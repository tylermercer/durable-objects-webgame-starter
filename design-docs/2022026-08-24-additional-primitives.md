# Framework Primitives Addendum

## Scope

This is an addendum to `design-docs/2026-08-24-core-architecture.md`. It adds generic, game-agnostic primitives to the starter template — things any real-time console/controller game will likely need, not specific to any one game. (These came up while sketching a collaborative Zelda-like, but nothing here is dungeon- or Zelda-specific; that logic belongs in the game built on top of this template, not in the template itself.)

Every primitive here is additive and opt-in: the existing touch/canvas demo should keep working unmodified. A game either ignores a primitive entirely or wires into it.

## 1. Input-state sync (continuous input, as an alternative to discrete events)

The current `input` channel carries discrete events (`{type:'touch', phase, x, y}`). That's the right shape for taps/gestures, but many games want a *continuous* signal instead — a joystick position, a held button — where each message is a full snapshot that supersedes the last, not an event in a log. That maps naturally onto the channel's unreliable/unordered delivery: a dropped snapshot just means one stale frame, self-corrected by the next one.

Add a small helper alongside the existing event-based path, not replacing it — games pick whichever fits their input type:

```ts
// src/utils/InputStateSync.ts
export class InputStateSync<T> {
  private timer: number | null = null;

  constructor(
    private channel: () => RTCDataChannel | null,
    private getState: () => T,
    private hz = 20
  ) {}

  start() {
    this.timer = window.setInterval(() => {
      const ch = this.channel();
      if (ch?.readyState === "open") {
        ch.send(JSON.stringify({ type: "state", state: this.getState() }));
      }
    }, 1000 / this.hz);
  }

  stop() {
    if (this.timer !== null) clearInterval(this.timer);
  }
}
```

Console side just tracks `Map<controllerId, T>`, overwritten on each `state` message, and reads the latest value once per sim tick (see §2) rather than reacting per-message.

## 2. Fixed-tick simulation loop

