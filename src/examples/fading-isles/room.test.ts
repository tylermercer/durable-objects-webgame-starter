import { describe, expect, it } from "vitest";
import { TileGrid } from "@utils/tileGrid";
import { EntityRegistry } from "@utils/entityRegistry";
import { capacityColor, isTileOccupiedByOtherPlayer, stepRoom } from "./room";
import type { Cell, PlayerEntity } from "./types";

describe("Fading Isles Room Logic", () => {
  it("computes capacity colors correctly", () => {
    expect(capacityColor(0)).toBe("#475569");
    expect(capacityColor(1)).toBe("#3b82f6");
    expect(capacityColor(5)).toBe("rgb(239, 68, 68)");
  });

  it("decrements capacity on tile arrival and crumbles only when vacated", () => {
    const grid = new TileGrid<Cell | null>(3, 1, (pos) => {
      if (pos.x === 0) return { kind: "start", capacity: 1, remaining: 1 };
      if (pos.x === 1) return { kind: "normal", capacity: 1, remaining: 1 };
      return { kind: "end", capacity: 1, remaining: 1 };
    });

    const registry = new EntityRegistry<PlayerEntity>();
    registry.add({ id: "p1", kind: "player", name: "P1", color: "#f00", x: 0.5, y: 0.5 });

    const inputs = new Map([["p1", { x: 1, y: 0 }]]);

    // Move right onto tile (1,0) (dt=0.3 -> dx = 1.05 tiles)
    let res = stepRoom(grid, registry, inputs, 0.3);
    expect(res.won).toBe(false);

    // Player 1 should now be on (1,0)
    const p1 = registry.get("p1")!;
    expect(Math.floor(p1.x)).toBe(1);

    // Tile (1,0) capacity remaining decremented to 0
    expect(grid.get({ x: 1, y: 0 })?.remaining).toBe(0);

    // Tile (0,0) had remaining 1, moved off, but it's not at remaining 0 so it stays tile
    expect(grid.get({ x: 0, y: 0 })).not.toBeNull();

    // Now move onto (2,0) which is end tile
    res = stepRoom(grid, registry, inputs, 0.3);

    expect(Math.floor(p1.x)).toBe(2);
    // Tile (1,0) had remaining 0 and was vacated, so it crumbles (becomes null)
    expect(grid.get({ x: 1, y: 0 })).toBeNull();
  });

  it("prevents players from moving onto tiles occupied by another player", () => {
    const grid = new TileGrid<Cell | null>(2, 1, (pos) => ({
      kind: pos.x === 0 ? "start" : "normal",
      capacity: 2,
      remaining: 2,
    }));

    const registry = new EntityRegistry<PlayerEntity>();
    registry.add({ id: "p1", kind: "player", name: "P1", color: "#f00", x: 0.5, y: 0.5 });
    registry.add({ id: "p2", kind: "player", name: "P2", color: "#0f0", x: 1.5, y: 0.5 });

    expect(isTileOccupiedByOtherPlayer({ x: 1, y: 0 }, "p1", [registry.get("p1")!, registry.get("p2")!])).toBe(true);

    const inputs = new Map([["p1", { x: 1, y: 0 }]]); // p1 tries to move onto p2's tile
    stepRoom(grid, registry, inputs, 0.3);

    const p1 = registry.get("p1")!;
    // p1 should be blocked and stay on tile 0
    expect(Math.floor(p1.x)).toBe(0);
  });

  it("triggers win condition when only E remains, depleted to 0, and occupied", () => {
    const grid = new TileGrid<Cell | null>(2, 1, (pos) => {
      if (pos.x === 0) return null; // Already crumbled
      return { kind: "end", capacity: 1, remaining: 1 };
    });

    const registry = new EntityRegistry<PlayerEntity>();
    // Player starts on (0,0) and moves onto (1,0)
    registry.add({ id: "p1", kind: "player", name: "P1", color: "#f00", x: 0.5, y: 0.5 });

    const inputs = new Map([["p1", { x: 1, y: 0 }]]);

    const res = stepRoom(grid, registry, inputs, 0.3);
    expect(grid.get({ x: 1, y: 0 })?.remaining).toBe(0);
    expect(res.won).toBe(true);
  });
});
