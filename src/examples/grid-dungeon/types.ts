export interface GridCell {
  walkable: boolean;
}

export interface PlayerEntity {
  id: string;
  kind: "player";
  name: string;
  color: string;
  x: number;
  y: number;
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
}

export type DungeonEntity = PlayerEntity | NpcEntity;

export interface JoystickState {
  x: number;
  y: number;
}

export interface RoomStateSnapshot {
  players: PlayerEntity[];
  npcs: NpcEntity[];
  gridWidth: number;
  gridHeight: number;
  tileSize: number;
}

export interface DungeonControlMessage {
  type: "roomState";
  snapshot: RoomStateSnapshot;
}
