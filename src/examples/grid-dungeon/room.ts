import { TileGrid, type GridPos } from "@utils/tileGrid";
import { EntityRegistry } from "@utils/entityRegistry";
import { moveCircleAgainstGrid, steerToward } from "@utils/circleMovement";
import { simplifyPath } from "@utils/pathSmoothing";
import type { PlayerConnectionStatus } from "@host/console";
import type {
  DungeonEntity,
  GamePhase,
  GridCell,
  JoystickState,
  NpcEntity,
  PlayerEntity,
  ProjectileEntity,
  StartZone,
} from "./types";

export const ROOM_WIDTH = 20;
export const ROOM_HEIGHT = 15;
export const TILE_SIZE = 40; // Pixels per tile in world space
export const PLAYER_SPEED = 4.0; // Tiles per second
export const NPC_SPEED = 2.0; // Tiles per second
export const PROJECTILE_SPEED = 12.0; // Tiles per second

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

export const RANGED_TILE = { x: 4, y: 7 };
export const MELEE_TILE = { x: 15, y: 7 };

export function createLobbyGrid(): TileGrid<GridCell> {
  const grid = new TileGrid<GridCell>(ROOM_WIDTH, ROOM_HEIGHT, (pos) => ({
    walkable: LOBBY_LAYOUT[pos.y][pos.x] === 0,
    destructible: false,
  }));

  // Place brown destructible blocks in a ring around START_ZONE with a 1-tile gap
  for (let x = 6; x <= 13; x++) {
    for (let y = 4; y <= 10; y++) {
      const isPerimeter = x === 6 || x === 13 || y === 4 || y === 10;
      if (isPerimeter) {
        grid.set({ x, y }, { walkable: false, destructible: true });
      }
    }
  }

  return grid;
}

export function createDungeonGrid(rng: () => number = Math.random): TileGrid<GridCell> {
  const grid = new TileGrid<GridCell>(ROOM_WIDTH, ROOM_HEIGHT, (pos) => ({
    walkable: DUNGEON_LAYOUT[pos.y][pos.x] === 0,
    destructible: false,
  }));

  // Candidate lines connecting permanent wall chunks
  const candidateLines: Array<Array<{ x: number; y: number }>> = [
    [{ x: 6, y: 3 }, { x: 7, y: 3 }],
    [{ x: 12, y: 3 }, { x: 13, y: 3 }],
    [{ x: 6, y: 9 }, { x: 7, y: 9 }],
    [{ x: 12, y: 9 }, { x: 13, y: 9 }],
    [{ x: 9, y: 3 }, { x: 9, y: 4 }],
    [{ x: 10, y: 3 }, { x: 10, y: 4 }],
    [{ x: 4, y: 6 }, { x: 4, y: 7 }],
    [{ x: 15, y: 6 }, { x: 15, y: 7 }],
    [{ x: 9, y: 7 }, { x: 9, y: 8 }],
    [{ x: 10, y: 7 }, { x: 10, y: 8 }],
    [{ x: 1, y: 3 }, { x: 2, y: 3 }],
    [{ x: 17, y: 3 }, { x: 18, y: 3 }],
    [{ x: 1, y: 9 }, { x: 2, y: 9 }],
    [{ x: 17, y: 9 }, { x: 18, y: 9 }],
  ];

  for (const line of candidateLines) {
    if (rng() < 0.5) {
      for (const pos of line) {
        if (grid.get(pos)?.walkable) {
          grid.set(pos, { walkable: false, destructible: true });
        }
      }
    }
  }

  return grid;
}

export function createRoomGrid(): TileGrid<GridCell> {
  return createDungeonGrid();
}

