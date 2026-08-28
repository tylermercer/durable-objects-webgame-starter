# Per-Example Routes + Ejection CLI

Status: proposed
Author: (drafted with Claude, for Jules to implement)
Related docs: `2026-08-25-001-example-switcher-and-liars-dice.md`,
`2026-08-27-001-game-viewport-and-button-switcher.md`

## Goal

Today every example lives at `/` behind an in-page switcher: `index.astro`
always renders the full console/controller shell, and `ExampleSwitcher.astro`
swaps which game is active via `localStorage` + a `example-changed`
`CustomEvent`, with `?game=` as a secondary signal for controllers joining
mid-session. This doc replaces that with one real route per example:

- `src/pages/play/[game].astro` — a single dynamic route file that serves
  every example (`/play/touch-demo`, `/play/liars-dice`, `/play/flappy-royale`,
  `/play/grid-dungeon`), console and controller alike.
- `src/pages/index.astro` — becomes a plain list of links to those routes.
  No console/controller bootstrap JS loads on `/` at all anymore.
- A new `scripts/eject.ts`, modeled on `scripts/init.ts`, that automates the
  README's "Building your own game" checklist so turning this from a
  multi-example template into a single-game project is a command, not a
  manual file surgery session.

Two side effects worth calling out up front because they drive most of the
design below. First, chasing this route split honestly turns out to
*simplify* `gameSource.ts`'s job rather than complicate it, and makes
State 1 and State 2 converge on nearly identical markup — that convergence
is what makes ejection smooth (see "Why ejection gets simpler"). Second,
once the console/controller role no longer needs to be decided server-side
(more on why below), `/play/[game]` can be fully static and edge-cacheable
rather than rendered on every request — a genuine improvement over today's
`/`, not just a lateral move.

## Non-goals

- No changes to `GameSession.ts`, `signaling-api.ts`, or anything durable-
  object-side. Confirmed by grep: the DO has no concept of "which example" —
  `gameState` is an opaque blob. This is purely a client-side/routing change.
- No changes to the WebRTC/signaling protocol, `PeerConnection`, or the
  `createGame` contract (`ConsoleContext`/`ControllerGameInstance` etc.).
- No redesign of the room-code modal, QR flow, or per-example console
  logic itself (touch-demo/liars-dice/flappy-royale/grid-dungeon internals
  are untouched).
- Not attempting to fix the pre-existing "joined via a bare code with no
  link, wrong game loads" gap — it's carried forward with equivalent
  behavior, not solved. Flagged again under Open Questions.

## Current state, briefly

- `src/pages/index.astro` sets `prerender = false` and branches its entire
  markup at request time on `Boolean(Astro.url.searchParams.get('code'))`
  to decide console vs. controller shell.
- `src/contract/gameSource.ts` is the seam: `loadConsoleGame()` /
  `loadControllerGame()` / `buildJoinUrl()` resolve which example via
  `src/examples/switcherState.ts`, which reads (in priority order) the
  `?game=` URL param, a `<select>` element (dead code — the switcher is
  already buttons per the 2026-08-27-001 doc, this appears to be a leftover),
  `localStorage`, then `DEFAULT_EXAMPLE`.
- The README's documented State 2 (single game) swap is already just
  replacing `gameSource.ts`'s contents with a version that imports
  `@logic/console` / `@logic/controller` directly — that seam is good and
  this doc keeps it as-is.
- The commented-out `#new-game-btn` in `index.astro` and its wired-up
  `openModal()` handler in `ConsoleApp` are dead code today, left in place
  for State 2. `ExampleSwitcher.astro` is what's actually shown in State 1.

## 1. Extract the shell into `GameShell.astro`, decide role with CSS + a blocking script

All of the console-shell/controller-shell markup and `<style>` currently
inline in `index.astro` moves, unchanged, into `src/components/GameShell.astro`.
The one real change: today's role decision (`Boolean(Astro.url.searchParams.get('code'))`)
moves from server-side branching to a CSS-first, script-confirmed decision,
which is what lets this route be fully static. **Both shells always render**;
which one is visible is decided before first paint.

- CSS carries the default, keyed on viewport — this mirrors the existing
  device heuristic (phone → probably a controller, desktop → probably a
  console) and is what's visible with JS disabled or before the script runs:

  ```css
  .console-shell { display: block; }
  .controller-shell { display: none; }
  .join-form-card { display: none; }

  @media (max-width: 768px) {
    .console-shell { display: none; }
    .controller-shell { display: block; }
  }
  ```

