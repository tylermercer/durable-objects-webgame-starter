import { describe, it, expect } from "vitest";
import {
  createRoomGrid,
  createInitialEntities,
  syncPlayers,
  movePlayer,
  stepNpcWander,
  ROOM_WIDTH,
  ROOM_HEIGHT,
} from "./room";
import { EntityRegistry } from "../../utils/entityRegistry";
import type { DungeonEntity, NpcEntity, PlayerEntity } from "./types";
import { createRng } from "../../utils/rng";

describe("Grid Dungeon room simulation", () => {
  it("creates room grid with outer wall boundary and expected size", () => {
    const grid = createRoomGrid();
    expect(grid.width).toBe(ROOM_WIDTH);
    expect(grid.height).toBe(ROOM_HEIGHT);

    // Check corners are walls
    expect(grid.get({ x: 0, y: 0 })?.walkable).toBe(false);
    expect(grid.get({ x: 19, y: 0 })?.walkable).toBe(false);
    expect(grid.get({ x: 0, y: 14 })?.walkable).toBe(false);
    expect(grid.get({ x: 19, y: 14 })?.walkable).toBe(false);

    // Check interior cell (1, 1) is walkable
    expect(grid.get({ x: 1, y: 1 })?.walkable).toBe(true);
  });

  it("spawns and retains player entities across rejoin", () => {
    const registry = createInitialEntities();
    const activePeers = [
      { id: "player-1", name: "Alice", color: "#ff0000" },
      { id: "player-2", name: "Bob", color: "#00ff00" },
    ];

    syncPlayers(registry, activePeers);
    let p1 = registry.get("player-1") as PlayerEntity;
    expect(p1).toBeDefined();
    expect(p1.name).toBe("Alice");
    expect(p1.x).toBe(1.5);
    expect(p1.y).toBe(1.5);

    // Move player 1
    p1.x = 5.0;
    p1.y = 5.0;

    // Simulate player 1 refreshing / rejoining
    const updatedPeers = [
      { id: "player-1", name: "Alice Renamed", color: "#ff0000" },
      { id: "player-2", name: "Bob", color: "#00ff00" },
    ];
    syncPlayers(registry, updatedPeers);

    p1 = registry.get("player-1") as PlayerEntity;
    expect(p1.name).toBe("Alice Renamed");
    // Position must be retained across rejoin!
    expect(p1.x).toBe(5.0);
    expect(p1.y).toBe(5.0);
  });

  it("moves player according to joystick input and blocks on wall tiles", () => {
    const grid = createRoomGrid();
    const player: PlayerEntity = {
      id: "p1",
      kind: "player",
      name: "Tester",
      color: "#ffffff",
      x: 1.5,
      y: 1.5,
    };

    // Move right into walkable space
    movePlayer(player, grid, { x: 1, y: 0 }, 0.1);
    expect(player.x).toBeGreaterThan(1.5);
    expect(player.y).toBe(1.5);

    // Attempt to move up into outer top wall (y = 0 is wall)
    player.x = 1.5;
    player.y = 1.4;
    const prevY = player.y;
    movePlayer(player, grid, { x: 0, y: -1 }, 0.5);
    // Move should be blocked by wall
    expect(player.y).toBe(prevY);
  });

  it("handles NPC wander pathfinding around wall obstacles", () => {
    const grid = createRoomGrid();
    const rng = createRng(12345);
    const npc: NpcEntity = {
      id: "npc-1",
      kind: "npc",
      name: "Goblin",
      color: "#2ecc40",
      x: 1.5,
      y: 1.5,
      currentPath: [],
      wanderTimer: 0, // Trigger path search immediately
    };

    stepNpcWander(npc, grid, 0.1, rng);
    expect(npc.currentPath.length).toBeGreaterThan(0);

    // Follow path over several ticks
    const initialPathLen = npc.currentPath.length;
    for (let i = 0; i < 20; i++) {
      stepNpcWander(npc, grid, 0.1, rng);
    }
    expect(npc.currentPath.length).toBeLessThan(initialPathLen);
  });
});
