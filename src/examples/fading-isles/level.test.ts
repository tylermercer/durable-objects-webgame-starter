import { describe, expect, it } from "vitest";
import { generateLevel, getLevelSpec } from "./level";

describe("Fading Isles Level Generation", () => {
  it("generates levels deterministically given same seed and level number", () => {
    const res1 = generateLevel("test_seed", 1);
    const res2 = generateLevel("test_seed", 1);

    expect(res1.levelSpec).toEqual(res2.levelSpec);
    expect(res1.grid.width).toBe(res2.grid.width);
    expect(res1.grid.height).toBe(res2.grid.height);

    for (let y = 0; y < res1.grid.height; y++) {
      for (let x = 0; x < res1.grid.width; x++) {
        const c1 = res1.grid.get({ x, y });
        const c2 = res2.grid.get({ x, y });
        expect(c1).toEqual(c2);
      }
    }
  });

  it("scales level difficulty spec with level number", () => {
    const spec1 = getLevelSpec(1);
    const spec5 = getLevelSpec(5);

    expect(spec5.width).toBeGreaterThanOrEqual(spec1.width);
    expect(spec5.height).toBeGreaterThanOrEqual(spec1.height);
    expect(spec5.targetWalkLength).toBeGreaterThan(spec1.targetWalkLength);
  });

  it("ensures generated grid contains start (S) and end (E) tiles", () => {
    const { grid, startPos, endPos } = generateLevel("seed_123", 2);

    const startCell = grid.get(startPos);
    expect(startCell).not.toBeNull();
    expect(startCell?.kind).toBe("start");
    expect(startCell?.capacity).toBeGreaterThanOrEqual(1);

    const endCell = grid.get(endPos);
    expect(endCell).not.toBeNull();
    expect(endCell?.kind).toBe("end");
    expect(endCell?.capacity).toBeGreaterThanOrEqual(1);
  });
});
