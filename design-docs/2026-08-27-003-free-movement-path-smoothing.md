# Free (non-grid-constrained) movement via path smoothing

Status: proposed — for later implementation, after
`2026-08-27-002-diagonal-pathfinding.md` has landed
Author: (drafted with Claude, for Jules to implement)
Related docs: `2026-08-26-002-world-primitives.md` (introduces `TileGrid`),
`2026-08-26-003-grid-dungeon-example.md` (first caller of `findPath`),
`2026-08-27-002-diagonal-pathfinding.md` (Option A — diagonal-aware `findPath`,
**hard prerequisite**: this doc's raw path input is expected to often come
from `findPath(..., { diagonals: true })`, and its acceptance criteria assume
diagonal search already exists)

## Goal

Give game logic a second, opt-in movement model for grid-pathed entities:
instead of walking a raw A* waypoint list tile-center to tile-center (locked
to the 4 or 8 directions the grid search moves in), an entity can follow a
**simplified** path and steer toward each remaining waypoint in a straight
line at any angle — the same free, continuous motion `movePlayer` already
gives joystick-driven players, but driven by a pathfinding goal instead of
direct input.

This is additive on top of `TileGrid`/`findPath`, not a replacement for
Option A. Both remain permanent, independently-selectable primitives in the
template. The concrete deliverable of this doc is making that choice a real,
low-friction one for whoever builds a game on this template — see
"Choosing between Option A and Option B" below, which is as much a part of
this doc's scope as the smoothing algorithm itself.

## Non-goals

- Not a navmesh, polygon-based pathfinding, or Jump Point Search — the grid
  and `findPath` stay exactly as they are (including Option A's diagonal
  support). This doc only adds a post-processing step on top of `findPath`'s
  output and a new way to walk the result.
- Not deprecating or hiding stepwise waypoint-following. `grid-dungeon`'s
  current NPC movement (walk each returned waypoint's tile center in
  sequence) stays as one of two supported, equally first-class modes — see
  below.
- Not changing `movePlayer`'s call sites or its current behavior in
  `grid-dungeon` by default. This doc extracts the reusable *shape* of what
  `movePlayer` already does (circle-vs-grid collision, independent-axis
  slide) into a shared utility so it can back Option B's steering movement
  too, but that refactor changing `movePlayer`'s own external behavior is
  explicitly not a goal — it should produce identical results for players
  before and after.
- Not adding steering behaviors beyond direct seek toward the next waypoint
  — no flocking, no inter-entity avoidance, no arrival/deceleration easing.
  Those are reasonable follow-ons a game could layer on top of the
  `steerToward` primitive this doc adds, but are their own scope.
- Not solving perfect capsule-cast collision for the line-of-sight check
  (see § Line-of-sight and entity radius) — the design deliberately keeps
  the smoothing pass approximate and leans on per-tick collision as the real
  safety net, the same way `movePlayer` already tolerates imprecise input by
  resolving collision every tick rather than requiring the input to be
  pre-validated.

## Background

Recall from `2026-08-27-002-diagonal-pathfinding.md`: `findPath` returns a
list of grid cells, and `stepNpcWander` currently walks that list by moving
in a straight line toward each cell's center in turn, one at a time. Even
with Option A's diagonal search, this still produces motion locked to 8
fixed directions between any two consecutive waypoints — an NPC pathing
across open ground takes a route made of 45°-and-90° segments, because
that's what the grid search itself moves in, even though nothing about the
open floor requires that.

The standard fix in tile-based games is **string-pulling**: take the raw
grid path, and greedily drop every waypoint that isn't actually necessary —
i.e., where a straight line from an earlier waypoint to a later one doesn't
cross any blocked cell. What's left is a much sparser list of "true" turning
points (typically just the corners the path actually has to go around), and
walking directly between *those* produces natural-looking, any-angle motion
that still respects the grid's walls, because the grid is exactly what
decided which waypoints could be dropped.

## Design

### 1. `simplifyPath` (`src/utils/pathSmoothing.ts`, new file)

