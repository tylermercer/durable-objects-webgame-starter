export interface Cell {
  kind: "start" | "end" | "normal";
  capacity: number; // 1..5+, fixed at generation time
  remaining: number; // decrements on arrival/initial spawn, mutated during play
}

export interface PlayerEntity {
  id: string;
  kind: "player";
  name: string;
  color: string;
  x: number; // continuous position for rendering (interpolated)
  y: number;
  tileX: number; // discrete current tile X
  tileY: number; // discrete current tile Y
  targetTileX?: number; // discrete target tile X during step
  targetTileY?: number; // discrete target tile Y during step
  moveProgress?: number; // 0..1 transition progress
}

export interface LevelSpec {
  width: number;
  height: number;
  startPos: { x: number; y: number };
  endPos: { x: number; y: number };
  targetWalkLength: number;
  maxRevisitsPerCell: number;
}

export interface JoystickState {
  x: number;
  y: number;
}

export interface FadingIslesSnapshot {
  players: PlayerEntity[];
  grid: (Cell | null)[]; // row-major array
  gridWidth: number;
  gridHeight: number;
  tileSize: number;
  levelNumber: number;
  won: boolean;
}

export type FadingIslesControlMessage =
  | { type: "roomState"; snapshot: FadingIslesSnapshot }
  | { type: "restartLevel" };
