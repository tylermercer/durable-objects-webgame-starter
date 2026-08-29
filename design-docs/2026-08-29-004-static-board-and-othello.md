# Static Boards, Line-Casting, and the Othello Example

**Date:** 2026-08-29
**Status:** Proposed
**Depends on:** `2026-08-28-001-turn-order-and-round-flow.md` (`TurnOrder`/`RoundFlow` — **specced but not yet implemented in the codebase**, see §0)

## 0. State of the repo, as pulled today

Before designing anything new, worth recording what's actually here, since it's shifted since the last two addenda:

- `design-docs/2026-08-28-001-turn-order-and-round-flow.md` and `2026-08-28-002-deck-and-hand-management.md` are both present, but **only as documents** — there is no `src/utils/turnOrder.ts`, `roundFlow.ts`, or `deck.ts`, and no `uno` entry in `src/examples/registry.ts`. `liars-dice` still hand-rolls `turnIndex`/`phase` exactly as described in `001` §1. This doc assumes `TurnOrder`/`RoundFlow` get implemented (they're a hard dependency for Othello's alternating turns and waiting/playing/roundOver flow) but doesn't re-spec them — see `001` for that.
- The transport layer changed shape: `ControllerPeer.pc` is now typed `GameTransport | null` (`src/transport/transport.ts`), not the concrete `PeerConnection` — `RelayConnection` is a second implementation for DO-relayed fallback. `sendControl`/`sendControlCoalesced`/`addControlListener` are unchanged in signature. `ControllerPeer.status` is now one of `"live" | "live-relay" | "reconnecting" | "grace-period" | "gone"`, with `peer.state === "connected"` kept as a fallback for older call sites — the live-connection check used throughout `liars-dice/console.ts` is `peer.status ? (peer.status === "live" || peer.status === "live-relay") : peer.state === "connected"`. Any console code in this doc uses that same check.
- TURN relay configuration was removed entirely (`2026-08-29-001-remove-turn-config.md`) in favor of the relay-fallback transport above — not relevant to this doc, just noting the README section it used to touch no longer exists.

## Scope

A **static board** — a fixed-size grid holding one piece/mark per cell, no movement or pathfinding, with a game rule about placing/flipping/connecting pieces — for board games like Othello, Connect Four, tic-tac-toe, checkers. This doc specs what such a game actually needs and the `othello` example that proves it.

## 1. We already have most of a board primitive

`TileGrid<T>` (`src/utils/tileGrid.ts`, from `2026-08-26-002-world-primitives.md`) is `width`/`height`/`get(pos)`/`set(pos, value)`/`inBounds(pos)`/`neighbors(pos, diagonals)` plus A* pathfinding on top. Strip the pathfinding off and that's exactly a static board: a 2D grid of generic cells. Building a parallel `Board<T>` class with its own `get`/`set`/`inBounds`/`neighbors` would duplicate code that already exists and is already tested (`tileGrid.test.ts`), for no real gain — `findPath` sitting unused on an Othello board costs nothing.

What's actually missing, checked against what Othello needs:

- **Serialization.** `TileGrid` has no `toJSON`/`fromJSON`. It hasn't needed one — `grid-dungeon`'s room layout is static and rebuilt from `RAW_LAYOUT` on every load, never persisted. A board game's board *is* the persisted game state (whose piece is in which cell, across a console reload), so this is a real gap.
- **Line-casting.** Othello's core rule — placing a piece flips every opponent piece in a straight line between the new piece and another piece of the same color — needs to walk outward from a cell in one of 8 directions and inspect what's there. Nothing in `TileGrid` does this; `neighbors()` only reaches one step out.

So: two additions to `TileGrid` itself, not a new class.

## 2. Additions to `TileGrid<T>`

