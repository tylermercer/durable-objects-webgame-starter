# Server-issued TURN credentials via Metered

Status: rejected in favor of 2026-08-28-004-relay-fallback-transport.md
Author: (drafted with Claude, for Jules to implement)
Related docs: none directly, but touches the same connection layer as
`2026-08-25-004-resilience-primitives.md` (ICE restart / `failed` handling)

## Motivation

The template already has *optional* TURN support (see README's "TURN Relay
Configuration" section), but it's wired up the only way that's simple for a
static Astro build: three `PUBLIC_*` env vars
(`PUBLIC_TURN_URLS`/`_USERNAME`/`_CREDENTIAL`) baked into the client bundle
at build time and read directly in `src/transport/peer-connection.ts`:

```ts
const ICE_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    ...(import.meta.env.PUBLIC_TURN_URLS
      ? [{
          urls: import.meta.env.PUBLIC_TURN_URLS.split(","),
          username: import.meta.env.PUBLIC_TURN_USERNAME,
          credential: import.meta.env.PUBLIC_TURN_CREDENTIAL,
        }]
      : [])
  ]
};
```

That's fine for a self-hosted `coturn` box with a long-lived shared secret
you don't mind exposing (TURN username/password pairs are *meant* to be
handed to the browser — that part is inherent to how ICE works, not a bug).
It's a worse fit for a hosted provider like Metered/Open Relay, for two
reasons:

1. Metered's dashboard gives you an **account-level API key/secret key**,
   not a disposable per-session TURN username/password. That key can list,
   create, enable/disable, and rotate *all* your TURN credentials and pull
   usage data — baking it into `PUBLIC_*` would ship it to every visitor's
   browser and anyone could read it out of the JS bundle.
2. Even Metered's actual TURN username/password pairs are meant to be
   short-lived and minted per use (Metered's own docs recommend generating
   them via a backend call, specifically calling out that the minting call
   "should never be called from front-end"). `PUBLIC_TURN_*` has no way to
   express "mint a fresh credential per room" — it's one static pair,
   forever, for every player of every game.

Cloudflare's own TURN relay is free but only bundled with their SFU
product, which this template doesn't use (it's pure P2P WebRTC, no SFU).
Metered's free tier (via the Open Relay signup link) is a reasonable stand-in,
but only if we keep the account secret server-side and hand the client
short-lived, per-connection credentials instead.

## Design

Add a small server-side credential-minting step. Route it through the
`GameSession` Durable Object rather than as a stateless proxy, so that one
minted credential can be **cached and shared by every client in a room**
instead of each controller and the console independently hitting Metered.
This resolves the "per-room vs. per-client minting" open question from the
first draft of this doc — the DO is exactly where that kind of per-room
caching already lives (see `consoleToken`, which is lazily loaded from
durable storage on first access and then reused for the life of the room).

Unlike `worker-entry.ts`'s current custom `fetch`, an Astro endpoint gets
the full `request`, `url`, and `locals` — everything needed to forward to
the DO the same way `worker-entry.ts` does today. That includes
`/api/signaling`, not just `/api/turn-credentials`: the DO's response for
a WebSocket upgrade is `new Response(null, { status: 101, webSocket:
client })`, and there's no obvious reason an Astro endpoint couldn't
return that `Response` object just as directly as `worker-entry.ts`'s raw
`fetch` does today.

The one thing worth being upfront about: `webSocket` on a `Response` is a
Cloudflare Workers–specific extension, not part of the standard Fetch API.
Whether it survives depends on whether Astro's Cloudflare adapter returns
your endpoint's `Response` completely untouched, or reconstructs a new one
around it (e.g. to merge in cookies/headers) — a reconstruction that
doesn't explicitly re-attach `.webSocket` would silently break the
upgrade. Other frameworks (Hono, TanStack Start) do successfully forward a
raw upgrade request straight to a DO's `fetch()` from a route handler, so
the pattern itself is sound; this is specifically an "does Astro's
endpoint pipeline pass the Response through unmodified" question.