```ts
import type { GridPos } from "./tileGrid";
import { TileGrid } from "./tileGrid";

/**
 * Greedily drops waypoints from a raw findPath() result that aren't
 * necessary — i.e. where later waypoints are directly reachable in a
 * straight line without crossing a blocked cell. Input may come from
 * either cardinal-only or diagonal findPath() output; a diagonal-aware
 * input path (see 2026-08-27-002) simplifies to a more direct route
 * than a cardinal-only "staircase" input does, but both are valid input.
 */
export function simplifyPath<T>(
  grid: TileGrid<T>,
  path: GridPos[],
  cost: (pos: GridPos, cell: T) => number
): GridPos[] {
  if (path.length <= 2) return path;

  const result: GridPos[] = [path[0]];
  let anchor = 0;

  for (let probe = 2; probe < path.length; probe++) {
    if (!hasLineOfSight(grid, path[anchor], path[probe], cost)) {
      // Farthest-reachable point from anchor was probe - 1; keep it and
      // restart the scan from there.
      result.push(path[probe - 1]);
      anchor = probe - 1;
    }
  }

  result.push(path[path.length - 1]);
  return result;
}

/** Grid-space line-of-sight: true if every cell the segment between `a`
 *  and `b` passes through is open per `cost`. Exported for reuse/testing. */
export function hasLineOfSight<T>(
  grid: TileGrid<T>,
  a: GridPos,
  b: GridPos,
  cost: (pos: GridPos, cell: T) => number
): boolean {
  // Supercover line walk: visits every cell the segment from the center
  // of `a` to the center of `b` touches, not just a thin Bresenham
  // center-line (which can skip cells at shallow angles).
  for (const cell of walkSupercoverLine(a, b)) {
    const value = grid.get(cell);
    if (value === undefined || !Number.isFinite(cost(cell, value))) {
      return false;
    }
  }
  return true;
}
```

`walkSupercoverLine` is a small internal helper (standard supercover/DDA
line algorithm — like Bresenham but yields every cell edge-crossed by the
segment, not just one per major-axis step, so it doesn't miss a wall corner
the line only grazes). It has no grid dependency itself and unit-tests
cleanly against known cell sequences for a handful of hand-picked
start/end points, independent of `hasLineOfSight`.

### 2. Line-of-sight and entity radius

The check above treats the moving entity as a dimensionless point, which is
an approximation — a real entity has a collision radius (`grid-dungeon`
players use `0.35` tiles today) and a path judged "clear" for a point could
still graze a corner for a wide entity. This doc deliberately does **not**
try to make `hasLineOfSight` a precise capsule-cast against the radius.
Instead, the design leans on the same principle `movePlayer` already
depends on: **the per-tick movement step is the actual safety net, not the
path plan.** `movePlayer` doesn't require its caller to pre-validate that an
input vector won't hit a wall — it resolves collision fresh every tick,
independently per axis, and simply doesn't apply the fraction of movement
that would clip. Option B's steering movement (§3) reuses exactly that
collision step every tick, so if a simplified path's straight segment would
graze a corner too closely for the entity's actual radius, the entity slides
along the wall that tick instead of visibly clipping through it — the same
way a player's joystick input that aims straight at a wall corner today
doesn't clip, it slides.

This means `simplifyPath`'s job is only to produce a *good enough* sparse
waypoint list, not a provably-safe one for every possible radius — it can
stay cheap and simple (point-based supercover) rather than reimplementing
`movePlayer`'s radius-aware AABB sweep as a path-planning-time check too.
Flagged as an open question below in case testing shows this isn't
conservative enough at larger radii relative to tile size.

### 3. Shared collision primitive + steering (`src/utils/circleMovement.ts`, new file)

Extract the reusable shape of `movePlayer`'s circle-vs-grid collision
(independent-axis resolve, so an entity slides along a wall instead of
stopping dead) out of `grid-dungeon/room.ts` and into a generic, grid-shaped
utility both player input-driven movement and Option B's path-driven
movement can call:

