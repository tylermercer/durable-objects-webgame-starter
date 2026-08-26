# Multi-Framework Game Contract (React + Imperative Canvas)

## Scope

A fourth addendum to `design-docs/2026-08-24-additional-primitives.md`, alongside the first-player, resilience, and controller-naming docs. This one answers a narrower question: how do we let a game like Liar's Dice be implemented in React while a game like Flappy Royale stays plain imperative canvas code, with neither one having to know the other paradigm exists — and without forcing a framework choice on games that don't benefit from it.

## 1. The existing seam, and the one gap in it

`createGame(ctx)` is already framework-agnostic in practice, even though nothing has needed that yet. `ConsoleApp.initGame()` calls it and only ever touches the two methods on the returned object:

```ts
this.activeGame = createGame({ session: this.api, peers: this.controllers });
this.gameLoop = createFixedTickLoop({
  tickRate: 30,
  onTick: (dt) => this.activeGame?.tick?.(dt),
  onRender: (alpha) => this.activeGame?.render?.(alpha),
});
```

It has no opinion about what's inside `createGame`'s closure — canvas drawing, `innerHTML` strings, a mounted React root, anything. The one thing missing is a way to clean up when a game goes away. Today, switching examples (`example-changed` → `initGame()` again) just calls `createGame()` again and lets the new game's setup overwrite the old one's DOM. That "works" only by accident, and it's already leaking:

- **Touch Demo** and **Flappy Royale** both call `window.addEventListener("resize", resizeCanvas)` in `createGame()` and never remove it. Switching away and back adds another listener each time.
- **Touch Demo**'s controller attaches four `pointerdown`/`pointermove`/`pointerup`/`pointercancel` listeners to `#touch-surface` and never removes them either.
- Controller's `createGame()` always returns `{}` — there's no cleanup hook there at all today, on either side.

None of this is React-specific. It's a real, pre-existing gap that just happens to become a hard requirement instead of a soft one once a game wants to mount a React root, since an unmounted-but-still-mounted React root reacting to a DOM node that's been overwritten out from under it is a much worse failure mode than a stray event listener.

## 2. The contract

```ts
// src/scripts/gameTypes.ts (new — shared by console.ts and controller.ts)
export interface ConsoleGameInstance {
  tick?: (dt: number) => void;
  render?: (alpha: number) => void;
  destroy?: () => void;
}

export interface ControllerGameInstance {
  destroy?: () => void;
}
```

`ConsoleApp.initGame()` and `ControllerApp.initiateWebRTC()` (or wherever controller games get created) both call `this.activeGame?.destroy?.()` before creating the next game instance, and again on any full teardown (page navigation, `pc.close()`). Two lines of change on the host side; every game gets clean teardown as a side effect, not an opt-in.

**`tick` vs. `render` is the actual split point between paradigms**, and it's worth naming explicitly:

- `tick(dt)` is simulation — turn timers, physics steps, anything that should advance regardless of how it's painted. Every game needs this, React or not. Liar's Dice's bidding countdown is a `tick()` concern whether the board is drawn with `innerHTML` or React.
- `render(alpha)` is an imperative paint call, driven by the host's fixed-tick clock. Canvas games need it because that's the only way pixels get drawn. A React game **omits it entirely** — React re-renders on its own schedule, triggered by state changes, not by the host's `requestAnimationFrame` loop. Returning `{ tick, destroy }` with no `render` is a completely valid, expected shape under this contract.

## 3. Canvas / imperative games: no change to their code, just a real `destroy()`

Flappy Royale and Touch Demo need exactly one addition each — actually removing the listeners they already attach:

```ts
// src/examples/flappy-royale/console.ts
export function createGame(ctx: ConsoleContext): ConsoleGameInstance {
  const canvas = document.getElementById("touch-canvas") as HTMLCanvasElement | null;
  // ... existing setup, unchanged ...

  function resizeCanvas() { /* unchanged */ }
  window.addEventListener("resize", resizeCanvas);

  return {
    tick: (dt) => { /* unchanged */ },
    render: (alpha) => { /* unchanged */ },
    destroy: () => window.removeEventListener("resize", resizeCanvas),
  };
}
```

Same pattern for Touch Demo's console (`resize` listener) and controller (`pointerdown`/`pointermove`/`pointerup`/`pointercancel` on `#touch-surface`, plus canceling any pending `requestAnimationFrame`). This is a bug fix that was going to be worth doing regardless of anything React-related.

## 4. React games: mount inside `createGame`, unmount inside `destroy`

Liar's Dice's `createGame(ctx)` becomes a mount point instead of a hand-rolled render loop:

```tsx
// src/examples/liars-dice/console.tsx
import { createRoot, type Root } from "react-dom/client";
import { createStore } from "@utils/reactStore";
import { LiarsDiceConsole } from "./LiarsDiceConsole";

export function createGame(ctx: ConsoleContext): ConsoleGameInstance {
  const store = createStore<PublicGameState>(initialGameState());
  let root: Root | null = null;

  const container = document.getElementById("touch-surface");
  if (container) {
    root = createRoot(container);
    root.render(<LiarsDiceConsole store={store} ctx={ctx} />);
  }

  return {
    tick: (dt) => {
      // same simulation logic as today (turnOrder, timers, phase transitions),
      // just pushing snapshots into the store instead of calling render()
      if (phase === "bidding") {
        timerRemaining -= dt;
        if (timerRemaining <= 0) { /* existing timeout handling */ }
        store.set(s => ({ ...s, timerRemaining }));
      }
    },
    destroy: () => root?.unmount(),
  };
}
```

