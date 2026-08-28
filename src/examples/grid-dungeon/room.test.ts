import { describe, it, expect } from "vitest";
import {
  createRoomGrid,
  createInitialEntities,
  syncPlayers,
  movePlayer,
  stepNpcWander,
  stepNpcWanderFree,
  ROOM_WIDTH,
  ROOM_HEIGHT,
} from "./room";
import { EntityRegistry } from "@utils/entityRegistry";
import type { DungeonEntity, NpcEntity, PlayerEntity } from "./types";
import { createRng } from "@utils/rng";

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

  it("spawns and retains player entities across rejoin and handles connection statuses", () => {
    const registry = createInitialEntities();
    const activePeers = [
      { id: "player-1", name: "Alice", color: "#ff0000", status: "live" as const },
      { id: "player-2", name: "Bob", color: "#00ff00", status: "reconnecting" as const },
    ];

    syncPlayers(registry, activePeers);
    let p1 = registry.get("player-1") as PlayerEntity;
    let p2 = registry.get("player-2") as PlayerEntity;
    expect(p1).toBeDefined();
    expect(p1.name).toBe("Alice");
    expect(p1.x).toBe(1.5);
    expect(p1.y).toBe(1.5);

    expect(p2).toBeDefined();
    expect(p2.name).toBe("Bob");

    // Move player 1
    p1.x = 5.0;
    p1.y = 5.0;

    // Simulate player 1 refreshing / rejoining
    const updatedPeers = [
      { id: "player-1", name: "Alice Renamed", color: "#ff0000", status: "live" as const },
      { id: "player-2", name: "Bob", color: "#00ff00", status: "reconnecting" as const },
    ];
    syncPlayers(registry, updatedPeers);

    p1 = registry.get("player-1") as PlayerEntity;
    expect(p1.name).toBe("Alice Renamed");
    // Position must be retained across rejoin!
    expect(p1.x).toBe(5.0);
    expect(p1.y).toBe(5.0);
  });

  it("filters out peers with grace-period or gone connection statuses when provided", () => {
    const registry = createInitialEntities();
    const peers = [
      { id: "player-1", name: "Alice", color: "#ff0000", status: "live" as const },
      { id: "player-2", name: "Bob", color: "#00ff00", status: "reconnecting" as const },
      { id: "player-3", name: "Charlie", color: "#0000ff", status: "grace-period" as const },
      { id: "player-4", name: "Dave", color: "#ffff00", status: "gone" as const },
    ];

    syncPlayers(registry, peers);

    expect(registry.get("player-1")).toBeDefined();
    expect(registry.get("player-2")).toBeDefined();
    expect(registry.get("player-3")).toBeUndefined();
    expect(registry.get("player-4")).toBeUndefined();
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

  it("handles NPC free wander pathfinding and steering (Option B)", () => {
    const grid = createRoomGrid();
    const rng = createRng(12345);
    const npc: NpcEntity = {
      id: "npc-skeleton",
      kind: "npc",
      name: "Skeleton",
      color: "#b10dc9",
      x: 1.5,
      y: 1.5,
      currentPath: [],
      wanderTimer: 0,
    };

    stepNpcWanderFree(npc, grid, 0.1, rng);
    expect(npc.currentPath.length).toBeGreaterThan(0);

    const initialPos = { x: npc.x, y: npc.y };
    for (let i = 0; i < 20; i++) {
      stepNpcWanderFree(npc, grid, 0.1, rng);
    }
    expect(npc.x !== initialPos.x || npc.y !== initialPos.y).toBe(true);
  });

  it("ensures NPC diagonal paths do not cut interior wall corners", () => {
    const grid = createRoomGrid();
    const rng = createRng(42);
    const npc: NpcEntity = {
      id: "npc-1",
      kind: "npc",
      name: "Goblin",
      color: "#2ecc40",
      x: 1.5,
      y: 1.5,
      currentPath: [],
      wanderTimer: 0,
    };

    // Run multiple wander cycles to sample various generated paths
    for (let cycle = 0; cycle < 50; cycle++) {
      npc.wanderTimer = 0;
      stepNpcWander(npc, grid, 0.1, rng);

      if (npc.currentPath.length > 0) {
        let cur = { x: Math.floor(npc.x), y: Math.floor(npc.y) };
        for (const step of npc.currentPath) {
          const dx = step.x - cur.x;
          const dy = step.y - cur.y;

          if (dx !== 0 && dy !== 0) {
            const cornerA = { x: cur.x + dx, y: cur.y };
            const cornerB = { x: cur.x, y: cur.y + dy };
            expect(grid.get(cornerA)?.walkable).toBe(true);
            expect(grid.get(cornerB)?.walkable).toBe(true);
          }
          cur = step;
        }
      }
    }
  });
});
