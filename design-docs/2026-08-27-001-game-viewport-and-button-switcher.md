# Game Viewport Contract + Button Switcher

Status: proposed
Author: (drafted with Claude, for Jules to implement)
Related docs: `2026-08-24-core-architecture.md`, `2026-08-25-example-switcher-and-liars-dice.md`,
`2026-08-25-multi-framework-game-contract.md`, `2026-08-25-pixi-canvas-games.md`,
`2026-08-26-world-primitives.md`

## Goal

Four related changes to how the console hosts an active example/game:

1. **Each game owns its own canvas/DOM subtree.** Right now every example
   reaches out into shared, host-owned markup (`#touch-canvas`, `#demo-view`,
   `.canvas-container`) and mutates it — hiding headings, toggling display
   styles, hunting for `.canvas-container` with `document.querySelector`.
   That stops. Each game gets an empty container element it exclusively
   owns, creates whatever it wants inside it, and cleans up after itself.
2. **The switcher is a list of buttons**, not the current `<select>`
   dropdown in `DemoSwitcher.astro`.
3. **Once a game is chosen, it fills the entire viewport** except for a
   persistent top bar (today's "Add Players" control). No more centered,
   `max-width`-boxed demo area — the game gets the full remaining screen,
   edge to edge.
4. **Each game manages its own layout within that full space**, because
   "full space" means different things to different games: a React game
   might constrain itself with `margin-inline: auto; inline-size: <N>px`
   inside the space it's given, while a canvas game centers/letterboxes its
   own fixed-aspect content. To do either, a game needs to know how big its
   space is up front, and to learn when that changes.

This is a host-side + example-migration change. It touches `src/host/`,
`src/contract/`, `src/pages/index.astro`, `src/components/`, and all four
examples' console-side code (`touch-demo`, `flappy-royale`, `grid-dungeon`,
`liars-dice`). It does not touch the controller side, the signaling DO, or
`src/logic/` (state 2 games get this contract for free once they exist,
same as any other example).

## Current state (what's actually wrong today)

Reading `src/pages/index.astro` and all four `src/examples/*/console.ts`
files, every single example repeats the same dance in `createGame()`:

```ts
const demoView = document.getElementById("demo-view");
if (demoView) {
  demoView.classList.remove("u-hidden");
  const heading = demoView.querySelector("h2");
  if (heading && heading.textContent === "Live Touch Visualization") {
    heading.textContent = "Flappy Royale"; // or hide it, or rename it
  }
  const canvasContainer = demoView.querySelector(".canvas-container");
  if (canvasContainer) (canvasContainer as HTMLElement).style.display = "block"; // or "none"
}
const touchCanvas = document.getElementById("touch-canvas") as HTMLCanvasElement | null;
if (touchCanvas) touchCanvas.style.display = "none"; // hide the demo's own canvas
const canvas = document.createElement("canvas");
document.querySelector(".canvas-container")?.appendChild(canvas);
```

This is fragile in ways that are already visible in the diffs between
examples: each one guesses at the previous example's leftover DOM state
(`heading.textContent === "Live Touch Visualization"`, `originalTouchCanvasDisplay`
save/restore) rather than starting from a clean slate. It also means the
"canvas" concept is really one shared canvas plus three different games
fighting over who gets to use it, which is exactly backwards from
`2026-08-25-multi-framework-game-contract.md`'s point that `createGame`
should be paradigm-agnostic.

Layout-wise, `#demo-view` is `max-width: 900px` and `.canvas-container` is
`aspect-ratio: 4/3` inside a `console-shell` that's centered with
`u-guttered-lg` padding. Every game is boxed into the same small centered
rectangle regardless of whether it wants that (touch-demo, flappy-royale,
grid-dungeon all would rather have the full screen) or wants something
narrower and centered (liars-dice, which fights the box by disabling
`.canvas-container` and injecting its own `<div id="liars-dice-console">`
sibling inside `#demo-view` anyway).

