# Fading Isles (procedural tile-depletion puzzle example)

Status: proposed
Author: (drafted with Claude, for Jules to implement)
Related docs: `2026-08-26-002-world-primitives.md`, `2026-08-26-003-grid-dungeon-example.md`,
`2026-08-24-002-additional-primitives.md`, `2026-08-29-004-static-board-and-othello.md`

## Goal

Add a new entry to the `EXAMPLES` registry: a cooperative, real-time puzzle
where every controller moves its own player around a shared grid of
floating tiles (continuous joystick movement, same feel as `grid-dungeon`),
and each tile can only be stepped on a fixed number of times before it
crumbles away permanently. The board is procedurally generated, difficulty
escalates level over level, and the puzzle supports any number of players
(1+) cooperating on the same board.

This is a standalone example — unrelated to `grid-dungeon` or the separate
puzzle-DAG dungeon-generator work as a *game*; it simply lives in the same
repo and reuses the same platform primitives. Structurally it follows
`grid-dungeon`'s shape: a new `src/examples/fading-isles/` module composing
`TileGrid`, `Camera` (only if the board outgrows one screen — see §
Camera), `EntityRegistry`, and `createRng`, plus one genuinely new piece of
reusable logic — capacity-based procedural level generation — that doesn't
exist anywhere in the template yet.

"Fading Isles" is a placeholder name/theme; rename freely.

## Rule recap (confirming semantics before design)

- Every tile has a `remaining`-uses counter, starting at its `capacity`
  (1–5+). Standing continuously on a tile is **one touch** — the counter
  only decrements the instant a player *arrives* on a tile from elsewhere,
  never per-tick while stationary.
- A tile whose `remaining` hits 0 crumbles (becomes a hole — unwalkable, not
  drawn) the moment it's unoccupied, i.e. as soon as the last player
  standing on it steps off. It does not vanish out from under a player who's
  still on it.
- **Win condition:** the door tile (E) reaches `remaining === 0` while every
  other tile on the board has already crumbled — concretely, the grid
  contains exactly one non-null cell (E) and a player is on it. This is a
  full-board covering puzzle, not a simple reach-the-exit puzzle: the
  player(s) must fully deplete every tile, in an order that never strands
  them, ending on E.
- **A tile holds at most one player at a time.** A move onto a tile that's
  already occupied is rejected outright, same as a move into a hole or wall
  — this is just another entry in the existing "proposed move only commits
  if the destination is valid" check `grid-dungeon` already uses for walls,
  not new machinery. One useful consequence: since occupancy is exclusive,
  an "arrival" is always exactly one player consuming exactly one charge —
  there's no simultaneous-multi-arrival case to design around.

## Non-goals

- No enemies, combat, timers, or scoring — this is a pure movement/logic
  puzzle, same restraint `grid-dungeon` took with "no combat, no items."
- No puzzles that *require* multiple players to solve, or any notion of
  players jointly holding/sharing a tile — v1 targets **solvable at any
  player count from 1 up**, not "requires coordination," to keep the first
  version buildable and testable in isolation.
- No diagonal movement/adjacency — matches the ASCII notation in the brief
  (tiles connect only up/down/left/right), and keeps generation §-work
  simpler. Flag as an open question if 8-directional is wanted later.
- No general "you've stranded yourself" detector. Per your call, soft-locks
  are allowed; the console just offers a manual restart. See § Soft-locks.

## Module layout

```
src/examples/fading-isles/
├── types.ts       # Tile, PlayerEntity, LevelSpec, message shapes
├── level.ts       # pure: procedural generation + the walk that proves solvability
├── room.ts         # pure: tick step (movement, arrival/departure, crumbling, win check)
├── console.ts       # createGame({ session, peers }) -> canvas rendering + tick loop
└── controller.ts     # createGame({ peerConnection }) -> joystick UI (shares shape with grid-dungeon's)
```

`level.ts` and `room.ts` must have no dependency on `PeerConnection`, the DO
client, canvas, or any DOM API — same bar as `grid-dungeon/room.ts` — so
generation and tick logic are both unit-testable with plain inputs/outputs.
They may depend on `TileGrid`, `EntityRegistry`, and `createRng`.

## Board representation

Reuse `TileGrid<Cell | null>` from world-primitives directly — `null` is a
hole, exactly the `_` gap in the ASCII notation from the brief:

```ts
// types.ts
export interface Cell {
  kind: "start" | "end" | "normal";
  capacity: number;   // 1..5+, fixed at generation time
  remaining: number;   // decrements on arrival, mutated during play
}
```

No new grid primitive needed — this is a static board with mutable cell
*contents* (remaining count, and cells going from `Cell` to `null` as they
crumble), which `TileGrid.get`/`set` already support; `ray()`/`DIRECTIONS_8`
from the Othello doc go unused, which is fine, same as `findPath` going
unused there.

## Level generation (`level.ts`) — the core of this doc