That's answerable without a production deploy: the Astro dev server (via
the Cloudflare adapter) runs on workerd itself, not a Node emulation — so
whatever behavior shows up under `pnpm dev` for `webSocket`/101 handling
is the same runtime behavior production has, not just an approximation of
it. Verify locally first, per the plan below; only fall back to a real
Cloudflare deploy if local behavior is ambiguous for some other reason
(e.g. a dev-only difference elsewhere in the Astro pipeline).

**Plan:** try it. Move both routes into Astro endpoints as described
below. Before considering it done, run `pnpm dev`, open the console, join
as a controller, and confirm the full WebRTC handshake completes over the
Astro-routed `/api/signaling` — not just that the HTTP upgrade itself
returns 101. If it breaks — likely surfacing as the upgrade succeeding but
messages never flowing, or the socket closing immediately — revert just
that one file back to the `worker-entry.ts` intercept it has today (a
small, self-contained change) and keep `/api/turn-credentials` as the
Astro route regardless, since that one has no such risk (it's a plain
JSON response, nothing upgrade-related to preserve).

### New Astro routes

The Cloudflare adapter exposes Worker bindings (including `GAME_SESSION`
and any `vars`/secrets) on `Astro.locals.runtime.env`, so each route can
reach the DO the same way `worker-entry.ts` does today, just via `locals`
instead of a function argument.

`src/pages/api/turn-credentials.ts`:

```ts
// src/pages/api/turn-credentials.ts
import type { APIRoute } from "astro";

export const GET: APIRoute = async ({ request, url, locals }) => {
  const code = url.searchParams.get("code");
  if (!code) return new Response("Missing code", { status: 400 });

  const env = locals.runtime.env;
  const id = env.GAME_SESSION.idFromName(code.toUpperCase());
  return env.GAME_SESSION.get(id).fetch(request);
};
```

(`output: 'server'` is already set in `astro.config.mjs`, so no
`prerender = false` export is needed — that's only required to opt a
route *out* of static generation, and this project's default is already
server-rendered.)

`src/pages/api/signaling.ts` — same shape, moved wholesale from
`worker-entry.ts`:

```ts
// src/pages/api/signaling.ts
import type { APIRoute } from "astro";

export const GET: APIRoute = async ({ request, url, locals }) => {
  const code = url.searchParams.get("code");
  if (!code) return new Response("Missing code", { status: 400 });

  const env = locals.runtime.env;
  const id = env.GAME_SESSION.idFromName(code.toUpperCase());
  return env.GAME_SESSION.get(id).fetch(request);
};
```

If this pans out, `worker-entry.ts` shrinks to just what a Worker main
module is required to provide — the Durable Object class export — with
everything else delegated straight to Astro's own entrypoint:

```ts
// src/worker-entry.ts
export { GameSession } from "./lib/GameSession";
export { default } from "@astrojs/cloudflare/entrypoints/server";
```

If `/api/signaling` turns out not to survive Astro's pipeline (see above),
keep its `worker-entry.ts` branch as it exists today and only move
`/api/turn-credentials` out — `worker-entry.ts` would then look like:

```ts
// src/worker-entry.ts (fallback, if /api/signaling can't move)
export { GameSession } from "./lib/GameSession";
import exports from "@astrojs/cloudflare/entrypoints/server";

export default {
  async fetch(request: Request, env: any, ctx: any) {
    const url = new URL(request.url);
    if (url.pathname === "/api/signaling") {
      const code = url.searchParams.get("code");
      if (!code) return new Response("Missing code", { status: 400 });
      const id = env.GAME_SESSION.idFromName(code.toUpperCase());
      return env.GAME_SESSION.get(id).fetch(request);
    }
    return exports.fetch(request, env, ctx);
  }
};
```