```ts
export interface CircleMoveResult {
  x: number;
  y: number;
}

/** Resolves a proposed (dx, dy) move for a circle of `radius` against a
 *  TileGrid's walkable cells, independent-axis (so it slides along walls
 *  rather than stopping on any blocked axis). This is the same collision
 *  shape grid-dungeon's movePlayer already used inline; extracted here so
 *  both direct-input movement and path-following steering can share it. */
export function moveCircleAgainstGrid<T>(
  pos: CircleMoveResult,
  radius: number,
  dx: number,
  dy: number,
  grid: TileGrid<T>,
  isWalkable: (pos: GridPos, cell: T) => boolean
): CircleMoveResult { /* body ported from movePlayer, generalized */ }

/** Direction + magnitude to move this tick to seek a target point,
 *  capped at `speed * dt`. Does not itself apply collision — pair with
 *  moveCircleAgainstGrid. Returns {dx:0, dy:0} if already within
 *  `arrivalRadius` of target. */
export function steerToward(
  pos: CircleMoveResult,
  target: CircleMoveResult,
  speed: number,
  dt: number,
  arrivalRadius = 0.05
): { dx: number; dy: number } { /* normalize(target - pos) * min(speed*dt, dist) */ }
```

`movePlayer` in `grid-dungeon/room.ts` is refactored to call
`moveCircleAgainstGrid` internally instead of inlining the axis-by-axis
walk it does today. This is a pure refactor — `movePlayer`'s exported
signature and behavior for players are unchanged; the point is that the
collision logic now lives in one place instead of being duplicated when
Option B's NPC movement needs the same thing.

### 4. NPC movement, Option B path

A new sibling to today's `stepNpcWander`, e.g. `stepNpcWanderFree`, that:

1. Computes a raw path with `grid.findPath(start, goal, cost, { diagonals: true })`
   (Option A) exactly as `stepNpcWander` does today.
2. Passes it through `simplifyPath(grid, rawPath, cost)`.
3. Each tick, calls `steerToward(npc, nextWaypoint, NPC_SPEED, dt)` then
   `moveCircleAgainstGrid(npc, npcRadius, dx, dy, grid, isWalkable)`, advancing
   to the next waypoint in the simplified list once within `arrivalRadius`.

This lives alongside `stepNpcWander`, not in place of it — see below.

## Choosing between Option A and Option B

This is the part of the doc that makes the choice real rather than
theoretical. Concretely:

- **Both `stepNpcWander` (Option A: stepwise, waypoint-locked) and
  `stepNpcWanderFree` (Option B: smoothed, freely-angled) ship side by
  side** in `grid-dungeon/room.ts`, both exported, both unit-testable in
  isolation the same way `stepNpcWander` is today. Neither is "the new
  default" that replaces the other.
- `grid-dungeon`'s own two demo NPCs (the goblin and the skeleton, per
  `2026-08-26-003-grid-dungeon-example.md`) are split one per mode — one
  calls `stepNpcWander`, the other `stepNpcWanderFree` — so the switcher
  demo itself is the side-by-side comparison a game dev sees when trying
  the example, without needing to read either design doc to notice the
  difference. Flag in the PR which NPC got which, so it's easy to swap for
  comparison later.
- The decision of which mode to use lives entirely at the call site, per
  entity, per path request — it is a normal function choice
  (`stepNpcWander(...)` vs. `stepNpcWanderFree(...)`), not a config flag,
  global setting, or constructor option on `TileGrid` itself. A game
  building `src/logic/console.ts` on top of this template can mix both in
  the same room (e.g. patrol guards that snap tile-to-tile for a
  retro/deliberate feel, alongside a chasing monster that steers freely for
  a more organic feel) with no structural conflict, since both read from
  the same `TileGrid`/`EntityRegistry` and only differ in which movement
  helper they call.
