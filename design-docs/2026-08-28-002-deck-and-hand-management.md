# Deck and Hand Management

## Scope

Addendum to `design-docs/2026-08-24-002-additional-primitives.md`, continuing the pattern from `2026-08-28-001-turn-order-and-round-flow.md`. This adds the one primitive named but deliberately deferred in that doc's §6: a generic, seed-reproducible **deck** — draw pile, discard pile, shuffle, reclaim — for any card-based game (Uno, 6 Nimmt, and beyond).

**"Hand," by contrast, is not a new primitive.** A hand is just `T[]`, and games already own a `Map<string, T[]>` of per-player state (`liars-dice`'s `playerHands: Map<string, number[]>` is exactly this shape for dice). What *is* worth generalizing is the delivery pattern for private per-player state, which `liars-dice` currently implements once, inline, as the `privateDice` control message. §3 below names that pattern explicitly so the Uno demo (and future card games) follow it deliberately rather than reinventing it a second time.

This doc also specs the `uno` example game that exercises both `Deck<T>` and `TurnOrder`/`RoundFlow` from the previous addendum together, per the same "prove it against a real example before it's trusted" approach used throughout `design-docs/`.

## 1. `Deck<T>`

```ts
// src/utils/deck.ts

export interface DeckState<T> {
  drawPile: T[];
  discardPile: T[];
}

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
   * discard pile first (see §2). Returns undefined only if there are no
   * cards left anywhere but players' hands — i.e. every card in the game
   * is already held by someone.
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
```

**Design choice — the deck owns an `rng`, not the caller.** Every draw-pile-empty moment needs a reshuffle, not just the initial deal, and that reshuffle has to be seedable for the same reproducibility reason `liars-dice` seeds `roundSeed` — a console reload mid-game shouldn't produce a different shuffle than what players already saw. Storing `rng` (built via the existing `createRng(seed)` from `2026-08-24-002-additional-primitives.md` §5) on the `Deck` instance means callers never have to remember to thread it through at the one call site (`reclaimDiscard`) that isn't the obvious one.

**Design choice — reclaim keeps the current top card.** Standard rule for every game in this family (Uno included): when the draw pile runs dry, everything *except* the currently face-up card gets shuffled back into a new draw pile. Baking this into `draw()` itself, rather than making callers check `remainingInDrawPile() === 0` and call a separate reclaim method, means a game can always just call `.draw()` and get a card back (or `undefined` in the genuine all-cards-in-hands edge case) without re-deriving this rule per game.

**Not included: dealing.** "Deal 7 cards to each of N players" is `for (const id of playerIds) hands.set(id, deck.drawMany(7))` — two lines in the game's own setup code. A `deal()` method on `Deck` would have to guess at turn-order-of-dealing and per-player-count conventions that vary by game; not worth the API surface for something this short.

## 2. Interaction with `TurnOrder`/`RoundFlow`

No new integration code — `Deck` is deliberately independent of both. A game wires them together itself, e.g. Uno's "Reverse acts as Skip in a 2-player game" (§4 below) is domain logic that composes `TurnOrder.reverse()` + `TurnOrder.advance()`, exactly the "caller composes primitives, primitive doesn't bake in game rules" pattern the no-`skip()`-method choice in the turn-order doc already established.

## 3. Private-hand delivery pattern (documented, not new code)

Generalizing what `liars-dice` already does once: a private per-player message is a plain `sendControl` (not `sendControlCoalesced` — hands change discretely, at most once a turn, so there's nothing to coalesce), sent to that peer only, whenever that player's hand changes:

```ts
// pattern, not a new utility — one call site per game, same as liars-dice's privateDice
function sendHand(peer: ControllerPeer, hand: Card[]) {
  peer.pc?.sendControl({ type: "yourHand", hand });
}
```

This is intentionally left as a documented convention rather than a wrapped helper: the message `type` name and card shape are game-specific, and the one-line body doesn't earn an abstraction. What's worth carrying forward is just the rule itself — **hands are never included in the broadcast public-state message**; only counts (`cardCount`) are public, the array of actual cards is unicast.

## 4. `uno` example

New example under `src/examples/uno/`, registered in `src/examples/registry.ts` alongside the existing four, demonstrating `Deck<T>` (shuffle/deal/draw/discard/reclaim), `TurnOrder` (rotation + `reverse()` for the Reverse card), and `RoundFlow<UnoPhase>` (`"waiting" | "playing" | "roundOver"`) together.

### Card model (`types.ts`)

```ts
export type CardColor = "red" | "yellow" | "green" | "blue";
export type CardValue =
  | "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9"
  | "skip" | "reverse" | "draw2" | "wild" | "wild4";

export interface UnoCard {
  id: string;              // unique per physical card, e.g. "red-7-0"
  color: CardColor | "wild";
  value: CardValue;
}
```

Standard 108-card deck: per color, one `0`, two each of `1`–`9`, two `skip`, two `reverse`, two `draw2` (25 cards × 4 colors = 100), plus four `wild` and four `wild4` (108 total) — built by `createUnoDeck()` in `rules.ts`.

### Rules kept, rules simplified

Kept: color/value matching, draw-if-no-play, Skip, Reverse (including the 2-player "acts as Skip" case), Draw Two / Wild Draw Four forcing the next player to draw and lose their turn, Wild color choice, win-on-empty-hand.

Simplified, to keep the demo's scope proportional to what it's demonstrating (noted in code comments, not silently dropped): no "must call UNO" penalty for reaching one card, no challenge/contest mechanic on Wild Draw Four, no stacking Draw Two/Draw Four on each other, drawing a playable card ends the turn rather than allowing an immediate follow-up play, and the opening discard is redrawn if it's a Wild Draw Four but otherwise played as-is (including action cards, which have no special first-turn effect).

### Message shape (`types.ts`)

```ts
export type UnoControlMessage =
  | { type: "yourHand"; hand: UnoCard[] }
  | { type: "gameState"; state: PublicUnoState }
  | { type: "requestStart" }
  | { type: "playCard"; cardId: string; chosenColor?: CardColor } // chosenColor required for wild/wild4
  | { type: "drawCard" }
  | { type: "playAgain" };
```

### Console-side flow (`console.ts`)

- `startNextGame()`: builds `new Deck(createUnoDeck(), createRng(seed))`, deals 7 cards to each active player via `deck.drawMany(7)`, flips a starting card (redrawing if it's a `wild4`), sets `turnOrder = new TurnOrder(activePlayerIds)`, `roundFlow.transition("playing")`, sends each player their hand via the §3 pattern, and broadcasts public state.
- `handleControlMessage`: `playCard` validates it's the sender's turn (`turnOrder.isCurrent(fromId)`) and the card is legal (`isPlayable`, §1 of the card model) before removing it from their hand, discarding it, applying its effect, and calling the turn-advance logic below; `drawCard` validates turn ownership, draws one card into the sender's hand, and advances the turn.
- Turn-advance logic (`advanceAfterCard(card)`) composes `TurnOrder` primitives per the effect:
  - Reverse: `turnOrder.reverse()`, then the normal advance below; if exactly 2 players remain, one *additional* `advance()` (equivalent to a Skip, per standard Uno rules).
  - Skip: normal advance, then one additional `advance()`.
  - Draw Two / Wild Draw Four: advance to the victim, give them `2`/`4` cards via `deck.drawMany`, send their updated hand, then advance again past them.
  - Everything else: a single `advance()`.
- Win check after every `playCard`: if the player's hand is now empty, `roundFlow.transition("roundOver")` and record the winner; `playAgain` (gated to the first player, same pattern as `liars-dice`'s `nextRound`) calls `startNextGame()` again.
- Persistence via `saveGameState`/`loadGameState`: `{ deck: deck.toJSON(), hands: Object.fromEntries(hands), turnOrder: turnOrder.toJSON(), roundFlow: roundFlow.toJSON(), activeColor, roundSeed, winner }`, restored with `Deck.fromJSON(state.deck, createRng(state.roundSeed))`.

### Controller-side flow (`controller.ts` / `UnoController.tsx`)

Mirrors `LiarsDiceController.tsx`'s structure: `usePeerControlMessage` handles `yourHand`/`gameState`; renders the player's hand as tappable cards (dimmed/disabled when not their turn or a card isn't legally playable given the current `topCard`/`activeColor`); tapping a `wild`/`wild4` card opens an inline 4-color picker before sending `playCard` with `chosenColor`; a Draw button sends `drawCard` when it's the player's turn and they have no legal play.

## Summary: what's new where

| File | Addition |
|---|---|
| `src/utils/deck.ts` | new — `Deck<T>` class (§1) |
| `src/utils/deck.test.ts` | new — unit tests: shuffle determinism given a seed, draw-pile exhaustion reclaiming the discard pile minus its top card, `drawMany` truncating gracefully when cards run out |
| `src/examples/uno/types.ts` | new — `UnoCard`, phase/state types, `UnoControlMessage` union |
| `src/examples/uno/rules.ts` | new — `createUnoDeck()`, `isPlayable()`, effect-resolution helpers |
| `src/examples/uno/rules.test.ts` | new — deck composition (108 cards, right color/value counts), `isPlayable` matrix, 2-player reverse-as-skip case |
| `src/examples/uno/console.ts` | new — game loop, turn/effect handling, persistence (this doc §4) |
| `src/examples/uno/controller.ts` | new — mounts `UnoController` |
| `src/examples/uno/UnoConsole.tsx` | new — shared-screen view: discard pile, active color, player list with card counts, turn indicator |
| `src/examples/uno/UnoController.tsx` | new — hand view, color picker for wilds, draw button |
| `src/examples/registry.ts` | add `"uno"` entry |