```ts
// src/utils/tileGrid.ts — additions

export interface TileGridState<T> {
  width: number;
  height: number;
  cells: T[];
}

export class TileGrid<T> {
  // ...existing members unchanged...

  toJSON(): TileGridState<T> {
    return { width: this.width, height: this.height, cells: [...this.cells] };
  }

  static fromJSON<T>(state: TileGridState<T>): TileGrid<T> {
    const grid = new TileGrid<T>(state.width, state.height, () => undefined as unknown as T);
    grid.cells = [...state.cells];
    return grid;
  }

  /**
   * Cells walking outward from `start` in a straight line — NOT including
   * `start` itself — stopping at the grid edge. `dx`/`dy` are a single
   * step's direction (-1, 0, or 1 per axis; both 0 is a no-op that yields
   * nothing). For flanking checks (Othello), line-of-sight, or any sliding
   * search along a row/column/diagonal.
   */
  *ray(start: GridPos, dx: -1 | 0 | 1, dy: -1 | 0 | 1): Generator<{ pos: GridPos; value: T }> {
    let pos: GridPos = { x: start.x + dx, y: start.y + dy };
    while (this.inBounds(pos)) {
      yield { pos, value: this.get(pos) as T };
      pos = { x: pos.x + dx, y: pos.y + dy };
    }
  }
}

/** The 8 directions `ray()` takes a single step in — reused as-is by any game walking every line from a cell. */
export const DIRECTIONS_8: Array<[-1 | 0 | 1, -1 | 0 | 1]> = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];
```

**Design choice — `fromJSON` re-runs the `fill` callback with a throwaway placeholder rather than adding a second constructor path.** `TileGrid`'s constructor always calls `fill` once per cell before `cells` is overwritten with the real, restored values immediately after. It's `width * height` wasted function calls (a handful of milliseconds even on a large board), traded for not needing a private/internal constructor overload — matches this codebase's general preference for the simpler option in `src/utils/` unless a real perf case shows up (see `Deck`'s equally simple `fromJSON` in `002` §1).

**Design choice — `ray()` excludes the start cell and takes a raw `dx`/`dy` step, not a `direction` enum or a `maxDistance`.** Othello needs to inspect the ray's contents itself (walk until it finds *either* an empty cell — invalid direction — *or* a same-color piece with only opponent pieces in between — valid, flip them). Baking "stop at the first non-empty cell" or "stop after N steps" into `ray()` would presuppose a rule that's actually game-specific; a plain generator over raw cells, walked with `DIRECTIONS_8` for "all 8 lines from here," lets Othello's `rules.ts` own the actual flanking logic exactly the way `liars-dice`'s `rules.ts` owns bid validity — the primitive stays a data-structure operation, not a rule.

## 3. Interaction with `TurnOrder`/`RoundFlow`

