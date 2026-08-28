# Radius-aware line-of-sight for path smoothing

Status: proposed
Author: (drafted with Claude, for Jules to implement)
Related docs: `2026-08-27-003-free-movement-path-smoothing.md` (introduces
`simplifyPath`/`hasLineOfSight`/`stepNpcWanderFree`; this doc fixes a gap
that doc's own Open Questions section flagged and left unresolved),
`2026-08-27-002-diagonal-pathfinding.md`

## Symptom

The skeleton NPC (`stepNpcWanderFree` in `src/examples/grid-dungeon/room.ts`)
correctly walks corner-to-corner around obstacles when there's genuinely no
line of sight to its goal. But when there *is* a line of sight, it will
sometimes walk close enough to a wall corner to clip it, and
`moveCircleAgainstGrid`'s per-tick collision has to slide it around the
corner instead of the path avoiding it in the first place. Visually: a
stutter/bump-and-slide right at a corner, on paths that should look smooth.

## Root cause

`hasLineOfSight` (`src/utils/pathSmoothing.ts`) walks the supercover line
between two waypoints and checks whether it ever *enters* a blocked cell. It
does not check how close the line passes to a blocked cell's corner. A
straight line can graze a corner within a few centimeters and still pass
this check, because the check is a dimensionless point/line test.

`simplifyPath` uses `hasLineOfSight` to decide which waypoints from
`findPath` are safe to drop. It has no notion of the moving entity's radius
— it doesn't know `stepNpcWanderFree` will later walk a circle of radius
`0.35` (about a third of a tile) along whatever straight line it approves.
So it happily drops a waypoint whenever the *mathematical* line clears a
corner, even when a body with real width would clip it.

The per-tick collision in `moveCircleAgainstGrid` catches this after the
fact and slides the NPC around the corner — which is why the game doesn't
break, but it's masking a gap in the path plan rather than avoiding it. This
is exactly the risk flagged (but left unresolved) as an open question in
`design-docs/2026-08-27-003-free-movement-path-smoothing.md`, under
"Whether the point-based `hasLineOfSight` turns out conservative enough in
practice."

## Fix

Add an optional `radius` parameter to `hasLineOfSight` and `simplifyPath`,
defaulting to `0` so **existing behavior and existing tests are
unchanged** when it's omitted. When `radius > 0`, additionally require the
segment to keep at least `radius` clearance from every blocked cell it
passes near — not just avoid entering one.

Keep this a clearance check layered on top of the existing cell-level
supercover check, not a replacement for it — the two together are strictly
more conservative (block more) than either alone, never less.

Suggested approach (deliberately simple/approximate, consistent with this
codebase's existing "the per-tick collision is the real safety net, the
plan doesn't need to be perfect" philosophy — see the same design doc):

1. Work in continuous coordinates: treat `a` and `b` as cell centers
   (`a.x + 0.5, a.y + 0.5`, matching how `stepNpcWanderFree` already
   targets waypoint centers).
2. Sample points along the segment from `a`-center to `b`-center at a fixed
   step (something like `Math.min(0.1, radius / 2)` tile-units is a
   reasonable default — small enough not to skip past a corner, cheap
   enough at this grid's scale).
3. At each sample point, check the small neighborhood of blocked cells
   around it (roughly `floor(sample - radius)` to `ceil(sample + radius)`
   in each axis is enough — no need to scan the whole grid) and compute the
   distance from the sample point to each blocked cell's AABB (clamp the
   point into the box's `[x, x+1] x [y, y+1]` range, then take the
   Euclidean distance from the point to that clamped point — `0` if the
   point is already inside the box).
4. If any sample point is closer than `radius` to any blocked cell's AABB,
   return `false`. Otherwise (and assuming the existing cell-level check
   also passes), return `true`.

```ts
export function hasLineOfSight<T>(
  grid: TileGrid<T>,
  a: GridPos,
  b: GridPos,
  cost: (pos: GridPos, cell: T) => number,
  radius = 0
): boolean {
  for (const cell of walkSupercoverLine(a, b)) {
    const value = grid.get(cell);
    if (value === undefined || !Number.isFinite(cost(cell, value))) {
      return false;
    }
  }
  if (radius > 0 && !hasClearance(grid, a, b, cost, radius)) {
    return false;
  }
  return true;
}
```

(Exact function boundaries/naming are up to you — a single `hasClearance`
helper that's separately unit-testable is probably cleanest, but folding it
inline is fine too.)

Thread `radius` through `simplifyPath`'s options and into every
`hasLineOfSight` call it makes internally.

In `stepNpcWanderFree`, call:

```ts
const simplified = simplifyPath(grid, path, cost, {
  radius: npcRadius + CLEARANCE_MARGIN,
});
```

Use a small `CLEARANCE_MARGIN` (start around `0.05`–`0.1`) on top of the
skeleton's true `0.35` radius. This isn't just padding for comfort — it
compensates for the fact that `moveCircleAgainstGrid`'s own collision test
is a square AABB sweep per axis, not a true circle, so its effective
collision boundary at a diagonal corner is slightly larger than the
skeleton's visual radius. Without the margin you could still see an
occasional graze even after this fix, if the LOS check (true circle) is
very slightly more permissive than the movement check (square-ish AABB) at
a corner. Playtest and tune this value rather than trusting a guess.

## Non-goals

- Don't change `stepNpcWander` (Option A, stepwise/waypoint-locked
  movement) — it doesn't call `simplifyPath` or `hasLineOfSight` at all and
  is unaffected by this bug.
- Don't change `movePlayer` or `moveCircleAgainstGrid`'s collision shape.
  If tuning `CLEARANCE_MARGIN` doesn't fully eliminate grazing, that's a
  sign the margin needs adjusting, not that the collision system needs to
  become a true circle sweep — that's a bigger change or a separate change,
  out of scope here.
- Don't try to make the clearance check an exact analytic segment-to-AABB
  distance formula. The sampling approach above is intentionally simple and
  matches how approximate/conservative-enough this template's other
  geometry already is (see `movePlayer`'s own axis-independent AABB
  approximation of circle collision, which isn't exact either).
- `radius` defaults to `0` and must not change any existing behavior when
  omitted — every current call site of `hasLineOfSight`/`simplifyPath`
  (there's currently only `stepNpcWanderFree`) should be updated to pass a
  radius, but the function itself must stay backward compatible for any
  future caller that wants pure point-based LOS.

## Tests

Add to `pathSmoothing.test.ts`:

- A grid with a single wall cell, and a segment that passes near its corner
  close enough to graze at radius `0.35` but doesn't enter the wall cell
  itself: assert `hasLineOfSight(..., 0)` (or omitted) is `true` (unchanged
  existing behavior) and `hasLineOfSight(..., 0.35)` is `false`.
- The same setup with the segment routed with generous clearance around the
  corner: assert `hasLineOfSight(..., 0.35)` is still `true` (make sure the
  fix isn't overly conservative and doesn't block legitimately clear paths).
- A `simplifyPath` case built on the near-corner-graze grid above: confirm
  that with `{ radius: 0.35 }`, the corner waypoint is retained (not
  dropped), where it would have been dropped with no radius specified.
- Confirm all existing `pathSmoothing.test.ts` cases still pass unmodified
  (they don't pass `radius`, so they should hit identical code paths to
  before).

## Acceptance criteria

- Skeleton NPC no longer visibly bumps/slides at corners in manual testing
  via the switcher — it should either take a route that already accounts
  for clearance, or (rarely, e.g. if a goal is only reachable via a
  hairline-clear gap) still fall back gracefully to `moveCircleAgainstGrid`
  sliding, but this should stop being the common case it is today.
- `stepNpcWander` (Option A) is untouched and its tests are unaffected.
- All new and existing `pathSmoothing.test.ts` cases pass.
