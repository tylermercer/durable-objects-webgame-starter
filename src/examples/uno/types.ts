export type CardColor = "red" | "yellow" | "green" | "blue";
export type CardValue =
  | "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9"
  | "skip" | "reverse" | "draw2" | "wild" | "wild4";

export interface UnoCard {
  id: string; // unique per physical card, e.g. "red-7-0"
  color: CardColor | "wild";
  value: CardValue;
}

export type UnoPhase = "waiting" | "playing" | "roundOver";

export interface PlayerPublicInfo {
  id: string;
  name: string;
  color: string;
  cardCount: number;
  isTurn: boolean;
  connected: boolean;
}

export interface PublicUnoState {
  phase: UnoPhase;
  topCard: UnoCard | null;
  activeColor: CardColor | null;
  direction: 1 | -1;
  drawPileCount: number;
  players: PlayerPublicInfo[];
  turnPlayerId: string | null;
  turnPlayerName: string | null;
  winner: { id: string; name: string } | null;
  firstPlayerId: string | null;
}

export interface PersistedUnoState {
  deck: { drawPile: UnoCard[]; discardPile: UnoCard[] };
  hands: Record<string, UnoCard[]>;
  turnOrder: { order: string[]; index: number; direction: 1 | -1 };
  roundFlow: { phase: UnoPhase; timeRemaining: number | null };
  activeColor: CardColor | null;
  roundSeed: number;
  winner: { id: string; name: string } | null;
}

export type YourHandMessage = { type: "yourHand"; hand: UnoCard[] };
export type GameStateMessage = { type: "gameState"; state: PublicUnoState };
export type RequestStartActionMessage = { type: "requestStart" };
export type PlayCardActionMessage = {
  type: "playCard";
  cardId: string;
  chosenColor?: CardColor; // required when playing a wild or wild4
};
export type DrawCardActionMessage = { type: "drawCard" };
export type PlayAgainActionMessage = { type: "playAgain" };

export type UnoControlMessage =
  | YourHandMessage
  | GameStateMessage
  | RequestStartActionMessage
  | PlayCardActionMessage
  | DrawCardActionMessage
  | PlayAgainActionMessage;
