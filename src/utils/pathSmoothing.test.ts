import { describe, it, expect } from "vitest";
import { TileGrid, type GridPos } from "@utils/tileGrid";
import { walkSupercoverLine, hasLineOfSight, simplifyPath } from "./pathSmoothing";

describe("pathSmoothing", () => {
  describe("walkSupercoverLine", () => {
    it("yields single cell for identical start and end", () => {
      const line = Array.from(walkSupercoverLine({ x: 2, y: 3 }, { x: 2, y: 3 }));
      expect(line).toEqual([{ x: 2, y: 3 }]);
    });

    it("yields horizontal sequence", () => {
      const line = Array.from(walkSupercoverLine({ x: 1, y: 2 }, { x: 4, y: 2 }));
      expect(line).toEqual([
        { x: 1, y: 2 },
        { x: 2, y: 2 },
        { x: 3, y: 2 },
        { x: 4, y: 2 },
      ]);
    });

    it("yields vertical sequence", () => {
      const line = Array.from(walkSupercoverLine({ x: 2, y: 4 }, { x: 2, y: 1 }));
      expect(line).toEqual([
        { x: 2, y: 4 },
        { x: 2, y: 3 },
        { x: 2, y: 2 },
        { x: 2, y: 1 },
      ]);
    });

    it("yields supercover cells for diagonal line without skipping edge-crossed cells", () => {
      // Shallow diagonal line
      const line = Array.from(walkSupercoverLine({ x: 0, y: 0 }, { x: 3, y: 1 }));
      expect(line).toContainEqual({ x: 0, y: 0 });
      expect(line).toContainEqual({ x: 3, y: 1 });
      expect(line.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe("hasLineOfSight", () => {
    const grid = new TileGrid<boolean>(5, 5, (pos) => {
      // Wall at (2, 2)
      if (pos.x === 2 && pos.y === 2) return false;
      return true;
    });
    const cost = (_pos: GridPos, cell: boolean) => (cell ? 1 : Infinity);

    it("returns true for open line of sight", () => {
      expect(hasLineOfSight(grid, { x: 0, y: 0 }, { x: 4, y: 0 }, cost)).toBe(true);
      expect(hasLineOfSight(grid, { x: 0, y: 0 }, { x: 0, y: 4 }, cost)).toBe(true);
    });

    it("returns false if line passes through blocked cell", () => {
      expect(hasLineOfSight(grid, { x: 0, y: 2 }, { x: 4, y: 2 }, cost)).toBe(false);
      expect(hasLineOfSight(grid, { x: 2, y: 0 }, { x: 2, y: 4 }, cost)).toBe(false);
      expect(hasLineOfSight(grid, { x: 0, y: 0 }, { x: 4, y: 4 }, cost)).toBe(false);
    });

    it("handles corner clearance based on radius", () => {
      // 6x6 grid with a single wall cell at (1, 3)
      const cornerGrid = new TileGrid<boolean>(6, 6, (pos) => {
        if (pos.x === 1 && pos.y === 3) return false;
        return true;
      });

      const start: GridPos = { x: 0, y: 1 }; // center (0.5, 1.5)
      const nearEnd: GridPos = { x: 4, y: 4 }; // center (4.5, 4.5); line segment distance to corner (2, 3) is 0.3 tile units

      // Radius 0 (or omitted) passes because supercover line does not enter cell (1, 3)
      expect(hasLineOfSight(cornerGrid, start, nearEnd, cost, 0)).toBe(true);
      expect(hasLineOfSight(cornerGrid, start, nearEnd, cost)).toBe(true);

      // Radius 0.35 fails because segment passes within 0.3 < 0.35 of corner (2, 3)
      expect(hasLineOfSight(cornerGrid, start, nearEnd, cost, 0.35)).toBe(false);

      // Generous clearance: route to (5, 4) passes at distance ~0.51 > 0.35 from corner (2, 3)
      const farEnd: GridPos = { x: 5, y: 4 };
      expect(hasLineOfSight(cornerGrid, start, farEnd, cost, 0.35)).toBe(true);
    });
  });

  describe("simplifyPath", () => {
    const cost = (_pos: GridPos, cell: boolean) => (cell ? 1 : Infinity);

    it("simplifies a staircase path in an open room to just [start, end]", () => {
      const openGrid = new TileGrid<boolean>(10, 10, () => true);
      const rawPath: GridPos[] = [
        { x: 1, y: 1 },
        { x: 2, y: 1 },
        { x: 2, y: 2 },
        { x: 3, y: 2 },
        { x: 3, y: 3 },
        { x: 4, y: 3 },
        { x: 5, y: 5 },
      ];

      const simplified = simplifyPath(openGrid, rawPath, cost);
      expect(simplified).toEqual([
        { x: 1, y: 1 },
        { x: 5, y: 5 },
      ]);
    });

    it("retains necessary turning point around an L-shaped obstacle", () => {
      // 5x5 grid with wall column at x=2, y=0..3 except y=4 is open
      const lGrid = new TileGrid<boolean>(5, 5, (pos) => {
        if (pos.x === 2 && pos.y >= 0 && pos.y <= 3) return false;
        return true;
      });

      const rawPath: GridPos[] = [
        { x: 0, y: 0 },
        { x: 0, y: 1 },
        { x: 0, y: 2 },
        { x: 0, y: 3 },
        { x: 0, y: 4 },
        { x: 1, y: 4 },
        { x: 2, y: 4 },
        { x: 3, y: 4 },
        { x: 4, y: 4 },
        { x: 4, y: 3 },
        { x: 4, y: 0 },
      ];

      const simplified = simplifyPath(lGrid, rawPath, cost);
      expect(simplified.length).toBeLessThan(rawPath.length);
      expect(simplified[0]).toEqual({ x: 0, y: 0 });
      expect(simplified[simplified.length - 1]).toEqual({ x: 4, y: 0 });
      // Waypoint around the wall bottom (e.g., at y=4) should be kept
      expect(simplified.some((p) => p.y === 4)).toBe(true);
    });

    it("returns short paths unchanged", () => {
      const openGrid = new TileGrid<boolean>(5, 5, () => true);
      const shortPath: GridPos[] = [{ x: 1, y: 1 }, { x: 2, y: 2 }];
      expect(simplifyPath(openGrid, shortPath, cost)).toEqual(shortPath);
    });

    it("retains corner waypoint when radius clearance is specified", () => {
      const cornerGrid = new TileGrid<boolean>(6, 6, (pos) => {
        if (pos.x === 1 && pos.y === 3) return false;
        return true;
      });

      const rawPath: GridPos[] = [
        { x: 0, y: 1 },
        { x: 2, y: 2 },
        { x: 4, y: 4 },
      ];

      // Without radius (radius = 0), straight line from (0,1) to (4,4) drops (2,2)
      const simplifiedNoRadius = simplifyPath(cornerGrid, rawPath, cost);
      expect(simplifiedNoRadius).toEqual([
        { x: 0, y: 1 },
        { x: 4, y: 4 },
      ]);

      // With radius 0.35, straight line grazes corner at (2,3), so intermediate waypoint (2,2) is retained
      const simplifiedWithRadius = simplifyPath(cornerGrid, rawPath, cost, { radius: 0.35 });
      expect(simplifiedWithRadius).toEqual([
        { x: 0, y: 1 },
        { x: 2, y: 2 },
        { x: 4, y: 4 },
      ]);
    });
  });
});