Either way, the DO-side handling is unchanged from the original design — `GameSession`
still needs the same branch in `fetch()` to handle this forwarded request,
the same way it handles signaling WebSocket upgrades. Only *how the
request reaches the DO* changes, from a `worker-entry.ts` branch to an
Astro endpoint reading `locals.runtime.env`:

```ts
// src/lib/GameSession.ts
async fetch(request: Request): Promise<Response> {
  await this.hydrateIfNeeded();

  const url = new URL(request.url);
  if (url.pathname === "/api/turn-credentials") {
    return this.getTurnCredentials();
  }

  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
    return new Response("Expected Upgrade: websocket", { status: 426 });
  }
  // ...unchanged
}
```

`getTurnCredentials` is a new private method on `GameSession`. It checks an
in-memory cache first (fast path — most requests in a room hit this),
falls back to durable storage (survives DO eviction, same pattern as
`consoleToken`), and only calls out to Metered when there's nothing cached
or the cached credential is close to expiring:

```ts
// src/lib/GameSession.ts
private cachedTurnCredentials: { iceServers: RTCIceServer[]; expiresAt: number } | null = null;

private async getTurnCredentials(): Promise<Response> {
  const now = Date.now();

  if (!this.cachedTurnCredentials && this.ctx?.storage?.get) {
    this.cachedTurnCredentials =
      (await this.ctx.storage.get("turnCredentials")) ?? null;
  }

  // Refresh a bit before actual expiry so an in-flight negotiation
  // never gets handed a credential that dies mid-handshake.
  if (this.cachedTurnCredentials && this.cachedTurnCredentials.expiresAt > now + 60_000) {
    return Response.json({ iceServers: this.cachedTurnCredentials.iceServers });
  }

  const minted = await mintMeteredCredentials(this.env);
  if (!minted) {
    // TURN not configured, or Metered call failed — client falls back to STUN-only.
    return Response.json({ iceServers: [] });
  }

  this.cachedTurnCredentials = {
    iceServers: minted.iceServers,
    expiresAt: now + minted.expiryInSeconds * 1000
  };
  if (this.ctx?.storage?.put) {
    await this.ctx.storage.put("turnCredentials", this.cachedTurnCredentials);
  }
  return Response.json({ iceServers: minted.iceServers });
}
```

`mintMeteredCredentials` (new file, `src/lib/turn-credentials.ts`) is the
part that actually talks to Metered, kept as a standalone function so it's
unit-testable without a DO in the loop:

```ts
// src/lib/turn-credentials.ts
export async function mintMeteredCredentials(env: {
  METERED_APP_DOMAIN?: string;
  METERED_SECRET_KEY?: string;
}): Promise<{ iceServers: RTCIceServer[]; expiryInSeconds: number } | null> {
  if (!env.METERED_APP_DOMAIN || !env.METERED_SECRET_KEY) return null;

  const expiryInSeconds = 4 * 3600; // covers the longest realistic party-game session
  const resp = await fetch(
    `https://${env.METERED_APP_DOMAIN}.metered.live/api/v1/turn/credential` +
      `?secretKey=${env.METERED_SECRET_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expiryInSeconds, label: "webgame" })
    }
  );
  if (!resp.ok) return null;

  const { username, password } = await resp.json<{ username: string; password: string }>();
  return {
    expiryInSeconds,
    iceServers: [
      {
        urls: [
          `turn:${env.METERED_APP_DOMAIN}.metered.live:80`,
          `turn:${env.METERED_APP_DOMAIN}.metered.live:443`,
          `turns:${env.METERED_APP_DOMAIN}.metered.live:443`
        ],
        username,
        credential: password
      }
    ]
  };
}
```

(Exact URL set/ports up to whatever Metered's dashboard shows for your
domain — the "Get TURN Credential" endpoint also just returns a ready-made
`iceServers` array directly if you'd rather proxy that shape verbatim
instead of hand-assembling `urls`. Either is fine; the important part is
that only `username`/`password` — the disposable, expiring pair — ever
reaches the client, never `METERED_SECRET_KEY`.)

