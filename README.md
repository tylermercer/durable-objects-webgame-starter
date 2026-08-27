# Durable Objects Webgame Starter

> [!NOTE]
> Author's (read: prompter's) note: I built this using Claude and Jules, and I had Claude write this README. Calibrate your expectations accordingly. I don't normally use AI to write words for others to read; I used AI here because the primary audience is myself and my AI tools that will implement a game on top of this. But please feel free to open an issue if you run into problems with this project. 

A starter template for browser-based multiplayer party games in the "Jackbox" mold: one **console** (a laptop/desktop, shown on a shared screen) and any number of **controllers** (players' phones), connected over WebRTC with a Cloudflare Durable Object handling signaling. Built on top of [Astroflare](https://github.com/tylermercer/astro-cloudflare-starter), an opinionated Astro + Cloudflare Workers starter.

- Players open the console's URL on a laptop/desktop, which shows a QR code.
- Each player scans it with their phone to join as a controller — no app install, no manual pairing.
- Once connected, the console and each controller talk directly over WebRTC data channels; the Durable Object is only involved in the initial handshake.
- The console is the single authoritative game simulator; controllers just report player input and render local UI (buttons, joysticks).

For the full design — Durable Object structure, the signaling protocol, WebRTC negotiation, data channel layout — see [`design-docs/2026-08-24-core-architecture.md`](./design-docs/2026-08-24-core-architecture.md). This README covers how to actually build a game on top of what's here.

## Getting started

1.  **Use this repo as a template** by clicking "Use this template" at the top of the GitHub page.
2.  **Clone your new repository**:
    ```bash
    git clone https://github.com/your-username/your-new-repo.git
    cd your-new-repo
    ```
3.  **Run the initialization script** and follow the instructions:
    ```bash
    bun ./scripts/init.ts
    ```
    Handles installing dependencies (via `pnpm`), customizing your project name and theme, setting up GitHub Secrets for deployment to Cloudflare, and — as its last step — verifying the production deploy pipeline and printing the deployed URL.
4.  **Try the demo as-is** before changing anything: open the deployed URL from step 3 on your laptop, pick `touch-demo` from the switcher UI, and scan the QR code with your phone. You should see a live dot on the console tracking your finger on the phone. That confirms the console → DO → controller → WebRTC pipe works end-to-end before you touch any game logic.

## Trying the examples

The switcher is the default experience out of the box with no setup needed.
- `touch-demo`: Raw touch input tracking showing real-time dot visualization across WebRTC data channels.
- `liars-dice`: Full turn-based game demonstrating private player state, turn timers, reconnect handling, state persistence (`saveGameState`), and coalesced state broadcasts.
- `flappy-royale`: Real-time simulation with per-player elimination, seeded/replayable procedural generation, and 60Hz tick-vs-render separation.
- `grid-dungeon`: Tile-grid movement and collision, multi-target camera following, and NPC pathfinding via `TileGrid`/`Camera`/`EntityRegistry`.

## What's already here

| Piece | File(s) | What it does |
|---|---|---|
| Signaling Durable Object | `src/lib/GameSession.ts`, `src/lib/signaling-api.ts` | One DO instance per room code. Relays WebRTC offer/answer/ICE between a console and its controllers over a [capnweb](https://github.com/cloudflare/capnweb) RPC session — no hand-rolled message parsing. Persists rejoin tokens and player numbers across DO cold-starts. |
| Room codes & QR join | `src/utils/generateRoomCode.ts`, console-side QR rendering | Console mints a short code client-side; the QR links to `/?code=<CODE>&game=<GAME>` — no in-app scanning needed. |
| WebRTC data channels | `src/transport/peer-connection.ts` | Two channels per console↔controller pair: `input` (unreliable/unordered, for high-frequency input) and `control` (reliable/ordered, for state that must arrive). |
| Game source seam | `src/contract/gameSource.ts` | The single seam between example switcher mode (State 1) and your own game mode (State 2). |
| Examples & Switcher | `src/examples/`, `src/components/DemoSwitcher.astro` | Out-of-the-box examples registry and UI switcher for testing before building your own game. |
| Custom Game Logic location | `src/logic/` | The scaffolded directory (`console.ts` & `controller.ts`) where your own game's logic will live. |
| Console app | `src/host/console.ts` | Generic console bootstrap handling QR rendering, connection tracking, and fixed-tick animation loop through `gameSource.ts`. |
| Controller app | `src/host/controller.ts` | Generic controller bootstrap handling WebRTC connection setup through `gameSource.ts`. |

## Building your own game

Transitioning from the initial example switcher state (State 1) to building your own game (State 2) is a simple 4-step checklist:

1. Look through `src/examples/` for a reference implementation close to what you're building (currently: `touch-demo`, `liars-dice`, `flappy-royale`, and `grid-dungeon`), and try them via the switcher.
2. Implement `src/logic/console.ts` and `src/logic/controller.ts` per the `createGame` contract, using the framework primitives (`InputStateSync`, `createFixedTickLoop`, `createRng`, `sendControlCoalesced`, `rejoinToken`, `saveGameState`) — copying from the example you liked as a starting point is expected and fine.
3. Replace the contents of `src/contract/gameSource.ts` with the two-line state-2 version shown in the comment block at the top of `gameSource.ts`.
4. In `src/pages/index.astro`, replace `<ExampleSwitcher />` inside `#start-screen` with `<button id="new-game-btn" class="btn-new-game" type="button">New Game</button>` so players can click "New Game" on the start screen to open the room invite modal.
5. Delete `src/examples/` and `src/components/ExampleSwitcher.astro`.

### Input: discrete events vs. continuous state

- **Discrete events** (taps, swipes, gestures) — use the existing `input` channel event pattern directly (`{type:'touch', phase, x, y}` or your own event shape).
- **Continuous input** (joystick position, held buttons) — use `InputStateSync` (`src/utils/InputStateSync.ts`), which sends a full state snapshot at a fixed rate rather than an event log. This matches the `input` channel's unreliable delivery: a dropped snapshot just means one stale frame, corrected by the next one.

### Simulation: fixed-tick loop

Game logic shouldn't run at display refresh rate. `createFixedTickLoop` (`src/utils/gameLoop.ts`) decouples a fixed-Hz simulation step from rendering:

```ts
createFixedTickLoop({
  tickRate: 30,
  onTick: (dt) => simulate(dt), // read latest input, advance world state
  onRender: (alpha) => draw(alpha), // interpolate for smooth rendering between ticks
});
```

This replaces the demo's `startAnimationLoop`, which just redraws every frame.

### Player identity across reconnects

By default, a controller refresh looks like a brand-new player joining — fine for the stateless demo, not fine for a game with per-player HP/position/inventory. `join()` on the signaling API accepts an optional `rejoinToken` (generate one with `crypto.randomUUID()`, persist it in `localStorage`); the DO reuses the player's existing `id`/`name` if the token matches a recent session, and holds their slot open for a grace period after a disconnect instead of immediately dropping them. Use this for any game where a player's state needs to survive a dropped connection or locked phone (see `src/examples/liars-dice/` for a complete example).

### TURN Relay Configuration (Optional)

WebRTC STUN server is used by default for P2P connection establishment. In environments with restrictive NATs or firewalls (e.g., venue Wi-Fi), a TURN relay server is recommended. The template supports optional TURN server configuration via environment variables:

- `PUBLIC_TURN_URLS`: Comma-separated list of TURN server URLs (e.g., `turn:turn.example.com:3478`).
- `PUBLIC_TURN_USERNAME`: TURN server username.
- `PUBLIC_TURN_CREDENTIAL`: TURN server password/credential.

### Sending frequently-changing state reliably

The `control` channel is reliable and ordered — good for state you can't afford to lose, bad for anything that changes faster than the channel drains (e.g. HP after every hit), since naive sends queue up into a stale backlog. Use `sendControlCoalesced(key, msg)` on `PeerConnection` for "latest value wins" state (as demonstrated in `src/examples/liars-dice/console.ts` for broadcasting game state); it keeps only the newest message per key until the channel is ready to send. Use the plain `sendControl` for one-shot events that must all arrive (item pickups, identity assignment, or private dice dispatches).

### Deterministic randomness

`createRng(seed)` (`src/utils/rng.ts`) is a seedable PRNG with the same `() => number` contract as `Math.random`. Use it anywhere your game needs reproducible randomness — procedural generation, shuffles, loot rolls — especially if that randomness needs to survive a console refresh from the same seed (used in `src/examples/liars-dice/console.ts` to reproduce dice rolls across console reloads).

### Persisting game state

The DO's `sessions` map is in-memory and doesn't survive eviction. For anything that should persist — score, world seed, progress — use `saveGameState`/`loadGameState` on the console's RPC session, backed by the DO's own durable storage (see `src/examples/liars-dice/console.ts`). This is console-only by design: controllers report input, only the console's authoritative simulation writes shared state. Values are capped around 2MB; shard larger state across multiple keys if you need to.

### Pixi.js for WebGL Canvas Games

For continuous-simulation games with complex visual effects (such as `flappy-royale`), Pixi.js provides a WebGL-accelerated retained scene graph backend as an alternative to hand-rolled Canvas2D. Note on bundle size trade-off: in the multi-example starter, example games are dynamic imports so Pixi is only fetched if `flappy-royale` is loaded. If you adapt this pattern into a single-game project (State 2), Pixi will be part of your main bundle — a worthwhile trade-off for a real-time, effects-heavy game, but likely unnecessary for simpler games.

## Design docs

`design-docs/` contains the planning docs for this template's architecture, written with Claude and implemented with Jules. Start with [`2026-08-24-core-architecture.md`](./design-docs/2026-08-24-core-architecture.md) for the console/controller/signaling model, and [`2026-08-24-framework-primitives.md`](./design-docs/2026-08-24-framework-primitives.md) for the game-building primitives described above. Add new docs here for any future large feature before implementing it.

## Inherited from Astroflare

This template started from [Astroflare](https://github.com/tylermercer/astro-cloudflare-starter) and keeps a few of its features:

### Core folder aliases

Folders under `src` have import aliases — `@utils/foo.ts` instead of `../../../utils/foo.ts` — configured for `assets`, `content`, `components`, `layouts`, `pages`, and `utils`.

### Commit hash logging

`@layouts/Base.astro` logs the current build's commit hash on page load via `logCommitHash` (`src/utils/logCommitHash.ts`), populated by the deploy pipeline.

**To remove:** delete `src/utils/logCommitHash.ts`, remove the script tag from `src/layouts/Base.astro`, and delete `PUBLIC_COMMIT_HASH: ${{ ... }}` from `.github/workflows/main.yml`.

### Scheduled builds (disabled by default)

The deploy workflow supports a daily cron build (useful for things like scheduled blog posts) — currently commented out in `.github/workflows/main.yml` since it doesn't apply to this project. Uncomment the `schedule` trigger there if you ever need it.
