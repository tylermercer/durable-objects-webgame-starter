import { describe, it, expect } from "vitest";
import { TileGrid, type GridPos } from "./tileGrid";
import { moveCircleAgainstGrid, steerToward } from "./circleMovement";

describe("circleMovement", () => {
  describe("moveCircleAgainstGrid", () => {
    // 5x5 grid with outer wall boundary (0 and 4 are walls)
    const grid = new TileGrid<boolean>(5, 5, (pos) => {
      if (pos.x === 0 || pos.x === 4 || pos.y === 0 || pos.y === 4) return false;
      return true;
    });
    const isWalkable = (_pos: GridPos, cell: boolean) => cell;

    it("moves freely in open space", () => {
      const start = { x: 2.5, y: 2.5 };
      const res = moveCircleAgainstGrid(start, 0.35, 0.5, 0.5, grid, isWalkable);
      expect(res.x).toBe(3.0);
      expect(res.y).toBe(3.0);
    });

    it("slides along wall when one axis is blocked", () => {
      const start = { x: 3.5, y: 2.5 };
      // Move right (blocked by wall at x=4) and down (open space)
      const res = moveCircleAgainstGrid(start, 0.35, 0.4, 0.4, grid, isWalkable);
      // X movement blocked, Y movement succeeded
      expect(res.x).toBe(3.5);
      expect(res.y).toBe(2.9);
    });

    it("stops on both axes when hitting a corner boundary", () => {
      const start = { x: 3.5, y: 3.5 };
      const res = moveCircleAgainstGrid(start, 0.35, 0.4, 0.4, grid, isWalkable);
      expect(res.x).toBe(3.5);
      expect(res.y).toBe(3.5);
    });

    it("handles zero movement delta", () => {
      const start = { x: 2.0, y: 2.0 };
      const res = moveCircleAgainstGrid(start, 0.35, 0, 0, grid, isWalkable);
      expect(res).toEqual({ x: 2.0, y: 2.0 });
    });
  });

  describe("steerToward", () => {
    it("returns {dx:0, dy:0} if within arrival radius", () => {
      const pos = { x: 1.0, y: 1.0 };
      const target = { x: 1.02, y: 1.02 };
      const steer = steerToward(pos, target, 2.0, 0.1, 0.05);
      expect(steer).toEqual({ dx: 0, dy: 0 });
    });

    it("caps step magnitude at speed * dt", () => {
      const pos = { x: 0.0, y: 0.0 };
      const target = { x: 10.0, y: 0.0 };
      const speed = 4.0;
      const dt = 0.5; // maxStep = 2.0
      const steer = steerToward(pos, target, speed, dt);
      expect(steer.dx).toBeCloseTo(2.0);
      expect(steer.dy).toBeCloseTo(0.0);
    });

    it("moves directly to target if distance is less than maxStep", () => {
      const pos = { x: 0.0, y: 0.0 };
      const target = { x: 0.5, y: 0.0 };
      const speed = 4.0;
      const dt = 0.5; // maxStep = 2.0
      const steer = steerToward(pos, target, speed, dt);
      expect(steer.dx).toBeCloseTo(0.5);
      expect(steer.dy).toBeCloseTo(0.0);
    });
  });
});
