# Pixi.js as a Rendering Backend for Canvas Games

## Scope

A fifth addendum, alongside the first-player, resilience, controller-naming, and multi-framework-contract docs. Where that last doc established `ConsoleGameInstance { tick?, render?, destroy? }` as a paradigm-agnostic seam and worked through React as one option, this doc works through a second option for the same seam: Pixi.js as a WebGL-accelerated replacement for hand-rolled Canvas2D, specifically for continuous-simulation games in the Flappy Royale mold.

This is not a proposal to migrate Flappy Royale wholesale, nor to add Pixi as a baseline dependency. It's a pattern for games that want it. Touch Demo should stay exactly as it is — it's a minimal plumbing-verification demo and shouldn't gain a rendering dependency it doesn't need. Flappy Royale is the natural candidate to actually demonstrate the pattern, since it's already the template's one continuously-simulated, effects-friendly example.

The controller side is unaffected. Flappy Royale's controller (`src/examples/flappy-royale/controller.ts`) has no canvas at all today — it's a full-screen DOM button rendered via `innerHTML`, same as every other controller UI in the template. Everything below is console-only.

## 1. Why Pixi over raw Canvas2D, for this class of game specifically

- **Retained-mode scene graph instead of immediate-mode redraw.** Today's `render(alpha)` clears the whole canvas and redraws every bird and pipe from scratch, every frame, via `ctx2d.arc`/`fillRect` calls. Pixi's model is: create a display object per entity once, then just mutate `.x`/`.y`/`.rotation`/`.alpha` on it each frame. Less redundant work, and the code reads as "update state" rather than "reissue draw commands."
- **WebGL batching gives cheap headroom for effects** — particles on a pipe pass, a bird trail, screen shake on death — the kind of "feels like a real party game" polish that's expensive to hand-roll efficiently with per-frame Canvas2D primitive calls, especially once there are a dozen birds and a screen full of pipes.
- **Built-in `Text`, `Graphics`, and interaction APIs** remove some manual bookkeeping (`ctx2d.textAlign`, manual hit-testing) without requiring a bundled asset pipeline — everything here can still be drawn procedurally with `Graphics`, no sprite sheets required, so the template stays asset-free.

## 2. Fitting into the `ConsoleGameInstance` contract — no host changes

The whole point of the `tick`/`render`/`destroy` contract from the previous doc is that the host doesn't need to know what's inside. Pixi fits directly:

```ts
// src/examples/flappy-royale/console.ts
import { Application, Graphics } from "pixi.js";

export function createGame(ctx: ConsoleContext): ConsoleGameInstance {
  let app: Application | null = null;
  let ready = false;
  const birdSprites = new Map<string, Graphics>();

  const canvas = document.createElement("canvas"); // see §4 — deliberately not #touch-canvas
  document.querySelector(".canvas-container")?.appendChild(canvas);

  const init = new Application()
    .init({ canvas, resizeTo: canvas.parentElement ?? undefined, autoStart: false, backgroundAlpha: 0 })
    .then(a => { app = a; ready = true; });

  return {
    tick: (dt) => { /* unchanged simulation logic from today, still framework-agnostic */ },
    render: (alpha) => {
      if (!ready || !app) return; // still initializing — see note below
      syncBirdSprites(app, birdSprites, currentState, alpha);
      app.render();
    },
    destroy: () => {
      init.then(() => app?.destroy(true, { children: true, texture: true })); // see §3
    },
  };
}
```

Two deliberate choices worth calling out:

- **`Application.init()` is async in Pixi v8, but `createGame()`'s signature stays synchronous.** Rather than changing `ConsoleApp.initGame()` to `await createGame(...)` — which would ripple into every other example's contract for one game's implementation detail — `createGame` returns its `{tick, render, destroy}` object immediately and gates on a `ready` flag internally. `tick` can usually run unconditionally (it's pure simulation, no Pixi dependency); `render` just no-ops until `ready` flips. A couple of skipped frames during the ~one-time async init is invisible in practice.
- **`autoStart: false`, and the host calls `app.render()` itself** inside `render(alpha)`. Pixi's `Application` normally runs its own internal ticker and renders on its own schedule. Leaving that on would mean two render loops fighting over the same canvas — the host's `createFixedTickLoop` and Pixi's own `app.ticker`. Disabling Pixi's autoplay and driving `app.render()` from the host's existing `onRender(alpha)` callback keeps the fixed-tick loop as the single source of truth for cadence, and keeps the interpolation pattern (§7) intact.

