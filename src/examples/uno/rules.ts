import type { CardColor, CardValue, UnoCard } from "./types";

export const CARD_COLORS: CardColor[] = ["red", "yellow", "green", "blue"];

/**
 * Standard 108-card Uno deck: per color, one 0, two each of 1-9, two Skip,
 * two Reverse, two Draw Two (25 cards x 4 colors = 100), plus four Wild and
 * four Wild Draw Four.
 */
export function createUnoDeck(): UnoCard[] {
  const cards: UnoCard[] = [];
  let n = 0;

  for (const color of CARD_COLORS) {
    cards.push({ id: `c${n++}`, color, value: "0" });
    const numberedValues: CardValue[] = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
    const actionValues: CardValue[] = ["skip", "reverse", "draw2"];
    for (const value of [...numberedValues, ...actionValues]) {
      cards.push({ id: `c${n++}`, color, value });
      cards.push({ id: `c${n++}`, color, value });
    }
  }

  for (let i = 0; i < 4; i++) cards.push({ id: `c${n++}`, color: "wild", value: "wild" });
  for (let i = 0; i < 4; i++) cards.push({ id: `c${n++}`, color: "wild", value: "wild4" });

  return cards;
}

/**
 * Is `card` a legal play on top of `topCard`, given the current active
 * color (which differs from `topCard.color` after a wild has been played)?
 */
export function isPlayable(card: UnoCard, topCard: UnoCard, activeColor: CardColor): boolean {
  if (card.color === "wild") return true;
  return card.color === activeColor || card.value === topCard.value;
}

/** True if this player has at least one legal play given the current state. */
export function hasPlayableCard(hand: UnoCard[], topCard: UnoCard, activeColor: CardColor): boolean {
  return hand.some(card => isPlayable(card, topCard, activeColor));
}

export function isWild(card: UnoCard): boolean {
  return card.color === "wild";
}

export function isActionCard(card: UnoCard): boolean {
  return card.value === "skip" || card.value === "reverse" || card.value === "draw2" || card.value === "wild4";
}

/** How many cards the next player must draw when this card is played, if any. */
export function drawPenaltyOf(card: UnoCard): number {
  if (card.value === "draw2") return 2;
  if (card.value === "wild4") return 4;
  return 0;
}