**Bridging imperative state into React without over-rendering** is the one genuinely new primitive this needs. Plain `useState` inside the component wouldn't work — the state lives in the `createGame` closure (the console's authoritative simulation), not inside a React component. The right tool is `useSyncExternalStore`, paired with a tiny store helper:

```ts
// src/utils/reactStore.ts
export function createStore<T>(initial: T) {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set: (updater: T | ((prev: T) => T)) => {
      state = typeof updater === "function" ? (updater as (p: T) => T)(state) : updater;
      for (const l of listeners) l();
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
```

```tsx
// src/examples/liars-dice/LiarsDiceConsole.tsx
export function LiarsDiceConsole({ store, ctx }: { store: ReturnType<typeof createStore<PublicGameState>>; ctx: ConsoleContext }) {
  const state = useSyncExternalStore(store.subscribe, store.get);
  return <div>{/* replaces the old innerHTML template, same data */}</div>;
}
```

This is the same shape of problem the resilience doc's `PlayerConnectionStatus` and the first-player doc's `onFirstPlayerChanged` already have — external, imperative state that a UI layer needs to react to — so `createStore`/`useSyncExternalStore` is a reusable pattern worth documenting once here rather than re-solving per game.

**On the controller side**, the equivalent bridge is a small hook wrapping the peer connection's existing (already-cleanup-friendly) subscription API:

```ts
// src/utils/reactBridge.ts
export function usePeerControlMessage(pc: PeerConnection | null, handler: (msg: ControlMessage) => void) {
  useEffect(() => {
    if (!pc) return;
    return pc.addControlListener(handler); // already returns an unsubscribe fn today
  }, [pc, handler]);
}
```

`addControlListener` already returns an unsubscribe function — this hook is a thin wrapper, not new plumbing. The Liar's Dice controller component uses it in place of the current file's manual `addControlListener` call plus hand-written `render()`, and turns `sendBid()`/`sendChallenge()` into ordinary `onClick` handlers.

## 5. Adding `@astrojs/react`

Not currently a dependency — `package.json` has no `react`/`react-dom`, and `astro.config.mjs` has no framework integration. This changes only build tooling (JSX/TSX support, the React runtime); it does **not** require adopting Astro's island model (`client:load` directives, etc.) anywhere. `ConsoleApp`/`ControllerApp` stay exactly the vanilla `<script>`-bootstrapped classes they are today; React only exists inside individual games' `createGame()` closures, mounted and unmounted manually via `createRoot`/`root.unmount()` as shown above.

```
pnpm add react react-dom
pnpm add -D @astrojs/react @types/react @types/react-dom
```

```js
// astro.config.mjs
import react from "@astrojs/react";
export default defineConfig({
  // ...
  integrations: [react()],
});
```

## 6. The switcher stays exactly what it is

No changes needed to `DemoSwitcher.astro`'s `example-changed` event or `ConsoleApp.initGame()`'s dispatch logic beyond the one `destroy()` call added in §1. It doesn't need to know or care that one example mounts a React root and another draws to canvas — that's precisely the point of routing everything through the same `ConsoleGameInstance`/`ControllerGameInstance` contract. This also means the fix applies identically in STATE 2 (single-game mode, `gameSource.ts` swapped to directly import `@logic/console`/`@logic/controller`) even though there's no switcher at all in that mode — `initGame()` still calls `destroy()` before any future re-init (e.g. a manual "restart game" action), so the contract pays for itself even in the common single-game case, not just the multi-example demo.

## Summary: what's new where

| File | Addition |
|---|---|
| `src/scripts/gameTypes.ts` | new — `ConsoleGameInstance` / `ControllerGameInstance` interfaces with optional `destroy()` (§2) |
| `src/scripts/console.ts` | calls `this.activeGame?.destroy?.()` before re-init (§1) |
| `src/scripts/controller.ts` | same, on the controller side; `ControllerContext`/return type gains `destroy` (§1) |
| `src/examples/touch-demo/console.ts`, `controller.ts` | `destroy()` removes the `resize`/pointer listeners each already leaks today (§3) |
| `src/examples/flappy-royale/console.ts` | `destroy()` removes its `resize` listener (§3) |
| `src/utils/reactStore.ts` | new — minimal external store for bridging imperative game state into `useSyncExternalStore` (§4) |
| `src/utils/reactBridge.ts` | new — `usePeerControlMessage()` hook wrapping `PeerConnection.addControlListener` (§4) |
| `src/examples/liars-dice/console.tsx`, `LiarsDiceConsole.tsx`, `controller.tsx` | React rewrite using the store/hook above, mounted in `createGame()` and unmounted in `destroy()` (§4) |
| `package.json`, `astro.config.mjs` | add `react`, `react-dom`, `@astrojs/react` (§5) |
