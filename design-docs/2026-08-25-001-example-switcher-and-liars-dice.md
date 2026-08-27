# Example Switcher + Liar's Dice

Status: proposed
Author: (drafted with Claude, for Jules to implement)
Related docs: `2026-08-24-core-architecture.md`, `2026-08-24-framework-primitives.md`

## Goal

The template has two states, and the whole point of this change is to make
the transition between them as seamless as possible:

1. **As received by user of this template**: multiple examples are runnable out of the box, with a
   switcher letting you pick between them. This is what someone sees the
   first time they deploy the template.
2. **Once building for real**: examples and switcher are gone; your own
   game's logic lives in a fixed location the console/controller always
   load.

This doc specifies two phases:

1. **Phase 1** — build state 1 (touch-demo behind a switcher) and the
   transition mechanism into state 2, such that the transition is a small,
   mechanical, well-documented set of steps rather than an architectural
   unwind.
2. **Phase 2** — add Liar's Dice as a second example in state 1, proving the
   pattern works for a real game and not just the demo, without touching the
   transition mechanism from Phase 1.

Each phase should land as its own PR and be independently mergeable/revertable.
Do not start Phase 2 until Phase 1 is merged.

## Non-goals

- No changes to `src/lib/GameSession.ts`, `src/lib/signaling-api.ts`, or the
  capnweb RPC protocol.
- No changes to how room codes are minted or how the QR code links, beyond
  what's needed to also pick an example (Phase 1).
- No new persistence mechanism beyond the existing `saveGameState`/`loadGameState`.

## Design principle: the transition is a file swap, not a search-and-remove

The core idea: exactly **one small file** — `src/scripts/gameSource.ts` —
is the seam between state 1 and state 2. Everything specific to "loading via
the switcher/examples registry" lives inside that one file. Everything
specific to "loading your own game" is a two-line replacement of that same
file's contents. No env flags to track down, no query-param handling
scattered across bootstrap files, nothing to grep for elsewhere.

```ts
// src/scripts/gameSource.ts — STATE 1 (as received)
import { EXAMPLES, DEFAULT_EXAMPLE } from "@examples/registry";
import { getSelectedExampleId, exampleIdFromJoinUrl } from "@examples/switcherState";

export function loadConsoleGame() {
  return EXAMPLES[getSelectedExampleId() ?? DEFAULT_EXAMPLE].console();
}

export function loadControllerGame(joinUrl: URL) {
  return EXAMPLES[exampleIdFromJoinUrl(joinUrl) ?? DEFAULT_EXAMPLE].controller();
}
```

```ts
// src/scripts/gameSource.ts — STATE 2 (once you're building your own game)
// Replace the entire file above with this:
export function loadConsoleGame() {
  return import("@logic/console");
}

export function loadControllerGame() {
  return import("@logic/controller");
}
```

`src/scripts/console.ts` and `controller.ts` call `loadConsoleGame()` /
`loadControllerGame()` and never change across the transition. Neither does
`src/logic/` itself, which exists from the start (see 1c) — the transition
only ever touches `gameSource.ts`'s contents, deletes two things, and fills
in two already-scaffolded files.

---

## Phase 1: Touch-demo behind the switcher + the `gameSource.ts` seam

### 1a. Factor the generic bootstrap so it's shared and stable

`src/scripts/console.ts` and `controller.ts` currently mix generic plumbing
(QR rendering, connection-status UI, `join()`, `PeerConnection` setup) with
demo-specific behavior. Split so the generic part never has to change:

```ts
// src/scripts/console.ts
import { loadConsoleGame } from "./gameSource";

// ...existing QR/join/PeerConnection setup, unchanged from today...
const { createGame } = await loadConsoleGame();
const game = createGame({ session, peers });
createFixedTickLoop({ tickRate: 30, onTick: game.tick, onRender: game.render });
```

```ts
// src/scripts/controller.ts
import { loadControllerGame } from "./gameSource";

// ...existing join/PeerConnection setup, unchanged from today...
const { createGame } = await loadControllerGame(new URL(window.location.href));
createGame({ peerConnection });
```

The only thing that changed relative to today's files is: the demo-specific
logic is gone (moved to `src/examples/touch-demo/`, 1d) and replaced with a
call through `gameSource.ts`. Nothing else about these two files should need
to change in Phase 2 or during the eventual transition to state 2.

This establishes the `createGame` contract every game-logic module must
implement — console: `{ tick, render }`; controller: caller-defined handlers.

### 1b. `src/examples/` — registry, switcher state, and touch-demo

```
src/examples/
├── registry.ts        # EXAMPLES map + DEFAULT_EXAMPLE
├── switcherState.ts    # getSelectedExampleId(), exampleIdFromJoinUrl(url)
└── touch-demo/
    ├── console.ts       # dot-drawing render, {type:'touch',...} handling
    └── controller.ts     # touch/pointer capture + input-channel sends
```

