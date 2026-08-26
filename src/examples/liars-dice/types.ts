export type GamePhase = "waiting" | "bidding" | "revealing" | "gameOver";

export interface Bid {
  count: number;
  face: number;
  bidderId: string;
  bidderName: string;
}

export interface PlayerPublicInfo {
  id: string;
  name: string;
  color: string;
  diceCount: number;
  isTurn: boolean;
  connected: boolean;
}

export interface ChallengeResult {
  challengerId: string;
  challengerName: string;
  bidderId: string;
  bidderName: string;
  bid: Bid;
  actualCount: number;
  challengeSuccess: boolean;
  loserId: string;
  loserName: string;
  allHands: Record<string, number[]>;
}

export interface PublicGameState {
  phase: GamePhase;
  roundNumber: number;
  turnPlayerId: string | null;
  turnPlayerName: string | null;
  currentBid: Bid | null;
  timerRemaining: number;
  totalDiceInPlay: number;
  players: PlayerPublicInfo[];
  lastChallengeResult: ChallengeResult | null;
  winner: { id: string; name: string } | null;
  firstPlayerId?: string | null;
}

export interface PersistedGameState {
  roundNumber: number;
  roundSeed: number;
  playerDiceCounts: Record<string, number>;
  currentBid: Bid | null;
  turnIndex: number;
  phase: GamePhase;
  lastChallengeResult: ChallengeResult | null;
  winner: { id: string; name: string } | null;
}

export type PrivateDiceMessage = {
  type: "privateDice";
  dice: number[];
};

export type GameStateMessage = {
  type: "gameState";
  state: PublicGameState;
};

export type RequestStartActionMessage = {
  type: "requestStart";
};

export type BidActionMessage = {
  type: "bid";
  count: number;
  face: number;
};

export type ChallengeActionMessage = {
  type: "challenge";
};

export type NextRoundActionMessage = {
  type: "nextRound";
};

export type LiarsDiceControlMessage =
  | PrivateDiceMessage
  | GameStateMessage
  | RequestStartActionMessage
  | BidActionMessage
  | ChallengeActionMessage
  | NextRoundActionMessage;
