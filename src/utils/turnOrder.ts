export interface TurnOrderState {
  order: string[];
  index: number;
  direction: 1 | -1;
}

/**
 * An ordered, mutation-safe list of active player IDs with a current-turn
 * pointer. See design-docs/2026-08-28-001-turn-order-and-round-flow.md.
 */
export class TurnOrder {
  private order: string[];
  private index: number;
  private direction: 1 | -1;

  constructor(playerIds: string[], state?: Partial<TurnOrderState>) {
    this.order = state?.order ? [...state.order] : [...playerIds];
    this.index = state?.index ?? 0;
    this.direction = state?.direction ?? 1;
    this.clampIndex();
  }

  /** The player ID whose turn it is, or null if no players remain. */
  current(): string | null {
    return this.order[this.index] ?? null;
  }

  isCurrent(id: string): boolean {
    return this.current() === id;
  }

  all(): readonly string[] {
    return this.order;
  }

  /** Move to the next player, respecting `direction`. Returns the new current player. */
  advance(): string | null {
    if (this.order.length === 0) return null;
    this.index = this.wrap(this.index + this.direction);
    return this.current();
  }

  /** Flip the direction of play. Persists until reversed again. */
  reverse(): void {
    this.direction = this.direction === 1 ? -1 : 1;
  }

  /** Jump directly to a player already in the order. */
  jumpTo(id: string): void {
    const idx = this.order.indexOf(id);
    if (idx !== -1) this.index = idx;
  }

  /**
   * Add a newly-joined player. `position`: "end" (default, back of the
   * queue) or "next" (cuts in immediately after the current player).
   */
  addPlayer(id: string, position: "end" | "next" = "end"): void {
    if (this.order.includes(id)) return;
    if (position === "next" && this.order.length > 0) {
      this.order.splice(this.index + 1, 0, id);
    } else {
      this.order.push(id);
    }
  }

  /**
   * Remove a player (disconnect, elimination). Safe to call mid-round,
   * including for the current player.
   */
  removePlayer(id: string): void {
    const idx = this.order.indexOf(id);
    if (idx === -1) return;
    this.order.splice(idx, 1);
    if (idx < this.index) this.index -= 1;
    this.clampIndex();
  }

  toJSON(): TurnOrderState {
    return { order: [...this.order], index: this.index, direction: this.direction };
  }

  private wrap(i: number): number {
    const n = this.order.length;
    return n === 0 ? 0 : ((i % n) + n) % n;
  }

  private clampIndex(): void {
    this.index = this.order.length === 0 ? 0 : this.wrap(this.index);
  }
}