Straightforward 2-player alternation: `new TurnOrder([blackId, whiteId])`, `turnOrder.advance()` after every move. `RoundFlow<OthelloPhase>` with `"waiting" | "playing" | "roundOver"`, no timer needed (Othello doesn't have a per-turn clock in this scope).

One thing Othello needs that neither `liars-dice` nor `uno` do: **a player can have zero legal moves and must be skipped without taking an action.** Standard Othello rule — if the current player can't flip anything anywhere, their turn passes automatically; if *neither* player can move, the game ends. This is composed entirely from existing `TurnOrder` calls, no new primitive needed:

```ts
// after every successful move, before broadcasting:
function skipPlayersWithNoMoves() {
  let attempts = 0;
  while (attempts < turnOrder.all().length) {
    const currentId = turnOrder.current();
    if (currentId && hasAnyLegalMove(board, currentId === blackId ? "black" : "white")) return;
    turnOrder.advance();
    attempts++;
  }
  // looped through every player with no legal move found anywhere — game over
  roundFlow.transition("roundOver");
}
```

## 4. `othello` example

New example under `src/examples/othello/`, registered in `registry.ts`.

### Board and rules (`types.ts`, `rules.ts`)

```ts
export type CellState = "black" | "white" | null;
export type OthelloPhase = "waiting" | "playing" | "roundOver";
```

`createInitialBoard()` returns an 8×8 `TileGrid<CellState>` filled `null`, with the standard 4 center pieces set (d4/e5 white, d5/e4 black in conventional notation — or whatever (x,y) equivalent).

`legalMoves(board, player)`: for every empty cell, for each of `DIRECTIONS_8`, walk `board.ray(cell, dx, dy)` — if it starts with ≥1 opponent piece immediately and *then* reaches a same-player piece before hitting an empty cell or the edge, the move is legal (and that ray's opponent run is what gets flipped). This is the one piece of real game logic in the example, and it's where `ray()` earns its keep.

`applyMove(board, player, pos)`: places the piece, then flips every bracketed run found by the same ray-walk.

### Message shape

```ts
export type OthelloControlMessage =
  | { type: "gameState"; state: PublicOthelloState }
  | { type: "requestStart" }
  | { type: "placePiece"; x: number; y: number }
  | { type: "playAgain" };
```

Notably **no private per-player message** — unlike `uno`'s `yourHand`, Othello's entire game state (the whole board) is public information, so `PublicOthelloState` carries the full `TileGrid` contents and there's nothing to unicast. Worth naming explicitly: the private-state delivery pattern from `002` §3 is a per-genre concern, not a universal one — card games generally need it, board games with no hidden information generally don't.

### Console-side flow (`console.ts`)

- `startNextGame()`: `board = createInitialBoard()`, `turnOrder = new TurnOrder([blackPeerId, whitePeerId])` (first two connected peers, in `ctx.peers` join order — a 2-player game, unlike `liars-dice`/`uno`'s N-player lobby, so this doc's `requestStart` handler additionally rejects starting with more than 2 connected controllers, same first-player gating pattern as the existing examples otherwise), `roundFlow.transition("playing")`.
- `handleControlMessage`: `placePiece` validates `turnOrder.isCurrent(fromId)` and that `{x,y}` is in `legalMoves(board, player)` before calling `applyMove`, then `skipPlayersWithNoMoves()` (§3), then checks board-full as an additional end condition, then broadcasts.
- Peer wiring follows the current `liars-dice` pattern exactly (§0): `attachedListeners` set, live-check via `peer.status`/`peer.state`, `addControlListener` on `peer.pc` (typed `GameTransport`).
- Persistence: `{ board: board.toJSON(), turnOrder: turnOrder.toJSON(), roundFlow: roundFlow.toJSON(), winner }`, restored with `TileGrid.fromJSON(state.board)`.

### Controller-side flow (`controller.ts` / `OthelloController.tsx`)

Because the board is fully public, the controller doesn't need a bespoke "your legal moves" message — it receives the same `gameState` broadcast as the console, imports `legalMoves` from `rules.ts` directly, and computes its own highlight set client-side. Renders a mirrored mini-board; legal cells (only when it's this player's turn) are tappable and send `placePiece`; everything else is inert. This is a nice contrast with `uno`'s controller, which *can't* do this (hand contents are the whole point of privacy) — worth keeping both examples around specifically because they demonstrate the two different shapes.

### Console view (`OthelloConsole.tsx`)

Big 8×8 board, piece counts per color, turn indicator, win/tie banner — same visual language (dark cards, colored accents) as `LiarsDiceConsole`/`UnoConsole` for consistency.

## Summary: what's new where

| File | Addition |
|---|---|
| `src/utils/tileGrid.ts` | add `toJSON`/`fromJSON`/`ray()`/`DIRECTIONS_8` (§2) — additive, no existing behavior changes |
| `src/utils/tileGrid.test.ts` | add tests: serialization round-trip, `ray()` in all 8 directions including edge-of-grid truncation |
| `src/examples/othello/types.ts` | new — `CellState`, `OthelloPhase`, message union |
| `src/examples/othello/rules.ts` | new — `createInitialBoard`, `legalMoves`, `applyMove` |
| `src/examples/othello/rules.test.ts` | new — known-position legal-move sets, flip correctness across all 8 directions, no-legal-move detection |
| `src/examples/othello/console.ts` | new — game loop, `skipPlayersWithNoMoves` (§3), persistence |
| `src/examples/othello/controller.ts` | new — mounts `OthelloController` |
| `src/examples/othello/OthelloConsole.tsx` | new — board view |
| `src/examples/othello/OthelloController.tsx` | new — tappable mini-board, computed locally from public state |
| `src/examples/registry.ts` | add `"othello"` entry |

## Non-goals

- Connect Four / checkers / tic-tac-toe as additional examples — `ray()` and the serialization addition are shaped generically enough to support them later, but proving that against a second board game is future work, not this doc's.
- Any AI/single-player opponent. Every example in this template assumes ≥2 human controllers, same as today.