Resize handling is also duplicated and leaky: `touch-demo` and
`flappy-royale` both call `window.addEventListener("resize", ...)`
directly (cleaned up in `destroy()` per the multi-framework doc, but still
each game independently deciding it needs a `window` listener at all).
`grid-dungeon`'s canvas has a hardcoded `800×600` backing store stretched
via CSS `width:100%; height:100%`, which is blurry on anything that isn't
exactly 4:3.

## Non-goals

- No changes to the controller side (`src/pages/index.astro`'s controller
  shell, `#touch-surface`, `src/host/controller.ts`). Controllers don't
  have the "shared canvas fought over by examples" problem today, and a
  matching controller-side viewport contract can be its own doc later if
  it turns out to be needed.
- No changes to `GameSession.ts`, `signaling-api.ts`, the capnweb RPC
  protocol, or `saveGameState`/`loadGameState`.
- No new example. This is purely a contract + migration change applied to
  the four that already exist.
- No redesign of the room-code modal, QR flow, or join-by-code form beyond
  relocating the "Add Players" trigger into the new top bar.
- Not attempting a controller-parity "full viewport" layout — that's a
  separate, controller-scoped concern if it comes up.

## 1. Markup: a persistent top bar + a full-bleed game viewport

`src/pages/index.astro`'s console branch changes from a padded, centered
`console-shell` to a two-region flex layout: a fixed-height top bar and a
game viewport that consumes all remaining space.

```html
<main class="console-shell">
  <header id="console-topbar" class="console-topbar">
    <span class="room-code-chip">Room <strong id="room-code-inline">----</strong></span>
    <button id="add-players-btn" class="add-players-btn u-hidden" type="button">
      Add Players
    </button>
  </header>

  <div id="game-viewport" class="game-viewport">
    <!-- Shown until a game has been chosen/loaded -->
    <div id="start-screen" class="start-screen l-stack l-space-m">
      <button id="new-game-btn" class="btn-new-game" type="button">New Game</button>
      <ExampleSwitcher />
    </div>

    <!-- Empty on load. Host creates/clears this; games own everything inside it. -->
    <div id="game-surface" class="game-surface u-hidden"></div>
  </div>

  <!-- mobile-console and #room-modal are unchanged -->
</main>
```

`#touch-canvas`, `#demo-view`, `.canvas-container`, and the `<h2>` heading
that examples used to rewrite are all deleted from the markup — there is
no more shared game-rendering DOM for an example to find or repurpose.

```css
.console-shell {
  height: 100dvh; /* not min-height: dvh handles mobile chrome better than vh */
  display: flex;
  flex-direction: column;
}
.console-topbar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-inline: 1rem;
  block-size: 3.5rem;
}
.game-viewport {
  flex: 1 1 auto;
  min-height: 0; /* required for a flex child to actually shrink/scroll properly */
  position: relative;
  overflow: hidden;
}
.game-surface {
  position: absolute;
  inset: 0;
}
```

The old `.add-players-btn { position: fixed; top: 1rem; right: 1rem; }` is
deleted — it's a normal flex item inside `.console-topbar` now, which is
what makes "full viewport minus the top bar" an exact, reliable
`calc`-free measurement instead of an overlay floating on top of content.

The pre-game `start-screen` (New Game button + switcher) lives inside
`#game-viewport` too, so the transition from "no game chosen" to "game
running" is just swapping which child of `#game-viewport` is visible, not
a structural change.

## 2. The switcher: buttons instead of a `<select>`

`DemoSwitcher.astro` becomes `ExampleSwitcher.astro` (rename optional but
recommended — "demo" stops being accurate once `src/logic/` games can also
be run this way in the future):

