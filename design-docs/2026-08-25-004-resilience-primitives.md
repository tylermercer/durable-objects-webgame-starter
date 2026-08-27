# Resilience Primitives & Device-Drop Handling

## Scope

This is a second addendum to `design-docs/2026-08-24-additional-primitives.md`, alongside `2026-08-25-first-player-primitive.md`. It targets a specific weak spot: the template already has a signaling-level reconnect story (rejoin tokens, disconnect grace period — §3 of the additional-primitives doc) but the WebRTC layer underneath it, and the DO's own durability, have gaps that undermine it. A controller can be fully "reconnected" at the signaling layer while its actual game connection is silently dead, and a rejoin token can be rendered meaningless by something as ordinary as the Durable Object going idle.

As before, everything here is additive and opt-in — a game that does nothing extra keeps behaving as it does today, just with a sturdier floor under it.

## 1. Rejoin tokens don't survive Durable Object eviction

This is the highest-priority gap. `GameSession.rejoinTokens` is a plain in-memory `Map`. Cloudflare can evict an idle Durable Object between requests; when a request wakes a fresh instance, that instance starts with an **empty** `rejoinTokens` map. The controller's `localStorage` token is untouched, but the DO no longer recognizes it — so what should be a rejoin (`join(callbacks, rejoinToken)` with a known token) instead falls into the "unknown token" branch and mints a brand-new player identity.

The existing 45-second grace period only protects against a *live* DO seeing a brief socket drop. It does nothing for a DO that went to sleep entirely — which, for a game like Liar's Dice where players spend long stretches just reading the board, is a realistic scenario (session idle timeouts vary, but assume single-digit minutes of inactivity is enough).