**Generate the solution first, then derive the puzzle from it** — the same
instinct as backward-constructing the puzzle DAG for the dungeon generator,
applied to a single self-intersecting walk instead of a fork/join graph.
This sidesteps needing a general solver (which would otherwise mean
searching a state space of `(position, remaining-counts-per-tile)` —
expensive and easy to get wrong) by construction: the generating walk *is*
the proof of solvability.

1. Pick a bounding box for the level (grows with difficulty — see § Progression).
2. Place `S` and `E` inside it (e.g. opposite corners, or random points at
   least `minDistance` apart).
3. Using `createRng(seed)`, run a random walk starting at `S`: at each step,
   pick a walkable neighbor (4-directional) uniformly at random, preferring
   unvisited cells but allowed to revisit a cell up to `maxRevisitsPerCell`
   times (this cap becomes that cell's eventual `capacity` — the loop
   example in the brief is exactly a walk that revisits two cells once each
   via a short detour). Stop when the walk reaches `E` **and** a target
   total length/coverage for this difficulty tier is met.
4. Every cell the walk never touched becomes a hole (`null`). Every cell it
   did touch gets `capacity = remaining = <number of times the walk visited
   it>` (S's count includes its initial occupancy; E's count is however many
   times the walk arrives there, with the *final* arrival being the one that
   depletes it to 0 and ends the level).
5. The walk itself is discarded after generation (not shown to players) —
   it only exists to prove a solution exists and to derive capacities/holes.
6. **Difficulty knobs**, tuned per level number: bounding-box size (bigger
   board), target walk length (higher average capacity, more backtracking),
   `maxRevisitsPerCell` (raises the ceiling toward the red end of the
   gradient), and hole density (more branch-and-rejoin loops, closer to the
   second worked example than the first).

**Why this holds for any player count:** the walk is a proof that *a*
sequence of steps clears the board, but nothing about the tick logic (§
below) cares who takes each step — only that steps happen in an order the
walk's own capacities allow (a tile can't be walked across after it's
already crumbled). A solo player can literally retrace the whole walk
themselves; N players can split it up arbitrarily, take turns, or shadow
each other, and the board is agnostic. That's what makes "supports any
number of players" free instead of a separate design problem — a solver
that specifically *required* splitting up would need real fork/join
modeling, which is the v2 idea flagged in § Non-goals.

## Movement & tick logic (`room.ts`)

Modeled closely on `grid-dungeon`: each connected controller gets a
`PlayerEntity` in an `EntityRegistry<PlayerEntity>` on join, at the `S`
tile's position. `InputStateSync` streams joystick `{x, y}` at 20Hz;
`onTick` proposes `position + vector * speed * dt` and commits it only if
the destination tile is **non-null and unoccupied by another player** — the
occupancy check is the exact same shape as `grid-dungeon`'s wall check, just
against player positions instead of a static walkability flag.

The one genuinely new piece of tick logic beyond `grid-dungeon`'s wall
collision is **arrival/departure tracking**, since that's what drives
capacity:

- Track each player's `currentTile` (derived by floor-dividing continuous
  position by tile size) from the previous tick.
- If it changed this tick: that's a **departure** from the old tile and an
  **arrival** on the new one.
  - Arrival: `newTile.remaining = Math.max(0, newTile.remaining - 1)`.
  - Departure: if `oldTile.remaining === 0` (now guaranteed unoccupied,
    since the player just leaving was the only one who could've been on it),
    remove it from the grid (set that cell to `null`).
- Resolve all players' proposed moves for the tick in a fixed order (e.g.
  stable sort by player id) before applying any of them, so if two players
  both target the same empty tile in the same tick, the first in order
  claims it and the second's move is simply rejected that tick — identical
  in spirit to a wall-collision rejection, no special-cased "double
  arrival" logic needed.
- Win check runs after crumbling is resolved each tick: grid has exactly one
  non-null cell (`E`) and `E.remaining === 0` and a player is on it.

## Soft-locks

No auto-detection in v1, per your call — a player can absolutely dead-end
the board (e.g. burn out the only tile leading back toward unexplored
territory). The console just shows a **Restart Level** button at all times;
restarting regenerates the *same* level (same seed) rather than skipping
ahead, so a stranded group retries the identical puzzle rather than losing
progress toward difficulty escalation. Worth flagging for Jules whether a
"you appear to be stuck" hint (e.g. detecting zero legal moves for every
player) is worth adding later as polish — not required for v1.

## Difficulty progression across sessions

On a win, generate the next level via `createRng(sessionSeed + levelNumber)`
with knobs from § Level generation nudged upward (bigger board, longer
target walk, higher revisit cap, more holes) — reproducible across a
console reload the same way a seed-based approach is reproducible anywhere
else in the template. `levelNumber` and `sessionSeed` are the only state
needed to regenerate a level deterministically, which also keeps
persistence (§ below) cheap.

## Rendering (`console.ts`)

