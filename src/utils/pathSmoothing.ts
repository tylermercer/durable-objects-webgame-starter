import type { GridPos } from "@utils/tileGrid";
import { TileGrid } from "@utils/tileGrid";

/**
 * Supercover line walk: yields every grid cell crossed by the line segment
 * from the center of cell `a` to the center of cell `b`.
 */
export function* walkSupercoverLine(a: GridPos, b: GridPos): Generator<GridPos> {
  let x = a.x;
  let y = a.y;

  yield { x, y };

  if (a.x === b.x && a.y === b.y) return;

  const dx = b.x - a.x;
  const dy = b.y - a.y;

  const stepX = Math.sign(dx);
  const stepY = Math.sign(dy);

  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);

  let tMaxX = stepX !== 0 ? 0.5 / absDx : Infinity;
  let tMaxY = stepY !== 0 ? 0.5 / absDy : Infinity;

  const tDeltaX = stepX !== 0 ? 1 / absDx : Infinity;
  const tDeltaY = stepY !== 0 ? 1 / absDy : Infinity;

  while (x !== b.x || y !== b.y) {
    const diff = tMaxX - tMaxY;
    if (Math.abs(diff) < 1e-9) {
      yield { x: x + stepX, y };
      yield { x, y: y + stepY };
      x += stepX;
      y += stepY;
      tMaxX += tDeltaX;
      tMaxY += tDeltaY;
    } else if (diff < 0) {
      x += stepX;
      tMaxX += tDeltaX;
    } else {
      y += stepY;
      tMaxY += tDeltaY;
    }
    yield { x, y };
  }
}

/** Grid-space line-of-sight: true if every cell the segment between `a`
 *  and `b` passes through is open per `cost`. Exported for reuse/testing. */
export function hasLineOfSight<T>(
  grid: TileGrid<T>,
  a: GridPos,
  b: GridPos,
  cost: (pos: GridPos, cell: T) => number
): boolean {
  for (const cell of walkSupercoverLine(a, b)) {
    const value = grid.get(cell);
    if (value === undefined || !Number.isFinite(cost(cell, value))) {
      return false;
    }
  }
  return true;
}

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
