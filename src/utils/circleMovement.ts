import type { GridPos, TileGrid } from "@utils/tileGrid";

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
): CircleMoveResult {
  let { x, y } = pos;
  if (dx === 0 && dy === 0) return { x, y };

  // Try X movement
  const targetX = x + dx;
  const minTileX = Math.floor(targetX - radius);
  const maxTileX = Math.floor(targetX + radius);
  const minTileY = Math.floor(y - radius);
  const maxTileY = Math.floor(y + radius);

  let xOk = true;
  for (let tx = minTileX; tx <= maxTileX; tx++) {
    for (let ty = minTileY; ty <= maxTileY; ty++) {
      const cell = grid.get({ x: tx, y: ty });
      if (cell === undefined || !isWalkable({ x: tx, y: ty }, cell)) {
        xOk = false;
        break;
      }
    }
    if (!xOk) break;
  }
  if (xOk) {
    x = targetX;
  }

  // Try Y movement
  const targetY = y + dy;
  const curMinTileX = Math.floor(x - radius);
  const curMaxTileX = Math.floor(x + radius);
  const newMinTileY = Math.floor(targetY - radius);
  const newMaxTileY = Math.floor(targetY + radius);

  let yOk = true;
  for (let tx = curMinTileX; tx <= curMaxTileX; tx++) {
    for (let ty = newMinTileY; ty <= newMaxTileY; ty++) {
      const cell = grid.get({ x: tx, y: ty });
      if (cell === undefined || !isWalkable({ x: tx, y: ty }, cell)) {
        yOk = false;
        break;
      }
    }
    if (!yOk) break;
  }
  if (yOk) {
    y = targetY;
  }

  return { x, y };
}

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
): { dx: number; dy: number } {
  const diffX = target.x - pos.x;
  const diffY = target.y - pos.y;
  const dist = Math.sqrt(diffX * diffX + diffY * diffY);

  if (dist <= arrivalRadius || dist === 0) {
    return { dx: 0, dy: 0 };
  }

  const maxStep = speed * dt;
  const step = Math.min(maxStep, dist);

  return {
    dx: (diffX / dist) * step,
    dy: (diffY / dist) * step,
  };
}