```astro
---
import { EXAMPLES } from '@examples/registry';
---
<div class="example-switcher" role="list">
  {Object.entries(EXAMPLES).map(([id, example]) => (
    <button type="button" class="example-btn" data-example-id={id} role="listitem">
      {example.label}
    </button>
  ))}
</div>

<script>
  const buttons = document.querySelectorAll<HTMLButtonElement>(".example-btn");
  const saved = localStorage.getItem("selected_example");

  function markSelected(id: string) {
    for (const btn of buttons) {
      btn.setAttribute("aria-pressed", String(btn.dataset.exampleId === id));
    }
  }
  if (saved) markSelected(saved);

  for (const btn of buttons) {
    btn.addEventListener("click", () => {
      const id = btn.dataset.exampleId!;
      localStorage.setItem("selected_example", id);
      markSelected(id);
      window.dispatchEvent(new CustomEvent("example-changed", { detail: { exampleId: id } }));
    });
  }
</script>
```

The `example-changed` event name/payload is unchanged, so
`ConsoleApp.setupUIHandlers()`'s existing listener in `src/host/console.ts`
needs no changes at all — this section is purely a markup/CSS swap plus
`aria-pressed` for the visually-selected state that a `<select>` got for
free. `switcherState.ts`'s `getSelectedExampleId()`/`exampleIdFromJoinUrl()`
are untouched.

## 3. The viewport contract: `ConsoleContext.viewport`

New shared types in `src/contract/gameTypes.ts` (which already holds
`ConsoleGameInstance`/`ControllerGameInstance` from the multi-framework
doc):

```ts
export interface ViewportSize {
  width: number;
  height: number;
}

export interface GameViewport {
  /**
   * Empty element this game exclusively owns for the duration of its
   * createGame() call. Append canvases, mount React roots, set innerHTML —
   * whatever the game needs. Must be emptied/unmounted in destroy().
   */
  container: HTMLElement;
  /** Size of `container`, in CSS pixels, at the moment createGame() ran. */
  initialSize: ViewportSize;
  /**
   * Subscribe to later size changes (window resize, orientation change,
   * top bar height changing, etc). Returns an unsubscribe function — call
   * it from the game's destroy().
   */
  onResize: (callback: (size: ViewportSize) => void) => () => void;
}

export interface ConsoleContext {
  session: RpcStub<ConsoleApi> | null;
  peers: Map<string, ControllerPeer>;
  viewport: GameViewport;
}
```

`ConsoleContext` and `ControllerPeer` today are redeclared nearly
identically in every example (`flappy-royale/console.ts`,
`grid-dungeon/console.ts`, `liars-dice/console.ts` each have their own
copy). Since this change already touches every example's `ConsoleContext`
usage, fold these into `src/contract/gameTypes.ts` as the single source of
truth and have examples `import type { ConsoleContext } from
"@contract/gameTypes"` instead of re-declaring it. This is a
drive-by cleanup, not new scope — flag it in the PR description as such.

### Host side: `src/host/console.ts`

`ConsoleApp` gets a `resizeSubscribers` slot (only one game is ever active
at a time, but model it as a `Set<(size: ViewportSize) => void>` so
`onResize` can be called defensively more than once without surprises) and
a single `ResizeObserver` on `#game-viewport` — not `window` — since the
viewport region's size is what actually matters (top bar height, safe-area
insets, and any future sidebar are all already baked into that element's
box, so games never need to know about them):

