# Turn-Order and Round-Flow Primitives

## Scope

This is an addendum to `design-docs/2026-08-24-002-additional-primitives.md`, in the same spirit: small, opt-in, game-agnostic building blocks under `src/utils/`. It extracts two things that currently exist *twice*, hand-rolled, inside example games — whose-turn-is-it bookkeeping, and lobby → play → reveal/over phase bookkeeping — into two reusable primitives:

- **`TurnOrder`** (`src/utils/turnOrder.ts`) — an ordered, mutation-safe list of active player IDs with a current pointer. Needed by any turn-based game: card games (Uno, 6 Nimmt), board games (Othello), word games with a "who reads next" rotation.
- **`RoundFlow`** (`src/utils/roundFlow.ts`) — a named-phase state container with an optional countdown timer per phase. Needed by essentially every party game: lobby → round → reveal/scoring → next round.

Neither primitive owns reactivity or persistence — that stays with `createStore` (`src/react/reactStore.ts`) and `saveGameState`/`loadGameState`, exactly as today. Both are plain serializable state containers, matching the style of `EntityRegistry` and `TileGrid`: a game calls their methods inside its own `handleControlMessage`/`tick`, then feeds the result into its existing `store.set(...)` and `persistState()` calls. A game that doesn't need them is completely unaffected.

## 1. Why extract now, not earlier

Two examples have independently implemented the same two patterns:

- **Turn order.** `liars-dice/console.ts` maintains `turnOrder: string[]` + `turnIndex: number`, computed fresh each round via `getActivePlayerIds()` (sorted by ID — not join order), advanced with `turnIndex = (turnIndex + 1) % turnOrder.length` on each bid, and re-seeded on a loser via `turnOrder.indexOf(lastChallengeResult.loserId)`. This has a latent bug worth fixing in the extraction: if a player disconnects *mid-round*, `turnOrder` isn't recomputed until `startNextRound()`, so `turnOrder[turnIndex]` can point at a stale ID and stall the round. A reusable primitive should handle removal safely at any time, not just between rounds.
- **Round/phase flow.** `liars-dice` has `phase: GamePhase = "waiting" | "bidding" | "revealing" | "gameOver"`; `flappy-royale` independently has `phase: RoundPhase = "waiting" | "active" | "roundOver"`. Both drive their `tick()` with an `if (phase === ...)` chain, both gate a `revealTimer`/countdown by hand, and both restore `phase` as a raw string field inside their own `PersistedGameState`/`PersistedFlappyState`. The shape is identical; only the phase names differ.

Waiting until a third genre (a card or board game) forces this generalization would mean guessing at the right abstraction. Building it now, against two known concrete usages plus the near-term card/board-game targets, keeps it grounded.

## 2. `TurnOrder`

```ts
// src/utils/turnOrder.ts

export interface TurnOrderState {
  order: string[];
  index: number;
  direction: 1 | -1;
}

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

  /** Uno/Crazy-Eights-style reverse card. Direction persists across `advance()` calls. */
  reverse(): void {
    this.direction = this.direction === 1 ? -1 : 1;
  }

  /** Jump directly to a player already in the order (e.g. "loser goes first" in Liar's Dice). */
  jumpTo(id: string): void {
    const idx = this.order.indexOf(id);
    if (idx !== -1) this.index = idx;
  }

  /**
   * Add a newly-joined player. `position` controls where: "end" (default — joins
   * the back of the queue, fair for most games) or "next" (cuts in immediately
   * after the current player — rarely what you want, but available for games
   * where a late joiner should play sooner).
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
   * Remove a player (disconnect, elimination). Safe to call mid-round, including
   * for the current player — the pointer is adjusted so `current()` still means
   * "whoever's turn it logically is now," not an off-by-one stale index.
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
```

**Design choice — removal adjusts the pointer, it doesn't just clamp.** Splicing out an index below the current one shifts everything after it left by one, so without the `if (idx < this.index) this.index -= 1` correction, `current()` would silently skip the player who was actually next. This is the fix for the mid-round-disconnect bug in §1. Removing the *current* player is intentionally simple: the splice already leaves `index` pointing at the next player in line, which is normally the desired outcome (their turn is skipped, play continues) — no special case needed.

**Design choice — `direction` lives on the object, not passed to `advance()` each time.** Uno's reverse card flips direction for the rest of the game (until reversed again), not just for one turn — modeling it as persistent state matches the rules directly and means callers never have to remember which way things are currently going.

**Design choice — no `skip()` method.** "Skip next player" (Uno's skip card, 6 Nimmt's non-turn-based-but-similar patterns) is just `advance()` called twice by the caller. Adding a dedicated method for a two-line composition isn't worth the API surface.

## 3. `RoundFlow`

```ts
// src/utils/roundFlow.ts

export interface RoundFlowState<TPhase extends string> {
  phase: TPhase;
  timeRemaining: number | null;
}

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
   * Advance the countdown for the current phase, if one is running. Returns true
   * exactly once, the tick where the timer crosses zero — the caller's cue to
   * call `transition()` to whatever phase comes next. Returns false every other
   * tick, including when no timer is running.
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
```

**Design choice — `tickTimer` returns a one-shot boolean rather than the game polling `remaining() <= 0`.** Both existing examples already have a bug shape this avoids: `flappy-royale` and `liars-dice` both decrement a raw `revealTimer` number and check `<= 0` inside their own `tick()`, which means the transition logic and the decrement are interleaved by hand every time. A one-shot edge-triggered return makes "did the timer just expire" a single unambiguous question, and going negative for one frame (network hiccup, slow tab) can't cause a double-transition, since the internal state is reset to `null` the instant it fires.