`registry.ts`:
```ts
export const EXAMPLES = {
  "touch-demo": {
    label: "Touch Demo",
    console: () => import("@examples/touch-demo/console"),
    controller: () => import("@examples/touch-demo/controller"),
  },
} as const;

export type ExampleId = keyof typeof EXAMPLES;
export const DEFAULT_EXAMPLE: ExampleId = "touch-demo";
```
Use dynamic `import()` per entry so the eventual state-2 build (which
deletes this file) never needed the unused examples bundled in the first
place.

`switcherState.ts` holds the two small pieces of state-1-only logic:
- `getSelectedExampleId()`: reads whatever the switcher UI (1c) last set
  (e.g. an in-memory/URL-driven value used at room-code mint time).
- `exampleIdFromJoinUrl(url)`: reads the `game` param appended to the join
  URL (see 1c) so a controller loads the same example the console picked.

Add `@examples` and `@logic` path aliases alongside the existing `@utils`,
`@components`, etc.

### 1c. Switcher UI

Create `src/components/DemoSwitcher.astro`: a dropdown over
`Object.entries(EXAMPLES)`, shown on the console before room-code creation
(this is the default state-1 experience — no env flag gating it). Selecting
an entry is what `getSelectedExampleId()` reads, and is also appended as
`&game=<id>` when the console mints the QR join URL alongside the existing
`code` param.

### 1d. `src/logic/` — scaffolded now, filled in later

Create the stub files now, even though nothing loads them yet in state 1:

```
src/logic/
├── console.ts      # exports createGame({ session, peers }) -> { tick, render }
└── controller.ts    # exports createGame({ peerConnection }) -> handlers
```