One credential pair now covers an entire room for its ~4h lifetime: the
console and every controller that joins or rejoins that room hit the same
cached value, so a 4-player game costs one Metered mint instead of five
(console + 4 controllers). This is the same trust boundary as before
(only the disposable username/password reaches any client) with the added
benefit of cutting Metered API calls roughly to one per room instead of
one per connection.

### Client: fetch before constructing `RTCPeerConnection`

`peer-connection.ts` currently builds `ICE_CONFIG` synchronously at module
load from `import.meta.env`. Since credentials now come from an async
fetch, `PeerConnection` needs its ICE servers passed in rather than
computed internally:

```ts
// src/transport/peer-connection.ts
export async function fetchIceServers(roomCode: string): Promise<RTCIceServer[]> {
  const stun = { urls: "stun:stun.l.google.com:19302" };
  try {
    const resp = await fetch(`/api/turn-credentials?code=${roomCode}`);
    const { iceServers } = await resp.json<{ iceServers: RTCIceServer[] }>();
    return [stun, ...iceServers];
  } catch {
    return [stun]; // network hiccup or TURN not configured — STUN-only
  }
}

export class PeerConnection {
  constructor(
    public isInitiator: boolean,
    private callbacks: PeerConnectionCallbacks,
    iceServers: RTCIceServer[]
  ) {
    this.pc = new RTCPeerConnection({ iceServers });
    // ...unchanged
  }
}
```

Call sites (`console.ts`'s `handleSignal`, `controller.ts`'s
`initiateWebRTC`) both already sit inside `async` methods and already have
`this.code` (the room code, same value used to build the `/api/signaling`
WebSocket URL), so this is a one-line change at each: `await
fetchIceServers(this.code)` once, cached on the instance for the page's
lifetime — no need to refetch per controller on the console side, since
the DO is now doing the room-level caching described above and will hand
back the same credential regardless of which client in the room asks.

### Config surface

Two things replace the three `PUBLIC_TURN_*` vars:

- `METERED_APP_DOMAIN` — not secret, just your Metered subdomain (e.g.
  `myapp` for `myapp.metered.live`). Fine as a plain `vars` entry in
  `wrangler.jsonc` or a `.dev.vars` line.
- `METERED_SECRET_KEY` — secret, set via
  `wrangler secret put METERED_SECRET_KEY` (production) and `.dev.vars`
  locally (already gitignored, same as any other local secret). Never
  prefixed `PUBLIC_`, never touched by the client bundle.

Both are optional — same "opt-in" posture the current TURN support has.
Missing either one makes `/api/turn-credentials` return `{ iceServers: [] }`
and the app runs STUN-only, exactly like today when the `PUBLIC_TURN_*`
vars are unset.

`scripts/init.ts` already prompts for and sets `CLOUDFLARE_API_TOKEN`/
`CLOUDFLARE_ACCOUNT_ID` as GitHub Secrets for the deploy pipeline. Add an
optional prompt there ("Set up a TURN relay now? [y/N]") that, if accepted,
asks for the Metered domain + secret key and runs
`gh secret set METERED_SECRET_KEY --body ...` plus wires
`METERED_APP_DOMAIN` into the deploy workflow's env, alongside the existing
`PUBLIC_COMMIT_HASH` line in `.github/workflows/main.yml`. Keep it skippable
— plenty of games will only ever be tested on trusted networks and don't
need this.

### Files touched

