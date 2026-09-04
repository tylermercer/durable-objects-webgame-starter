import { describe, it, expect } from "vitest";
import {
  createLobbyGrid,
  createDungeonGrid,
  createRoomGrid,
  createInitialEntities,
  syncPlayers,
  movePlayer,
  stepNpcWander,
  stepNpcWanderFree,
  isPlayerInStartZone,
  stepLobbyCountdown,
  findWalkableSpawnPos,
  handlePlayerFiring,
  stepProjectiles,
  checkPlayerMonsterCollisions,
  spawnPlayersInBottom,
  spawnWaveMonsters,
  stepRoom,
  START_ZONE,
  ROOM_WIDTH,
  ROOM_HEIGHT,
} from "./room";
import { EntityRegistry } from "@utils/entityRegistry";
import type { DungeonEntity, NpcEntity, PlayerEntity, ProjectileEntity } from "./types";
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

  it("finds walkable spawn positions that do not land on wall tiles", () => {
    const lobbyGrid = createLobbyGrid();
    const dungeonGrid = createDungeonGrid();

    // Default lobby spawn
    const lobbySpawn = findWalkableSpawnPos(lobbyGrid, 2.5, 2.5);
    const lobbyTile = { x: Math.floor(lobbySpawn.x), y: Math.floor(lobbySpawn.y) };
    expect(lobbyGrid.get(lobbyTile)?.walkable).toBe(true);

    // Default dungeon spawn
    const dungeonSpawn = findWalkableSpawnPos(dungeonGrid, 1.5, 1.5);
    const dungeonTile = { x: Math.floor(dungeonSpawn.x), y: Math.floor(dungeonSpawn.y) };
    expect(dungeonGrid.get(dungeonTile)?.walkable).toBe(true);

    // If preferred spawn is on a wall (e.g. tile (3, 3) in lobby grid), it redirects to walkable neighbor
    const wallSpawn = findWalkableSpawnPos(lobbyGrid, 3.5, 3.5);
    const wallTile = { x: Math.floor(wallSpawn.x), y: Math.floor(wallSpawn.y) };
    expect(lobbyGrid.get(wallTile)?.walkable).toBe(true);
  });

  it("identifies when player is standing inside or outside START_ZONE", () => {
    const player: PlayerEntity = {
      id: "p1",
      kind: "player",
      name: "Alice",
      color: "#ff0000",
      x: START_ZONE.minX + 0.5,
      y: START_ZONE.minY + 0.5,
    };

    expect(isPlayerInStartZone(player)).toBe(true);

    player.x = START_ZONE.minX - 1.0;
    expect(isPlayerInStartZone(player)).toBe(false);
  });

  it("handles lobby countdown: starts when all stand, decrements, triggers transition at 0", () => {
    const p1: PlayerEntity = { id: "p1", kind: "player", name: "Alice", color: "#f00", x: 8.5, y: 6.5 };
    const p2: PlayerEntity = { id: "p2", kind: "player", name: "Bob", color: "#0f0", x: 9.5, y: 7.5 };

    // Initially both in start zone
    let result = stepLobbyCountdown([p1, p2], null, 0.1);
    expect(result.nextCountdown).toBeCloseTo(4.9);
    expect(result.shouldTransition).toBe(false);

    // Continue tick to 0
    result = stepLobbyCountdown([p1, p2], 0.1, 0.1);
    expect(result.nextCountdown).toBe(0);
    expect(result.shouldTransition).toBe(true);
  });

  it("stops and resets lobby countdown when a player steps off start zone", () => {
    const p1: PlayerEntity = { id: "p1", kind: "player", name: "Alice", color: "#f00", x: 8.5, y: 6.5 };
    const p2: PlayerEntity = { id: "p2", kind: "player", name: "Bob", color: "#0f0", x: 9.5, y: 7.5 };

    // Countdown active at 3.0
    let result = stepLobbyCountdown([p1, p2], 3.0, 0.1);
    expect(result.nextCountdown).toBeCloseTo(2.9);

    // p2 steps off start zone
    p2.x = 2.5;
    p2.y = 2.5;

    result = stepLobbyCountdown([p1, p2], 2.9, 0.1);
    expect(result.nextCountdown).toBeNull();
    expect(result.shouldTransition).toBe(false);
  });

  it("retains player entities across rejoin and updates player metadata in syncPlayers", () => {
    const registry = createInitialEntities();
    registry.add({ id: "player-1", kind: "player", name: "Alice", color: "#ff0000", x: 1.5, y: 1.5 });
    registry.add({ id: "player-2", kind: "player", name: "Bob", color: "#00ff00", x: 1.5, y: 1.5 });

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

  it("does not create entities for missing peers in syncPlayers", () => {
    const registry = createInitialEntities();
    const peers = [
      { id: "player-1", name: "Alice", color: "#ff0000", status: "live" as const },
    ];

    syncPlayers(registry, peers);

    expect(registry.get("player-1")).toBeUndefined();
  });

  it("filters out peers with grace-period or gone connection statuses when syncing metadata", () => {
    const registry = createInitialEntities();
    registry.add({ id: "player-1", kind: "player", name: "Alice Old", color: "#ff0000", x: 1.5, y: 1.5 });
    registry.add({ id: "player-2", kind: "player", name: "Bob Old", color: "#00ff00", x: 1.5, y: 1.5 });
    registry.add({ id: "player-3", kind: "player", name: "Charlie Old", color: "#0000ff", x: 1.5, y: 1.5 });
    registry.add({ id: "player-4", kind: "player", name: "Dave Old", color: "#ffff00", x: 1.5, y: 1.5 });

    const peers = [
      { id: "player-1", name: "Alice", color: "#ff0000", status: "live" as const },
      { id: "player-2", name: "Bob", color: "#00ff00", status: "reconnecting" as const },
      { id: "player-3", name: "Charlie", color: "#0000ff", status: "grace-period" as const },
      { id: "player-4", name: "Dave", color: "#ffff00", status: "gone" as const },
    ];

    syncPlayers(registry, peers);

    expect((registry.get("player-1") as PlayerEntity).name).toBe("Alice");
    expect((registry.get("player-2") as PlayerEntity).name).toBe("Bob");
    expect((registry.get("player-3") as PlayerEntity).name).toBe("Charlie Old");
    expect((registry.get("player-4") as PlayerEntity).name).toBe("Dave Old");
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
      hp: 5,
      maxHp: 5,
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
      hp: 5,
      maxHp: 5,
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
      hp: 5,
      maxHp: 5,
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

  it("fires projectiles towards the nearest monster every 500ms when firing is held", () => {
    const registry = new EntityRegistry<DungeonEntity>();
    const player: PlayerEntity = { id: "p1", kind: "player", name: "P1", color: "#f00", x: 2.5, y: 12.5 };
    const npcNear: NpcEntity = { id: "npc1", kind: "npc", name: "Near", color: "#0f0", x: 2.5, y: 2.5, currentPath: [], wanderTimer: 1, hp: 5, maxHp: 5 };
    const npcFar: NpcEntity = { id: "npc2", kind: "npc", name: "Far", color: "#00f", x: 18.5, y: 2.5, currentPath: [], wanderTimer: 1, hp: 5, maxHp: 5 };

    registry.add(player);
    registry.add(npcNear);
    registry.add(npcFar);

    // Initial press fires first projectile immediately towards nearest monster (npcNear)
    handlePlayerFiring(player, true, registry, [npcNear, npcFar], 0.1);
    let projectiles = registry.query((e) => e.kind === "projectile") as ProjectileEntity[];
    expect(projectiles.length).toBe(1);
    expect(player.fireCooldown).toBe(0.5);

    // Direction should point upwards towards npcNear (y: 2.5)
    const proj1 = projectiles[0];
    expect(proj1.vy).toBeLessThan(0); // Moving up towards y=2.5

    // Second tick within 500ms cooldown should NOT fire
    handlePlayerFiring(player, true, registry, [npcNear, npcFar], 0.2);
    projectiles = registry.query((e) => e.kind === "projectile") as ProjectileEntity[];
    expect(projectiles.length).toBe(1);

    // Advance remaining cooldown time (0.3s)
    handlePlayerFiring(player, true, registry, [npcNear, npcFar], 0.3);
    projectiles = registry.query((e) => e.kind === "projectile") as ProjectileEntity[];
    expect(projectiles.length).toBe(2);
  });

  it("causes monster to disappear after receiving 5 projectile hits", () => {
    const grid = createDungeonGrid();
    const registry = new EntityRegistry<DungeonEntity>();
    const monster: NpcEntity = { id: "m1", kind: "npc", name: "Goblin", color: "#2ecc40", x: 5.5, y: 5.5, currentPath: [], wanderTimer: 1, hp: 5, maxHp: 5 };
    registry.add(monster);

    for (let hit = 1; hit <= 5; hit++) {
      const proj: ProjectileEntity = { id: `p${hit}`, kind: "projectile", x: 5.5, y: 5.5, vx: 0, vy: 0, playerId: "p1" };
      registry.add(proj);
      stepProjectiles(registry, grid, 0.01);

      if (hit < 5) {
        expect(monster.hp).toBe(5 - hit);
        expect(registry.get("m1")).toBeDefined();
      } else {
        expect(registry.get("m1")).toBeUndefined(); // Monster removed after 5th hit!
      }
    }
  });

  it("deducts a life when player touches monster and gives temporary invulnerability", () => {
    const player: PlayerEntity = { id: "p1", kind: "player", name: "Alice", color: "#f00", x: 5.0, y: 5.0 };
    const monster: NpcEntity = { id: "m1", kind: "npc", name: "Orc", color: "#0f0", x: 5.2, y: 5.0, currentPath: [], wanderTimer: 1, hp: 5, maxHp: 5 };

    let isHit = checkPlayerMonsterCollisions([player], [monster], 0.1);
    expect(isHit).toBe(true);
    expect(player.damageCooldown).toBe(1.5);

    // Second check while damageCooldown > 0 should not trigger hit
    isHit = checkPlayerMonsterCollisions([player], [monster], 0.1);
    expect(isHit).toBe(false);
  });

  it("handles Game Over transition to lobby when lives reach 0, recording survived waves", () => {
    const grid = createDungeonGrid();
    const registry = new EntityRegistry<DungeonEntity>();
    const rng = createRng(999);

    const player: PlayerEntity = { id: "p1", kind: "player", name: "Alice", color: "#f00", x: 5.0, y: 5.0 };
    const monster: NpcEntity = { id: "m1", kind: "npc", name: "Orc", color: "#0f0", x: 5.2, y: 5.0, currentPath: [], wanderTimer: 1, hp: 5, maxHp: 5 };
    registry.add(player);
    registry.add(monster);

    const inputs = new Map();
    inputs.set("p1", { x: 0, y: 0 });

    const result = stepRoom(grid, registry, inputs, 0.1, rng, {
      phase: "dungeon",
      wave: 3,
      lives: 1,
      gameOverSurvivedWaves: null,
    });

    expect(result.phase).toBe("lobby");
    expect(result.gameOverSurvivedWaves).toBe(2); // Wave 3 failed -> Survived 2 waves
    expect(registry.get("m1")).toBeUndefined(); // Monster cleared on game over
  });

  it("advances to new wave with +1 monster when all monsters are defeated, spawning players at bottom and monsters at top", () => {
    const grid = createDungeonGrid();
    const registry = new EntityRegistry<DungeonEntity>();
    const rng = createRng(777);

    const player: PlayerEntity = { id: "p1", kind: "player", name: "Alice", color: "#f00", x: 5.0, y: 12.0 };
    registry.add(player);

    const inputs = new Map();

    // Step room when no monsters remain -> triggers Wave 1 completion -> Wave 2 start
    const result = stepRoom(grid, registry, inputs, 0.1, rng, {
      phase: "dungeon",
      wave: 1,
      lives: 3,
      gameOverSurvivedWaves: null,
    });

    expect(result.wave).toBe(2);
    const spawnedMonsters = registry.query((e) => e.kind === "npc") as NpcEntity[];
    expect(spawnedMonsters.length).toBe(3); // Wave 2 has 2 + 1 = 3 monsters

    // Verify monsters spawned in top half (y < 7.5)
    for (const m of spawnedMonsters) {
      expect(m.y).toBeLessThan(7.5);
      expect(m.hp).toBe(5);
    }

    // Verify player spawned in bottom half (y >= 7.5)
    expect(player.y).toBeGreaterThanOrEqual(7.5);
  });
});