- A **synchronous, non-deferred** script in `<head>` — same pattern as a
  dark-mode-flash guard — checks the actual signal (`?code=`) and stamps a
  class on `<html>` before the browser paints anything:

  ```html
  <script>
    if (new URLSearchParams(location.search).has('code')) {
      document.documentElement.classList.add('has-code');
    }
  </script>
  ```

  ```css
  html.has-code .console-shell { display: none; }
  html.has-code .controller-shell { display: block; }
  ```

  `html.has-code .console-shell` outranks both the bare rule and the
  media-query rule on specificity, so it wins unconditionally regardless of
  viewport — including the rare case of someone joining as a controller on
  a desktop-sized window. Because the script is inline and blocking, this
  never flashes the wrong shell, even in that case.

- **Three states, not two.** A narrow viewport with *no* `code` isn't the
  controller shell — it's the existing "Join Game" code-entry card (today's
  `.mobile-console` block), since a controller UI with nothing to connect
  to would just hang on "Connecting...". That's a third CSS tier, same
  specificity trick:

  ```css
  @media (max-width: 768px) {
    .console-shell, .controller-shell { display: none; }
    .join-form-card { display: block; }
  }
  html.has-code .join-form-card { display: none; }
  html.has-code .controller-shell { display: block; }
  ```

- **`display: none` doesn't stop JavaScript.** This is the part that's easy
  to get wrong: hiding a shell with CSS doesn't stop its bootstrap script
  from running. Without a corresponding guard, a phone showing the
  controller UI would *also* silently instantiate `ConsoleApp`, mint a room
  code, and open a signaling websocket in the background — for a shell
  nobody can see. `host/console.ts` and `host/controller.ts`'s
  `DOMContentLoaded` entry points both need the identical check the inline
  head script uses, so the visible shell and the running code always agree:

  ```ts
  // src/utils/isController.ts — single source of truth,
  // used by the inline head script (inlined by hand, since it must
  // run before any bundle loads) AND by both host bootstraps.
  export function isController(): boolean {
    return new URLSearchParams(window.location.search).has('code');
  }
  ```

  ```ts
  // src/host/console.ts
  if (typeof window !== "undefined" && !isController()) {
    window.addEventListener("DOMContentLoaded", () => {
      const app = new ConsoleApp();
      app.init();
    });
  }
  ```

  (and the mirror-image guard in `controller.ts`). The inline `<head>`
  script can't literally `import` this util — it has to run before any
  module loads — so it stays a tiny hand-written duplicate of the same
  one-line check; a comment pointing each at the other keeps them from
  drifting.