| File | Change |
|---|---|
| `src/lib/turn-credentials.ts` | New. `mintMeteredCredentials(env)` — the actual Metered call, standalone and unit-testable. |
| `src/lib/GameSession.ts` | Add `cachedTurnCredentials` field + `getTurnCredentials()` method; branch on `/api/turn-credentials` at the top of `fetch()` before the WebSocket-upgrade check. |
| `src/pages/api/turn-credentials.ts` | New. Astro API route (`GET`) reading `Astro.locals.runtime.env.GAME_SESSION` and forwarding to the room's DO instance. |
| `src/pages/api/signaling.ts` | New. Astro API route, moved from `worker-entry.ts` — **contingent on verifying the 101/`webSocket` response survives Astro's endpoint pipeline** (see Design). |
| `src/worker-entry.ts` | Shrinks to just the `GameSession` export + delegating to Astro's entrypoint, if both routes move successfully. Keep the `/api/signaling` branch as a fallback otherwise. |
| `src/transport/peer-connection.ts` | Replace module-level `ICE_CONFIG` with `fetchIceServers(roomCode)`; take `iceServers` as a constructor param. |
| `src/host/console.ts` | `await fetchIceServers(this.code)` once, pass to each `new PeerConnection(false, ..., iceServers)`. |
| `src/host/controller.ts` | Same, in `initiateWebRTC()`. |
| `src/lib/GameSession.test.ts` | Add cases: first request mints and caches, second request (same room) reuses the cache without a second Metered call, cache survives a simulated DO re-instantiation (reads from `ctx.storage`), missing env vars → `{ iceServers: [] }`. |
| `src/pages/api/turn-credentials.ts` (test) | Add a route test (using Astro's container API or a lightweight mock of `locals.runtime.env`) asserting a missing `code` param 400s and a present one forwards to the right DO id. |
| `src/transport/peer-connection.test.ts` | Update to pass `iceServers` directly instead of relying on env vars — tests get simpler, not harder. |
| `wrangler.jsonc` | Add `METERED_APP_DOMAIN` under `vars` (commented out / empty by default). |
| `scripts/init.ts` | Optional prompt to set `METERED_SECRET_KEY` + `METERED_APP_DOMAIN`. |
| `.github/workflows/main.yml` | Pass `METERED_APP_DOMAIN` through to the deploy step's env if set. |
| `README.md` | Replace "TURN Relay Configuration" section with Metered setup instructions (signup link, where to find domain/secret key, `wrangler secret put` command). |

## Why not just keep it simpler and ship Metered's own scoped API key to the client?

Metered's docs mention the credential shown in "Show API Key" next to a
manually-created TURN credential is itself safe for front-end use, since
it's scoped to that one credential rather than the account. That's a valid
lighter-weight alternative if you only ever want *one* static credential
pool shared by every room forever — basically today's `PUBLIC_TURN_*`
pattern with Metered's URLs filled in, no server code needed. It doesn't
buy you per-room rotation, expiry, or usage labeling, and it still means a
long-lived credential sits in the public bundle indefinitely. Given the
user's ask to keep API keys server-side, and that the server-issued
approach is barely more code (one route, one fetch), that's the one this
doc recommends. The static-credential path is a reasonable fallback to
mention in the README for anyone who'd rather skip the server round trip.

## Open questions

- **`locals.runtime.env` typing.** The Cloudflare adapter's `Locals` typing
  needs the `Runtime<Env>` augmentation (typically declared in
  `src/env.d.ts` or similar) for `locals.runtime.env.GAME_SESSION` to be
  typed rather than `any` — check what's already set up for this project
  (the existing `worker-entry.ts` just types `env: any`, so this may be
  new plumbing, not just a reuse of something already there).
- **Local dev without a Metered account.** `wrangler dev` won't have
  `METERED_SECRET_KEY` set unless it's in `.dev.vars`; confirm the
  STUN-only fallback path is exercised by a test so this doesn't silently
  break local development for contributors who haven't signed up.
- **`turn.metered.live` vs. Open Relay-branded URLs.** The signup link in
  the prompt goes through `dashboard.metered.ca` with `?tool=turnserver`,
  which is Metered's own TURN product (Open Relay was folded into it) —
  worth a one-line README note so people don't go hunting for a
  separately-branded "Open Relay" dashboard that mostly redirects here now.