- Because Option B is built as a post-processing step on `findPath`'s
  output plus a movement helper, rather than a different pathfinding
  algorithm, a game dev can also start with Option A (cheaper, simpler,
  ships today per `2026-08-27-002`) and layer Option B on later for
  specific entities without redoing any pathfinding-side work — the same
  `findPath` call feeds either mode.
- README's "Building your own game" primitives list (the sentence naming
  `InputStateSync`, `createFixedTickLoop`, `createRng`,
  `sendControlCoalesced`, `rejoinToken`, `saveGameState`) should gain
  `TileGrid.findPath` (already implied via `grid-dungeon`) plus a short
  mention of `simplifyPath`/`steerToward` as the freely-angled alternative,
  so a game dev discovers the choice exists without having to find this
  doc.

## Tests

- `pathSmoothing.test.ts`: `walkSupercoverLine` against known
  start/end/expected-cell-sequence fixtures (including shallow-angle lines,
  to confirm it doesn't skip corner cells a plain Bresenham would);
  `hasLineOfSight` true/false cases against small hand-built grids;
  `simplifyPath` against a raw staircase path in an open room (should
  collapse to just `[start, end]`), and against an L-shaped obstacle
  (should retain exactly the corner waypoint(s) needed to go around it,
  matching the doc's own "true turning points" description).
- `circleMovement.test.ts`: `moveCircleAgainstGrid` ported test cases from
  whatever inline behavior `movePlayer` has today (sliding along a wall
  when only one axis is blocked, stopping when both are); `steerToward`
  cap-at-speed and arrival-radius cases.
- `room.test.ts` (`grid-dungeon`): add coverage for `stepNpcWanderFree`
  mirroring the existing `stepNpcWander` wander-and-path-around-walls
  coverage, and a regression check that `stepNpcWander`'s own existing
  tests are unaffected by the `movePlayer` → `moveCircleAgainstGrid`
  refactor (same inputs, same outputs, before and after).

## Acceptance criteria

- `simplifyPath` and `hasLineOfSight` exist in a new
  `src/utils/pathSmoothing.ts`, `moveCircleAgainstGrid` and `steerToward`
  in a new `src/utils/circleMovement.ts`, all independently unit-tested.
- `movePlayer` is refactored to call `moveCircleAgainstGrid` with identical
  external behavior — no test of player movement changes its expected
  result.
- `grid-dungeon` ships both `stepNpcWander` (Option A) and
  `stepNpcWanderFree` (Option B) as separate, equally-supported functions;
  the example's two NPCs demonstrate one of each.
- A path computed once via `findPath(..., { diagonals: true })` can be fed
  to either the stepwise walker or `simplifyPath` + steering, unmodified —
  no duplicated pathfinding work between the two modes.
- An entity moving under Option B visibly cuts corners and moves at
  non-45°-multiple angles across open ground when manually tested via the
  switcher, while never clipping through a wall (verified visually, per the
  §"Line-of-sight and entity radius" reasoning that per-tick collision is
  the real safety net).
- README's primitives list and the "Building your own game" section
  mention both movement modes and point at `grid-dungeon` as the worked
  example of each.

## Open questions for Jules to flag if encountered (not to resolve unilaterally)

- Whether the point-based `hasLineOfSight` (§2) turns out conservative
  enough in practice once a real entity radius is tested against tile
  size — if NPCs visibly graze corners more than feels acceptable, the fix
  is likely inflating the check (testing a line thickened by radius, or
  eroding the effective walkable mask by radius once up front) rather than
  a full capsule-cast; flag which, if either, was needed.
- Whether `stepNpcWanderFree` should re-run `simplifyPath` every time the
  NPC picks a new wander goal (current assumption, matching how
  `stepNpcWander` re-runs `findPath` on every new goal) or whether there's
  a reason to cache/reuse — unlikely to matter at `grid-dungeon`'s scale,
  but flag if it comes up.
- Whether `moveCircleAgainstGrid`'s extraction is worth doing as its own
  small preparatory PR before the rest of this doc, to keep the
  `movePlayer`-behavior-preserving refactor easy to review in isolation
  from the new Option B code — reasonable either way, sequencing call.