- `GameShell` takes one optional prop: `game?: string`. Since the frontmatter
  no longer needs `Astro.url.searchParams` for anything, it's also no
  longer request-dependent — the `game` prop can be stamped straight onto
  the markup as a plain `data-game` attribute on the root element (no need
  for the `<meta>`/head-hoisting workaround from an earlier draft of this
  doc, since there's no server branch left to hang it off of):

  ```astro
  ---
  // src/components/GameShell.astro
  export interface Props {
    game?: string;
  }
  const { game } = Astro.props;
  ---
  <div data-game={game}>
    <!-- ...unchanged console-shell / controller-shell / join-form-card markup... -->
  </div>
  ```

Why `GameShell` needs to know `game` at all: `gameSource.ts` (State 1
version) needs to resolve which example's code to dynamically `import()`,
and unlike today, that's no longer carried in `localStorage` or a `?game=`
query param — it's baked into which page you're on.

## 2. The dynamic route: `src/pages/play/[game].astro`, fully static

Because the role decision no longer needs the server, this route can be
genuinely static — one prebuilt HTML file per example, cacheable at the
edge, via `getStaticPaths()`:

```astro
---
import Layout from '@layouts/Base.astro';
import GameShell from '@components/GameShell.astro';
import { EXAMPLES, type ExampleId } from '@examples/registry';

export function getStaticPaths() {
  return Object.keys(EXAMPLES).map((game) => ({ params: { game } }));
}

const { game } = Astro.params as { game: ExampleId };
---
<Layout>
  <GameShell game={game} />
</Layout>
```

No `prerender = false`, no per-request branching, no `Response(null, {status:
404})` needed — `getStaticPaths()` is the allowlist. Astro's normal static
404 handles anything not in `EXAMPLES` automatically (a real `404.astro` is
still worth adding at some point, but that's a pre-existing repo gap, not
introduced or fixed here). This is a strictly better outcome than the
SSR version this doc originally proposed: same "one route file handles
every example" shape, now with build-time HTML and edge caching instead of
a render on every request, and — thanks to the inline blocking script —
no flash-of-wrong-shell trade-off to accept for it.

## 3. `gameSource.ts` and `switcherState.ts` get simpler, not more complex

Today's `switcherState.ts` juggles four fallback sources for "which
example is active" because the single shared `/` route had no other way
to know. With the example baked into the URL path, most of that
collapses:

```ts
// src/examples/switcherState.ts (State 1)
import { EXAMPLES, DEFAULT_EXAMPLE, type ExampleId } from "./registry";

export function getSelectedExampleId(): ExampleId {
  if (typeof document === "undefined") return DEFAULT_EXAMPLE;
  const id = document.querySelector('[data-game]')
    ?.getAttribute("data-game");
  return (id && id in EXAMPLES) ? (id as ExampleId) : DEFAULT_EXAMPLE;
}

export function exampleIdFromJoinUrl(url: URL): ExampleId | undefined {
  const [, prefix, id] = url.pathname.split("/");
  return (prefix === "play" && id in EXAMPLES) ? (id as ExampleId) : undefined;
}
```

`gameSource.ts` itself (State 1 branch) doesn't change at all — it already
just calls `getSelectedExampleId()` / `exampleIdFromJoinUrl()` and doesn't
care how they're implemented.

**`buildJoinUrl` gets a nice simplification, worth calling out
separately.** Today it's:

```ts
export function buildJoinUrl(origin: string, code: string): string {
  const exampleId = getSelectedExampleId() ?? DEFAULT_EXAMPLE;
  return `${origin}/?code=${code}&game=${encodeURIComponent(exampleId)}`;
}
```

Once the example lives in the path, the join URL is just "wherever you
already are, plus a code":

```ts
export function buildJoinUrl(origin: string, code: string): string {
  return `${origin}${window.location.pathname}?code=${code}`;
}
```

This version is identical for State 1 (`/play/touch-demo?code=X`) and
State 2 (`/?code=X`) — it doesn't need to know about examples at all.
Recommend pulling it out of `gameSource.ts` entirely into a small shared
`src/utils/buildJoinUrl.ts` that both states' `gameSource.ts` import
unchanged. That's one less thing the ejection step has to touch.

## 4. The home route becomes a link list

```astro
---
// src/pages/index.astro (State 1)
import Layout from '@layouts/Base.astro';
import { EXAMPLES } from '@examples/registry';
---
<Layout>
  <main class="home-shell l-stack l-space-m">
    <h1 class="u-step-2">Pick a game</h1>
    <div class="example-links" role="list">
      {Object.entries(EXAMPLES).map(([id, ex]) => (
        <a href={`/play/${id}`} class="example-link" role="listitem">{ex.label}</a>
      ))}
    </div>
  </main>
</Layout>
```

No `export const prerender = false` needed — this page has no per-request
branching, so it's fully static (the default), and — unlike today's `/` —
it loads zero console/controller bootstrap JS. Styling can lift the
`.example-btn` rules straight out of the soon-to-be-deleted
`ExampleSwitcher.astro`, just applied to `<a>` instead of `<button>`.

**The one thing this drops:** today's mobile "Join Game" code-entry form
lives inside the console shell (shown at narrow viewports as a fallback
when the console UI itself doesn't fit). That form has nowhere obviously
right to live once `/` has no shell at all. Two options:

1. Put it on the home page too, submitting to
   `/play/${DEFAULT_EXAMPLE}?code=...` — matches today's actual behavior
   exactly (today, a code with no `game` param already falls back to
   `DEFAULT_EXAMPLE` via `exampleIdFromJoinUrl`'s `undefined` return). This
   is carrying forward an existing ambiguity (a bare code doesn't say which
   game), not introducing a new one.
2. Drop it from the home page and rely on each `/play/[game]` page's own
   mobile fallback (which already exists per-page, unchanged, and is
   correct there since the game is unambiguous — you're already on that
   game's page).

Recommend (2): it's less code, and (1) only helps someone who has a bare
room code with zero context about which game — already a degraded
experience today, not worth preserving a dedicated UI for. Flagged under
Open Questions in case there's a real use case for it (e.g., reading a
code aloud over a PA system at an event).

## 5. Why ejection gets simpler

This is the part worth designing around, not just an afterthought. With
the above, `GameShell.astro` is now **identical in State 1 and State 2** —
it's just markup, and it takes an optional `game` prop it doesn't
otherwise care about. The only things that differ between states are:

| | State 1 (multi-example) | State 2 (your game) |
|---|---|---|
| `src/pages/index.astro` | list of links | `<Layout><GameShell /></Layout>`, fully static |
| `src/pages/play/[game].astro` | exists | deleted |
| `src/contract/gameSource.ts` | resolves via `EXAMPLES` registry | imports `@logic/console` / `@logic/controller` directly |
| `src/examples/` | exists | deleted |
| `src/components/GameShell.astro` | exists | **exists, unchanged** — this is the key simplification |

Ejection is now: delete two things, replace one file's contents with a
version already sitting in a comment block (or, per below, a real
alternate file), done. No markup surgery, because the markup never lived
in the thing being deleted.

### `scripts/eject.ts`

Modeled on `scripts/init.ts`'s shape (confirm-then-act, clear numbered
steps, bun's `$` for shell/fs work):

```ts
import { $ } from "bun";
import { existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";

async function main() {
  console.log("\n🎮 Ejecting to a single-game project...\n");
  console.log("This will:");
  console.log("  - Delete src/pages/play/ (the per-example route)");
  console.log("  - Delete src/examples/ (all four demo games + registry)");
  console.log("  - Replace src/pages/index.astro with the single-game shell");
  console.log("  - Point src/contract/gameSource.ts at src/logic/ instead of the example registry\n");

  if (prompt("Type 'eject' to continue:") !== "eject") {
    console.log("Aborted.");
    return;
  }

  console.log("\x1b[34m[1/4]\x1b[0m Removing example route and demo games...");
  rmSync("./src/pages/play", { recursive: true, force: true });
  rmSync("./src/examples", { recursive: true, force: true });

  console.log("\x1b[34m[2/4]\x1b[0m Rewriting src/pages/index.astro...");
  writeFileSync(
    "./src/pages/index.astro",
    `---\nimport Layout from '@layouts/Base.astro';\nimport GameShell from '@components/GameShell.astro';\n---\n<Layout>\n  <GameShell />\n</Layout>\n`
  );

  console.log("\x1b[34m[3/4]\x1b[0m Switching gameSource.ts to src/logic/...");
  writeFileSync(
    "./src/contract/gameSource.ts",
    readFileSync("./src/contract/gameSource.state2.ts", "utf-8")
  );
  rmSync("./src/contract/gameSource.state2.ts");

  console.log("\x1b[34m[4/4]\x1b[0m Verifying build...");
  await $`pnpm astro check`;
  await $`pnpm build`;

  console.log("\n\x1b[32m[Success]\x1b[0m Ejected. src/logic/console.ts and");
  console.log("src/logic/controller.ts are your game now — build away.\n");
}

main().catch((err) => {
  console.error(`\n\x1b[31m[Error]\x1b[0m ${err.message}`);
  process.exit(1);
});
```

Two changes from today's README-documented flow, both small:

- **`gameSource.ts`'s State 2 contents move out of a comment block into a
  real sibling file, `src/contract/gameSource.state2.ts`.** Today's
  comment-and-swap is fine for a human doing it by hand, but a script
  shouldn't be regex-extracting code out of a `/* ... */` block — that's
  fragile the moment someone reformats the comment. A real (untracked in
  the sense of "never imported, only read by the eject script") sibling
  file is simpler and gets normal syntax highlighting/type-checking for
  free as a bonus. `gameSource.ts`'s top-of-file comment pointing to it
  replaces the current inline code-in-a-comment.
- **`pnpm astro check && pnpm build` at the end**, not just a manual
  "try it out" step — catches the case where someone already has
  half-finished `src/logic/` code that doesn't match the `createGame`
  contract, before they discover it at deploy time.

Steps 3-4 of the README's existing checklist (deleting `src/examples/`,
replacing `gameSource.ts`) are exactly what the script automates. Step 2
("implement `src/logic/console.ts`/`controller.ts`") is unaffected —
that's the actual game-building work and stays manual, as it should.

## Summary: what's new/changed where

| File | Change |
|---|---|
| `src/components/GameShell.astro` | **New.** Console/controller/join-form markup extracted verbatim from `index.astro`, plus optional `game` prop stamped as a `data-game` attribute. Role (console vs. controller vs. join-form) is now decided by CSS + an inline blocking `<head>` script instead of server-side branching. `ExampleSwitcher` usage removed; dead `#new-game-btn` uncommented as `#start-game-btn`. |
| `src/utils/isController.ts` | **New.** One-line `URLSearchParams(location.search).has('code')` check; single source of truth referenced by the inline head script (duplicated by hand, since it must run pre-bundle) and by both `host/console.ts`/`host/controller.ts`'s `DOMContentLoaded` guards, so the visible shell and the running bootstrap always agree. |
| `src/pages/play/[game].astro` | **New.** Fully static via `getStaticPaths()` over `EXAMPLES`; no `prerender = false`, no per-request branching; renders `<GameShell game={game} />`. |
| `src/pages/index.astro` | Replaced: static list of `<a href="/play/...">` links, no bootstrap JS. |
| `src/examples/ExampleSwitcher.astro` | Deleted — replaced by home page's link list. |
| `src/examples/switcherState.ts` | Simplified: reads the `[data-game]` attribute / URL pathname instead of `localStorage`/`<select>`/`?game=`. |
| `src/utils/buildJoinUrl.ts` | **New**, extracted out of `gameSource.ts`; state-agnostic (`origin + pathname + code`). |
| `src/contract/gameSource.ts` | State 1 logic unchanged apart from delegating to the simplified `switcherState.ts` / shared `buildJoinUrl`. |
| `src/contract/gameSource.state2.ts` | **New.** The already-written State 2 contents, moved out of a comment block into a real file so `eject.ts` can read it verbatim. |
| `scripts/eject.ts` | **New.** Automates README steps 3-4 (delete examples, swap `gameSource.ts`, rewrite `index.astro`), then runs `astro check` + `build` to verify. |
| `README.md` | "Building your own game" section updated to mention `bun ./scripts/eject.ts` as the recommended path, with the manual steps kept below as what it does under the hood. |

## Acceptance criteria

- `/play/touch-demo`, `/play/liars-dice`, `/play/flappy-royale`,
  `/play/grid-dungeon` each load directly (no client-side redirect from
  `/`) and behave identically to today's `/` with that example selected
  via the switcher.
- `/play/not-a-real-example` returns Astro's static 404.
- `/` loads no console/controller JS (verify via network tab: no
  `host/console.ts` or `host/controller.ts` bundle on the home route).
- Scanning a QR code generated from `/play/liars-dice`'s console lands a
  phone on `/play/liars-dice?code=XXXX` and joins as a controller for
  *that* game, with no `?game=` param involved anywhere.
- Loading `/play/touch-demo?code=XXXX` on a *desktop-sized* browser window
  still shows the controller shell, not the console shell — confirms the
  `html.has-code` override beats the media-query default.
- With devtools' network throttled and JS paused on first paint, briefly
  inspecting the DOM shows only one of `.console-shell`/`.controller-shell`/
  `.join-form-card` visible at a time — no visible flash/swap after load.
- On a narrow viewport loading `/play/touch-demo?code=XXXX`, only
  `ConsoleApp` or only `ControllerApp` ever calls `DOMContentLoaded` setup —
  never both (verify via a `console.log` or breakpoint in each — this is
  the "CSS hides it but JS still ran" failure mode to rule out explicitly).
- `grep` for `example-changed` and `ExampleSwitcher` across `src/` returns
  nothing.
- Running `bun ./scripts/eject.ts` against a fresh clone, confirming the
  prompt, then running `pnpm dev`, results in `/` directly hosting the
  console/controller shell with no example concept anywhere — `grep -r
  EXAMPLES src/` returns nothing post-eject.
- Post-eject `pnpm build` succeeds without modification (assuming
  `src/logic/console.ts`/`controller.ts` already satisfy the `createGame`
  contract, which the scaffolded starter versions do out of the box).

## Open questions for Jules to flag if encountered (not to resolve unilaterally)

- **Where the inline `<head>` script physically lives.** It has to be
  hand-written (not `import`ed) so it runs before any bundle, and it has
  to appear before the CSS that references `html.has-code` is parsed — in
  practice this likely means it belongs in `Base.astro`'s `<head>` (once,
  shared by every page) rather than in `GameShell.astro`, since pages
  without a `GameShell` (like the eventual home link-list) don't need it
  but it's harmless if present everywhere. Flag if it ends up somewhere
  else for a good reason.
- **Whether the three-shell CSS (console/controller/join-form) plus the
  `has-code` override is worth co-locating as a single small stylesheet**
  (e.g. `src/styles/game-shell-visibility.scss`) versus leaving it inline
  in `GameShell.astro`'s `<style>` block like today. Either is fine; flag
  the choice since the specificity ordering between the three rules is the
  one part of this that's easy to subtly break during a later refactor,
  and a dedicated file with a comment explaining the ordering is cheap
  insurance.
- **The dropped home-page "join with bare code" form** (section 4, option
  2). Confirm no one actually relies on sharing a room code without a
  link/QR before removing it — if that's a real usage pattern, option (1)
  ($DEFAULT_EXAMPLE fallback) is a one-file addition to restore.
- **Route naming.** `/play/[game]` is a reasonable, arbitrary pick.
  `/g/[game]`, `/games/[game]`, or matching the `?game=` param's existing
  naming some other way are all fine — not worth debating at length, but
  flag the final choice since it's a public URL shape.