Stub content: a minimal placeholder (e.g. render "Implement your game here —
see src/examples/ for reference and README.md for the transition steps") so
the file compiles and matches the `createGame` contract, ready to be
overwritten with real logic during the transition. These files are not
imported from anywhere in state 1 — they exist purely so the transition
(1e) is "fill in existing files" rather than "create new files."

### 1e. The transition (document in README, don't implement in this PR)

Add a README section, "Building your own game," spelling out the transition
from state 1 to state 2 as a fixed checklist:

1. Look through `src/examples/` for a reference implementation close to what
   you're building (currently: `touch-demo`), and try it via the switcher.
2. Implement `src/logic/console.ts` and `src/logic/controller.ts` per the
   `createGame` contract, using the framework primitives (`InputStateSync`,
   `createFixedTickLoop`, `createRng`, `sendControlCoalesced`,
   `rejoinToken`, `saveGameState`) — copying from the example you liked as a
   starting point is expected and fine.
3. Replace the contents of `src/scripts/gameSource.ts` with the two-line
   state-2 version shown at the top of this doc / in a comment at the top of
   the shipped `gameSource.ts` file itself.
4. Delete `src/examples/` and `src/components/DemoSwitcher.astro`.

Steps 3–4 are mechanical and order-independent; nothing outside
`gameSource.ts`, `src/examples/`, and `DemoSwitcher.astro` should need to
change. `console.ts`, `controller.ts`, and `src/logic/` are untouched by the
transition itself (logic/ was already filled in during step 2).

**Implementation note for this PR**: ship `gameSource.ts` with a clearly
marked comment block containing the exact state-2 replacement code, so step
3 above is copy-paste, not "reconstruct this from the README."

### 1f. README updates (Phase 1)

- In "What's already here," describe the new files: `gameSource.ts` as the
  seam between example-mode and your-game-mode; `src/examples/` as
  reference implementations plus the switcher; `src/logic/` as the
  (initially stubbed) location for your own game.
- Replace "Building a game on top of this" with the transition checklist
  from 1e.
- Add a short "Trying the examples" subsection: the switcher is the default
  experience out of the box, no setup needed; note that `touch-demo` is
  presently the only entry.
- Update step 4 of "Getting started": it should now describe seeing the
  switcher and picking `touch-demo` to see the live dot-tracking, rather
  than assuming a single hardcoded demo.

### Acceptance criteria (Phase 1)

- Fresh clone + `init.ts` + deploy shows the switcher by default; selecting
  `touch-demo` reproduces today's live dot-tracking demo end-to-end.
- `src/logic/console.ts`/`controller.ts` exist, compile, implement the
  `createGame` contract, and are not imported anywhere yet.
- Following the 4-step transition checklist by hand (with `src/logic/`
  filled in with a trivial placeholder game) results in a working build
  where the switcher and touch-demo no longer appear, with no edits needed
  outside `gameSource.ts`, `src/examples/`, and `DemoSwitcher.astro`.
- `src/scripts/console.ts` and `controller.ts` contain no references to
  `EXAMPLES`, the switcher, or any `game`/example URL param — all of that
  lives inside `gameSource.ts` and `src/examples/switcherState.ts`.
- README reflects the transition checklist and updated getting-started flow.

---

## Phase 2: Liar's Dice as a second example

Do not start until Phase 1 is merged and its acceptance criteria pass.

### 2a. Module layout

```
src/examples/liars-dice/
├── types.ts        # LiarsDiceState, Bid, Player, Phase, message shapes
├── rules.ts         # pure functions: isValidBid, countMatchingDice, resolveChallenge
├── console.ts        # createGame({ session, peers }) -> { tick, render }
└── controller.ts      # createGame({ peerConnection }) -> bid/challenge UI handlers
```

`rules.ts` must have no dependency on `PeerConnection`, the DO client, or any
DOM/canvas API — it should be plausible to unit test in isolation.

This is a second example for people to try via the switcher and copy from
during their own transition (1e) — it does not touch `gameSource.ts` or
`src/logic/`.

### 2b. Game behavior

- **Rolling**: use `createRng(seed)` (`src/utils/rng.ts`) to roll each
  player's dice. Generate and persist the seed at round start via
  `saveGameState` so a console refresh mid-round reproduces the same roll
  rather than reshuffling hands.
- **Private dice reveal**: each player's own roll is sent console→controller
  via one-shot `sendControl` (not coalesced, not broadcast) — same pattern
  the framework doc uses for identity assignment.
- **Bids and challenges**: controller→console actions ("bid 3 fours", "liar!")
  must arrive exactly once and in order — use plain `sendControl`, not the
  unreliable `input` channel.
- **State broadcast**: after each action, console pushes current bid /
  whose-turn-it-is to all controllers via `sendControlCoalesced('gameState', state)`
  per peer, since only the latest snapshot matters.
- **Turn timer**: implement via the `tick`/`render` hooks the `createGame`
  contract expects — countdown on `tick`, animation/render on `render`. On
  timeout, auto-resolve (e.g. auto-challenge or skip) per whatever default
  behavior is specified in `types.ts`.
- **Reconnects**: use the `rejoinToken` pattern (`join()`'s optional param) so
  a locked/refreshed phone keeps its `id`, dice, and turn slot instead of
  rejoining as a new player.
- **Persistence**: round number, seed, and per-player dice counts are saved
  via `saveGameState`/`loadGameState`, sharded across keys if needed to stay
  under the ~2MB cap.

### 2c. Registry entry

Add to `src/examples/registry.ts`:

```ts
"liars-dice": {
  label: "Liar's Dice",
  console: () => import("@examples/liars-dice/console"),
  controller: () => import("@examples/liars-dice/controller"),
},
```

No changes to `gameSource.ts`, `switcherState.ts`, `DemoSwitcher.astro`,
`src/scripts/console.ts`/`controller.ts`, or `src/logic/` should be
required — this is the test that Phase 1's seam holds under a second, more
complex example.

### 2d. README updates (Phase 2)

- Under "Trying the examples," list both `touch-demo` and `liars-dice` with
  a one-line description each (touch-demo: raw input plumbing; liars-dice:
  full turn-based game with private state, reconnects, and persistence).
- If `2b`'s design choices (rejoin tokens, coalesced state, seeded RNG) are
  useful as a second worked example beyond what's in
  `2026-08-24-framework-primitives.md`, add a short cross-reference from that
  doc to `src/examples/liars-dice/` rather than duplicating the explanation.

### Acceptance criteria (Phase 2)

- Selecting "Liar's Dice" from the switcher runs a full game: roll → bid →
  challenge → reveal → round end, across at least 2 controllers.
- A controller refresh mid-round rejoins with its prior dice/turn state
  intact (via `rejoinToken`), not as a new player.
- A console refresh mid-round reproduces the same dice roll (via the
  persisted seed) rather than re-rolling.
- `rules.ts` has no imports from `PeerConnection`/DO/DOM.
- `gameSource.ts` and `src/logic/` are unchanged by this phase.
- README updated per 2d.

## Open questions for Jules to flag if encountered (not to resolve unilaterally)

- Exact UX for the turn-timer timeout behavior (auto-challenge vs. auto-skip)
  isn't specified above beyond "pick a default" — flag the choice made in
  the PR description rather than silently deciding.
- Where `getSelectedExampleId()` stores the switcher's current pick
  (in-memory module state vs. a URL param on the console's own page) is an
  implementation detail — pick whichever is simplest given how
  `DemoSwitcher.astro` is wired, and flag the choice.
- Exact content of the `src/logic/` stub (message text, minimal styling) is
  not specified — keep it short, clearly labeled as a placeholder, and
  mention the transition checklist location.
