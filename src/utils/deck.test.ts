import { describe, it, expect } from "vitest";
import { Deck } from "./deck";
import { createRng } from "./rng";

describe("Deck", () => {
  it("shuffles deterministically given the same seed", () => {
    const cards = Array.from({ length: 20 }, (_, i) => i);
    const a = new Deck(cards, createRng(42));
    const b = new Deck(cards, createRng(42));
    const drawnA = a.drawMany(20);
    const drawnB = b.drawMany(20);
    expect(drawnA).toEqual(drawnB);
    // and it's an actual shuffle, not identity order
    expect(drawnA).not.toEqual(cards);
  });

  it("draw removes cards one at a time and decrements remainingInDrawPile", () => {
    const deck = new Deck([1, 2, 3], createRng(1));
    expect(deck.remainingInDrawPile()).toBe(3);
    deck.draw();
    expect(deck.remainingInDrawPile()).toBe(2);
  });

  it("reclaims the discard pile (minus its top card) when the draw pile empties", () => {
    const deck = new Deck([1, 2, 3], createRng(1));
    const drawn = deck.drawMany(3);
    expect(deck.remainingInDrawPile()).toBe(0);

    // discard all but the last drawn card, keeping one as the new "top"
    deck.discard(drawn[0]);
    deck.discard(drawn[1]);
    deck.discard(drawn[2]); // this one stays as topOfDiscard after reclaim

    const nextCard = deck.draw();
    expect(nextCard).not.toBeUndefined();
    // the card that was on top of the discard pile should NOT have been reclaimed
    expect(nextCard).not.toBe(drawn[2]);
    expect(deck.topOfDiscard()).toBe(drawn[2]);
  });

  it("drawMany truncates gracefully when the deck runs out entirely", () => {
    const deck = new Deck([1, 2], createRng(1));
    const drawn = deck.drawMany(5);
    expect(drawn.length).toBe(2);
    expect(deck.draw()).toBeUndefined();
  });

  it("round-trips through toJSON/fromJSON", () => {
    const deck = new Deck([1, 2, 3, 4], createRng(7));
    deck.discard(deck.draw()!);
    const restored = Deck.fromJSON(deck.toJSON(), createRng(7));
    expect(restored.remainingInDrawPile()).toBe(deck.remainingInDrawPile());
    expect(restored.topOfDiscard()).toBe(deck.topOfDiscard());
  });
});
