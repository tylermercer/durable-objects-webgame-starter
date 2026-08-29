# Relay Fallback Transport (DO-Relayed Input/Control)

**Date:** 2026-08-28
**Status:** Proposed
**Depends on:** `2026-08-24-001-core-architecture.md` (signaling model), `2026-08-24-002-additional-primitives.md` (framework primitives)

## Motivation

WebRTC connections between a console and a controller are established via STUN-discovered candidates, with TURN configured as an optional relay of last resort (`PUBLIC_TURN_URLS`/`PUBLIC_TURN_USERNAME`/`PUBLIC_TURN_CREDENTIAL`). Two problems with relying on TURN as the sole fallback:

1. Operating a trustworthy, always-available TURN server is an ongoing infrastructure burden that many deployers of this template won't want to take on.
2. STUN-established connections can fail *after* they've connected, not just during initial negotiation. This is common on networks with stateful firewalls or double NAT (e.g. corporate/office networks): the initial UDP hole-punch succeeds, but the NAT/firewall's binding times out or the path is throttled shortly after, and `iceConnectionState` transitions to `disconnected` or `failed` mid-session. A fallback that only triggers on *initial* connection failure misses this case entirely and leaves the affected player stranded mid-game.

Since every console↔controller pair already has a persistent signaling channel open to the `GameSession` Durable Object (the Cap'n Web RPC session used for offer/answer/ICE relay), we can reuse that same channel as a full message relay instead of depending on TURN. This avoids adding new infrastructure and reuses bookkeeping (player numbers, connection tracking) the DO already maintains.

## Goals

- Game logic (`src/logic/console.ts`/`controller.ts`, and the example games) should be unaware of whether a given peer's traffic is flowing over WebRTC data channels or relayed through the DO.
- Fall back to relay both when initial WebRTC negotiation fails to connect within a timeout, *and* when a previously-connected pair degrades to `disconnected`/`failed` later in the session.
- Preserve existing channel semantics as closely as possible: `input` (loss-tolerant, latest-wins) vs. `control` (must-arrive) as documented in the README.
- No changes required to `rejoinToken`/reconnect-grace-period behavior; relay mode should compose with it, not replace it.
- TURN remains optional and can still be tried before relay, but is no longer required for the template to work reliably.

## Non-goals

- Optimizing relay-mode bandwidth/latency beyond "acceptable for a Jackbox-style party game" (small JSON messages, a handful of players). No binary framing, batching, or compression in this pass.
- Automatically retrying/upgrading from relay back to P2P mid-session. Once a pair is in relay mode, it stays there for the rest of the session (see Open Questions).

## Current behavior (baseline)

- `src/transport/peer-connection.ts` establishes two RTCDataChannels per console↔controller pair: `input` (unreliable/unordered) and `control` (reliable/ordered).
- Signaling (offer/answer/ICE candidates) is relayed through `GameSession` via a Cap'n Web RPC session over WebSocket, per `src/lib/GameSession.ts` / `src/lib/signaling-api.ts`.
- Once `PeerConnection` reports `connected`, the signaling channel is not used again for that pair except for out-of-band things like `saveGameState`/`loadGameState`.
- If P2P negotiation never connects, current behavior is to rely on TURN candidates (if configured) to establish a relayed WebRTC path; there is no non-WebRTC fallback.

## Design

### 1. Shared transport interface

Introduce a `GameTransport` interface that both `PeerConnection` and a new `RelayConnection` implement:

```ts
interface GameTransport {
  sendInput(msg: unknown): void;
  sendControl(msg: unknown): void;
  sendControlCoalesced(key: string, msg: unknown): void;
  onInput(cb: (msg: unknown) => void): void;
  onControl(cb: (msg: unknown) => void): void;
  readonly mode: "p2p" | "relay";
  onModeChange(cb: (mode: "p2p" | "relay") => void): void;
}
```

`PeerConnection` is refactored to satisfy this interface (it already implements everything except `mode`/`onModeChange`). Consumers (`src/host/console.ts`, `src/host/controller.ts`, `src/contract/gameSource.ts`, and the framework primitives `InputStateSync`/`sendControlCoalesced`) are updated to depend on `GameTransport` rather than `PeerConnection` directly. Game logic never needs to branch on `mode` — it's exposed for UI purposes only (e.g. optionally showing a "relayed connection" indicator).

### 2. `RelayConnection`

A new class in `src/transport/relay-connection.ts` that:
- Wraps the existing Cap'n Web RPC session already open to the `GameSession` DO for this peer.
- Implements `sendInput`/`sendControl`/`sendControlCoalesced` by calling new DO RPC methods (`relayInput`, `relayControl`) addressed to the specific peer (console, or controller N).
- Implements `onInput`/`onControl` by subscribing to relay messages pushed from the DO for this peer.
- `sendControlCoalesced` keeps the same "latest value per key wins until flushed" semantics client-side that `PeerConnection` already implements, rather than relying on the DO to coalesce — the DO relay methods are treated as simple pass-through.

### 3. DO relay API additions

Extend `signaling-api.ts` / `GameSession.ts` with two RPC methods, mirroring the existing offer/answer relay pattern:

- `relayInput(fromRole, toPlayerNumber | "console", payload)`
- `relayControl(fromRole, toPlayerNumber | "console", payload)`

Routing reuses the same player-number/connection bookkeeping the DO already maintains for signaling — no new state needed beyond what's used to relay offer/answer/ICE today. Messages are forwarded to the target's live RPC session; if the target isn't currently connected (e.g. mid-reconnect), the payload is dropped for `input` (loss-tolerant by design) and briefly queued (bounded, e.g. last N messages or a few seconds) for `control`, consistent with the existing reconnect grace period.

### 4. Negotiation-timeout fallback (initial connect)

In `PeerConnection` setup, start a timer (default ~8–10s, configurable) when ICE negotiation begins. If `connectionState`/`iceConnectionState` hasn't reached `connected` by the timeout, the caller (console/controller bootstrap in `src/host/`) discards the `PeerConnection` attempt and constructs a `RelayConnection` for that peer instead. TURN, if configured, can still be attempted as an intermediate step before this timeout expires; if TURN is not configured, this is the only fallback path.

### 5. Mid-session degradation promotion

This is the piece motivated by the office-network case. `PeerConnection` already exposes ICE connection state changes; the bootstrap code adds a listener:

- On transition to `disconnected`: start a short grace timer (a few seconds) rather than promoting immediately, since `disconnected` can be transient and self-heal (this matches typical WebRTC guidance and avoids flapping).
- If the state reaches `failed`, or `disconnected` persists past the grace timer without returning to `connected`, promote that pair to relay: construct a `RelayConnection` using the peer's still-open signaling session, swap it in as the active `GameTransport` for that peer, and tear down the dead `RTCPeerConnection`.
- Because game logic only ever holds a reference to the current `GameTransport` (not the concrete `PeerConnection`/`RelayConnection`), this swap is transparent — in-flight `sendControlCoalesced` state and `onInput`/`onControl` subscriptions are re-registered on the new transport by the same bootstrap code that owns the swap, not by game logic.
- This composes with `rejoinToken`: if the underlying WebSocket signaling session itself drops (not just the WebRTC path), normal rejoin/grace-period handling applies regardless of which transport mode was active at the time.

### 6. Channel semantics under relay

- `input` messages relayed through the DO are inherently reliable/ordered (WebSocket/TCP), unlike the unreliable/unordered RTCDataChannel. This is a strict upgrade in delivery guarantees, not a regression — no changes needed to game logic, which already tolerates dropped/stale input by design (per README: "a dropped snapshot just means one stale frame, corrected by the next one").
- `control` semantics (must-arrive, ordered) are preserved as-is by the relay.
- `sendControlCoalesced` behavior (keep only newest message per key until ready to send) is preserved client-side in `RelayConnection` for consistency, even though a WebSocket relay is less likely to backlog than a data channel under load.

## Message flow (mid-session promotion)

```
Console PeerConnection          GameSession DO           Controller PeerConnection
        |  iceConnectionState -> disconnected                    |
        |  (grace timer running)                                 |
        |  ... timer expires without recovery ...                |
        |----- construct RelayConnection (console side) -------->|
        |                                                         |
        |====== relayInput / relayControl via existing RPC ======>|
        |<===== relayInput / relayControl via existing RPC =======|
        |                                                         |
        |  (RTCPeerConnection for this pair torn down)            |
```

## Rollout / testing

- Add a debug toggle (env var or query param) to force relay mode for a given pair, to test the relay path without needing to reproduce a real NAT failure.
- Manually reproduce the reported scenario (one participant on an office network, others remote) to confirm the grace-timer + promotion path triggers and that gameplay continues uninterrupted through the swap.
- Verify `saveGameState`/`loadGameState` and rejoin flows are unaffected, since they already go through the DO independent of transport mode.

## Open questions

- Should a relayed pair ever attempt to renegotiate back to P2P later in the session (e.g. after a network change)? Deferred for now — added complexity (re-running ICE negotiation live, swapping transports a second time) isn't obviously worth it for typical party-game session lengths.
- Should TURN configuration and DO-relay fallback be mutually exclusive, or should TURN be tried first as a lower-latency relay when available, falling back to DO-relay only if TURN also fails? Current design allows both to coexist (TURN attempted during normal ICE negotiation, DO-relay as the timeout/degradation backstop), but this could be simplified to DO-relay-only if TURN is dropped from the template entirely.
- Bound on `control` message queueing in the DO when a target is briefly unreachable during promotion/reconnect — needs a concrete size/time limit to avoid unbounded memory growth per room.