## 3. `destroy()` moves from "good hygiene" to load-bearing

The previous doc's `destroy()` addition fixed a leak (a stray `resize` listener) that was mostly harmless. For Pixi, skipping it isn't just a leak — it's a hard resource limit. Browsers cap the number of *concurrent WebGL contexts* per page (commonly somewhere around a dozen to sixteen, browser-dependent); once exhausted, new `getContext("webgl2")` calls start failing or the browser silently evicts the oldest context (`webglcontextlost`). Switching between examples repeatedly — or even just re-initializing the same game via a "restart" action — without releasing the previous `Application`'s context will eventually break rendering with no obvious error message pointing at the cause.

`app.destroy(true, { children: true, texture: true })` releases the WebGL context along with every display object and texture it owns. This must run inside `destroy()`, and — since `Application.init()` is async — it has to wait for that init to resolve first if a switch happens mid-initialization (shown in the sketch above via `init.then(...)`), so a rapid double-switch doesn't try to destroy an `app` that doesn't exist yet.

## 4. Don't reuse `#touch-canvas` — give Pixi its own canvas element

`index.astro` has one static `<canvas id="touch-canvas">`, currently grabbed by both Touch Demo and Flappy Royale via `getContext("2d")`. This is a real gotcha for a WebGL migration: **a canvas element's context type is sticky.** Once `getContext("webgl2")` (what Pixi requests) has been called on a given `<canvas>` node, that same node can no longer successfully return a `"2d"` context, and vice versa. If Flappy Royale's Pixi `Application` took over `#touch-canvas` directly, switching to Touch Demo afterward would break Touch Demo's `getContext("2d")` call on that same element — and there's no clean recovery short of replacing the DOM node.

Two ways to avoid this; the second is the one that fits the "no host changes" principle:

- **(Rejected) Recreate the canvas element on every switch.** Works, but means `index.astro`/`console.ts` needs new logic to detect a context-type change and swap the node — real host-level plumbing added for one game's rendering choice.
- **(Recommended) Pixi-based games create and own their own `<canvas>` element**, appended into the existing `.canvas-container` div (which already exists in `index.astro` and currently just wraps `#touch-canvas`) and removed in `destroy()`. This is exactly the same instinct as React games targeting the generic `#touch-surface` container rather than fighting over a game-specific element — the shared static markup provides *containers*, and each game decides what goes inside. `#touch-canvas` stays reserved for Canvas2D games; any WebGL/Pixi game brings its own canvas.

```ts
const canvas = document.createElement("canvas");
document.querySelector(".canvas-container")?.appendChild(canvas);
// ... on destroy():
canvas.remove();
```

## 5. World-to-screen scaling collapses to one transform

Today's Canvas2D draw code manually recomputes `scaleX`/`scaleY` (mapping the fixed `WORLD_WIDTH`/`WORLD_HEIGHT` — 800×600 — sim coordinates from `sim.ts` onto the actual device-pixel canvas size) and applies it inline, per shape, on every draw call. With Pixi, this becomes a single transform set once, on resize, on a root container:

```ts
const world = new Container();
app.stage.addChild(world);

function applyWorldScale() {
  const scaleX = app.screen.width / WORLD_WIDTH;
  const scaleY = app.screen.height / WORLD_HEIGHT;
  world.scale.set(scaleX, scaleY);
}
applyWorldScale();
app.renderer.on("resize", applyWorldScale); // pairs with resizeTo from §2
```

Every bird/pipe display object then just uses raw world coordinates (`x: 150`, not `x: 150 * scaleX`) and gets scaled for free by being a child of `world`. This also means Pixi's `resizeTo` option (§2) can fully replace today's hand-rolled `resizeCanvas()` + manual `window.addEventListener("resize", ...)` — one less listener to worry about leaking, on top of the `destroy()` fix from the previous doc.

## 6. Retained-mode entity sync pattern

Rather than redrawing every bird from scratch each frame, maintain a `Map<id, Graphics>` synced against sim state — create on first appearance, update in place, remove when gone:

