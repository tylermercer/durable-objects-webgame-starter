import { TileGrid, type GridPos } from "@utils/tileGrid";
import { EntityRegistry } from "@utils/entityRegistry";
import { moveCircleAgainstGrid, steerToward } from "@utils/circleMovement";
import { simplifyPath } from "@utils/pathSmoothing";
import type { PlayerConnectionStatus } from "@host/console";
import type { DungeonEntity, GamePhase, GridCell, JoystickState, NpcEntity, PlayerEntity, StartZone } from "./types";

export const ROOM_WIDTH = 20;
export const ROOM_HEIGHT = 15;
export const TILE_SIZE = 40; // Pixels per tile in world space
export const PLAYER_SPEED = 4.0; // Tiles per second
export const NPC_SPEED = 2.0; // Tiles per second

// 20x15 hand-authored grid layout for the Lobby (1 = wall, 0 = walkable floor)
export const LOBBY_LAYOUT: number[][] = [
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
  [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
  [1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1],
  [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
  [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
  [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
  [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
  [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
  [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
  [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
  [1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1],
  [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
  [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
];

// 20x15 hand-authored grid layout for the Dungeon
export const DUNGEON_LAYOUT: number[][] = [
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  [1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1],
  [1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1],
  [1, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 1],
  [1, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 1],
  [1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1],
  [1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1],
  [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
  [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
  [1, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 1],
  [1, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 1],
  [1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1],
  [1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1],
  [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
];

export const RAW_LAYOUT = DUNGEON_LAYOUT;

export const START_ZONE: StartZone = {
  minX: 8,
  maxX: 11,
  minY: 6,
  maxY: 8,
};

export function createLobbyGrid(): TileGrid<GridCell> {
  return new TileGrid<GridCell>(ROOM_WIDTH, ROOM_HEIGHT, (pos) => ({
    walkable: LOBBY_LAYOUT[pos.y][pos.x] === 0,
  }));
}

export function createDungeonGrid(): TileGrid<GridCell> {
  return new TileGrid<GridCell>(ROOM_WIDTH, ROOM_HEIGHT, (pos) => ({
    walkable: DUNGEON_LAYOUT[pos.y][pos.x] === 0,
  }));
}

export function createRoomGrid(): TileGrid<GridCell> {
  return createDungeonGrid();
}

export function createDungeonNpcs(): NpcEntity[] {
  return [
    {
      id: "npc-goblin",
      kind: "npc",
      name: "Goblin",
      color: "#2ecc40",
      x: 5.5,
      y: 2.5,
      currentPath: [],
      wanderTimer: 1.0,
    },
    {
      id: "npc-skeleton",
      kind: "npc",
      name: "Skeleton",
      color: "#b10dc9",
      x: 14.5,
      y: 12.5,
      currentPath: [],
      wanderTimer: 2.0,
    },
  ];
}

export function createInitialEntities(phase: GamePhase = "lobby"): EntityRegistry<DungeonEntity> {
  const registry = new EntityRegistry<DungeonEntity>();

  if (phase === "dungeon") {
    const npcs = createDungeonNpcs();
    for (const npc of npcs) {
      registry.add(npc);
    }
  }

  return registry;
}

export function isPlayerInStartZone(player: PlayerEntity): boolean {
  const tileX = Math.floor(player.x);
  const tileY = Math.floor(player.y);
  return (
    tileX >= START_ZONE.minX &&
    tileX <= START_ZONE.maxX &&
    tileY >= START_ZONE.minY &&
    tileY <= START_ZONE.maxY
  );
}

export interface LobbyCountdownResult {
  nextCountdown: number | null;
  shouldTransition: boolean;
}

export function stepLobbyCountdown(
  players: PlayerEntity[],
  currentCountdown: number | null,
  dt: number
): LobbyCountdownResult {
  if (players.length === 0) {
    return { nextCountdown: null, shouldTransition: false };
  }

  const allStanding = players.every(isPlayerInStartZone);

  if (!allStanding) {
    return { nextCountdown: null, shouldTransition: false };
  }

  const startValue = currentCountdown ?? 5.0;
  const nextCountdown = Math.max(0, startValue - dt);

  if (nextCountdown <= 0) {
    return { nextCountdown: 0, shouldTransition: true };
  }

  return { nextCountdown, shouldTransition: false };
}

export function syncPlayers(
  registry: EntityRegistry<DungeonEntity>,
  activePeers: Array<{ id: string; name: string; color: string; status?: PlayerConnectionStatus | string; state?: string }>
): void {
  for (const peer of activePeers) {
    const status = peer.status ?? peer.state;
    if (status && status !== "live" && status !== "reconnecting" && status !== "connected") {
      continue;
    }
    const existing = registry.get(peer.id);
    if (existing && existing.kind === "player") {
      // Rejoin / metadata sync: update name & color, retain x & y!
      existing.name = peer.name;
      existing.color = peer.color;
    }
  }
}

export function isWalkablePos(grid: TileGrid<GridCell>, tileX: number, tileY: number): boolean {
  const cell = grid.get({ x: tileX, y: tileY });
  return cell !== undefined && cell.walkable;
}

export function findWalkableSpawnPos(
  grid: TileGrid<GridCell>,
  preferredX: number = 2.5,
  preferredY: number = 2.5
): { x: number; y: number } {
  const tileX = Math.floor(preferredX);
  const tileY = Math.floor(preferredY);
  if (grid.get({ x: tileX, y: tileY })?.walkable) {
    return { x: preferredX, y: preferredY };
  }
  for (let r = 1; r < Math.max(grid.width, grid.height); r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = tileX + dx;
        const y = tileY + dy;
        if (grid.get({ x, y })?.walkable) {
          return { x: x + 0.5, y: y + 0.5 };
        }
      }
    }
  }
  return { x: 1.5, y: 1.5 };
}

export function movePlayer(
  player: PlayerEntity,
  grid: TileGrid<GridCell>,
  input: JoystickState,
  dt: number
): void {
  if (input.x === 0 && input.y === 0) return;

  const dx = input.x * PLAYER_SPEED * dt;
  const dy = input.y * PLAYER_SPEED * dt;

  const playerRadius = 0.35; // Player bounding circle in tile units

  const result = moveCircleAgainstGrid(
    player,
    playerRadius,
    dx,
    dy,
    grid,
    (_pos, cell) => cell.walkable
  );
  player.x = result.x;
  player.y = result.y;
}

export function stepNpcWander(
  npc: NpcEntity,
  grid: TileGrid<GridCell>,
  dt: number,
  rng: () => number
): void {
  if (npc.currentPath.length > 0) {
    const targetCell = npc.currentPath[0];
    const targetX = targetCell.x + 0.5;
    const targetY = targetCell.y + 0.5;

    const dx = targetX - npc.x;
    const dy = targetY - npc.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const moveDist = NPC_SPEED * dt;

    if (dist <= moveDist) {
      npc.x = targetX;
      npc.y = targetY;
      npc.currentPath.shift();
    } else {
      npc.x += (dx / dist) * moveDist;
      npc.y += (dy / dist) * moveDist;
    }
  } else {
    npc.wanderTimer -= dt;
    if (npc.wanderTimer <= 0) {
      npc.wanderTimer = 2.0 + rng() * 3.0; // Reset wander timer to 2-5 seconds

      const startPos: GridPos = { x: Math.floor(npc.x), y: Math.floor(npc.y) };

      // Pick a random walkable goal cell
      const walkableCells: GridPos[] = [];
      for (let y = 0; y < grid.height; y++) {
        for (let x = 0; x < grid.width; x++) {
          if (grid.get({ x, y })?.walkable) {
            walkableCells.push({ x, y });
          }
        }
      }

      if (walkableCells.length > 0) {
        const goalIndex = Math.floor(rng() * walkableCells.length);
        const goalPos = walkableCells[goalIndex];

        const path = grid.findPath(
          startPos,
          goalPos,
          (_pos, cell) => (cell.walkable ? 1 : Infinity),
          { diagonals: true }
        );

        if (path && path.length > 1) {
          npc.currentPath = path.slice(1);
        }
      }
    }
  }
}

export function stepNpcWanderFree(
  npc: NpcEntity,
  grid: TileGrid<GridCell>,
  dt: number,
  rng: () => number
): void {
  const npcRadius = 0.35;
  const CLEARANCE_MARGIN = 0.05;
  const cost = (_pos: GridPos, cell: GridCell) => (cell.walkable ? 1 : Infinity);

  if (npc.currentPath.length > 0) {
    const targetCell = npc.currentPath[0];
    const targetPos = { x: targetCell.x + 0.5, y: targetCell.y + 0.5 };

    const { dx, dy } = steerToward(npc, targetPos, NPC_SPEED, dt, 0.05);

    if (dx === 0 && dy === 0) {
      // Arrived at current waypoint
      npc.currentPath.shift();
    } else {
      const result = moveCircleAgainstGrid(
        npc,
        npcRadius,
        dx,
        dy,
        grid,
        (_pos, cell) => cell.walkable
      );
      npc.x = result.x;
      npc.y = result.y;
    }
  } else {
    npc.wanderTimer -= dt;
    if (npc.wanderTimer <= 0) {
      npc.wanderTimer = 2.0 + rng() * 3.0; // Reset wander timer to 2-5 seconds

      const startPos: GridPos = { x: Math.floor(npc.x), y: Math.floor(npc.y) };

      // Pick a random walkable goal cell
      const walkableCells: GridPos[] = [];
      for (let y = 0; y < grid.height; y++) {
        for (let x = 0; x < grid.width; x++) {
          if (grid.get({ x, y })?.walkable) {
            walkableCells.push({ x, y });
          }
        }
      }

      if (walkableCells.length > 0) {
        const goalIndex = Math.floor(rng() * walkableCells.length);
        const goalPos = walkableCells[goalIndex];

        const path = grid.findPath(startPos, goalPos, cost, { diagonals: true });

        if (path && path.length > 1) {
          const simplified = simplifyPath(grid, path, cost, {
            radius: npcRadius + CLEARANCE_MARGIN,
          });
          npc.currentPath = simplified.slice(1);
        }
      }
    }
  }
}

export function stepRoom(
  grid: TileGrid<GridCell>,
  registry: EntityRegistry<DungeonEntity>,
  joystickInputs: Map<string, JoystickState>,
  dt: number,
  rng: () => number
): void {
  const players = registry.query((e) => e.kind === "player") as PlayerEntity[];
  for (const player of players) {
    const input = joystickInputs.get(player.id) ?? { x: 0, y: 0 };
    movePlayer(player, grid, input, dt);
  }

  const npcs = registry.query((e) => e.kind === "npc") as NpcEntity[];
  for (const npc of npcs) {
    if (npc.id === "npc-skeleton") {
      stepNpcWanderFree(npc, grid, dt, rng);
    } else {
      stepNpcWander(npc, grid, dt, rng);
    }
  }
}
