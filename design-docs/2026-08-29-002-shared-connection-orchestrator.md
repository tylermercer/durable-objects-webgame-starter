# Shared Connection Orchestrator

**Date:** 2026-08-29
**Status:** Proposed
**Depends on:** `2026-08-28-004-relay-fallback-transport.md` (relay fallback transport — implemented)

## Motivation

`2026-08-28-004` added negotiation-timeout and mid-session-degradation promotion to `RelayConnection`. That logic — start a negotiation timer, start a disconnect grace timer, clear both on `connected`, promote to relay on `failed` or on timeout expiry, respect a forced-transport override for debugging — is implemented independently in both `src/host/console.ts` (per-controller, inside `handleSignal`) and `src/host/controller.ts` (singleton, inside `initiateWebRTC`). The two implementations are not shared code; they are hand-written twins that happen to currently agree, including the literal timeout values (`8000` for negotiation, `4000` for post-disconnect grace) and the four-line timer-clearing block, which appears verbatim four separate times across the two files.

This duplication is a maintenance hazard, not just a style complaint. Every future change to the connection state machine — adjusting a timeout, adding a new state transition, fixing a race in when timers get cleared — has to be applied twice, by hand, in two files that have no compiler or test coupling to each other. It is easy to fix a bug in one copy and not notice the other copy has the same bug, since nothing will fail loudly if they drift; the two roles will simply start behaving slightly differently under network stress, which is exactly the kind of thing that's hard to catch in testing and easy to catch in a live game.

## Goals

- One implementation of the negotiation-timeout / disconnect-grace / promote-to-relay state machine, used by both the console (per-controller) and controller (singleton) bootstrap code.
- No behavior change to the connection lifecycle itself — this is a structural refactor, not a redesign. Timer durations, promotion triggers, and `forced` transport override semantics stay exactly as they are today.
- Timer state (`negotiationTimer`, `disconnectTimer`) becomes private to the new module instead of being fields the caller must remember to clear at every exit path (`removeController`, `promoteToRelay`, the `connected` branch of `onStateChange`, `handleConsoleGone`).
- `console.ts` and `controller.ts` shrink to role-specific glue: constructing the orchestrator, wiring its callbacks to UI updates and signaling RPC calls, and nothing else.

## Non-goals

- Changing when or how relay promotion is triggered. The triggers (negotiation timeout, `failed` state, `disconnected` past grace period) and their durations are unchanged.
- Touching `RelayConnection` or `PeerConnection` internals. Both classes already implement `GameTransport` correctly; this doc is about who *constructs and supervises* them, not what they do once constructed.
- Removing the `forced` transport debug override (`getForcedTransport()` / `?force_transport=`). It moves into the orchestrator but keeps its current behavior.

## Current behavior (baseline)

Both files independently do the following on WebRTC negotiation start:

1. Construct a `PeerConnection`, passing an `onStateChange` callback.
2. If `forced !== "rtc"`, start an 8000ms `negotiationTimer`. On expiry, if the underlying `RTCPeerConnection.connectionState` still isn't `"connected"`, promote to relay.
3. In `onStateChange`:
   - `"connected"`: clear both timers, run role-specific side effects (console: send `identity` control message and update UI; controller: update status text).
   - `"disconnected"`: if `forced !== "rtc"` and no `disconnectTimer` is already running, start a 4000ms one. On expiry, if still not `"connected"`, promote to relay.
   - `"failed"`: if `forced !== "rtc"`, promote to relay immediately.
   - default: update status/UI only.
4. `promoteToRelay()`: clear both timers, close the existing transport, construct a `RelayConnection`, swap it in, and re-send anything the new transport needs (console re-sends `identity`; controller re-subscribes game logic).

Timer fields live directly on `ControllerState` (console side, one instance per controller — `src/host/console.ts:36-37`) and on `ControllerApp` (controller side, a single instance — `src/host/controller.ts:56-57`). Every function that can end a connection's life early (`removeController`, `promoteToRelay`, `handleConsoleGone`) has to remember to clear both timers itself; there is no single place that guarantees this happens.

## Design

### 1. `ConnectionOrchestrator`

A new class in `src/transport/connectionOrchestrator.ts`, one instance per console↔controller pair (so the console creates one per `ControllerState`, and the controller creates exactly one for itself):

```ts
export interface ConnectionOrchestratorCallbacks {
  onSignal: (signal: RTCSignal) => void;
  onTransportChange: (transport: GameTransport) => void; // fired on initial pc creation AND on relay promotion
  onStateChange?: (state: RTCPeerConnectionState) => void; // pass-through for UI/status text
}

export interface ConnectionOrchestratorOptions {
  isInitiator: boolean;
  negotiationTimeoutMs?: number; // default 8000
  disconnectGraceMs?: number;    // default 4000
  getApi: () => RpcStub<ConsoleApi | ControllerApi> | null;
  peerId?: string; // console side: target controller id. controller side: undefined.
}

export class ConnectionOrchestrator {
  readonly transport: GameTransport; // current active transport; identity changes on promotion, so callers must read this via onTransportChange rather than caching it
  constructor(opts: ConnectionOrchestratorOptions, callbacks: ConnectionOrchestratorCallbacks);
  handleSignal(signal: RTCSignal): Promise<void>; // no-ops if current transport isn't a PeerConnection
  createOffer(): Promise<RTCSessionDescriptionInit>; // controller side only; throws if !isInitiator
  forcePromoteToRelay(): void; // used by the `force_transport=relay` debug path and by relay-message-received handlers on both sides
  close(): void; // clears all timers, closes the transport, unconditionally — the single place cleanup happens
}
```

