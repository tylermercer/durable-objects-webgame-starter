# Player Departure Handling Across Examples

**Date:** 2026-09-01
**Status:** Proposed
**Depends on:** none (orthogonal to the room-lifetime-and-cleanup doc; that's DO-storage cleanup, this is in-game state cleanup)

## Motivation

The host layer (`ConsoleApp`, `GameSession`) already has a solid disconnect/kick story: `PlayerConnectionStatus` (`live` / `live-relay` / `reconnecting` / `grace-period`) is computed per controller and threaded onto `ConsoleContext.peers`, and every departure path — kick, grace-period expiry, and explicit leave — ends the same way: the entry is deleted from the live `ctx.peers` `Map` and `onControllerLeft` fires. That part of the contract works and is consistent.

What's inconsistent is what each example game *does* with that signal. `ctx.peers` is handed to `createGame()` once and mutated in place — nothing in the `ConsoleGameModule`/`ConsoleGameInstance` contract (`gameTypes.ts`) calls a game back when a peer disappears. Each example is on its own to notice a missing key and reconcile its internal state, and they've done so with three different levels of completeness, one of which (grid-dungeon) does effectively nothing. This doc is a survey of the current behavior per example, followed by a proposed contract addition and per-example fixes.

## Goals

- Every example behaves sanely when a controller disconnects, reconnects within the grace period, is kicked, or is purged after the grace period expires — no permanently stuck games, no leaked entities, no silent stalls with zero UI feedback.
- Establish one shared pattern for "notice departed players" that all examples use, instead of five ad-hoc implementations (or none).
- Distinguish, in each game's response, between *temporarily* gone (`grace-period` — still in `ctx.peers`, might come back) and *permanently* gone (removed from `ctx.peers` entirely) — these warrant different game behavior (pause vs. reassign/reclaim).
- Keep the fix additive to the existing `ConsoleContext.peers`-is-a-live-`Map` model; no game currently relies on `peers` being callback-driven, and a callback would be redundant with a `Map` games already poll every tick.

## Non-goals

- Not touching the signaling/WebRTC layer itself — `PlayerConnectionStatus`, the grace period, kick, and rejoin-token behavior in `GameSession`/`ConsoleApp` are all correct today and out of scope.
- Not adding turn-timers or auto-skip-on-inactivity for players who are simply slow (as opposed to disconnected). That's a separate, purely UX-driven feature.
- Not solving TURN/ICE-restart resilience (§2 of `2026-08-25-004-resilience-primitives.md`) — a player who never reconnects because their WebRTC path is broken looks identical, from a game-state perspective, to one who genuinely left; both are covered by the same fix here.

## Current behavior, by example

### touch-demo — fine, by construction

`render()` iterates `ctx.peers.values()` fresh every frame and draws a dot only if `controller.lastTouch` exists and isn't `end`/`cancel`. It holds no independent per-player state (`lastTouch` lives *on* the peer object itself, which is deleted along with the peer). A departed controller's dot simply stops being drawn on the next frame. Nothing to fix here, but it's a useful baseline: **a game with no independent per-player state can't leak.** Every other example keeps independent state (turn order, hands, entity registries) and that's where the gaps are.

### grid-dungeon — no removal logic at all

`syncPeers()` → `syncPlayers()` (`room.ts`) only ever *adds* or *updates* player entities from `activePeers`; there is no corresponding removal call. A `PlayerEntity` added to the `EntityRegistry` on join stays in the registry forever — through disconnect, through kick, through the grace period expiring, even through the DO evicting and `saveGameState`/`loadGameState` round-tripping it back on the next cold start.

Concretely, once a player leaves:
- Their sprite keeps rendering at its last position (frozen, since `joystickInputs` for that id stops updating but the entity itself is never deleted).
- The `Players: N` HUD counter never decrements.
- `camera.update(targets)` keeps averaging in the stale position, permanently skewing the camera toward wherever the departed player was standing.
- The ghost entity is included in `getSnapshot()` and broadcast to every remaining controller indefinitely.

This is the example the user flagged, and it's the clearest case: there's simply no code path that ever calls `registry.remove(id)`.

### liars-dice — no removal logic; can deadlock

Unlike othello/uno, there's no `syncRemovedPlayers()`-equivalent at all. `turnOrder` is computed once per round (`startNextRound()` → `getActivePlayerIds()`, which does correctly filter against `ctx.peers` presence) and then treated as fixed for the rest of the round — nothing re-derives it as peers come and go mid-round.

If the player whose turn it currently is (`turnOrder[turnIndex]`) is kicked or fully purged mid-bidding, `handleControlMessage` keeps checking `turnOrder[turnIndex] !== fromId` against an id that will never send another message. **No other player can ever bid or challenge again — the round is permanently stuck** until the console is manually reset (`onNewGame`). This is the most severe bug of the five examples, because it isn't a UX rough edge, it's a full soft-lock.

(Players who leave when it *isn't* their turn mostly self-heal: they vanish from `getPublicGameState().players` immediately since that list is built by mapping over live `ctx.peers`, and `getActivePlayerIds()` will correctly exclude them starting next round. Only the current-turn case deadlocks.)

### othello — has removal logic; ends the game abruptly, no mid-grace-period feedback

`syncRemovedPlayers()` (ticks only while `roundFlow.is("playing")`) does correctly diff `ctx.peers` against a tracked `knownPlayerIds` set, calls `turnOrder.removePlayer(id)` (which is safe to call for the current player — see `TurnOrder.removePlayer`, it clamps the index), clears `blackId`/`whiteId` if either departs, and calls `finishGame()` if either seat is now empty.

Two gaps:
1. This only fires once a player is **fully** gone (removed from `ctx.peers`). During the up-to-45-second `grace-period` window, the peer is still present in the map with `status: "grace-period"` — so if it's their turn, the board just sits frozen for the full grace period with no timeout and no visible feedback, then the game ends outright the moment they're purged, rather than pausing and offering to resume if they reconnect.
2. `PlayerPublicInfo.connected` is declared in `othello/types.ts` but **`PublicOthelloState` doesn't even have a `players: PlayerPublicInfo[]` field** — only `blackPlayer`/`whitePlayer` with just `{ id, name }`. The `connected` flag is dead: nothing computes it, nothing sends it, the controller/console UI has no way to show "your opponent's connection dropped" at all during the grace window.

### uno — has removal logic; can leave a one-player "game" running forever

Same `syncRemovedPlayers()` pattern as othello (`turnOrder.removePlayer(id)`, plus discarding their hand). This is safe mid-turn — `TurnOrder.removePlayer` handles the current-player case — but there's no check afterward for **"only one player remains."** Uno's only win condition is a hand reaching zero cards (`playCard` handler); nothing declares a winner or returns to `roundFlow: "waiting"` when attrition leaves a single player. That lone player can keep playing draw/discard against nobody indefinitely, with no winner ever declared and no way back to the lobby short of a manual reset.

Same grace-period gap as othello applies here too: `UnoConsole.tsx` does dim a disconnected player's row via `p.connected` (this one *is* wired up, unlike othello's dead field), so there's at least visual feedback, but there's still no timeout — the game just waits indefinitely on a `grace-period` player's turn.

### flappy-royale — no explicit handling, but self-heals by accident

There's no disconnect-aware code at all in `console.ts`. But because `stepRound()` in `sim.ts` applies gravity to every bird every tick regardless of input, and a departed player simply stops sending `flap` events, their bird falls and collides with the ground/a pipe within a few seconds like anyone who stops playing. `remainingAlive` naturally shrinks and the existing win condition (`<= 1 bird remains`) fires normally. This is the one example where doing nothing happens to be correct — worth calling out explicitly so a future contributor doesn't "fix" something that isn't broken, and worth using as the model for what a real-time game's departure handling should look like (physics does the work; no special-casing needed).

## Summary table

| Example | Fully-gone (post-grace/kick) | Mid-grace-period | Verdict |
|---|---|---|---|
| touch-demo | self-heals (no per-player state) | self-heals | fine |
| grid-dungeon | **ghost entity persists forever** | same (indistinguishable — no removal at all) | broken |
| liars-dice | **deadlocks if it was their turn** | same (indistinguishable — no removal at all) | broken |
| othello | game ends abruptly | frozen with zero UI feedback for up to 45s | partial |
| uno | game can end up stuck 1-player, no winner | frozen, but at least dimmed in UI | partial |
| flappy-royale | bird naturally dies within seconds via physics | same | fine (unintentionally) |

## Design

### 1. A shared helper, not a new contract callback

`ConsoleContext.peers` is already a live `Map` that every example polls once per tick via `syncPeers()`/`syncPeersAndListeners()`/`syncRemovedPlayers()` — adding an `onPeerRemoved` callback to the contract would just be a second notification path for the same information a game can already get by diffing the map, and three of five examples already do that diff themselves (with duplicated code). Instead, add one small utility both new and existing examples can call from their per-tick sync function:

```ts
// src/utils/peerDeparture.ts
export interface DepartureEvents {
  /** Ids present last tick, fully absent from ctx.peers this tick (kicked or grace-period-purged). */
  departed: string[];
}

/**
 * Diffs a tracked set of known player ids against the live ctx.peers map.
 * Call once per tick. Mutates `knownIds` in place to the new baseline.
 * Only reports *full* removal — grace-period (still-present-but-disconnected)
 * peers are not departures; see PlayerConnectionStatus for that distinction.
 */
export function diffDepartedPeers(
  knownIds: Set<string>,
  peers: Map<string, { id: string }>
): DepartureEvents {
  const departed: string[] = [];
  for (const id of knownIds) {
    if (!peers.has(id)) {
      departed.push(id);
      knownIds.delete(id);
    }
  }
  for (const id of peers.keys()) knownIds.add(id);
  return { departed };
}
```

This is exactly what othello's and uno's inline `syncRemovedPlayers()` already do, pulled out so grid-dungeon and liars-dice can use it instead of writing their own (or, in their current state, not writing one at all).

### 2. grid-dungeon: remove the entity on departure

```ts
// console.ts
const knownPlayerIds = new Set<string>();

function syncPeers() {
  const { departed } = diffDepartedPeers(knownPlayerIds, ctx.peers);
  for (const id of departed) {
    registry.remove(id);
    joystickInputs.delete(id);
    attachedListeners.delete(id);
  }
  // ...existing activePeers / syncPlayers logic unchanged
}
```

`EntityRegistry.remove(id)` already exists and is unused by this example today — this is a small, self-contained fix. Worth also excluding a `grace-period` player's stale joystick input from `movePlayer` in the same pass (freeze them in place rather than let a last-known-direction input keep walking them into a wall), though that's a smaller polish item than the leak itself.

### 3. liars-dice: re-derive `turnOrder` reactively, not just at round start

The core fix is narrower than a full rewrite: whenever a fully-departed player is the current turn holder, advance past them instead of waiting forever.

```ts
const knownPlayerIds = new Set<string>();

function syncPeersAndListeners() {
  const { departed } = diffDepartedPeers(knownPlayerIds, ctx.peers);
  if (departed.length > 0 && (phase === "bidding")) {
    const wasCurrentTurn = departed.includes(turnOrder[turnIndex]);
    turnOrder = turnOrder.filter(id => !departed.includes(id));
    if (turnOrder.length < 2) {
      // Not enough players left to continue this round.
      phase = "waiting";
      broadcastState();
      persistState();
    } else if (wasCurrentTurn) {
      turnIndex = turnIndex % turnOrder.length;
      broadcastState();
      persistState();
    }
  }
  // ...existing attachedListeners logic unchanged
}
```

Note this deliberately only reacts to *full* departure, not `grace-period` — a player whose phone locked mid-turn should get their reconnect window before being skipped, consistent with §8 of the resilience-primitives doc (turn-based games should distinguish grace-period from gone). If the round should also handle "everyone still present but no dice left" edge cases, that's already handled by the existing `activeRemaining.length === 1` winner check in `executeChallenge`.

### 4. othello: wire up the dead `connected` field, and pause instead of ending outright

Two independent changes:

- Add `players: PlayerPublicInfo[]` to `PublicOthelloState` (mirroring uno's shape, which already does this correctly) and populate `connected` from `isConnected(peer)` in `getPublicOthelloState()`. This alone fixes the "opponent dropped and nothing shows" gap for the grace-period window — `OthelloConsole.tsx` can then dim/badge the same way `UnoConsole.tsx` does, with no server-side behavior change needed.
- For the abrupt-ending gap: rather than `finishGame()` immediately on full departure, prefer transitioning to a `"paused"` phase (new `OthelloPhase` member) that waits for either a rejoin (unlikely once fully purged, but a new player could occupy the seat via a "claim empty seat" affordance — out of scope here) or a manual "end game" action from the remaining player, with `finishGame()` still available as that explicit fallback. This is a slightly bigger change than grid-dungeon/liars-dice's fixes and is called out as the one item in this doc that's a judgment call rather than a clear bug fix — filing it as a follow-up rather than blocking the rest of this doc on it is reasonable.

### 5. uno: declare a winner (or return to lobby) when attrition leaves one player

```ts
function syncRemovedPlayers() {
  const { departed } = diffDepartedPeers(knownPlayerIds, ctx.peers);
  for (const id of departed) {
    turnOrder.removePlayer(id);
    hands.delete(id);
  }
  if (departed.length > 0 && roundFlow.is("playing")) {
    const remaining = turnOrder.all();
    if (remaining.length === 1) {
      const soleId = remaining[0];
      const peer = ctx.peers.get(soleId);
      winner = { id: soleId, name: peer ? peer.name : "Player" };
      roundFlow.transition("roundOver");
      broadcastState();
      persistState();
    } else if (remaining.length === 0) {
      roundFlow.transition("waiting");
      broadcastState();
      persistState();
    }
  }
}
```

### 6. flappy-royale: no code change, just a comment

Add a short comment in `console.ts` near `syncPeers()` noting explicitly that departure is handled implicitly via physics (gravity → collision → natural elimination), so a future contributor doesn't spend time "fixing" a non-bug or, worse, adds a redundant removal path that fights with the simulation's own death handling.

## Summary: what's new where

| File | Change |
|---|---|
| `src/utils/peerDeparture.ts` | new — `diffDepartedPeers()` shared helper |
| `src/examples/grid-dungeon/console.ts` | call `diffDepartedPeers`, `registry.remove()` + clear joystick/listener state on departure |
| `src/examples/liars-dice/console.ts` | call `diffDepartedPeers`; drop departed ids from `turnOrder`, advance past current turn if needed, fall back to `"waiting"` if under 2 players remain |
| `src/examples/othello/types.ts` | add `players: PlayerPublicInfo[]` to `PublicOthelloState` |
| `src/examples/othello/console.ts` | populate `players`/`connected` in `getPublicOthelloState()`; (follow-up, not this doc) add a `"paused"` phase instead of ending outright on full departure |
| `src/examples/othello/OthelloConsole.tsx` | render the now-populated `connected` flag |
| `src/examples/uno/console.ts` | use `diffDepartedPeers`; declare a winner or return to `"waiting"` when attrition leaves ≤1 player |
| `src/examples/flappy-royale/console.ts` | comment only, documenting the intentional no-op |