**Fix:** persist `rejoinTokens` (and `nextPlayerNumber`, so post-eviction names don't collide with pre-eviction ones) to the DO's durable storage, the same mechanism `saveGameState`/`loadGameState` already use:

```ts
// src/lib/GameSession.ts
async fetch(request: Request): Promise<Response> {
  await this.hydrateIfNeeded();
  // ... existing logic
}

private hydrated = false;
private async hydrateIfNeeded() {
  if (this.hydrated) return;
  this.hydrated = true;
  const stored = await this.ctx.storage.get<[string, ControllerRecord][]>("rejoinTokens");
  if (stored) this.rejoinTokens = new Map(stored);
  const nextNum = await this.ctx.storage.get<number>("nextPlayerNumber");
  if (nextNum) this.nextPlayerNumber = nextNum;
}

private async persistRejoinTokens() {
  await this.ctx.storage.put("rejoinTokens", [...this.rejoinTokens.entries()]);
  await this.ctx.storage.put("nextPlayerNumber", this.nextPlayerNumber);
}
```

Call `persistRejoinTokens()` wherever the map currently changes: new-token creation in `join()`, `disconnectedAt` updates in `handleClose()`, and purges in `alarm()`. This is a small, bounded write (a handful of players, each record is tiny) — well under the storage-value size concerns called out for `gameState`.

One nuance: an evicted-then-woken DO has no live `sessions` for anyone, even a console that was connected five minutes ago. On wake, every client's signaling socket is already broken and will hit its own `scheduleReconnect()` (see §3) and reconnect fresh — that's fine, since the persisted `rejoinTokens` map is what makes those reconnects resolve to existing identities instead of new ones. The console reconnecting should similarly get `loadGameState()`'s persisted state back, so the room picks up where it left off.

## 2. WebRTC-level drops aren't detected or healed

The signaling layer (DO + rejoin tokens) is one connection. The actual gameplay connection is the peer-to-peer `RTCPeerConnection` it negotiates, and today nothing watches or repairs that layer on its own:

- `pc.onconnectionstatechange` in `peer-connection.ts` only forwards the raw state to a callback that updates UI text (`controller!.state = state` on console, a status string on controller). Nothing acts on `"disconnected"` or `"failed"`.
- `"disconnected"` is often transient (brief network hiccup) and self-heals within seconds — fine to leave alone, maybe with a short debounce before showing anything alarming to the user.
- `"failed"` does **not** self-heal. WebRTC's own guidance is that the connection needs an ICE restart or full renegotiation at that point. Right now the only way out is the controller reloading the page, which — combined with §1 being unfixed — used to also lose their identity; even with §1 fixed, a manual reload is a rough experience mid-game.

**Add an ICE-restart helper to `PeerConnection`:**

```ts
// src/scripts/peer-connection.ts (addition)
async restartIce() {
  if (!this.isInitiator) return; // only the offering side restarts
  const offer = await this.pc.createOffer({ iceRestart: true });
  await this.pc.setLocalDescription(offer);
  this.callbacks.onSignal({ sdp: offer });
}
```

And wire it into the existing state-change callback with a short debounce, so a same-second `"disconnected"` → `"connected"` blip doesn't trigger a needless restart:

```ts
this.pc.onconnectionstatechange = () => {
  const state = this.pc.connectionState;
  this.callbacks.onStateChange?.(state);
  if (state === "failed" && this.isInitiator) {
    this.restartIce().catch(() => {});
  }
};
```

Since the signaling socket (DO relay) is a separate connection from the `RTCPeerConnection`, an ICE restart can ride over it exactly like the original offer/answer did — no new plumbing needed there, just a fresh `sdp` signal through the same `sendSignal` path.

## 3. Reconnect thundering herd

Both `ControllerApp.scheduleReconnect()` and `ConsoleApp.scheduleReconnect()` retry the signaling socket on a flat 3-second timer. That's fine for a single client, but a DO cold-start (or a shared-WiFi blip affecting a whole room) means every controller's `onRpcBroken` fires within the same tick, and they'll all retry on the same 3s boundary — a small, self-inflicted spike right when the DO is already paying a cold-start cost. Standard fix, small change:

```ts
// shared pattern for both ControllerApp and ConsoleApp
private reconnectAttempt = 0;

scheduleReconnect() {
  if (this.reconnectTimer) return;
  const base = Math.min(30000, 1000 * 2 ** this.reconnectAttempt);
  const jitter = Math.random() * base * 0.3;
  this.reconnectTimer = window.setTimeout(() => {
    this.reconnectTimer = null;
    this.reconnectAttempt++;
    this.connectSignaling();
  }, base + jitter);
}
```

Reset `reconnectAttempt` to 0 on a successful `join()` resolution.

## 4. Heartbeat / RTT — an unused primitive that already half-exists

`peer-connection.ts` already defines `PingMessage`/`PongMessage` types and auto-replies to a `"ping"` with a `"pong"` — but nothing ever *sends* a ping. It's dead code today. Finishing it gives two things at once: a liveness signal independent of (and often faster than) `RTCPeerConnectionState`, and an actual RTT number games can use for a "weak connection" indicator.

```ts
// src/scripts/peer-connection.ts (addition)
startHeartbeat(intervalMs = 3000, onRtt?: (ms: number) => void) {
  const timer = setInterval(() => {
    const t = performance.now();
    this.sendControl({ type: "ping", t });
    const off = this.addControlListener(msg => {
      if (msg.type === "pong" && (msg as PongMessage).t === t) {
        onRtt?.(performance.now() - t);
        off();
      }
    });
  }, intervalMs);
  return () => clearInterval(timer);
}
```

Both console and controller can call this once a `PeerConnection` reaches `"connected"`. This is opt-in per game via `onRtt` — the template itself doesn't need to render anything, but a game (or the template's own controller badge) can.

## 5. TURN fallback

Current ICE config is STUN-only:

```ts
const STUN_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};
```

STUN is enough for most home networks (both peers discover a usable public address and connect directly). It is *not* enough behind symmetric NAT or on networks that block P2P UDP outright — both realistic at a party on venue WiFi, which is this template's actual use case. Without a TURN relay, those users simply can't connect at all, with no fallback and no clear error message beyond "still connecting...".

This doesn't need to ship a bundled TURN server — that's an operational/cost decision for whoever deploys a game — but the template should have the config slot ready:

```ts
// src/scripts/peer-connection.ts
const ICE_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    ...(import.meta.env.PUBLIC_TURN_URLS
      ? [{
          urls: import.meta.env.PUBLIC_TURN_URLS.split(","),
          username: import.meta.env.PUBLIC_TURN_USERNAME,
          credential: import.meta.env.PUBLIC_TURN_CREDENTIAL,
        }]
      : [])
  ]
};
```

Document in the README that this is optional but recommended for any real deployment, with a pointer to a couple of managed TURN providers. Leaving it unset keeps today's STUN-only behavior exactly as-is.

## 6. One connection-status model instead of three

Right now "is this player connected" has three different, partially-overlapping answers depending on where you ask:

| Layer | Where it lives | What it actually tells you |
|---|---|---|
| `RTCPeerConnectionState` | `PeerConnection.pc.connectionState` | Is the WebRTC data path currently up |
| `ControllerRecord.disconnectedAt` | `GameSession.rejoinTokens` | Is there a live signaling socket for this player, and if not, since when |
| `ControllerState.state` | `console.ts`'s `ControllerState` | Currently just a copy of the WebRTC state, string-typed |

A game trying to show "this player is having trouble" today has to reconcile all three itself, and none of them alone captures the case that actually matters for gameplay pacing: *is this player able to act right now*. Proposed single enum, computed once and handed to games instead of the raw pieces:

```ts
export type PlayerConnectionStatus =
  | "live"          // signaling connected AND WebRTC data channel open
  | "reconnecting"  // signaling connected, WebRTC renegotiating (post-restartIce)
  | "grace-period"  // signaling dropped, within the DO's grace window (§1 makes this survive eviction too)
  | "gone";         // grace period expired, player purged
```

Compute it on the console (it already has visibility into both the DO callbacks and each `PeerConnection`'s state) and thread it through `ControllerState`/`ConsoleContext.peers` the same way `isFirstPlayer` was threaded through in the first-player primitive doc — same shape of change, same "games get a richer field on the same shared `Map`, no new plumbing" story.

## 7. Configurable grace period

`DISCONNECT_GRACE_PERIOD_MS = 45000` is a fixed constant in `GameSession.ts`, shared by every game. A turn-based game like Liar's Dice can afford to hold a slot open for a couple of minutes without hurting pacing for anyone else; a fast real-time game may want to declare someone "really gone" sooner so the game keeps moving. Make it a parameter set at room creation instead of a hardcoded constant — e.g. passed through the initial console `join()` call (console is the natural place to declare "this room is running game X with grace period Y") and stored on the DO instance for that room's lifetime.

## 8. Turn-based logic should know about grace-period vs. active

Separate from *detecting* a drop is *what a game does with that information*. Liar's Dice's bidding timer counts down identically for a player who is fully present and one who is mid-grace-period after a drop — meaning a phone locking for even a few seconds during someone's turn can auto-bid or auto-challenge for them, functionally punishing a network blip the same as inattention. This isn't a framework primitive so much as a convention worth establishing: expose the §6 `PlayerConnectionStatus` to turn logic, and have turn-based games pause or extend the active player's timer while their status is `"grace-period"` rather than `"live"`, resuming normal countdown on reconnect. Real-time games (Flappy Royale) don't need this — a dropped player's bird can just keep simulating with stale input, which is already effectively what happens today.

## Summary: what's new where

| File | Addition |
|---|---|
| `src/lib/GameSession.ts` | hydrate/persist `rejoinTokens` + `nextPlayerNumber` via `ctx.storage` (§1); configurable grace period param (§7) |
| `src/scripts/peer-connection.ts` | `restartIce()` + debounced auto-restart on `"failed"` (§2); `startHeartbeat()` (§4); TURN-aware `ICE_CONFIG` (§5) |
| `src/scripts/controller.ts` / `src/scripts/console.ts` | exponential backoff + jitter on `scheduleReconnect()` (§3); compute and surface `PlayerConnectionStatus` (§6) |
| `src/examples/liars-dice/console.ts` | pause/extend turn timer while active player's status is `"grace-period"` (§8) |
| README | document optional `PUBLIC_TURN_URLS`/`PUBLIC_TURN_USERNAME`/`PUBLIC_TURN_CREDENTIAL` env vars (§5) |