```ts
private resizeSubscribers = new Set<(size: ViewportSize) => void>();
private resizeObserver: ResizeObserver | null = null;

private ensureResizeObserver() {
  if (this.resizeObserver) return;
  const viewportEl = document.getElementById("game-viewport");
  if (!viewportEl) return;
  let pending: ViewportSize | null = null;
  this.resizeObserver = new ResizeObserver((entries) => {
    const box = entries[0]?.contentBoxSize?.[0];
    if (!box) return;
    pending = { width: box.inlineSize, height: box.blockSize };
    requestAnimationFrame(() => {
      if (!pending) return;
      const size = pending;
      pending = null;
      for (const cb of this.resizeSubscribers) cb(size);
    });
  });
  this.resizeObserver.observe(viewportEl);
}

async initGame() {
  try {
    this.activeGame?.destroy?.();
    this.resizeSubscribers.clear();

    const surface = document.getElementById("game-surface")!;
    surface.innerHTML = ""; // belt-and-suspenders even though destroy() should have cleared it
    surface.classList.remove("u-hidden");
    document.getElementById("start-screen")?.classList.add("u-hidden");

    this.ensureResizeObserver();
    const rect = surface.getBoundingClientRect();

    const { createGame } = await loadConsoleGame();
    this.activeGame = createGame({
      session: this.api,
      peers: this.controllers,
      viewport: {
        container: surface,
        initialSize: { width: rect.width, height: rect.height },
        onResize: (cb) => {
          this.resizeSubscribers.add(cb);
          return () => this.resizeSubscribers.delete(cb);
        },
      },
    });
    // ...unchanged gameLoop setup...
  } catch (err) {
    console.error("Failed to load console game:", err);
  }
}
```

`requestAnimationFrame`-coalescing the `ResizeObserver` callback matters:
without it, a burst of `ResizeObserver` entries during, e.g., a mobile
browser's address-bar show/hide animation would fire the game's resize
handler many times per second for a change that only matters once
settled.

## 4. Migrating the four examples

None of these need new features — each is a subtraction of DOM-scavenging
code plus using `ctx.viewport` instead of `window`/hardcoded sizes.

