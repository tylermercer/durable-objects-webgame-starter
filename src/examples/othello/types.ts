import type { TileGridState } from "@utils/tileGrid";
import type { TurnOrderState } from "@utils/turnOrder";
import type { RoundFlowState } from "@utils/roundFlow";

export type CellState = "black" | "white" | null;
export type OthelloPhase = "waiting" | "playing" | "roundOver";

export interface PlayerPublicInfo {
  id: string;
  name: string;
  color: string;
  pieceColor: "black" | "white" | null;
  isTurn: boolean;
  connected: boolean;
  count: number;
}

export interface PublicOthelloState {
  phase: OthelloPhase;
  board: TileGridState<CellState>;
  turnPlayerId: string | null;
  turnPlayerName: string | null;
  blackPlayer: { id: string; name: string } | null;
  whitePlayer: { id: string; name: string } | null;
  blackCount: number;
  whiteCount: number;
  winner: { id: string; name: string; color: "black" | "white" | "tie" } | null;
  firstPlayerId: string | null;
}

export interface PersistedOthelloState {
  board: TileGridState<CellState>;
  turnOrder: TurnOrderState;
  roundFlow: RoundFlowState<OthelloPhase>;
  blackId: string | null;
  whiteId: string | null;
  winner: { id: string; name: string; color: "black" | "white" | "tie" } | null;
}

export type GameStateMessage = { type: "gameState"; state: PublicOthelloState };
export type RequestStartActionMessage = { type: "requestStart" };
export type PlacePieceActionMessage = { type: "placePiece"; x: number; y: number };
export type PlayAgainActionMessage = { type: "playAgain" };

export type OthelloControlMessage =
  | GameStateMessage
  | RequestStartActionMessage
  | PlacePieceActionMessage
  | PlayAgainActionMessage;