Real-time games need a deterministic simulation step decoupled from the render loop (`requestAnimationFrame` runs at display refresh rate, which varies; game logic shouldn't). The console's current render loop (`startAnimationLoop` in `console.ts`) just redraws every frame — fine for the demo, not a substitute for a sim loop.

```ts
// src/utils/gameLoop.ts
export function createFixedTickLoop(opts: {
  tickRate: number; // Hz
  onTick: (dt: number) => void;
  onRender?: (alpha: number) => void; // alpha = interpolation factor into the next tick
}) {
  const tickMs = 1000 / opts.tickRate;
  let last = performance.now();
  let acc = 0;
  let running = true;

  function frame(now: number) {
    if (!running) return;
    acc += now - last;
    last = now;
    while (acc >= tickMs) {
      opts.onTick(tickMs / 1000);
      acc -= tickMs;
    }
    opts.onRender?.(acc / tickMs);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return { stop: () => { running = false; } };
}
```

A game replaces the demo's `startAnimationLoop` with this: `onTick` advances the authoritative simulation at a fixed rate (typically 20–30Hz — read the latest `InputStateSync` value per controller here), `onRender` draws using `alpha` for smooth interpolation between ticks.

## 3. Player identity / rejoin tokens

Today, a controller refresh is indistinguishable from a new player joining — the DO mints a fresh `id`/`name` every time `join()` is called. Fine for the current stateless demo; not fine for any game with per-player state (position, HP, inventory), where a phone locking or losing signal shouldn't delete the character.

Extend the signaling API so a controller can prove it's the same player as before:

```ts
// src/lib/signaling-api.ts
export interface ControllerApi extends RpcTarget {
  join(
    callbacks: ControllerCallbacks,
    rejoinToken?: string
  ): { id: string; name: string; consoleConnected: boolean; rejoinToken: string }
    | Promise<{ id: string; name: string; consoleConnected: boolean; rejoinToken: string }>;
  sendSignal(signal: RTCSignal): void;
}
```

Controller generates a `rejoinToken` on first join (`crypto.randomUUID()`, persisted to `localStorage`) and passes it on every subsequent `join()` call, including reconnects.

`GameSession` keeps a `Map<rejoinToken, { id: string; name: string; disconnectedAt: number | null }>`, separate from the live `sessions` map (which is keyed by `WebSocket` and only reflects currently-connected sockets). On `join(callbacks, rejoinToken)`:

- **Known token, not stale:** reuse the existing `id`/`name` rather than minting new ones.
- **Unknown or missing token:** mint a new `id`/`name`/`rejoinToken` as today.

On disconnect, don't immediately broadcast a "left" event — mark `disconnectedAt = Date.now()` and set a Durable Object alarm (`this.ctx.storage.setAlarm(...)`) for a grace period (e.g. 30–60s). If the same `rejoinToken` reconnects before the alarm fires, cancel it and keep the player's `id` alive with no visible interruption. If the alarm fires first, purge the record and broadcast the leave then. This gives games a clean seam for "player is temporarily gone, hold their spot" vs. "player is really gone" without the template dictating what "temporarily gone" should look like in-game.

## 4. Coalescing sender for the `control` channel

The `control` channel is reliable and ordered, which is exactly wrong for state that changes faster than the channel can drain on a slow connection — e.g. broadcasting HP after every hit. Naive `send()` calls queue up and the receiver ends up processing a backlog of stale values instead of just the current one.

```ts
// src/scripts/peer-connection.ts (addition)
class CoalescingSender {
  private pending = new Map<string, unknown>();
  private flushing = false;

  constructor(private channel: () => RTCDataChannel | null) {}

  send(key: string, msg: unknown) {
    this.pending.set(key, msg); // overwrites any not-yet-sent value for this key
    if (!this.flushing) {
      this.flushing = true;
      queueMicrotask(() => this.flush());
    }
  }

  private flush() {
    this.flushing = false;
    const ch = this.channel();
    if (!ch || ch.readyState !== "open") return;
    for (const msg of this.pending.values()) ch.send(JSON.stringify(msg));
    this.pending.clear();
  }
}
```

Expose as `PeerConnection.sendControlCoalesced(key, msg)` alongside the existing `sendControl` — games use the coalescing version for "latest value wins" state (HP, position) and the plain version for one-shot events that must all arrive (identity assignment, item pickups).

## 5. Seeded PRNG utility

Any game wanting reproducible randomness (procedural generation, shuffles, loot rolls that need to survive a console refresh via the same seed) needs a deterministic PRNG — `Math.random()` can't be seeded. Add a small, dependency-free generator:

```ts
// src/utils/rng.ts
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return function next() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
```

Returns a `() => number` in `[0, 1)`, same contract as `Math.random`, so it's a drop-in replacement anywhere a game wants determinism.

## 6. Durable game-state storage hook on `GameSession`

The DO currently only tracks the ephemeral `sessions` map — in-memory, gone on eviction. Games with any persistent state (score, world seed, progress) need a place to put it that survives the DO restarting. Rather than have every game invent its own scheme, give the template one documented slot:

```ts
// src/lib/signaling-api.ts
export interface ConsoleApi extends RpcTarget {
  join(callbacks: ConsoleCallbacks): { controllers: {id:string; name:string}[] } | Promise<...>;
  sendSignal(to: string, signal: RTCSignal): void;
  saveGameState(state: unknown): void;
  loadGameState(): unknown | Promise<unknown>;
}
```

Implementation is a thin wrapper over the DO's own storage: `this.ctx.storage.put('gameState', state)` / `this.ctx.storage.get('gameState')`. Deliberately console-only (not exposed on `ControllerApi`) — controllers shouldn't be able to overwrite shared world state directly, only the console's authoritative simulation should. Note the ~2MB per-key size limit on DO storage values; games with larger state should shard it under multiple keys.

This is opt-in — the current demo has no persistent state and can ignore it entirely.

## Summary: what's new where

| File | Addition |
|---|---|
| `src/utils/InputStateSync.ts` | new — continuous input snapshot helper (§1) |
| `src/utils/gameLoop.ts` | new — fixed-tick sim loop (§2) |
| `src/utils/rng.ts` | new — seeded PRNG (§5) |
| `src/lib/signaling-api.ts` | `join()` gains optional `rejoinToken` param and return field (§3); `ConsoleApi` gains `saveGameState`/`loadGameState` (§6) |
| `src/lib/GameSession.ts` | rejoin-token map + grace-period alarm logic (§3); storage-backed `saveGameState`/`loadGameState` (§6) |
| `src/scripts/peer-connection.ts` | `CoalescingSender` + `sendControlCoalesced` (§4) |
