# Diagonal pathfinding for `TileGrid.findPath`

Status: proposed
Author: (drafted with Claude, for Jules to implement)
Related docs: `2026-08-26-002-world-primitives.md` (introduces `TileGrid`),
`2026-08-26-003-grid-dungeon-example.md` (first and so far only caller of
`findPath`)

## Goal

`TileGrid.neighbors(pos, diagonals)` already supports an 8-directional mode,
but `findPath` ignores it — it hardcodes `this.neighbors(cur.pos, false)`
internally, so every path is cardinal-only (N/E/S/W), which produces
"staircase" routes on open ground and can't move at all on a true diagonal.
This doc wires the existing flag through to `findPath` so callers can opt
into 8-directional search, and fixes the two things that come along with
that (heuristic admissibility and wall-corner cutting) so the result is
correct, not just diagonal-shaped.

The immediate consumer is `grid-dungeon`'s `stepNpcWander`, which is
currently the only call site of `findPath` in the repo. Turning diagonals on
there should make the wandering NPCs take visibly more direct routes and cut
corners around interior wall clusters instead of hugging them at right
angles.

## Non-goals

- This is **not** "Option B" (free/non-grid-constrained NPC movement via
  path simplification and steering) — that's a materially different design
  (raycast-based string-pulling, a new movement function replacing
  tile-center-to-tile-center walking) and belongs in its own doc if pursued.
  This doc only makes the existing waypoint-following A* diagonal-aware.
- Not touching player movement (`movePlayer`). Players already move
  continuously via circle-vs-tile collision, independent of `findPath`
  entirely — nothing here changes their behavior.
- Not replacing the open-set's linear scan
  (`[...open.entries()].reduce(...)`) with a binary heap / priority queue.
  Diagonal search does expand more candidate nodes per tile than cardinal
  search, but at `grid-dungeon`'s 20×15 room size this is not a measurable
  concern. Worth flagging as future work if `TileGrid` is ever used for a
  substantially larger room, but out of scope here.
- Not adding Jump Point Search, flow fields, navmeshes, or any other
  pathfinding algorithm swap. This is a targeted fix to the existing A*
  implementation, not a rewrite.
