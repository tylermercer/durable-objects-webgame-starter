# Source Tree Reorganization

Status: proposed
Author: (drafted with Claude, for Jules to implement)
Related docs: all prior design docs, including `2026-08-25-pixi-canvas-games.md`
(now landed). This one is cross-cutting and doesn't add or change any
primitive, contract, or behavior — it's a pure move/rename pass over files
those docs already created.

## Scope

Every addendum so far — through pixi, the most recent — has landed its files
into whichever existing folder was closest — almost always `src/scripts/` or
`src/utils/` — because introducing a new folder for one file felt premature at
the time. Six addenda later, that's left two folders doing three or four
unrelated jobs each, with no folder name that actually describes what's in
it. This doc proposes a one-time move pass to give each concern its own
folder, now that the addendum sequence has settled and further churn in
`scripts/`/`utils/` is unlikely in the near term.

**Non-goals:** no file's contents change (aside from import paths), no new
primitive or contract, no changes to `EXAMPLES`, `createGame`, or any public
API. This is filesystem layout only.

## 1. Current shape, and why it's a catch-all

`src/scripts/` today mixes three concerns that don't share a lifecycle or an
audience:

| File | Actual concern |
|---|---|
| `peer-connection.ts` (+ test) | WebRTC data-channel transport (`PeerConnection`, `CoalescingSender`). Framework-agnostic; doesn't know about consoles, controllers, or games. |
| `console.ts`, `controller.ts` | The host apps themselves — signaling, QR rendering, connection-status UI, game lifecycle. This is genuinely "scripts" in the sense of "what the console/controller pages boot into," but it's a different thing from the transport layer sitting next to it. |
| `gameSource.ts`, `gameTypes.ts` | The seam between host and game: the `ConsoleGameInstance`/`ControllerGameInstance` contract types (formalized in `2026-08-25-multi-framework-game-contract.md`) and the state-1/state-2 loader switch. Every game and every example imports from here, but conceptually it's a contract definition, not a script. |

`src/utils/` is cleaner but has the same problem in miniature: five
framework-agnostic primitives (`gameLoop`, `rng`, `generateRoomCode`,
`deviceIdentity`, `InputStateSync`) sit next to two files that only exist to
support React specifically — `reactBridge.ts` (`usePeerControlMessage`, a
hook) and `reactStore.ts` (`createStore`, the tiny store `2026-08-25-multi-framework-game-contract.md`'s
React example wires up to `useSyncExternalStore`). A game author skimming
`utils/` seeing `reactStore.ts` next to `rng.ts` has no way to tell from the
folder alone that one requires React and the other doesn't.

Pixi didn't add to this problem, for what it's worth — per its own summary
table, it only touched `package.json` and rewrote
`src/examples/flappy-royale/console.ts` in place; nothing landed in
`scripts/` or `utils/` as part of that doc. So the shape of the catch-all is
exactly what it was before pixi, and this reorg's scope doesn't need to
account for anything pixi-specific beyond the ordinary import-path updates
`flappy-royale/console.ts` needs like every other consumer of `PeerConnection`
and `ConsoleGameInstance` (§4).

One symptom worth naming: every file that currently imports `PeerConnection`
or `ConsoleGameInstance`/`ControllerGameInstance` does it via a relative path
into `scripts/` — `../../scripts/peer-connection`, `../scripts/gameTypes`,
etc. — because there's no `@scripts` alias today (only `@utils`, `@examples`,
`@logic`, `@components`, `@layouts`, `@assets`, `@styles` are defined in
`tsconfig.json`). That's a dozen-plus call sites across `examples/`, `logic/`,
and `utils/` that'll need touching regardless of exactly how we split
`scripts/` up — which is the case for doing this in one deliberate pass
instead of drifting further.

## 2. Proposed structure

```
src/
  host/                  # was scripts/console.ts, controller.ts
    console.ts
    controller.ts
  transport/              # was scripts/peer-connection.ts
    peer-connection.ts
    peer-connection.test.ts
  contract/               # was scripts/gameTypes.ts, gameSource.ts
    gameTypes.ts
    gameSource.ts
  react/                  # was utils/reactBridge.ts, reactStore.ts
    reactBridge.ts
    reactStore.ts
    reactStore.test.ts
  utils/                  # unchanged except the two files above leaving
    InputStateSync.ts
    InputStateSync.test.ts
    deviceIdentity.ts
    deviceIdentity.test.ts
    gameLoop.ts
    gameLoop.test.ts
    generateRoomCode.ts
    generateRoomCode.test.ts
    rng.ts
    rng.test.ts
    logCommitHash.ts      # stays — see §5
  lib/                    # unchanged: GameSession.ts, signaling-api.ts
  logic/                  # unchanged: your-game-goes-here stubs
  examples/                # unchanged
  components/, layouts/, pages/, assets/, styles/  # unchanged
```

