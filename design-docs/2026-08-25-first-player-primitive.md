# First-Player Primitive

## Scope

This is an addendum to `design-docs/2026-08-24-additional-primitives.md`. It adds one more generic, opt-in primitive: knowing which connected controller was the **first to join**, so games can grant that player host-like privileges (most immediately: the ability to start the game). As part of the same change, it also formalizes rejoin-token handling as a small reusable utility instead of inline logic on `ControllerApp` — the first-player primitive depends on stable per-device identity across reconnects, and that identity is exactly what the rejoin token already provides, so the two belong in the same pass.

Like the other primitives, this is additive: a game that ignores it keeps behaving exactly as it does today.

## 1. Where "first player" already almost exists

`GameSession` already maintains `rejoinTokens: Map<string, ControllerRecord>` (§3 of the additional-primitives doc). Two properties of that map make it the right source of truth, with no new state needed:

- **It's insertion-ordered.** A `Map` preserves insertion order, and entries are only created for a *new* token — a rejoin reuses the existing entry rather than re-inserting it. So iterating `rejoinTokens.values()` already yields players in original join order, stable across reconnects.
- **It already tracks liveness.** Each `ControllerRecord` has `disconnectedAt: number | null`. `null` means "currently connected"; non-null means "in the disconnect grace period."

So "first player" is just: *the earliest-joined record that is currently connected.*

```ts
// src/lib/GameSession.ts (addition)
private getFirstPlayerId(): string | null {
  for (const record of this.rejoinTokens.values()) {
    if (record.disconnectedAt === null) return record.id;
  }
  return null;
}
```

**Design choice — priority follows connection, not a permanent claim.** If the first player's phone locks and they drop into the grace period, `getFirstPlayerId()` returns the next-earliest connected player until they reconnect — at which point they get first-player status back immediately, since it's computed from original join order, not recency. This matches "first *connected* player" literally and needs no extra bookkeeping. The alternative — first-player status is claimed once and kept permanently even across a full disconnect — is a reasonable variant for games that want a stickier "host," but it requires an explicit sticky-host field and a hand-off rule for when that host leaves for good; skipping it keeps this addition small. Flag it if you want it; it's a follow-up, not a blocker.

## 2. Broadcasting changes

Compute `getFirstPlayerId()` after every join, disconnect, reconnect, and grace-period purge; if it differs from the previously broadcast value, push it out. Add one callback to each side:

```ts
// src/lib/signaling-api.ts
export interface ConsoleCallbacks extends RpcTarget {
  onControllerJoined(id: string, name: string): void;
  onControllerLeft(id: string): void;
  onSignal(from: string, signal: RTCSignal): void;
  onFirstPlayerChanged(id: string | null): void; // new
}

export interface ControllerCallbacks extends RpcTarget {
  onConsoleReady(): void;
  onConsoleGone(): void;
  onSignal(signal: RTCSignal): void;
  onFirstPlayerChanged(id: string | null): void; // new
}
```

Also surface the current value at connect time, so a client doesn't have to wait for the next change event:

```ts
// src/lib/signaling-api.ts
export interface ControllerApi extends RpcTarget {
  join(
    callbacks: ControllerCallbacks,
    rejoinToken?: string
  ): { id: string; name: string; consoleConnected: boolean; rejoinToken: string; isFirstPlayer: boolean }
    | Promise<{ ... }>;
  sendSignal(signal: RTCSignal): void;
}

export interface ConsoleApi extends RpcTarget {
  join(callbacks: ConsoleCallbacks): {
    controllers: { id: string; name: string }[];
    firstPlayerId: string | null;
  } | Promise<{ ... }>;
  // sendSignal / saveGameState / loadGameState unchanged
}
```

`GameSession` calls `self.getFirstPlayerId()` inside `ControllerApi.join()` to populate `isFirstPlayer`, and inside `ConsoleApi.join()` for `firstPlayerId`, then calls the broadcast helper wherever join/leave/disconnect/reconnect already happens (`makeControllerApi().join()`, `handleClose()`, and the `alarm()` grace-period purge).

## 3. Console-side trust boundary

The controller UI will only *show* a start button to the first player, but the console must not trust that client-side gating alone — a stale `onFirstPlayerChanged` delivery, or a modified client, could still send a start request. The console tracks the current `firstPlayerId` itself (from its own `join()` response and `onFirstPlayerChanged` callback) and checks the sender before honoring any privileged control message:

```ts
// pattern used in each example game's console.ts
peer.pc.addControlListener(msg => {
  if (msg.type === "requestStart" && id !== currentFirstPlayerId) return; // ignored
  handleControlMessage(id, msg);
});
```

This is the same "console is sole authority" pattern already used for `saveGameState`/`loadGameState` being console-only — the DO tells the console who's first, and the console is the one thing every client already has to trust.

## 4. Wrapping rejoin-token handling into the connect flow

Today, `ControllerApp.getRejoinToken()` in `src/scripts/controller.ts` reads/writes `localStorage` inline as a private method. No game's `createGame(ctx)` touches it directly — but it's also not a documented primitive, has no test coverage, and breaks silently in private-browsing contexts where `localStorage` throws. Since the first-player primitive now depends on this identity being reliably stable, pull it out into its own small utility, matching the pattern of `rng.ts` / `gameLoop.ts` / `InputStateSync.ts`:

```ts
// src/utils/deviceIdentity.ts
const STORAGE_KEY = "rejoinToken";

export function getOrCreateRejoinToken(): string {
  try {
    let token = localStorage.getItem(STORAGE_KEY);
    if (!token) {
      token = crypto.randomUUID();
      localStorage.setItem(STORAGE_KEY, token);
    }
    return token;
  } catch {
    // Private browsing / storage disabled: fall back to a token that's
    // stable for this tab's lifetime but won't survive a refresh.
    return (globalThis as any).__sessionRejoinToken ??=
      crypto.randomUUID();
  }
}

export function persistRejoinToken(token: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, token);
  } catch {
    (globalThis as any).__sessionRejoinToken = token;
  }
}
```

