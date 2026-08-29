import type { CardColor, UnoCard } from "./types";

export const COLOR_HEX: Record<CardColor, string> = {
  red: "#e6413c",
  yellow: "#ecc41f",
  green: "#3aa856",
  blue: "#2f6fed",
};

export function cardLabel(card: UnoCard): string {
  switch (card.value) {
    case "skip": return "🚫";
    case "reverse": return "🔄";
    case "draw2": return "+2";
    case "wild": return "🌈";
    case "wild4": return "+4";
    default: return card.value;
  }
}

export function cardBackground(card: UnoCard, activeColor: CardColor | null): string {
  if (card.color === "wild") return activeColor ? COLOR_HEX[activeColor] : "#333";
  return COLOR_HEX[card.color];
}
