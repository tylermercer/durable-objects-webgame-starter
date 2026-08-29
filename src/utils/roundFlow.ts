export interface RoundFlowState<TPhase extends string> {
  phase: TPhase;
  timeRemaining: number | null;
}

/**
 * A generic labeled-phase container with an optional one-shot countdown
 * timer. See design-docs/2026-08-28-001-turn-order-and-round-flow.md.
 */
export class RoundFlow<TPhase extends string> {
  private phase: TPhase;
  private timeRemaining: number | null;

  constructor(initialPhase: TPhase, state?: Partial<RoundFlowState<TPhase>>) {
    this.phase = state?.phase ?? initialPhase;
    this.timeRemaining = state?.timeRemaining ?? null;
  }

  current(): TPhase {
    return this.phase;
  }

  is(phase: TPhase): boolean {
    return this.phase === phase;
  }

  /** Move to a new phase. `durationSeconds`, if given, starts a countdown for this phase. */
  transition(phase: TPhase, durationSeconds?: number): void {
    this.phase = phase;
    this.timeRemaining = durationSeconds ?? null;
  }

  /**
   * Advance the countdown for the current phase, if one is running. Returns
   * true exactly once, the tick where the timer crosses zero. False every
   * other tick, including when no timer is running.
   */
  tickTimer(dt: number): boolean {
    if (this.timeRemaining === null) return false;
    this.timeRemaining -= dt;
    if (this.timeRemaining <= 0) {
      this.timeRemaining = null;
      return true;
    }
    return false;
  }

  /** Seconds left in the current phase's timer, or null if none is running. */
  remaining(): number | null {
    return this.timeRemaining;
  }

  toJSON(): RoundFlowState<TPhase> {
    return { phase: this.phase, timeRemaining: this.timeRemaining };
  }
}