Plain Canvas2D, same pattern as `grid-dungeon`/`touch-demo` — no Pixi, since
this is a static board with no particle/effects case to justify
`2026-08-25-007-pixi-canvas-games.md`'s tradeoff. Own `<canvas>` element
appended to `.canvas-container`, sized via `devicePixelRatio` (copy
`grid-dungeon`'s existing setup).

Per tile: filled rounded rect, `remaining` drawn as centered text, fill
color from a small `capacityColor(remaining, maxCapacityForGradient)`
helper in `room.ts` (framework-free so it's independently testable) —
lerping blue (`#3b82f6`) at `remaining === 1` to red (`#ef4444`) at
`remaining >= 5`. Holes are simply not drawn (the gap reads as open sky
between floating tiles). Players render as colored circles, same
color-per-player convention as `grid-dungeon`.

If a generated board fits comfortably in one screen (likely, at least for
early difficulty tiers), skip `Camera` entirely and draw the whole grid
directly — only reach for `Camera`'s multi-target follow if a later
difficulty tier's bounding box actually exceeds a comfortable single-screen
size. Flag which threshold Jules picks as an open question.

## Message shape / broadcast

Same two-tier split as `grid-dungeon`: `sendControlCoalesced('roomState',
snapshot)` every tick with player positions and the *entire* tile grid
(kind/remaining per cell, `null` for holes). Puzzle boards at these sizes
are small enough that resending the full grid each tick is simpler than
diffing; flag as an open question if a later difficulty tier's board grows
large enough that this stops being cheap.

```ts
export interface FadingIslesSnapshot {
  players: PlayerEntity[];
  grid: (Cell | null)[]; // row-major, width/height included alongside
  gridWidth: number;
  gridHeight: number;
  tileSize: number;
  levelNumber: number;
  won: boolean;
}
```

## Controller

A virtual joystick, functionally identical to `grid-dungeon/controller.ts`
— the phone doesn't need to see the board, only move a dot. Worth checking
whether the two controllers are similar enough to literally share an
implementation (a small shared joystick module under `src/utils/`) rather
than duplicating it a second time — flagged as an open question rather than
decided here, since that's a slightly bigger change than "add one example."

## Persistence

Save `{ grid: grid.toJSON(), players: registry.toJSON(), sessionSeed,
levelNumber }` via `saveGameState`, restored with `TileGrid.fromJSON`. This
matters more here than in `grid-dungeon` — crumbled tiles are real,
irreversible player progress, and losing that to a console refresh would be
a much worse experience than `grid-dungeon`'s "NPCs/positions reset" gap.

## Registry entry

```ts
"fading-isles": {
  label: "Fading Isles",
  controllerTypes: { phone: {} },
  console: () => import("@examples/fading-isles/console"),
  controller: () => import("@examples/fading-isles/controller"),
},
```

## README updates

- Under "Trying the examples," add: *fading-isles: procedurally generated
  tile-depletion co-op puzzle — exercises `TileGrid` mutation, capacity-based
  level generation, and shared-board real-time multiplayer with any number
  of players.*

## Acceptance criteria

- Selecting "Fading Isles" shows a generated board; each connected
  controller's joystick moves its own player, blocked by holes and
  depleted-and-crumbled tiles.
- A tile's displayed number decrements exactly once per arrival, never while
  a player merely stands still on it.
- A tile crumbles (becomes a hole, stops rendering) only once `remaining
  === 0` and its last occupant has stepped off.
- Two players can never occupy the same tile simultaneously; a move onto an
  occupied tile is rejected the same way a move into a hole is.
- The level is solvable with exactly one connected player, proving the
  "any number of players" claim isn't accidentally requiring ≥2.
- Reaching the win condition (only `E` remains, depleted, occupied) is
  detected and shown; a "Restart Level" control regenerates the identical
  level from the same seed.
- A console refresh mid-level restores crumbled tiles/positions correctly
  (persistence round-trip).
- `level.ts` and `room.ts` have no imports from `PeerConnection`/DO/DOM/canvas
  and are unit-testable as pure functions, same bar as `grid-dungeon/room.ts`.
- README updated per the section above.

## Open questions for Jules to flag if encountered (not to resolve unilaterally)

- Exact theming/name (`fading-isles` is a placeholder) and exact
  capacity→color curve (linear vs. stepped) are unspecified — pick
  reasonable defaults and flag them as tunable.
- Tie-break order for simultaneous same-tile move contention (§ Movement)
  is specified as "stable sort by player id" for determinism, but any
  consistent order works — flag if a different one reads cleaner against
  the actual tick implementation.
- Camera threshold for switching from "draw whole board" to
  multi-target-follow (§ Rendering) is unspecified.
- Whether the joystick controller should be factored into a shared
  `src/utils/` module with `grid-dungeon`'s, or duplicated a second time (§
  Controller) — purely a code-reuse question, not a design coupling between
  the two games.
- Parallel-required puzzles (needing multiple players in the puzzle logic
  itself, not just faster clearing) are explicitly out of scope (§
  Non-goals) — `level.ts`'s single-walk generator would need real extension,
  not just parameter tuning, if that's ever wanted.
