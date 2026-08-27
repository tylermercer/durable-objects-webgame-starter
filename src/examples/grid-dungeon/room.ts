import { TileGrid, type GridPos } from "../../utils/tileGrid";
import { EntityRegistry } from "../../utils/entityRegistry";
import type { PlayerConnectionStatus } from "@host/console";
import type { DungeonEntity, GridCell, JoystickState, NpcEntity, PlayerEntity } from "./types";

export const ROOM_WIDTH = 20;
export const ROOM_HEIGHT = 15;
export const TILE_SIZE = 40; // Pixels per tile in world space
export const PLAYER_SPEED = 4.0; // Tiles per second
export const NPC_SPEED = 2.0; // Tiles per second

// 20x15 hand-authored grid layout (1 = wall, 0 = walkable floor)
export const RAW_LAYOUT: number[][] = [
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

export function createRoomGrid(): TileGrid<GridCell> {
  return new TileGrid<GridCell>(ROOM_WIDTH, ROOM_HEIGHT, (pos) => ({
    walkable: RAW_LAYOUT[pos.y][pos.x] === 0,
  }));
}

export function createInitialEntities(): EntityRegistry<DungeonEntity> {
  const registry = new EntityRegistry<DungeonEntity>();

  const npcs: NpcEntity[] = [
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

  for (const npc of npcs) {
    registry.add(npc);
  }

  return registry;
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
    if (!existing) {
      // Spawn new player entity at spawn tile (1.5, 1.5)
      const player: PlayerEntity = {
        id: peer.id,
        kind: "player",
        name: peer.name,
        color: peer.color,
        x: 1.5,
        y: 1.5,
      };
      registry.add(player);
    } else if (existing.kind === "player") {
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

  // Try X movement
  const targetX = player.x + dx;
  const minTileX = Math.floor(targetX - playerRadius);
  const maxTileX = Math.floor(targetX + playerRadius);
  const minTileY = Math.floor(player.y - playerRadius);
  const maxTileY = Math.floor(player.y + playerRadius);

  let xOk = true;
  for (let tx = minTileX; tx <= maxTileX; tx++) {
    for (let ty = minTileY; ty <= maxTileY; ty++) {
      if (!isWalkablePos(grid, tx, ty)) {
        xOk = false;
        break;
      }
    }
    if (!xOk) break;
  }
  if (xOk) {
    player.x = targetX;
  }

  // Try Y movement
  const targetY = player.y + dy;
  const curMinTileX = Math.floor(player.x - playerRadius);
  const curMaxTileX = Math.floor(player.x + playerRadius);
  const newMinTileY = Math.floor(targetY - playerRadius);
  const newMaxTileY = Math.floor(targetY + playerRadius);

  let yOk = true;
  for (let tx = curMinTileX; tx <= curMaxTileX; tx++) {
    for (let ty = newMinTileY; ty <= newMaxTileY; ty++) {
      if (!isWalkablePos(grid, tx, ty)) {
        yOk = false;
        break;
      }
    }
    if (!yOk) break;
  }
  if (yOk) {
    player.y = targetY;
  }
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
    stepNpcWander(npc, grid, dt, rng);
  }
}
