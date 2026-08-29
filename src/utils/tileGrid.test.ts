import { describe, expect, it } from "vitest";
import { TileGrid, DIRECTIONS_8 } from "./tileGrid";

describe("TileGrid", () => {
  it("serializes and deserializes via toJSON and fromJSON", () => {
    const grid = new TileGrid<"black" | "white" | null>(3, 3, (pos) => (pos.x === pos.y ? "black" : null));
    grid.set({ x: 0, y: 1 }, "white");

    const json = grid.toJSON();
    expect(json.width).toBe(3);
    expect(json.height).toBe(3);
    expect(json.cells).toHaveLength(9);

    const restored = TileGrid.fromJSON(json);
    expect(restored.width).toBe(3);
    expect(restored.height).toBe(3);
    expect(restored.get({ x: 0, y: 0 })).toBe("black");
    expect(restored.get({ x: 0, y: 1 })).toBe("white");
    expect(restored.get({ x: 1, y: 0 })).toBeNull();
  });

  it("casts rays outward excluding start pos and truncating at grid edges", () => {
    const grid = new TileGrid(4, 4, (pos) => `${pos.x},${pos.y}`);

    // Ray right (1, 0) from (1, 1)
    const rightRay = Array.from(grid.ray({ x: 1, y: 1 }, 1, 0));
    expect(rightRay).toEqual([
      { pos: { x: 2, y: 1 }, value: "2,1" },
      { pos: { x: 3, y: 1 }, value: "3,1" },
    ]);

    // Ray diagonal (-1, -1) from (2, 2)
    const diagRay = Array.from(grid.ray({ x: 2, y: 2 }, -1, -1));
    expect(diagRay).toEqual([
      { pos: { x: 1, y: 1 }, value: "1,1" },
      { pos: { x: 0, y: 0 }, value: "0,0" },
    ]);

    // Ray from edge going out of bounds immediately
    const edgeRay = Array.from(grid.ray({ x: 0, y: 0 }, -1, 0));
    expect(edgeRay).toEqual([]);

    // Check that ray works in all DIRECTIONS_8 from center (2,2) on 5x5 grid
    const grid5 = new TileGrid(5, 5, () => 1);
    for (const [dx, dy] of DIRECTIONS_8) {
      const rayResult = Array.from(grid5.ray({ x: 2, y: 2 }, dx, dy));
      expect(rayResult.length).toBeGreaterThanOrEqual(2);
      expect(rayResult[0].pos).toEqual({ x: 2 + dx, y: 2 + dy });
    }
  });

  it("initializes grid cells using fill function", () => {
    const grid = new TileGrid(3, 2, (pos) => `${pos.x},${pos.y}`);
    expect(grid.width).toBe(3);
    expect(grid.height).toBe(2);
    expect(grid.get({ x: 0, y: 0 })).toBe("0,0");
    expect(grid.get({ x: 2, y: 1 })).toBe("2,1");
  });

  it("checks bounds correctly", () => {
    const grid = new TileGrid(5, 5, () => 0);
    expect(grid.inBounds({ x: 0, y: 0 })).toBe(true);
    expect(grid.inBounds({ x: 4, y: 4 })).toBe(true);
    expect(grid.inBounds({ x: -1, y: 0 })).toBe(false);
    expect(grid.inBounds({ x: 0, y: -1 })).toBe(false);
    expect(grid.inBounds({ x: 5, y: 0 })).toBe(false);
    expect(grid.inBounds({ x: 0, y: 5 })).toBe(false);
  });

  it("returns undefined for out-of-bounds get and ignores out-of-bounds set", () => {
    const grid = new TileGrid(2, 2, () => 10);
    expect(grid.get({ x: 2, y: 0 })).toBeUndefined();
    grid.set({ x: 2, y: 0 }, 99);
    expect(grid.get({ x: 2, y: 0 })).toBeUndefined();

    grid.set({ x: 1, y: 1 }, 42);
    expect(grid.get({ x: 1, y: 1 })).toBe(42);
  });

  it("iterates neighbors (cardinal and diagonal)", () => {
    const grid = new TileGrid(3, 3, () => 0);

    const cardinalCorner = Array.from(grid.neighbors({ x: 0, y: 0 }));
    expect(cardinalCorner).toEqual([
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ]);

    const cardinalCenter = Array.from(grid.neighbors({ x: 1, y: 1 }));
    expect(cardinalCenter).toEqual([
      { x: 2, y: 1 },
      { x: 0, y: 1 },
      { x: 1, y: 2 },
      { x: 1, y: 0 },
    ]);

    const diagonalCenter = Array.from(grid.neighbors({ x: 1, y: 1 }, true));
    expect(diagonalCenter.length).toBe(8);
    expect(diagonalCenter).toContainEqual({ x: 2, y: 2 });
    expect(diagonalCenter).toContainEqual({ x: 0, y: 0 });
  });

  describe("findPath", () => {
    it("finds a direct straight-line path when clear", () => {
      const grid = new TileGrid(5, 5, () => ({ walkable: true }));
      const path = grid.findPath(
        { x: 0, y: 0 },
        { x: 3, y: 0 },
        (_pos, cell) => (cell.walkable ? 1 : Infinity)
      );
      expect(path).toEqual([
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
        { x: 3, y: 0 },
      ]);
    });

    it("navigates around walls", () => {
      // 3x3 grid with a wall in the middle:
      // S W .
      // . W .
      // . . G
      const grid = new TileGrid(3, 3, () => ({ walkable: true }));
      grid.set({ x: 1, y: 0 }, { walkable: false });
      grid.set({ x: 1, y: 1 }, { walkable: false });

      const path = grid.findPath(
        { x: 0, y: 0 },
        { x: 2, y: 2 },
        (_pos, cell) => (cell.walkable ? 1 : Infinity)
      );

      expect(path).not.toBeNull();
      expect(path![0]).toEqual({ x: 0, y: 0 });
      expect(path![path!.length - 1]).toEqual({ x: 2, y: 2 });
      for (const pos of path!) {
        expect(grid.get(pos)?.walkable).toBe(true);
      }
    });

    it("returns null when goal is completely blocked", () => {
      const grid = new TileGrid(3, 3, () => ({ walkable: true }));
      // Wall surrounding (2,2)
      grid.set({ x: 1, y: 2 }, { walkable: false });
      grid.set({ x: 2, y: 1 }, { walkable: false });

      const path = grid.findPath(
        { x: 0, y: 0 },
        { x: 2, y: 2 },
        (_pos, cell) => (cell.walkable ? 1 : Infinity)
      );

      expect(path).toBeNull();
    });

    it("returns null for out of bounds start or goal", () => {
      const grid = new TileGrid(3, 3, () => ({ walkable: true }));
      expect(
        grid.findPath({ x: -1, y: 0 }, { x: 2, y: 2 }, () => 1)
      ).toBeNull();
      expect(
        grid.findPath({ x: 0, y: 0 }, { x: 5, y: 2 }, () => 1)
      ).toBeNull();
    });

    it("respects variable cell costs", () => {
      // 3x3 grid: direct route tile has high cost 100
      const grid = new TileGrid(3, 3, () => 1);
      grid.set({ x: 1, y: 0 }, 100);

      const path = grid.findPath(
        { x: 0, y: 0 },
        { x: 2, y: 0 },
        (_pos, costVal) => costVal
      );

      expect(path).toEqual([
        { x: 0, y: 0 },
        { x: 0, y: 1 },
        { x: 1, y: 1 },
        { x: 2, y: 1 },
        { x: 2, y: 0 },
      ]);
    });

    it("returns shorter/straighter path on open ground when diagonals: true", () => {
      const grid = new TileGrid(5, 5, () => ({ walkable: true }));
      const cost = (_pos: any, cell: any) => (cell.walkable ? 1 : Infinity);

      const cardinalPath = grid.findPath({ x: 0, y: 0 }, { x: 3, y: 3 }, cost);
      const diagonalPath = grid.findPath(
        { x: 0, y: 0 },
        { x: 3, y: 3 },
        cost,
        { diagonals: true }
      );

      expect(cardinalPath).toHaveLength(7); // 6 steps (3 right, 3 down)
      expect(diagonalPath).toEqual([
        { x: 0, y: 0 },
        { x: 1, y: 1 },
        { x: 2, y: 2 },
        { x: 3, y: 3 },
      ]);
      expect(diagonalPath).toHaveLength(4); // 3 diagonal steps
    });

    it("prevents corner-cutting when an orthogonal neighbor is blocked", () => {
      // 3x3 grid:
      // S W .
      // . G .
      // . . .
      // S at (0,0), W at (1,0) wall, G at (1,1).
      // Diagonal step from (0,0) to (1,1) requires both (1,0) and (0,1) to be open.
      const grid = new TileGrid(3, 3, () => ({ walkable: true }));
      grid.set({ x: 1, y: 0 }, { walkable: false }); // Wall at (1,0)
      const cost = (_pos: any, cell: any) => (cell.walkable ? 1 : Infinity);

      const path = grid.findPath(
        { x: 0, y: 0 },
        { x: 1, y: 1 },
        cost,
        { diagonals: true }
      );

      // Should not cut corner (0,0)->(1,1). Instead go (0,0)->(0,1)->(1,1).
      expect(path).toEqual([
        { x: 0, y: 0 },
        { x: 0, y: 1 },
        { x: 1, y: 1 },
      ]);

      // If both orthogonal neighbors are blocked, diagonal move is completely blocked
      grid.set({ x: 0, y: 1 }, { walkable: false });
      const pathBlocked = grid.findPath(
        { x: 0, y: 0 },
        { x: 1, y: 1 },
        cost,
        { diagonals: true }
      );
      expect(pathBlocked).toBeNull();
    });

    it("asserts no path with diagonals on steps diagonally across a blocked corner", () => {
      // Complex room with multiple walls
      const grid = new TileGrid(5, 5, () => ({ walkable: true }));
      grid.set({ x: 2, y: 1 }, { walkable: false });
      grid.set({ x: 1, y: 2 }, { walkable: false });
      grid.set({ x: 3, y: 3 }, { walkable: false });

      const cost = (_pos: any, cell: any) => (cell.walkable ? 1 : Infinity);
      const path = grid.findPath(
        { x: 0, y: 0 },
        { x: 4, y: 4 },
        cost,
        { diagonals: true }
      );

      expect(path).not.toBeNull();
      for (let i = 0; i < path!.length - 1; i++) {
        const cur = path![i];
        const next = path![i + 1];
        const dx = next.x - cur.x;
        const dy = next.y - cur.y;
        if (dx !== 0 && dy !== 0) {
          const cornerA = { x: cur.x + dx, y: cur.y };
          const cornerB = { x: cur.x, y: cur.y + dy };
          expect(grid.get(cornerA)?.walkable).toBe(true);
          expect(grid.get(cornerB)?.walkable).toBe(true);
        }
      }
    });
  });
});
