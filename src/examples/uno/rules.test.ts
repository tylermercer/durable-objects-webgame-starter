import { describe, it, expect } from "vitest";
import { createUnoDeck, isPlayable, hasPlayableCard, drawPenaltyOf, CARD_COLORS } from "./rules";
import type { UnoCard } from "./types";

describe("createUnoDeck", () => {
  it("has exactly 108 cards", () => {
    expect(createUnoDeck().length).toBe(108);
  });

  it("has 25 cards of each color and 8 wild cards", () => {
    const deck = createUnoDeck();
    for (const color of CARD_COLORS) {
      expect(deck.filter(c => c.color === color).length).toBe(25);
    }
    expect(deck.filter(c => c.color === "wild").length).toBe(8);
  });

  it("has one 0 and two each of 1-9 per color", () => {
    const deck = createUnoDeck();
    expect(deck.filter(c => c.color === "red" && c.value === "0").length).toBe(1);
    expect(deck.filter(c => c.color === "red" && c.value === "7").length).toBe(2);
  });

  it("all card ids are unique", () => {
    const deck = createUnoDeck();
    expect(new Set(deck.map(c => c.id)).size).toBe(deck.length);
  });
});

describe("isPlayable", () => {
  const top: UnoCard = { id: "t", color: "red", value: "7" };

  it("matches by color", () => {
    const card: UnoCard = { id: "a", color: "red", value: "2" };
    expect(isPlayable(card, top, "red")).toBe(true);
  });

  it("matches by value across colors", () => {
    const card: UnoCard = { id: "a", color: "blue", value: "7" };
    expect(isPlayable(card, top, "red")).toBe(true);
  });

  it("wild is always playable", () => {
    const card: UnoCard = { id: "a", color: "wild", value: "wild" };
    expect(isPlayable(card, top, "red")).toBe(true);
  });

  it("rejects a non-matching, non-wild card", () => {
    const card: UnoCard = { id: "a", color: "blue", value: "3" };
    expect(isPlayable(card, top, "red")).toBe(false);
  });

  it("uses activeColor, not topCard.color, after a wild was played", () => {
    const wildTop: UnoCard = { id: "t", color: "wild", value: "wild" };
    const card: UnoCard = { id: "a", color: "green", value: "5" };
    expect(isPlayable(card, wildTop, "green")).toBe(true);
    expect(isPlayable(card, wildTop, "blue")).toBe(false);
  });
});

describe("hasPlayableCard", () => {
  const top: UnoCard = { id: "t", color: "red", value: "7" };

  it("true if any card in hand is playable", () => {
    const hand: UnoCard[] = [
      { id: "a", color: "blue", value: "3" },
      { id: "b", color: "red", value: "9" },
    ];
    expect(hasPlayableCard(hand, top, "red")).toBe(true);
  });

  it("false if no card in hand is playable", () => {
    const hand: UnoCard[] = [
      { id: "a", color: "blue", value: "3" },
      { id: "b", color: "green", value: "9" },
    ];
    expect(hasPlayableCard(hand, top, "red")).toBe(false);
  });
});

describe("drawPenaltyOf", () => {
  it("draw2 is 2, wild4 is 4, everything else is 0", () => {
    expect(drawPenaltyOf({ id: "a", color: "red", value: "draw2" })).toBe(2);
    expect(drawPenaltyOf({ id: "a", color: "wild", value: "wild4" })).toBe(4);
    expect(drawPenaltyOf({ id: "a", color: "red", value: "5" })).toBe(0);
    expect(drawPenaltyOf({ id: "a", color: "red", value: "skip" })).toBe(0);
  });
});
