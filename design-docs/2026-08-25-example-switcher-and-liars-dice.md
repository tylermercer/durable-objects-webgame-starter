# Example Switcher + Liar's Dice

Related docs: `2026-08-24-core-architecture.md`, `2026-08-24-framework-primitives.md`

## Goal

Today the console/controller scripts hard-code the touch-tracking demo directly.
This doc specifies two phases of work:

1. **Phase 1** — extract the touch demo into `src/examples/touch-demo/`, add a
   registry + optional switcher UI so the console can pick which example runs,
   without changing any signaling/DO/WebRTC behavior.
2. **Phase 2** — build a Liar's Dice game in `src/examples/liars-dice/` as a
   second entry in that same registry, proving the pattern works for a real
   game and not just the demo.

Each phase should land as its own PR and be independently mergeable/revertable.
Do not start Phase 2 until Phase 1 is merged.

## Non-goals

- No changes to `src/lib/GameSession.ts`, `src/lib/signaling-api.ts`, or the
  capnweb RPC protocol.
- No changes to how room codes are minted or how the QR code links (aside from
  appending one query param — see Phase 1 below).
- No new persistence mechanism beyond the existing `saveGameState`/`loadGameState`.
- The switcher is a dev/demo convenience, not a production feature — it must
  be trivially removable (see "Removal" in Phase 1).

---

## Phase 1: Extract touch-demo + add switcher

### 1a. Move the demo into `src/examples/touch-demo/`

Create:
```
src/examples/touch-demo/
├── console.ts      # exports createGame({ session, peers }) -> { tick, render }
└── controller.ts    # exports createGame({ peerConnection }) -> controller handlers
```

Move the touch-tracking-specific logic currently inlined in
`src/scripts/console.ts` and `src/scripts/controller.ts` into these two files:

- Console side: the dot-drawing render loop, the `{type:'touch', phase, x, y}`
  handling, per-controller dot state.
- Controller side: touch/pointer capture and the `input`-channel send calls.

What must **stay** in `src/scripts/console.ts` / `controller.ts` (the generic
bootstrap): QR rendering, per-controller connection-status UI, `join()` /
signaling setup, `PeerConnection` construction, and the `createFixedTickLoop`
scaffold. Replace the demo's existing `startAnimationLoop` call with
`createFixedTickLoop({ tickRate: 30, onTick, onRender })`, wired to whatever
`console.ts`'s example module returns.

Each example module's console side must conform to this shape:

```ts
export function createGame(ctx: { session: GameSessionClient; peers: PeerConnection[] }): {
  tick: (dt: number) => void;
  render: (alpha: number) => void;
};
```

and controller side:

```ts
export function createGame(ctx: { peerConnection: PeerConnection }): {
  // whatever input handlers/UI hooks the example needs; touch-demo's will
  // just be pointer event bindings
};
```

