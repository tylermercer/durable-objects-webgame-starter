export interface GridCell {
  walkable: boolean;
  destructible?: boolean;
}

export interface PlayerEntity {
  id: string;
  kind: "player";
  name: string;
  color: string;
  x: number;
  y: number;
  fireCooldown?: number;
  damageCooldown?: number;
  prevFiring?: boolean;
  attackType?: "ranged" | "melee";
}

export interface ShockwaveEntity {
  id: string;
  kind: "shockwave";
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  color: string;
  duration: number;
  maxDuration: number;
}

export interface NpcEntity {
  id: string;
  kind: "npc";
  name: string;
  color: string;
  x: number;
  y: number;
  currentPath: { x: number; y: number }[];
  wanderTimer: number;
  hp: number;
  maxHp: number;
}

export interface ProjectileEntity {
  id: string;
  kind: "projectile";
  x: number;
  y: number;
  vx: number;
  vy: number;
  playerId: string;
}

export type DungeonEntity = PlayerEntity | NpcEntity | ProjectileEntity | ShockwaveEntity;

export interface JoystickState {
  x: number;
  y: number;
  firing?: boolean;
}

export type GamePhase = "lobby" | "dungeon";

export interface StartZone {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface RoomStateSnapshot {
  phase: GamePhase;
  countdown: number | null;
  players: PlayerEntity[];
  npcs: NpcEntity[];
  projectiles?: ProjectileEntity[];
  shockwaves?: ShockwaveEntity[];
  gridWidth: number;
  gridHeight: number;
  tileSize: number;
  wave?: number;
  lives?: number;
  gameOverSurvivedWaves?: number | null;
}

export interface DungeonControlMessage {
  type: "roomState";
  snapshot: RoomStateSnapshot;
}