- Not changing `neighbors()` itself — its 8-directional behavior is already
  correct and already tested (`tileGrid.test.ts`, "iterates neighbors
  (cardinal and diagonal)"). Only `findPath`'s internals change.

## Background: what's wrong with just flipping the flag

Naively changing `this.neighbors(cur.pos, false)` to `this.neighbors(cur.pos,
true)` inside `findPath` is not sufficient on its own, for two reasons:

1. **The heuristic becomes inadmissible.** `findPath`'s heuristic is
   Manhattan distance (`|dx| + |dy|`), which is admissible (never
   overestimates) only when moves are restricted to cardinal directions. Once
   diagonal moves are allowed, Manhattan distance overestimates the true
   remaining cost for any pair of points that aren't aligned on an axis,
   which breaks A*'s optimality guarantee — it can return a longer path than
   necessary, or explore the space in a way that no longer prioritizes
   correctly.
2. **Diagonal steps need their own cost, and their own legality check.** A
   diagonal step covers `√2` the distance of a cardinal step, so treating it
   as equal-cost make diagonal movement artificially cheap (a path that
   zig-zags diagonally would be scored the same as, but is shorter in
   practice than, a straight cardinal line — direction bias creeps in).
   Separately, nothing currently stops a diagonal move from cutting through
   the corner where two walls meet — e.g. moving from `(0,0)` to `(1,1)` when
   `(1,0)` and `(0,1)` are both blocked. Visually this looks like clipping
   through a wall corner, which is the main thing that makes naive diagonal
   A* look wrong in a tile-based dungeon.

## Design

### 1. `findPath` takes an options parameter

```ts
findPath(
  start: GridPos,
  goal: GridPos,
  cost: (pos: GridPos, cell: T) => number,
  options?: { diagonals?: boolean }
): GridPos[] | null
```

`options.diagonals` defaults to `false`. This keeps the method
backward-compatible — every existing call site (today, just
`stepNpcWander`) and every existing test in `tileGrid.test.ts` continues to
compile and pass unmodified with cardinal-only behavior, since omitting the
new parameter is a no-op.

### 2. Heuristic switches to octile distance when diagonals are on

```ts
const heuristic = diagonals
  ? (a: GridPos, b: GridPos) => {
      const dx = Math.abs(a.x - b.x);
      const dy = Math.abs(a.y - b.y);
      return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
    }
  : (a: GridPos, b: GridPos) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
```

Octile distance is the standard admissible heuristic for 8-directional grids
with unit cardinal cost and `√2` diagonal cost: it assumes you take as many
diagonal steps as possible (the `min(dx, dy)` term) and cover the remainder
cardinally. It equals Manhattan distance when `diagonals` is `false`'s
counterpart isn't needed since that branch is untouched.

### 3. Diagonal step cost and corner-cutting

Inside the neighbor-expansion loop, `findPath` needs to know, for each
candidate neighbor, whether the step to it is diagonal, and if so, whether
both of the two orthogonal cells adjacent to that diagonal are open. This
requires calling `cost()` on those two orthogonal positions in addition to
the diagonal neighbor itself:

```ts
for (const n of this.neighbors(cur.pos, diagonals)) {
  const nKey = key(n);
  if (closed.has(nKey)) continue;

  const cell = this.get(n);
  if (cell === undefined) continue;
  const cellCost = cost(n, cell);
  if (!Number.isFinite(cellCost)) continue;

  const dx = n.x - cur.pos.x;
  const dy = n.y - cur.pos.y;
  const isDiagonal = dx !== 0 && dy !== 0;

  if (isDiagonal) {
    // Disallow cutting through the corner where two orthogonal
    // neighbors meet — both must be open, not just the diagonal cell.
    const cornerA = { x: cur.pos.x + dx, y: cur.pos.y };
    const cornerB = { x: cur.pos.x, y: cur.pos.y + dy };
    const cellA = this.get(cornerA);
    const cellB = this.get(cornerB);
    const openA = cellA !== undefined && Number.isFinite(cost(cornerA, cellA));
    const openB = cellB !== undefined && Number.isFinite(cost(cornerB, cellB));
    if (!openA || !openB) continue;
  }

  const stepCost = cellCost * (isDiagonal ? Math.SQRT2 : 1);
  const g = gScore.get(curKey)! + stepCost;
  if (g < (gScore.get(nKey) ?? Infinity)) {
    parent.set(nKey, curKey);
    gScore.set(nKey, g);
    open.set(nKey, { pos: n, f: g + heuristic(n, goal) });
  }
}
```

This is a strict corner-cutting rule: **both** orthogonal cells must be
passable for a diagonal move to be legal, not just one. This matches how
most tile-based dungeon games handle it (you can't squeeze diagonally past a
single wall corner) and avoids NPCs visually clipping through wall corners
in `grid-dungeon`'s tile art. See Open Questions for the "loose" alternative.

Note `cost()` may now be called up to three times per candidate neighbor
(the neighbor itself plus two corner checks) instead of once. `cost`
implementations in this repo are cheap property lookups (e.g. `cell.walkable
? 1 : Infinity` in `room.ts`), so this isn't a performance concern, but it's
worth knowing if a future caller gives `cost` expensive side effects (it
shouldn't — `cost` is documented as a pure lookup — but nothing currently
enforces that).

### 4. `grid-dungeon` opts in

The only call site, in `stepNpcWander` (`src/examples/grid-dungeon/room.ts`):

```ts
const path = grid.findPath(
  startPos,
  goalPos,
  (_pos, cell) => (cell.walkable ? 1 : Infinity),
  { diagonals: true }
);
```

No other change to `room.ts`, `console.ts`, or `controller.ts` is needed —
`stepNpcWander` already just walks whatever waypoint list `findPath`
returns, one straight-line segment at a time, regardless of whether
consecutive waypoints happen to be cardinal or diagonal neighbors.

## Tests

Add to `tileGrid.test.ts`, alongside the existing `findPath` describe block:

- **Diagonal path is shorter/straighter than cardinal-only on open ground.**
  On a clear grid, `findPath(start, goal, cost, { diagonals: true })` between
  two points offset equally in x and y should return a path that moves
  diagonally the whole way (length `max(|dx|,|dy|) + 1` waypoints), versus
  the cardinal-only "staircase" path's `|dx| + |dy| + 1` waypoints.
- **Corner-cutting is prevented.** Reuse a variant of the existing "navigates
  around walls" fixture (two adjacent blocked cells forming an L/corner) and
  assert that with `{ diagonals: true }`, the returned path does not step
  diagonally through that corner — every consecutive pair of waypoints in
  the path is either cardinal, or a diagonal pair whose two orthogonal
  neighbors are both walkable in the fixture.
- **Default behavior is unchanged.** Run the existing "finds a direct
  straight-line path," "navigates around walls," "returns null when goal is
  completely blocked," and "respects variable cell costs" cases with no
  `options` argument at all and confirm identical results to before this
  change (this should require no edits to those existing test bodies —
  that's the point).
- **`grid-dungeon`'s existing NPC wander tests** (if `room.test.ts` — check
  the sibling `room.test.ts` file — asserts anything about path shape)
  continue to pass; add a case confirming NPCs there don't path through the
  two interior wall clusters in `RAW_LAYOUT` diagonally-adjacent to open
  corners, if such a corner exists in that layout.

## Acceptance criteria

- `findPath`'s signature grows an optional fourth parameter; every existing
  call site and every existing test compiles and passes with no changes to
  those call sites or test bodies.
- With `{ diagonals: true }`, `findPath` returns shorter (in waypoint count
  and in the sense of eliminating unnecessary axis-aligned zig-zag) paths on
  open ground than the cardinal-only mode does for the same start/goal.
- No returned path, with diagonals on, ever steps diagonally between two
  cells where either orthogonal neighbor at that corner is blocked.
- `grid-dungeon`'s `stepNpcWander` passes `{ diagonals: true }` and NPCs
  visibly path more directly / cut appropriate corners when manually tested
  via the switcher, without clipping through wall corners.
- No changes to `movePlayer`, `EntityRegistry`, `Camera`, `console.ts`,
  `controller.ts`, or any file outside `src/utils/tileGrid.ts` and
  `src/examples/grid-dungeon/room.ts`.

## Open questions for Jules to flag if encountered (not to resolve unilaterally)

- **Strict vs. loose corner-cutting.** This doc specifies strict (both
  orthogonal corner cells must be open). Some games use a "loose" rule
  (allow the cut if at least one of the two is open) for a looser, more
  forgiving feel. Strict is recommended here since `grid-dungeon`'s walls
  are drawn as full square tiles with hard edges, where a loose cut would
  look like clipping through a corner post. Flag if the visual result looks
  wrong either way once NPCs are actually running around the room.
- **Per-call flag vs. per-grid default.** This doc keeps `diagonals` as a
  per-`findPath`-call option rather than a constructor-time setting on
  `TileGrid` itself, on the reasoning that a single grid instance might
  reasonably have callers wanting different search modes (e.g. a debug tool
  wanting cardinal-only comparison against the same grid an NPC pathfinds
  diagonally on). If that flexibility never ends up mattering in practice,
  moving it to a constructor option instead is a reasonable simplification —
  flag the tradeoff either way.
- **Whether to expose the octile heuristic or diagonal step cost as
  overridable.** This doc hardcodes `√2` diagonal cost and octile heuristic
  whenever `diagonals: true` is passed, matching the uniform per-cell `cost`
  callback's existing assumption that cardinal cost is uniform per cell. If
  a future caller wants non-uniform diagonal costs (e.g. difficult terrain
  costing more to cross diagonally than the cell's own `cost()` value
  implies), that's out of scope here and would need its own extension.