This shape is what every future example (including Liar's Dice in Phase 2)
must implement.

### 1b. Add the registry

Create `src/examples/registry.ts`:

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

Use dynamic `import()` per entry (not static imports) so unused examples are
code-split out of a build that only ships one game.

Add a `@examples` path alias alongside the existing `@utils`, `@components`,
etc. aliases (astro.config.mjs / tsconfig.json), pointing at `src/examples`.

### 1c. Isolate all switcher logic in one resolver module

All switcher-specific logic — the env flag check, reading/writing the `game`
query param, and the registry lookup — must live in a single module that both
bootstrap files call into. Nothing switcher-related should be written
directly into `console.ts` or `controller.ts` beyond one call each. This is
what makes the switcher removable later without spelunking through both
bootstrap files (see 1f).

Create `src/examples/resolveExample.ts`:

```ts
import { EXAMPLES, DEFAULT_EXAMPLE, type ExampleId } from "./registry";

// Console: reads switcher UI state (if enabled) and returns the id to mint
// into the QR URL. Also responsible for appending `&game=<id>` to the join
// URL alongside the existing `code` param.
export function resolveExampleForConsole(): ExampleId { ... }

// Controller: reads `game` from the join URL. Falls back to DEFAULT_EXAMPLE
// if missing or unrecognized.
export function resolveExampleForController(url: URL): ExampleId { ... }

export function isSwitcherEnabled(): boolean {
  return import.meta.env.PUBLIC_ENABLE_DEMO_SWITCHER === "true";
}
```

The console already encodes the room code in the QR URL as `/?code=<CODE>`.
`resolveExampleForConsole` is responsible for the console-side half of
appending `&game=<EXAMPLE_ID>` to that URL when minting it; no DO or
signaling protocol changes are needed, since controllers already read the
join URL and `resolveExampleForController` handles the controller-side read.

### 1d. Switcher UI

Create `src/components/DemoSwitcher.astro`: a dropdown populated from
`Object.entries(EXAMPLES)`, rendered on the console before room-code creation,
shown only when `isSwitcherEnabled()` is true. Selecting an entry feeds the
choice `resolveExampleForConsole()` uses when minting the QR URL.

Gate the switcher behind an env flag:

```
PUBLIC_ENABLE_DEMO_SWITCHER=true
```

When the flag is false/unset, the console skips the dropdown entirely and
`resolveExampleForConsole()` returns `DEFAULT_EXAMPLE` — no UI, no branching
in `console.ts` itself.

### 1e. Bootstrap wiring

`src/scripts/console.ts` should contain exactly one call into the resolver,
no inline param/flag logic:

```ts
import { resolveExampleForConsole } from "@examples/resolveExample";
import { EXAMPLES } from "@examples/registry";

const gameId = resolveExampleForConsole();
const { console: loadConsole } = EXAMPLES[gameId];
const game = (await loadConsole()).createGame({ session, peers });
createFixedTickLoop({ tickRate: 30, onTick: game.tick, onRender: game.render });
```

`src/scripts/controller.ts`, same pattern:

```ts
import { resolveExampleForController } from "@examples/resolveExample";
import { EXAMPLES } from "@examples/registry";

const gameId = resolveExampleForController(new URL(window.location.href));
const { controller: loadController } = EXAMPLES[gameId];
const game = (await loadController()).createGame({ peerConnection });
```

No query-param parsing, env var checks, or registry fallbacks should appear
directly in either bootstrap file — if a review finds any, it belongs in
`resolveExample.ts` instead.

### 1f. Removal instructions (document, don't necessarily implement)

Add a section to the README (see below) explaining that the switcher can be
fully removed in three steps, with no changes needed inside
`console.ts`/`controller.ts` beyond swapping one import each:

1. Delete `src/components/DemoSwitcher.astro`.
2. Delete `src/examples/resolveExample.ts` (and trim `registry.ts` to a
   single entry, or delete it too).
3. In `console.ts` and `controller.ts`, replace the `resolveExampleForX()` +
   `EXAMPLES[gameId]` call with a static import of the chosen example
   module's `createGame`, e.g.
   `import { createGame } from "@examples/liars-dice/console"`.

No other files should need to change — if they do, that's a sign some
switcher logic leaked outside `resolveExample.ts` and should be moved back in.

### 1g. README updates (Phase 1)

- In "What's already here," update the Console app / Controller app rows to
  note that game logic now lives in `src/examples/<name>/`, and that
  `src/scripts/console.ts`/`controller.ts` are the generic bootstrap.
- In "Building a game on top of this," replace language about "replacing the
  demo's touch-tracking" with instructions to add a new folder under
  `src/examples/`, implement the `createGame` shape described above, and
  register it in `src/examples/registry.ts`.
- Add a new subsection, "Switching between examples," documenting:
  `PUBLIC_ENABLE_DEMO_SWITCHER`, the `game` URL param, `resolveExample.ts` as
  the single place switcher logic lives, and the removal steps from 1f.
- Update step 4 of "Getting started" (the initial demo smoke test) if the
  switcher changes how the demo is reached (it shouldn't, since
  `touch-demo` is the default).

### Acceptance criteria (Phase 1)

- Fresh clone + `init.ts` + deploy still reproduces the existing touch-dot
  demo end-to-end with no switcher UI visible (flag unset/false by default).
- Setting `PUBLIC_ENABLE_DEMO_SWITCHER=true` shows a dropdown with one entry
  ("Touch Demo") and functions identically to the flag-off case.
- No changes to `src/lib/GameSession.ts` or `src/lib/signaling-api.ts`.
- `console.ts` and `controller.ts` each contain exactly one call into
  `resolveExample.ts` and no inline env/query-param logic of their own.
- README reflects the new structure and includes removal instructions.

---

## Phase 2: Liar's Dice on top of the switcher

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
- **Turn timer**: implement via the `tick`/`render` hooks from
  `createFixedTickLoop` (already wired by the Phase 1 bootstrap) — countdown
  on `tick`, animation/render on `render`. On timeout, auto-resolve (e.g.
  auto-challenge or skip) per whatever default behavior is specified in
  `types.ts`.
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

No other bootstrap changes should be required — `resolveExample.ts` and both
bootstrap files should need zero edits to support this new entry. That's the
test that the Phase 1 abstraction is sufficient.

### 2d. README updates (Phase 2)

- Add a bullet or short subsection under "Building a game on top of this"
  (or a new "Examples" section) listing `touch-demo` and `liars-dice` as the
  two registered examples, with one line each on what they demonstrate
  (touch-demo: raw input plumbing; liars-dice: full turn-based game with
  private state, reconnects, and persistence).
- If `2b`'s design choices (rejoin tokens, coalesced state, seeded RNG) are
  useful as a second worked example beyond what's in
  `2026-08-24-framework-primitives.md`, add a short cross-reference from that
  doc to `src/examples/liars-dice/` rather than duplicating the explanation.

### Acceptance criteria (Phase 2)

- Selecting "Liar's Dice" from the switcher (or setting `game=liars-dice` in
  the join URL directly) runs a full game: roll → bid → challenge → reveal →
  round end, across at least 2 controllers.
- A controller refresh mid-round rejoins with its prior dice/turn state
  intact (via `rejoinToken`), not as a new player.
- A console refresh mid-round reproduces the same dice roll (via the
  persisted seed) rather than re-rolling.
- `rules.ts` has no imports from `PeerConnection`/DO/DOM.
- README updated per 2d.

## Open questions for Jules to flag if encountered (not to resolve unilaterally)

- Exact UX for the turn-timer timeout behavior (auto-challenge vs. auto-skip)
  isn't specified above beyond "pick a default" — flag the choice made in the
  PR description rather than silently deciding.
- Whether `DemoSwitcher.astro` should persist the selected example across a
  console refresh (e.g. via the room's own state) or reset to default each
  time — default to reset-each-time unless this becomes annoying in testing.