export function createDungeonNpcs(): NpcEntity[] {
  return [
    {
      id: "npc-goblin",
      kind: "npc",
      name: "Goblin 1",
      color: "#2ecc40",
      x: 5.5,
      y: 2.5,
      currentPath: [],
      wanderTimer: 1.0,
      hp: 5,
      maxHp: 5,
    },
    {
      id: "npc-skeleton",
      kind: "npc",
      name: "Skeleton 2",
      color: "#b10dc9",
      x: 14.5,
      y: 2.5,
      currentPath: [],
      wanderTimer: 2.0,
      hp: 5,
      maxHp: 5,
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

export function getBottomSpawnPositions(grid: TileGrid<GridCell>): Array<{ x: number; y: number }> {
  const positions: Array<{ x: number; y: number }> = [];
  const xOrder = [10, 9, 11, 8, 12, 7, 13, 6, 14, 5, 15, 4, 16, 3, 17, 2, 18, 1];
  for (let y = grid.height - 2; y >= grid.height - 3; y--) {
    for (const x of xOrder) {
      if (grid.get({ x, y })?.walkable) {
        positions.push({ x: x + 0.5, y: y + 0.5 });
      }
    }
  }
  return positions;
}

export function spawnPlayersInBottom(players: PlayerEntity[], grid: TileGrid<GridCell>): void {
  const spawnPositions = getBottomSpawnPositions(grid);
  if (spawnPositions.length === 0) return;

  players.forEach((player, idx) => {
    const pos = spawnPositions[(idx * 3) % spawnPositions.length];
    player.x = pos.x;
    player.y = pos.y;
    player.damageCooldown = 1.0; // Brief invulnerability on spawn
  });
}

export function getTopSpawnPositions(grid: TileGrid<GridCell>): Array<{ x: number; y: number }> {
  const positions: Array<{ x: number; y: number }> = [];
  const maxY = Math.floor(grid.height / 2) - 1;
  for (let y = 1; y <= maxY; y++) {
    for (let x = 1; x < grid.width - 1; x++) {
      if (grid.get({ x, y })?.walkable) {
        positions.push({ x: x + 0.5, y: y + 0.5 });
      }
    }
  }
  return positions;
}

const MONSTER_TEMPLATES = [
  { name: "Goblin", color: "#2ecc40" },
  { name: "Skeleton", color: "#b10dc9" },
  { name: "Orc", color: "#ff851b" },
  { name: "Demon", color: "#ff4136" },
  { name: "Ghost", color: "#7fdbff" },
  { name: "Slime", color: "#01ff70" },
];

export function spawnWaveMonsters(
  wave: number,
  grid: TileGrid<GridCell>,
  registry: EntityRegistry<DungeonEntity>,
  rng: () => number
): void {
  const topPositions = getTopSpawnPositions(grid);
  if (topPositions.length === 0) return;

  const count = wave + 1; // Wave 1: 2 monsters, Wave 2: 3 monsters, etc.
  for (let i = 0; i < count; i++) {
    const template = MONSTER_TEMPLATES[i % MONSTER_TEMPLATES.length];
    const posIdx = Math.floor(rng() * topPositions.length);
    const pos = topPositions[posIdx];
    const npc: NpcEntity = {
      id: `npc-w${wave}-${i}-${Math.random().toString(36).slice(2)}`,
      kind: "npc",
      name: `${template.name} ${i + 1}`,
      color: template.color,
      x: pos.x,
      y: pos.y,
      currentPath: [],
      wanderTimer: 1.0 + rng() * 2.0,
      hp: 5,
      maxHp: 5,
    };
    registry.add(npc);
  }
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

export function findNearestNpc(player: PlayerEntity, npcs: NpcEntity[]): NpcEntity | null {
  let nearest: NpcEntity | null = null;
  let minDistSq = Infinity;
  for (const npc of npcs) {
    const dx = npc.x - player.x;
    const dy = npc.y - player.y;
    const distSq = dx * dx + dy * dy;
    if (distSq < minDistSq) {
      minDistSq = distSq;
      nearest = npc;
    }
  }
  return nearest;
}

export function findNearestDestructibleBlock(
  player: PlayerEntity,
  grid: TileGrid<GridCell>
): { x: number; y: number } | null {
  let nearest: { x: number; y: number } | null = null;
  let minDistSq = Infinity;
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      if (grid.get({ x, y })?.destructible) {
        const blockX = x + 0.5;
        const blockY = y + 0.5;
        const dx = blockX - player.x;
        const dy = blockY - player.y;
        const distSq = dx * dx + dy * dy;
        if (distSq < minDistSq) {
          minDistSq = distSq;
          nearest = { x: blockX, y: blockY };
        }
      }
    }
  }
  return nearest;
}

export function handlePlayerFiring(
  player: PlayerEntity,
  firing: boolean,
  registry: EntityRegistry<DungeonEntity>,
  npcs: NpcEntity[],
  dt: number,
  grid?: TileGrid<GridCell>,
  joystickInput?: JoystickState
): void {
  if (player.fireCooldown !== undefined && player.fireCooldown > 0) {
    player.fireCooldown = Math.max(0, player.fireCooldown - dt);
  }

  const isNewPress = firing && !player.prevFiring;
  const isHeld = firing && player.prevFiring;
  const canFire = isNewPress || (isHeld && (player.fireCooldown === undefined || player.fireCooldown <= 0));

  if (canFire) {
    if (player.attackType === "melee") {
      // Perform Melee Shockwave Attack
      registry.add({
        id: `shockwave-${player.id}-${Math.random().toString(36).slice(2)}`,
        kind: "shockwave",
        x: player.x,
        y: player.y,
        radius: 0.2,
        maxRadius: 1.0,
        color: player.color,
        duration: 0.2,
        maxDuration: 0.2,
      });

      // Double damage (2 HP) to all monsters within 1.0 tile distance
      for (const npc of npcs) {
        const dx = npc.x - player.x;
        const dy = npc.y - player.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= 1.2) {
          npc.hp -= 2;
          if (npc.hp <= 0) {
            registry.remove(npc.id);
          }
        }
      }

      // Destroy destructible brown blocks within 1.0 tile distance
      if (grid) {
        const playerTileX = Math.floor(player.x);
        const playerTileY = Math.floor(player.y);
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const tx = playerTileX + dx;
            const ty = playerTileY + dy;
            if (grid.get({ x: tx, y: ty })?.destructible) {
              grid.set({ x: tx, y: ty }, { walkable: true, destructible: false });
            }
          }
        }
      }

      player.fireCooldown = 0.5;
    } else {
      // Ranged Attack (Projectile)
      let vx = 0;
      let vy = 0;

      const targetNpc = findNearestNpc(player, npcs);
      if (targetNpc) {
        const dx = targetNpc.x - player.x;
        const dy = targetNpc.y - player.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 0) {
          vx = (dx / dist) * PROJECTILE_SPEED;
          vy = (dy / dist) * PROJECTILE_SPEED;
        }
      } else if (joystickInput && (joystickInput.x !== 0 || joystickInput.y !== 0)) {
        const dist = Math.sqrt(joystickInput.x * joystickInput.x + joystickInput.y * joystickInput.y);
        vx = (joystickInput.x / dist) * PROJECTILE_SPEED;
        vy = (joystickInput.y / dist) * PROJECTILE_SPEED;
      } else if (grid) {
        const destBlock = findNearestDestructibleBlock(player, grid);
        if (destBlock) {
          const dx = destBlock.x - player.x;
          const dy = destBlock.y - player.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > 0) {
            vx = (dx / dist) * PROJECTILE_SPEED;
            vy = (dy / dist) * PROJECTILE_SPEED;
          }
        }
      }

      if (vx === 0 && vy === 0) {
        // Default shoot UP
        vy = -PROJECTILE_SPEED;
      }

      registry.add({
        id: `proj-${player.id}-${Math.random().toString(36).slice(2)}`,
        kind: "projectile",
        x: player.x,
        y: player.y,
        vx,
        vy,
        playerId: player.id,
      });
      player.fireCooldown = 0.5;
    }
  }

  player.prevFiring = firing;
}