The orchestrator owns the negotiation timer, the disconnect timer, and the `PeerConnection` → `RelayConnection` swap. It does not own anything role-specific: no UI updates, no `identity` message construction, no game-instance lifecycle. Those stay in `console.ts`/`controller.ts` as callback bodies.

### 2. Timer ownership

`negotiationTimer` and `disconnectTimer` become private fields on `ConnectionOrchestrator`, not on `ControllerState` or `ControllerApp`. `close()` is the only method that clears them, and it's called from exactly the places that already call `controller.pc?.close()` / `this.pc?.close()` today (`removeController`, `promoteToRelay`'s internal teardown-before-rebuild, `handleConsoleGone`). This removes the four duplicated clear-both-timers blocks entirely — they collapse into one `close()` implementation.

### 3. Role-specific glue

`console.ts`'s `handleSignal` becomes:

```ts
if (!controller.orchestrator) {
  controller.orchestrator = new ConnectionOrchestrator(
    { isInitiator: false, getApi: () => this.api, peerId: from },
    {
      onSignal: sig => this.api?.sendSignal(from, sig),
      onTransportChange: transport => {
        controller!.pc = transport;
        this.updateControllerStatus(controller!);
        if (transport.mode === "p2p") {
          transport.sendControl({ type: "identity", name: controller!.name, color: controller!.color });
        }
      },
      onStateChange: () => this.updateControllerStatus(controller!)
    }
  );
}
await controller.orchestrator.handleSignal(signal);
```

`controller.ts`'s `initiateWebRTC` follows the same shape, substituting its own `onTransportChange` (re-create `activeGame` against the new transport, update status text) in place of the console's identity-broadcast/UI-row logic.

The `getForcedTransport() === "relay"` check that both files currently do before constructing a `PeerConnection` at all moves inside the orchestrator's constructor — if forced relay is set, it skips straight to building a `RelayConnection` and never starts a negotiation timer, same as today's behavior in both files.

### 4. Interaction with relay messages arriving before promotion

Both `console.ts` and `controller.ts` have a path where a `relayInput`/`relayControl` message arrives from the DO before the local state machine has decided to promote (e.g. the *other* side already gave up and promoted, and is now sending over the relay). Today this is handled by an inline `if (controller.pc?.mode !== "relay") { promoteToRelay(); }` check in `handleRelayInput`/`handleRelayControl` on both sides. This becomes `orchestrator.forcePromoteToRelay()`, called from the same call sites, with the same idempotency (`forcePromoteToRelay()` is a no-op if already in relay mode).

## Migration plan

1. Add `ConnectionOrchestrator` alongside the existing code, fully unit-testable against the same fake `RTCPeerConnection`/timer mocks already used in `peer-connection.test.ts` and `relay-connection.test.ts`.
2. Port `console.ts` to use it, verifying `GameSession.test.ts`-adjacent integration behavior (controller list status badges, relay promotion, forced-transport query param) is unchanged.
3. Port `controller.ts` to use it.
4. Delete the now-dead timer fields from `ControllerState` and `ControllerApp`, and the four duplicated clear-both-timers blocks.

Steps 2 and 3 can land independently — the orchestrator doesn't require both callers to migrate simultaneously, so this can be split into two smaller reviewable changes if preferred.

## Testing

- New unit tests for `ConnectionOrchestrator` covering: negotiation timeout → relay promotion, `disconnected` → grace timer → recovery (no promotion) vs. → grace timer → still disconnected (promotion), `failed` → immediate promotion, `forced=rtc` suppressing all auto-promotion, `forced=relay` skipping P2P entirely, and `close()` clearing timers such that a late timer firing after `close()` is a no-op.
- Re-run existing `console.ts`/`controller.ts` behavioral coverage (status badge transitions, identity message delivery on connect, relay fallback via `?force_transport=relay`) to confirm no behavior change post-migration.
- Manually re-verify the two triggers from `004`'s testing section (negotiation-timeout and mid-session-degradation promotion) still work end-to-end after both files are migrated.

## Open questions

- Should `ConnectionOrchestrator` also absorb the `getOrCreateController`-style lookup boilerplate in `console.ts`, or is that a separate, smaller cleanup? Recommend keeping it separate (see `2026-08-29-003-close-gametransport-abstraction-leaks.md`) since it's orthogonal to timer/state-machine ownership.
- The controller side's `activeGame` re-creation currently happens inline in both `promoteToRelay` and `initiateWebRTC` with near-duplicate `loadControllerGame` calls. Worth folding into `onTransportChange` as part of this migration, or deferring? Recommend folding in since it's already touched by this refactor and removes another small duplication for free.
