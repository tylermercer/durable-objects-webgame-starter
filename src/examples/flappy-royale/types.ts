export type RoundPhase = "waiting" | "active" | "roundOver";

export interface BirdState {
  id: string;
  name: string;
  color: string;
  x: number;
  y: number;
  vy: number;
  alive: boolean;
  place: number | null;
}

export interface PipeState {
  id: number;
  x: number;
  topHeight: number;
  bottomY: number;
  gap: number;
  width: number;
}

export interface RoundState {
  phase: RoundPhase;
  seed: number;
  tickIndex: number;
  birds: Record<string, BirdState>;
  pipes: PipeState[];
  totalPlayersAtStart: number;
  winner: { id: string; name: string } | null;
}

export interface PersistedFlappyState {
  seed: number;
  tickIndex: number;
  phase: RoundPhase;
  birds: Record<string, BirdState>;
  winner: { id: string; name: string } | null;
}

export interface FlapMessage {
  type: "flap";
}

export interface DiedMessage {
  type: "died";
  place: number;
}

export interface RoundOverMessage {
  type: "roundOver";
  place: number | null;
  winnerId: string | null;
  winnerName: string | null;
  [key: string]: unknown;
}

export interface RoundStateSnapshot {
  phase: RoundPhase;
  tickIndex: number;
  birds: Array<{
    id: string;
    name: string;
    color: string;
    x: number;
    y: number;
    vy: number;
    alive: boolean;
    place: number | null;
  }>;
  pipes: Array<{
    id: number;
    x: number;
    topHeight: number;
    bottomY: number;
    width: number;
  }>;
  winner: { id: string; name: string } | null;
}

export interface RoundStateMessage {
  type: "roundState";
  snapshot: RoundStateSnapshot;
}

export type FlappyControlMessage =
  | FlapMessage
  | DiedMessage
  | RoundOverMessage
  | RoundStateMessage;