export function stepProjectiles(
  registry: EntityRegistry<DungeonEntity>,
  grid: TileGrid<GridCell>,
  dt: number
): void {
  const projectiles = registry.query((e) => e.kind === "projectile") as ProjectileEntity[];
  const npcs = registry.query((e) => e.kind === "npc") as NpcEntity[];

  for (const proj of projectiles) {
    const nextX = proj.x + proj.vx * dt;
    const nextY = proj.y + proj.vy * dt;

    // Check grid bounds and wall collision
    const tileX = Math.floor(nextX);
    const tileY = Math.floor(nextY);

    const cell = grid.get({ x: tileX, y: tileY });
    if (cell && cell.destructible) {
      grid.set({ x: tileX, y: tileY }, { walkable: true, destructible: false });
      registry.remove(proj.id);
      continue;
    }

    if (!isWalkablePos(grid, tileX, tileY)) {
      registry.remove(proj.id);
      continue;
    }

    // Check hit against NPCs
    let hitNpc = false;
    for (const npc of npcs) {
      const dx = npc.x - nextX;
      const dy = npc.y - nextY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 0.45) {
        npc.hp -= 1;
        registry.remove(proj.id);
        hitNpc = true;
        if (npc.hp <= 0) {
          registry.remove(npc.id);
        }
        break;
      }
    }

    if (!hitNpc) {
      proj.x = nextX;
      proj.y = nextY;
    }
  }
}

