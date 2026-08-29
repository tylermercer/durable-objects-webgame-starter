export interface DeckState<T> {
  drawPile: T[];
  discardPile: T[];
}

/**
 * A generic draw-pile/discard-pile deck of cards, backed by a seedable RNG
 * (see `createRng` in `./rng.ts`) so shuffles are reproducible across a
 * console reload. See design-docs/2026-08-28-002-deck-and-hand-management.md.
 */
export class Deck<T> {
  private drawPile: T[];
  private discardPile: T[];
  private rng: () => number;

  /** Cards start in the draw pile, shuffled immediately using `rng`. */
  constructor(cards: T[], rng: () => number) {
    this.rng = rng;
    this.drawPile = [...cards];
    this.discardPile = [];
    this.shuffleDrawPile();
  }

  static fromJSON<T>(state: DeckState<T>, rng: () => number): Deck<T> {
    const deck = new Deck<T>([], rng);
    deck.drawPile = [...state.drawPile];
    deck.discardPile = [...state.discardPile];
    return deck;
  }

  /**
   * Draw one card. If the draw pile is empty, automatically reclaims the
   * discard pile first (shuffling everything but its top card back in).
   * Returns undefined only if there are no cards left anywhere but
   * players' hands.
   */
  draw(): T | undefined {
    if (this.drawPile.length === 0) this.reclaimDiscard();
    return this.drawPile.pop();
  }

  drawMany(n: number): T[] {
    const out: T[] = [];
    for (let i = 0; i < n; i++) {
      const card = this.draw();
      if (card === undefined) break;
      out.push(card);
    }
    return out;
  }

  /** Place a card face-up on top of the discard pile. */
  discard(card: T): void {
    this.discardPile.push(card);
  }

  /** The current face-up card, or undefined if nothing's been discarded yet. */
  topOfDiscard(): T | undefined {
    return this.discardPile[this.discardPile.length - 1];
  }

  remainingInDrawPile(): number {
    return this.drawPile.length;
  }

  discardPileSize(): number {
    return this.discardPile.length;
  }

  toJSON(): DeckState<T> {
    return { drawPile: [...this.drawPile], discardPile: [...this.discardPile] };
  }

  private shuffleDrawPile(): void {
    for (let i = this.drawPile.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [this.drawPile[i], this.drawPile[j]] = [this.drawPile[j], this.drawPile[i]];
    }
  }

  private reclaimDiscard(): void {
    if (this.discardPile.length <= 1) return; // nothing to reclaim
    const top = this.discardPile.pop()!;
    this.drawPile = this.discardPile;
    this.discardPile = [top];
    this.shuffleDrawPile();
  }
}
