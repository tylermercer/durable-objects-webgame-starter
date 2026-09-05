import { TileGrid, type GridPos } from "@utils/tileGrid";
import { createRng } from "@utils/rng";
import type { Cell, LevelSpec } from "./types";

export function getLevelSpec(levelNumber: number): LevelSpec {
  const clampedLevel = Math.max(1, levelNumber);
  const width = Math.min(12, 5 + Math.floor((clampedLevel - 1) * 0.5));
  const height = Math.min(10, 5 + Math.floor((clampedLevel - 1) * 0.5));
  const targetWalkLength = 6 + (clampedLevel - 1) * 3;
  const maxRevisitsPerCell = Math.min(5, 1 + Math.floor((clampedLevel - 1) * 0.3));

  return {
    width,
    height,
    startPos: { x: 0, y: 0 },
    endPos: { x: width - 1, y: height - 1 },
    targetWalkLength,
    maxRevisitsPerCell,
  };
}

export function generateLevel(
  seed: string | number,
  levelNumber: number
): {
  grid: TileGrid<Cell | null>;
  startPos: GridPos;
  endPos: GridPos;
  levelSpec: LevelSpec;
} {
  const levelSpec = getLevelSpec(levelNumber);
  const { width, height, targetWalkLength, maxRevisitsPerCell } = levelSpec;

  const startPos: GridPos = { x: 0, y: 0 };
  const endPos: GridPos = { x: width - 1, y: height - 1 };

  // Generate walk using seed
  const rng = createRng(`${seed}_level_${levelNumber}`);

  let walk: GridPos[] = [];
  let visitCounts: number[][] = [];

  const maxAttempts = 200;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    visitCounts = Array.from({ length: height }, () => Array(width).fill(0));
    walk = [startPos];
    visitCounts[startPos.y][startPos.x] = 1;

    let steps = 0;
    const maxSteps = targetWalkLength * 10;

    while (steps < maxSteps) {
      steps++;
      const current = walk[walk.length - 1];

      // Check win condition for walk
      if (
        walk.length >= targetWalkLength &&
        current.x === endPos.x &&
        current.y === endPos.y
      ) {
        break;
      }

      // Orthogonal neighbors
      const neighbors: GridPos[] = [
        { x: current.x + 1, y: current.y },
        { x: current.x - 1, y: current.y },
        { x: current.x, y: current.y + 1 },
        { x: current.x, y: current.y - 1 },
      ].filter(
        (p) =>
          p.x >= 0 &&
          p.x < width &&
          p.y >= 0 &&
          p.y < height &&
          visitCounts[p.y][p.x] < maxRevisitsPerCell
      );

      if (neighbors.length === 0) {
        // Dead end, break to retry attempt
        break;
      }

      // If walk length < targetWalkLength, filter out endPos if other options exist
      let candidates = neighbors;
      if (walk.length < targetWalkLength && candidates.length > 1) {
        const nonEnd = candidates.filter(
          (p) => !(p.x === endPos.x && p.y === endPos.y)
        );
        if (nonEnd.length > 0) {
          candidates = nonEnd;
        }
      }

      // Prefer unvisited neighbors
      const unvisited = candidates.filter((p) => visitCounts[p.y][p.x] === 0);
      let chosen: GridPos;
      if (unvisited.length > 0 && rng() < 0.75) {
        chosen = unvisited[Math.floor(rng() * unvisited.length)];
      } else {
        chosen = candidates[Math.floor(rng() * candidates.length)];
      }

      visitCounts[chosen.y][chosen.x]++;
      walk.push(chosen);
    }

    const last = walk[walk.length - 1];
    if (
      walk.length >= targetWalkLength &&
      last.x === endPos.x &&
      last.y === endPos.y
    ) {
      // Valid walk generated!
      break;
    }
  }

  // Construct grid from visitCounts
  const grid = new TileGrid<Cell | null>(width, height, (pos) => {
    const count = visitCounts[pos.y][pos.x];
    if (count === 0) return null;

    let kind: Cell["kind"] = "normal";
    if (pos.x === startPos.x && pos.y === startPos.y) {
      kind = "start";
    }
    if (pos.x === endPos.x && pos.y === endPos.y) {
      kind = "end";
    }

    return {
      kind,
      capacity: count,
      remaining: count,
    };
  });

  return { grid, startPos, endPos, levelSpec };
}