| Example | Before | After |
|---|---|---|
| `touch-demo/console.ts` | Draws into `#touch-canvas`; own `resizeCanvas`/`window.addEventListener("resize", ...)` | Creates its own `<canvas>`, appends to `ctx.viewport.container`, sizes from `ctx.viewport.initialSize`, updates via `ctx.viewport.onResize` |
| `flappy-royale/console.ts` | Hides `#touch-canvas`, reveals `.canvas-container`, appends a Pixi canvas there | Appends Pixi canvas straight into `ctx.viewport.container`; `Application.init({ resizeTo: ... })` replaced with `resizeTo: false` + explicit `app.renderer.resize(w, h)` driven by `ctx.viewport.onResize`, seeded from `initialSize` — keeps the existing `applyWorldScale` centering/letterboxing logic (`resizeAndCenter` around `WORLD_WIDTH`/`WORLD_HEIGHT`) exactly as-is, since that's already "a canvas game centering its own content" |
| `grid-dungeon/console.ts` | Fixed `canvas.width = 800; canvas.height = 600` stretched via CSS to `100%`/`100%` | Canvas backing store set from `ctx.viewport.initialSize` (× `devicePixelRatio`), updated on `ctx.viewport.onResize`; room content (fixed `ROOM_WIDTH × ROOM_HEIGHT` at `TILE_SIZE`) is letterboxed/centered inside whatever space is available via a scale+translate in the existing `Camera`/draw step, rather than relying on CSS to stretch a fixed bitmap — this also fixes the existing blurriness bug as a side effect |
| `liars-dice/console.tsx` | Builds a nested `#liars-dice-console` div inside the shared `#demo-view`, disabling `.canvas-container` | `createRoot(ctx.viewport.container)` directly; `LiarsDiceConsole`'s outer wrapper gets `style={{ inlineSize: "min(720px, 100%)", marginInline: "auto" }}` so the board is centered with a comfortable reading width instead of stretching edge-to-edge on a wide monitor — this is the concrete "React game manages its own layout" case from the goal. Size/resize aren't needed for its own layout (it's CSS-driven, not pixel-driven), but `ctx.viewport` is still accepted for contract consistency and future use (e.g. a board-size breakpoint) |

Every example's `destroy()` (added per the multi-framework doc) now also
has less to clean up: no more `originalTouchCanvasDisplay` save/restore,
no more `window.removeEventListener("resize", ...)` (that subscription
moved to the host-owned `ResizeObserver`, unsubscribed via the function
`ctx.viewport.onResize` returned).

## Summary: what's new/changed where

| File | Change |
|---|---|
| `src/pages/index.astro` | Console markup restructured into `.console-topbar` + `#game-viewport` (`#start-screen` + `#game-surface`); `#touch-canvas`/`#demo-view`/`.canvas-container` deleted; layout CSS rewritten to full-bleed flex instead of padded/centered/`max-width` boxes |
| `src/components/DemoSwitcher.astro` → `ExampleSwitcher.astro` | `<select>` replaced with a list of `<button>`s; same `example-changed` event/payload |
| `src/contract/gameTypes.ts` | New `ViewportSize`, `GameViewport` types; `ConsoleContext` (and `ControllerPeer`) centralized here instead of redeclared per example |
| `src/host/console.ts` | `ResizeObserver` on `#game-viewport`, rAF-coalesced fan-out to the active game's `onResize` subscribers; `initGame()` builds and passes `viewport` into `createGame()`; clears/re-shows `#game-surface`/`#start-screen` |
| `src/examples/touch-demo/console.ts` | Own canvas appended to `ctx.viewport.container`; drops `window` resize listener |
| `src/examples/flappy-royale/console.ts` | Own canvas appended to `ctx.viewport.container`; Pixi driven by `ctx.viewport.initialSize`/`onResize` instead of `resizeTo`/`window` |
| `src/examples/grid-dungeon/console.ts` | Own canvas appended to `ctx.viewport.container`, backing store sized from `ctx.viewport`; room letterboxed/centered in draw logic instead of CSS-stretched |
| `src/examples/liars-dice/console.tsx`, `LiarsDiceConsole.tsx` | Mounts directly into `ctx.viewport.container`; outer wrapper self-constrains width via `margin-inline: auto; inline-size: ...` |

## Acceptance criteria

- The switcher renders as a list of buttons (no `<select>` anywhere in the
  console markup); selecting one still round-trips through
  `localStorage`/`example-changed` exactly as today.
- With any example active, the game visually fills 100% of the viewport
  below a persistent top bar; no centered box, no `max-width`-constrained
  demo area remains for touch-demo/flappy-royale/grid-dungeon.
- `grep` for `touch-canvas`, `demo-view`, or `canvas-container` across
  `src/examples/**` returns nothing.
- `grep` for `window.addEventListener("resize"` across `src/examples/**`
  returns nothing — all resize handling goes through
  `ctx.viewport.onResize`.
- Resizing the browser window updates the active example's rendered
  content within roughly one animation frame of the resize settling.
- `grid-dungeon`'s canvas is crisp at any window size (backing store
  matches device pixels), not stretched from a fixed `800×600` buffer.
- `liars-dice`'s board is centered with a bounded width on a wide desktop
  window, while the other three examples fill edge-to-edge.
- Switching examples via the button switcher correctly tears down the
  previous example's DOM/canvas/React root (via existing `destroy()`) and
  leaves `#game-surface` empty before the next example mounts.

## Open questions for Jules to flag if encountered (not to resolve unilaterally)

- Whether `#console-topbar` should always show the room code, or only
  after the modal has been opened once (today's "Add Players" button only
  appears after the modal is first closed) — pick whichever matches
  today's reveal timing most closely and flag the choice.
- `ResizeObserver` coalescing strategy: this doc suggests a single
  `requestAnimationFrame` per burst; if that produces visible jank on any
  test device, a small debounce (e.g. 50ms) is an acceptable substitute —
  flag which was used.
- Whether `flappy-royale`'s Pixi canvas should keep its own internal
  `resizeTo` behavior alongside `ctx.viewport.onResize` (belt-and-suspenders,
  slightly redundant) or switch fully to the host-driven callback
  (cleaner, single source of truth) — this doc recommends the latter, but
  if Pixi's built-in resize handling turns out to fight with it, flag
  what was chosen instead.