`host` / `transport` / `contract` read, in order, as "the app," "what it talks
over," and "what it expects from a game" — three questions with three
different answers, now three folders instead of one.

## 3. New path aliases

Add to `tsconfig.json`'s `paths` (Astro picks these up automatically from
`tsconfig.json`; no separate `astro.config.mjs` change needed, same as the
existing aliases):

```json
"@host/*": ["src/host/*"],
"@transport/*": ["src/transport/*"],
"@contract/*": ["src/contract/*"],
"@react/*": ["src/react/*"]
```

Every call site touched in this reorg should switch to the alias rather than
a new relative path — the whole point is that a future move doesn't require
re-deriving `../../` chains again.

## 4. Migration mechanics

Mechanical, in this order, each step independently buildable:

1. `git mv src/scripts/peer-connection.ts src/transport/peer-connection.ts`
   (+ its test). Update the call sites in `examples/*/console.ts` (including
   the now-landed `flappy-royale/console.ts` Pixi rewrite),
   `examples/*/controller.ts`, `logic/console.ts`, `logic/controller.ts`,
   `react/reactBridge.ts` (post-move, see step 3) from
   `../../scripts/peer-connection` / `../scripts/peer-connection` to
   `@transport/peer-connection`.
2. `git mv src/scripts/gameTypes.ts src/contract/gameTypes.ts` and
   `git mv src/scripts/gameSource.ts src/contract/gameSource.ts`. Update the
   `ConsoleGameInstance`/`ControllerGameInstance` imports in the same call
   sites as step 1, plus `host/console.ts`/`host/controller.ts` (post-move).
3. `git mv src/scripts/console.ts src/host/console.ts` and
   `git mv src/scripts/controller.ts src/host/controller.ts`. Update
   whatever in `src/pages/index.astro` (or wherever the host apps are
   currently script-tagged in) references `scripts/console`/`scripts/controller`.
   Delete `src/scripts/` once empty.
4. `git mv src/utils/reactBridge.ts src/react/reactBridge.ts` and
   `git mv src/utils/reactStore.ts src/react/reactStore.ts` (+ its test).
   Update imports in `examples/liars-dice/LiarsDiceConsole.tsx`,
   `LiarsDiceController.tsx`, and anywhere else that pulled
   `usePeerControlMessage`/`createStore` from `@utils/*`, to `@react/*`.
5. Add the four aliases to `tsconfig.json` (§3) — do this alongside step 1
   rather than after, so intermediate commits aren't left on relative paths
   only to be immediately rewritten again.
6. Run the full test suite (`peer-connection.test.ts`, `reactStore.test.ts`,
   plus everything unaffected) and `tsc --noEmit` to catch any missed import.

Each step lands as its own commit; the whole thing is one PR since none of it
is independently useful mid-way.

## 5. What's explicitly not moving

- **`src/lib/`, `src/logic/`, `src/examples/`, `src/components/`,
  `src/layouts/`, `src/pages/`, `src/assets/`, `src/styles/`** — already
  single-concern, already named for what they contain. No change.
- **`src/utils/logCommitHash.ts`** — inherited from Astroflare, unrelated to
  the game framework (it's build/deploy plumbing, not a game primitive). It's
  arguably misplaced in `utils/` too, but moving it is orthogonal to this
  doc's motivation (game-primitive vs. React-only vs. host vs. transport) and
  the README already documents exactly how to remove it wholesale if a
  project doesn't want it. Flagging as a possible future follow-up, not
  bundling it here.

## 6. Open questions

- Should `contract/` fold into `host/` instead of standing alone? The
  argument for splitting is that every example and `logic/` file imports the
  contract but nothing from `host/` directly (only the built pages wire up
  `host/console.ts`/`host/controller.ts`); the argument against is that it's
  only two small files. Leaning toward keeping it split since "what a game
  must implement" and "the thing that runs the console" are conceptually
  different audiences (game author vs. template maintainer), but flagging
  this as the one genuinely debatable call in this doc.
- This lands as its own PR now that pixi is already merged, rather than
  folded into the pixi PR — keeps the "pure move, no behavior change" diff
  reviewable on its own, and meant pixi didn't have to land on a moving
  floor while this was still being drafted.