`ControllerApp` calls `getOrCreateRejoinToken()` in place of its current inline method, and `persistRejoinToken(res.rejoinToken)` where it currently does the raw `localStorage.setItem` after `join()` resolves. Net effect for game authors: nothing changes in what they touch — `createGame(ctx)` still never sees a token — but the identity backing `isFirstPlayer` is now a documented, testable, degrade-gracefully primitive instead of a private implementation detail of one file.

## 5. Threading `isFirstPlayer` through to game code

- **Controller side:** `ControllerApp` stores `isFirstPlayer` from the `join()` response, updates it on `onFirstPlayerChanged`, and passes it into `createGame(ctx)`:

  ```ts
  // src/scripts/controller.ts
  export interface ControllerContext {
    peerConnection: PeerConnection | null;
    isFirstPlayer: boolean; // new
  }
  ```

  Since it can change after `createGame()` has already run (first player disconnects mid-game), also pass a way to observe updates rather than only a snapshot — simplest option is a getter closure so games that care can poll it each render/tick:

  ```ts
  isFirstPlayer: () => this.isFirstPlayer
  ```

- **Console side:** `ControllerState` (in `src/scripts/console.ts`) gains `isFirstPlayer: boolean`, updated on the same callback. Since `ctx.peers` passed into every game's `createGame()` is the *same* `Map` instance as `this.controllers`, this flows through to `liars-dice` and `flappy-royale`'s `ConsoleContext.peers` with no per-game plumbing.

## 6. Wiring the two example games

### Liar's Dice

The `"waiting"` phase currently has no way out — `console.ts`'s tick loop has a stub (`if (active.length >= 2) { // Ready to start game }`) with no call. This primitive is exactly the missing piece:

- **Controller:** in `"waiting"` phase, show a "Start Game" button only when `ctx.isFirstPlayer()` and at least 2 players are connected; otherwise show "Waiting for `<first player name>` to start…". Button sends `ctx.peerConnection.sendControl({ type: "requestStart" })` — add `RequestStartActionMessage` to the `LiarsDiceControlMessage` union in `types.ts`.
- **Console:** in the control-message handler, accept `"requestStart"` only if `id === currentFirstPlayerId` and `phase === "waiting"`, then call `startNextRound()` (finally giving that stub a real trigger).
- The existing `"nextRound"` message type (declared in `types.ts`, currently unhandled) is a natural second use of the same gate — worth wiring up in the same pass so "start next round" after game-over is also first-player-only, for consistency.

### Flappy Royale

Right now any flap during `"waiting"` or `"roundOver"` calls `startNewRound()` unconditionally — every player is effectively a start button, which is the behavior you're asking to replace:

- **Controller:** flapping during those phases only sends the flap as a start-trigger if `ctx.isFirstPlayer()`; other players' flaps in lobby/results phases are ignored (a UI hint — "Waiting for `<first player>` to start" — should replace the current always-active flap prompt for non-first players).
- **Console:** apply the same `id === currentFirstPlayerId` gate at both call sites that currently invoke `startNewRound()` from a controller message — the flap-handler one, *and* the one in the mid-lobby join-handling path (`if (currentState.phase === "waiting" && !currentState.birds[id]) startNewRound()`), which today can also auto-start the round just from a second player joining. Both need the same guard or the fix is incomplete.
- The console's own click-to-start on the shared screen is a host-device action, not a controller message, so it's unaffected — it stays trusted as-is.

### Touch Demo

Intentionally untouched per scope — it's the plumbing-verification demo, not a game with a lobby/start concept.

## 7. Cosmetic UI hooks (optional, cheap)

- Console's controller list (`updateControllerUI` in `src/scripts/console.ts`) can render a small badge next to the first player's row using the existing per-controller color styling — a nice-to-have, not required for the mechanic to work.
- Controller's own header can show "Host" under the player name when `isFirstPlayer()` is true, mirroring how `updatePlayerInfo` already renders name/color.

## Summary: what's new where

| File | Addition |
|---|---|
| `src/lib/GameSession.ts` | `getFirstPlayerId()` helper; broadcast on join/leave/reconnect/grace-purge (§1–2) |
| `src/lib/signaling-api.ts` | `onFirstPlayerChanged` on both callback interfaces; `isFirstPlayer`/`firstPlayerId` in both `join()` return types (§2) |
| `src/utils/deviceIdentity.ts` | new — `getOrCreateRejoinToken()` / `persistRejoinToken()`, extracted from `ControllerApp` (§4) |
| `src/scripts/controller.ts` | uses `deviceIdentity.ts` instead of inline localStorage calls; `ControllerContext` gains `isFirstPlayer` (§4–5) |
| `src/scripts/console.ts` | `ControllerState` gains `isFirstPlayer`; tracks `firstPlayerId` from callbacks (§5) |
| `src/examples/liars-dice/types.ts` | `RequestStartActionMessage` added to `LiarsDiceControlMessage` |
| `src/examples/liars-dice/console.ts` | `"requestStart"`/`"nextRound"` handling gated to `firstPlayerId`, finally calling `startNextRound()` (§6) |
| `src/examples/liars-dice/controller.ts` | start button shown only to first player in `"waiting"` phase (§6) |
| `src/examples/flappy-royale/console.ts` | both `startNewRound()` call sites gated to `firstPlayerId` (§6) |
| `src/examples/flappy-royale/controller.ts` | flap-as-start only sent by first player in lobby/results phases (§6) |