export function checkPlayerMonsterCollisions(
  players: PlayerEntity[],
  npcs: NpcEntity[],
  dt: number
): boolean {
  let playerHit = false;
  for (const player of players) {
    if (player.damageCooldown !== undefined && player.damageCooldown > 0) {
      player.damageCooldown = Math.max(0, player.damageCooldown - dt);
      continue;
    }
    for (const npc of npcs) {
      const dx = npc.x - player.x;
      const dy = npc.y - player.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 0.6) {
        player.damageCooldown = 1.5; // 1.5s invulnerability
        playerHit = true;
        break;
      }
    }
  }
  return playerHit;
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
      npc.wanderTimer = 2.0 + rng() * 3.0;

      const startPos: GridPos = { x: Math.floor(npc.x), y: Math.floor(npc.y) };

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
      npc.wanderTimer = 2.0 + rng() * 3.0;

      const startPos: GridPos = { x: Math.floor(npc.x), y: Math.floor(npc.y) };

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

export interface DungeonStateUpdate {
  phase: GamePhase;
  wave: number;
  lives: number;
  gameOverSurvivedWaves: number | null;
}

export function stepShockwaves(
  registry: EntityRegistry<DungeonEntity>,
  dt: number
): void {
  const shockwaves = registry.query((e) => e.kind === "shockwave") as any[];
  for (const sw of shockwaves) {
    sw.duration -= dt;
    sw.radius = sw.maxRadius * (1 - sw.duration / sw.maxDuration);
    if (sw.duration <= 0) {
      registry.remove(sw.id);
    }
  }
}

export function stepRoom(
  grid: TileGrid<GridCell>,
  registry: EntityRegistry<DungeonEntity>,
  joystickInputs: Map<string, JoystickState>,
  dt: number,
  rng: () => number,
  gameState: DungeonStateUpdate
): DungeonStateUpdate {
  let { phase, wave, lives, gameOverSurvivedWaves } = gameState;

  if (phase !== "dungeon") {
    return { phase, wave, lives, gameOverSurvivedWaves };
  }

  const players = registry.query((e) => e.kind === "player") as PlayerEntity[];
  const npcs = registry.query((e) => e.kind === "npc") as NpcEntity[];

  // 1. Move players & handle firing
  for (const player of players) {
    const input = joystickInputs.get(player.id) ?? { x: 0, y: 0 };
    movePlayer(player, grid, input, dt);
    handlePlayerFiring(player, !!input.firing, registry, npcs, dt, grid, input);
  }

  // 2. Step projectiles & shockwaves
  stepProjectiles(registry, grid, dt);
  stepShockwaves(registry, dt);

  // 3. Step NPCs
  const currentNpcs = registry.query((e) => e.kind === "npc") as NpcEntity[];
  for (const npc of currentNpcs) {
    if (npc.id.includes("skeleton")) {
      stepNpcWanderFree(npc, grid, dt, rng);
    } else {
      stepNpcWander(npc, grid, dt, rng);
    }
  }

  // 4. Check collisions between players and NPCs
  const wasHit = checkPlayerMonsterCollisions(players, currentNpcs, dt);
  if (wasHit) {
    lives -= 1;
    if (lives <= 0) {
      // Game Over
      phase = "lobby";
      gameOverSurvivedWaves = wave - 1;

      // Reset damageCooldown for all players so blinking stops!
      for (const p of players) {
        p.damageCooldown = 0;
      }

      // Clear NPCs, projectiles & shockwaves
      const toRemove = registry.query((e) => e.kind === "npc" || e.kind === "projectile" || e.kind === "shockwave");
      for (const entity of toRemove) {
        registry.remove(entity.id);
      }
      return { phase, wave, lives, gameOverSurvivedWaves };
    }
  }

  // 5. Check if all monsters defeated -> Next Wave!
  const remainingNpcs = registry.query((e) => e.kind === "npc") as NpcEntity[];
  if (remainingNpcs.length === 0) {
    wave += 1;
    // Clear remaining projectiles
    const remainingProjs = registry.query((e) => e.kind === "projectile");
    for (const proj of remainingProjs) {
      registry.remove(proj.id);
    }
    // Spawn players along bottom of screen
    spawnPlayersInBottom(players, grid);
    // Spawn monsters in top half of screen
    spawnWaveMonsters(wave, grid, registry, rng);
  }

  return { phase, wave, lives, gameOverSurvivedWaves };
}