**Design choice — generic over `TPhase extends string`, not a fixed enum.** `"waiting" | "bidding" | "revealing" | "gameOver"` and `"waiting" | "active" | "roundOver"` are different phase sets for different genres. Making `RoundFlow` generic lets each game keep its own phase union (unchanged from today) while sharing the mechanics. This also means `RoundFlow` doesn't try to prescribe a fixed lobby → play → score lifecycle — genres differ enough (a board game's "phase" might be `placing | flipping | gameOver`, no lobby needed after game start) that a rigid shared enum would fight more games than it'd help.

**Not included: transition validity rules.** Whether `"bidding" → "gameOver"` is legal is game-specific domain logic (see `rules.ts` in `liars-dice`, which already owns bid/challenge validity). `RoundFlow` is deliberately just a labeled container plus a timer, not a state-machine-with-guards — adding transition tables would push genre-specific rules into a supposedly generic primitive.

## 4. Interaction with the first-player primitive

Neither primitive decides *who* is allowed to call `transition()` or `advance()` — that's already solved by `isFirstPlayer`/`firstPlayerId` from `design-docs/2026-08-25-003-first-player-primitive.md`. The pattern (already used for `requestStart`/`nextRound` in `liars-dice`) stays exactly the same, just against the new primitives:

```ts
// pattern for any game's handleControlMessage
if (msg.type === "requestStart") {
  if (fromId === getFirstPlayerId() && roundFlow.is("waiting")) {
    roundFlow.transition("playing");
    broadcastState();
  }
}
```

## 5. Refactoring the existing examples

### Liar's Dice

- Replace `turnOrder: string[]` + `turnIndex: number` with a single `turnOrder: TurnOrder` field, constructed in `startNextRound()` as `new TurnOrder(getActivePlayerIds())`.
  - `turnOrder[turnIndex] !== fromId` checks become `!turnOrder.isCurrent(fromId)`.
  - `turnIndex = (turnIndex + 1) % turnOrder.length` becomes `turnOrder.advance()`.
  - `turnIndex = turnOrder.indexOf(lastChallengeResult.loserId)` becomes `turnOrder.jumpTo(lastChallengeResult.loserId)`.
  - The mid-round-disconnect gap in §1 is fixed for free: call `turnOrder.removePlayer(id)` from wherever peer disconnect is already handled, instead of only recomputing at round start.
- Replace `phase: GamePhase` + the manual `revealTimer` countdown with `roundFlow: RoundFlow<GamePhase>`.
  - The `tick()` branch `revealTimer -= dt; if (revealTimer <= 0) { ... }` becomes `if (roundFlow.tickTimer(dt)) { winner ? roundFlow.transition("gameOver") : startNextRound(); }`.
  - `startNextRound()`'s `phase = "revealing"; revealTimer = REVEAL_DURATION;` becomes `roundFlow.transition("revealing", REVEAL_DURATION)`.
- `PersistedGameState` drops its separate `turnIndex`/`phase` fields in favor of spreading `turnOrder.toJSON()` and `roundFlow.toJSON()`; `loadGameState()` reconstructs both via the constructors' `state` parameter.

### Flappy Royale

Flappy Royale has no per-turn ordering (all players act simultaneously), so only `RoundFlow<RoundPhase>` applies:

- `phase: RoundPhase` becomes `roundFlow: RoundFlow<RoundPhase>`; the `if (currentState.phase === "active")` / `"waiting"` / `"roundOver"` branches throughout `console.ts` become `roundFlow.is(...)` checks.
- `roundOver` doesn't currently run a timer (it waits for the first player's next flap) — `RoundFlow` supports this fine, since `transition()`'s `durationSeconds` is optional; no timer starts unless a phase needs one.

### Touch Demo

Untouched — no phases or turns, same as its exclusion from the first-player doc.

## 6. Looking ahead to card and board games

Not built in this pass, but worth naming so the primitives above are shaped correctly for them:

- **Uno / 6 Nimmt (cards):** `TurnOrder` covers turn rotation including reverse/skip directly. A separate deck/hand primitive (shuffle via the existing `createRng`, deal, draw/discard piles, private-hand delivery generalized from `liars-dice`'s one-off `privateDice` message) is the next logical addendum, and is intentionally out of scope here.
- **Othello (board):** `RoundFlow` covers `placing | gameOver`; `TurnOrder` covers alternating players. The missing piece is a static board/cell-ownership primitive (distinct from `TileGrid`, which is built for walkability/pathfinding, not click-to-place-and-flood-fill) — also intentionally out of scope here.

## Summary: what's new where

| File | Addition |
|---|---|
| `src/utils/turnOrder.ts` | new — `TurnOrder` class (§2) |
| `src/utils/turnOrder.test.ts` | new — unit tests, especially mid-round `removePlayer` pointer adjustment |
| `src/utils/roundFlow.ts` | new — `RoundFlow<TPhase>` class (§3) |
| `src/utils/roundFlow.test.ts` | new — unit tests, especially `tickTimer`'s one-shot edge trigger |
| `src/examples/liars-dice/console.ts` | `turnIndex`/manual `revealTimer` replaced with `TurnOrder`/`RoundFlow`; disconnect now calls `removePlayer` immediately (§5) |
| `src/examples/liars-dice/types.ts` | `PersistedGameState` restructured to nest `TurnOrderState`/`RoundFlowState` instead of raw `turnIndex`/`phase` fields |
| `src/examples/flappy-royale/console.ts` | `phase` field replaced with `RoundFlow<RoundPhase>` (§5) |
| `src/examples/flappy-royale/types.ts` | `PersistedFlappyState` nests `RoundFlowState<RoundPhase>` instead of raw `phase` |
