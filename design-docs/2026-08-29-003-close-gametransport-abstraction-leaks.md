# Close GameTransport Abstraction Leaks

**Date:** 2026-08-29
**Status:** Proposed
**Depends on:** `2026-08-28-004-relay-fallback-transport.md` (relay fallback transport — implemented)

## Motivation

`004` introduced `GameTransport` specifically so that game logic and, more broadly, the host bootstrap code wouldn't need to know whether a given peer is connected over WebRTC or DO-relay. In practice, the host bootstrap code (`src/host/console.ts`) doesn't fully honor that boundary: it reaches past the interface with `instanceof PeerConnection` / `instanceof RelayConnection` checks to get at transport-specific details, most importantly the raw `RTCPeerConnectionState` needed to compute a controller's displayed status. Separately, three call sites in `console.ts` repeat an identical four-line "look up this controller, create it if it doesn't exist yet" block. Neither issue is a bug today, but both make the code harder to read and slightly easier to break — the `instanceof` checks in particular mean `GameTransport` isn't actually doing its job as an abstraction boundary, just as documentation of intent.

## Goals

- `computePlayerStatus` and its callers stop needing to know the concrete transport class. All the information they need is available through `GameTransport` itself.
- The repeated "find or create controller" lookup in `console.ts` becomes a single named helper.
- No behavior change — this is purely a readability/maintainability cleanup, verified by existing status-badge and relay-promotion test coverage continuing to pass unmodified.

## Non-goals

- Changing what `computePlayerStatus` returns or when status transitions happen. The five states (`live`, `live-relay`, `reconnecting`, `grace-period`, `gone`) and their triggers are unchanged.
- Restructuring `PeerConnection`/`RelayConnection` beyond adding one read-only property to each.
- This doc assumes `2026-08-29-002-shared-connection-orchestrator.md` may or may not have landed yet; the changes here are independent and apply equally to the current `console.ts`/`controller.ts` or to their post-orchestrator replacements.

## Current behavior (baseline)

### `instanceof` checks

`src/host/console.ts:426-428`, inside `updateControllerStatus`:

```ts
let rtcState: RTCPeerConnectionState | null = null;
if (controller.pc && controller.pc instanceof PeerConnection) {
  rtcState = controller.pc.pc.connectionState;
}
controller.status = computePlayerStatus(controller.signalingConnected, rtcState, controller.pc?.mode);
```

And at `src/host/console.ts:554` / `578` and the mirrored spots in `controller.ts` (`:246`, `:275`), the same pattern recurs to decide whether a pending timeout should actually promote to relay:

```ts
if (controller.pc?.mode === "p2p" && (controller.pc as PeerConnection).pc.connectionState !== "connected") {
  this.promoteToRelay(controller);
}
```

Every one of these sites is really asking one question — "what's this transport's current connection state, expressed the same way regardless of which class it is?" — but has to know the concrete class to ask it.

### Duplicated controller lookup

`src/host/console.ts`'s `handleRelayInput`, `handleRelayControl`, and `handleSignal` each open with:

```ts
let controller = this.controllers.get(from);
if (!controller) {
  this.addController(from, `Player ${this.controllers.size + 1}`);
  controller = this.controllers.get(from)!;
}
```

verbatim, three times.

## Design

### 1. `connectionState` on `GameTransport`

Add a read-only property to the interface in `src/transport/transport.ts`:

```ts
export interface GameTransport {
  readonly mode: TransportMode;
  readonly connectionState: RTCPeerConnectionState; // "connected" for relay (it's either usable or being torn down, no partial states)
  // ...unchanged members
}
```

- `PeerConnection.connectionState` becomes a getter returning `this.pc.connectionState` — no new state, just exposing what's already tracked.
- `RelayConnection.connectionState` returns the literal `"connected"` always. A `RelayConnection` instance only exists once a peer has been promoted to relay and is, by construction, usable for sending; there's no partial-connection state to represent on the relay path (the underlying signaling WebSocket's health is tracked separately via `signalingConnected`, not conflated here).

With this in place, `computePlayerStatus`'s signature and logic don't need to change — only its call site does, since it can now read `controller.pc?.connectionState` directly instead of branching on `instanceof PeerConnection` first:

```ts
updateControllerStatus(controller: ControllerState) {
  const rtcState = controller.pc?.connectionState ?? null;
  controller.status = computePlayerStatus(controller.signalingConnected, rtcState, controller.pc?.mode);
  controller.state = controller.status;
  this.updateControllerUI();
}
```

The timeout-callback sites (`controller.pc?.mode === "p2p" && (controller.pc as PeerConnection).pc.connectionState !== "connected"`) simplify the same way, to `controller.pc?.connectionState !== "connected"` — the `mode === "p2p"` half of the check becomes redundant once relay always reports `"connected"`, since the intent ("don't promote if we're not actually still stuck") is fully captured by `connectionState` alone.

### 2. `getOrCreateController` helper

Add a private method to `ConsoleApp`:

```ts
private getOrCreateController(id: string): ControllerState {
  let controller = this.controllers.get(id);
  if (!controller) {
    this.addController(id, `Player ${this.controllers.size + 1}`);
    controller = this.controllers.get(id)!;
  }
  return controller;
}
```

and replace all three call sites with `const controller = this.getOrCreateController(from);`.

## Testing

- Existing status-badge tests (whatever currently exercises `computePlayerStatus` and `updateControllerUI`) should pass unmodified against the new `connectionState`-based implementation — this is the main correctness check, since the goal is identical output via a cleaner path.
- Add a small unit test asserting `RelayConnection.connectionState === "connected"` immediately after construction, since that's now a piece of the public contract other code depends on rather than an incidental default.
- Re-run relay-promotion coverage (negotiation timeout, mid-session `failed`/`disconnected`) to confirm the simplified timeout-callback condition (`connectionState !== "connected"` without the `mode === "p2p"` guard) behaves identically — it should, since relay mode always reports `"connected"` and would therefore never satisfy the promotion condition anyway, but this is worth confirming explicitly given it's a subtle behavioral equivalence rather than an obviously identical rewrite.

## Open questions

- None outstanding — both changes are small, additive to the interface (no existing implementers break), and don't touch timing or state-transition behavior.