```ts
function syncBirdSprites(world: Container, sprites: Map<string, Graphics>, state: RoundState, alpha: number) {
  const seen = new Set<string>();

  for (const bird of Object.values(state.birds)) {
    seen.add(bird.id);
    let g = sprites.get(bird.id);
    if (!g) {
      g = new Graphics().circle(0, 0, BIRD_RADIUS).fill(bird.color);
      world.addChild(g);
      sprites.set(bird.id, g);
    }
    g.x = lerp(bird.prevX ?? bird.x, bird.x, alpha); // see §7
    g.y = lerp(bird.prevY ?? bird.y, bird.y, alpha);
    g.alpha = bird.alive ? 1 : 0.35; // dead birds fade instead of vanishing, matches today's spectator behavior
  }

  for (const [id, g] of sprites) {
    if (!seen.has(id)) {
      g.destroy();
      sprites.delete(id);
    }
  }
}
```

Pipes follow the identical pattern, keyed by pipe id instead of player id.

## 7. Interpolation still matters, and gets simpler to apply

The existing `render(alpha)` interpolation concept — smoothing motion between fixed-tick simulation steps — is unchanged in principle: `tick()` still needs to stash each entity's pre-step position (`prevX`/`prevY`) before advancing it, exactly as any Canvas2D implementation would. What changes is the *application* of that interpolation: instead of computing an interpolated point and issuing a fresh draw call with it, it's a plain property assignment on an object that already exists (`g.x = lerp(...)`, shown in §6). Same math, less ceremony.

## 8. Overlay text (lobby prompt, "eliminated," winner banner)

The previous doc noted that today's lobby/game-over text is drawn straight onto the canvas via `ctx2d.fillText`, which is part of why there's no natural "chrome" for a React wrapper to own without restructuring the game. Under Pixi, that text becomes a `Text` display object added to the stage instead of a raw `fillText` call — still living inside the same retained scene graph as the birds and pipes, not lifted out into DOM. This is a nice-to-have (automatic text metrics, no manual `ctx2d.textAlign`/`font` bookkeeping) rather than a structural change — it doesn't turn Flappy Royale into a React-chrome-friendly game, it's just a cleaner way to draw the same text that already lives inside the canvas today.

## 9. Bundle size, and why it's safe to add as a dependency

Pixi's core package is meaningfully heavier than the zero-dependency Canvas2D approach currently in use — order of a few hundred KB before compression. This is fine here specifically because `src/examples/registry.ts` already lazy-loads each example via dynamic `import()`:

```ts
"flappy-royale": {
  console: () => import("@examples/flappy-royale/console"),
  controller: () => import("@examples/flappy-royale/controller"),
},
```

A visitor who never selects Flappy Royale never fetches Pixi. The existing code-splitting contains the cost to the one example that opts in — no change needed there, it's already the right shape for this. Worth a line in the README, though, for anyone hand-porting this pattern into their own single-game project (STATE 2): if your one game uses Pixi, that cost is no longer optional-per-example, it's just part of your bundle — a fine trade for a real-time effects-heavy game, probably not worth it for something simpler.

## 10. What this doc deliberately doesn't cover

- **Sprite/texture assets.** Everything above uses `Graphics` (procedural shapes), matching Flappy Royale's current circles-and-rectangles look and keeping the template asset-free. A game that wants actual sprite art would add `Assets.load()` calls and a `public/` asset folder — straightforward, but a separate decision from "should this game use Pixi at all."
- **Controller-side Pixi.** No current example's controller draws to a canvas. If a future game wants a richer controller visual (an animated joystick, say), the same pattern from §4 applies symmetrically — the game creates and owns its own canvas inside `#touch-surface`, cleaned up in `destroy()` — but nothing today needs it.

## Summary: what's new where

| File | Addition |
|---|---|
| `package.json` | add `pixi.js` (v8) |
| `src/examples/flappy-royale/console.ts` | rewritten to create its own `<canvas>` in `.canvas-container` (§4), initialize a Pixi `Application` with `autoStart: false` (§2), drive `app.render()` from the existing `render(alpha)` hook, sync `Graphics` objects per bird/pipe each frame (§6–7), and release everything via `app.destroy()` in `destroy()` (§3) |
| `src/examples/flappy-royale/sim.ts` | unchanged — simulation stays framework-agnostic, only the console's rendering of it changes |
| `src/examples/flappy-royale/controller.ts` | unchanged (§ Scope) |
| README | note on Pixi's bundle-size trade-off for anyone adapting this pattern outside the lazy-loaded multi-example demo (§9) |
