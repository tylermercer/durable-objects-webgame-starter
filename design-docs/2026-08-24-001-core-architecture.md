# Console + Controllers Starter — Architecture

## 1. What this is

A starter template for browser-based multiplayer party games in the "Jackbox" mold:

- A **console** — a game rendered on a desktop/laptop browser, shown on a shared screen (TV, monitor, projector).
- One or more **controllers** — each player's phone browser, used as an input device.

Players open the console's URL, scan a QR code shown on screen, and their phone becomes a controller for that session. The console shows live connection status for each controller and echoes back the raw touch events it receives, as proof that the input pipe works end-to-end. Actual game logic is left for whoever builds on top of this template.

This document describes the target architecture for a coding agent to implement. It builds on two existing repos:

- **Base template:** [`astro-cloudflare-starter`](https://github.com/tylermercer/astro-cloudflare-starter) — Astro + Cloudflare Workers, static output with per-route SSR opt-in, path aliases (`@components`, `@layouts`, `@utils`, etc.).
- **Signaling reference:** [`quickshare-durable-objects`](https://github.com/tylermercer/quickshare-durable-objects) — demonstrates the pattern of using a Durable Object as a WebSocket signaling relay for WebRTC, deployed on the same Worker as the Astro site. This template reuses that pattern but replaces IP-based peer grouping with room-code-based grouping, and replaces the symmetric "any peer talks to any peer" model with an asymmetric console/controller model.
- **Signaling transport:** [`capnweb`](https://github.com/cloudflare/capnweb) — Cloudflare's JSON-based, object-capability RPC library. Used for the DO ↔ console/controller signaling channel only (see §3). It's a young library (actively shipping releases), so pin a version and expect its API surface to keep moving for a while.

## 2. High-level flow

1. A browser opens `/` with no `code` query param → it's treated as a **console**.
2. The console generates a short random **room code** client-side and renders a QR code linking to `/?code=<ROOMCODE>`.
3. The console opens a WebSocket to `/api/signaling?code=<ROOMCODE>&role=console`. This routes (via `idFromName(code)`) to a **`GameSession` Durable Object** unique to that room code.
4. A player scans the QR code (or otherwise opens the link). Their browser loads `/?code=<ROOMCODE>` → it's treated as a **controller**.
5. The controller opens a WebSocket to `/api/signaling?code=<ROOMCODE>&role=controller`.
6. The `GameSession` DO introduces the controller to the console over a [capnweb](https://github.com/cloudflare/capnweb) RPC session running on that WebSocket. They perform a WebRTC offer/answer/ICE exchange relayed through the DO via RPC calls.
7. Once the `RTCPeerConnection` between the console and that controller is established, they communicate directly, peer-to-peer, over WebRTC data channels — the DO is no longer in the data path (it's only used for signaling and presence).
8. The controller sends touch events over its data channel. The console renders per-controller connection status and a live visualization of incoming touch events.
9. Any number of controllers can join the same room concurrently; each gets its own independent `RTCPeerConnection` to the console.

```
   Console (laptop)                 Cloudflare Worker                Controller (phone)
   ───────────────                  ──────────────────                ─────────────────
   GET /              ───────────▶  Astro SSR (role=console)
   WS /api/signaling?code=X&role=console
                       ───────────▶  GameSession DO (id = "X")
                                     [capnweb RPC session]
                                            ▲
                                            │  WS /api/signaling?code=X&role=controller
                                            │◀────────────────────────  GET /?code=X
                                            │◀────────────────────────  WS connect
                                            │                     [capnweb RPC session]
   ◀── callbacks.onControllerJoined(id,name)┤
   ── api.sendSignal(id, offer) ────────────┼───────────────────────▶
                                             │◀── api.sendSignal(answer) ─
   ◀────────────────────────────────────────┼── api.sendSignal(ICE) ──▶
                       (RTCPeerConnection negotiated via DO-relayed RPC calls)
   ◀═══════════════════════ WebRTC data channels (P2P) ══════════════▶
                       touch events, status, game messages
```

## 3. Durable Object: `GameSession`

Replaces `SignalingServer` from the reference project. One instance per room code (`env.GAME_SESSION.idFromName(roomCode)`), so the DO doubles as the natural "room" abstraction — no separate room-creation API is needed.

### 3.1 Responsibilities

- Accept WebSocket upgrades from consoles and controllers for its room.
- Run a [capnweb](https://github.com/cloudflare/capnweb) RPC session on each socket instead of hand-parsing JSON message envelopes (see §3.2–3.4).
- Track connected sessions in memory: `Map<WebSocket, { id: string; role: 'console' | 'controller'; name: string; callbacks: RpcStub<ConsoleCallbacks | ControllerCallbacks> }>`.
- Enforce **at most one active console** per room. If a new console connects while one is already present, close the old console socket (treat it as a reconnect/refresh — see §6.3) rather than rejecting the new one, since the starter has no way to distinguish "same device refreshing" from "a different device."
- Assign each controller a short display identity on join (e.g. `Player 1`, `Player 2`, ... in join order, or a name/color from a fun word list like the reference project's boat-name generator). Return it to the controller and announce it to the console.
- Relay WebRTC signaling calls between a specific controller and the console (never controller-to-controller) via direct RPC method calls rather than an addressed message envelope.
- Push presence changes (controller joined/left) to the console by calling methods on its stored callback stub.
- Push console-availability changes to controllers the same way, so a controller knows when to (re-)initiate WebRTC negotiation.
- Clean up its `sessions` map entry — and dispose the corresponding callback stub — on socket close, exactly like the reference project's `close` handler.

### 3.2 Why capnweb here, and only here

This DO ↔ client channel is a natural fit for capnweb: it's low-frequency, needs to be reliable and ordered anyway (it's WebSocket signaling, not the real-time input path), and is inherently bidirectional — the DO needs to *push* events to clients (`onControllerJoined`, `onConsoleReady`, forwarded WebRTC signals) as much as clients need to call *into* it. Cap'n Web's support for passing a callback `RpcTarget` into an RPC call is exactly this pattern: instead of hand-writing a `type`-tagged JSON union and a `switch` on both ends, each side gets a typed interface and the DO just calls a method on the stub it was handed at connect time.

This is deliberately **not** used for the WebRTC data channels between console and controller (§6–7) — see §7 for why.

### 3.3 Shared RPC interfaces

```ts
// src/lib/signaling-api.ts — shared between GameSession (server) and console.ts/controller.ts (client)
import type { RpcTarget } from "capnweb";

export type RTCSignal = { sdp?: RTCSessionDescriptionInit } | { candidate?: RTCIceCandidateInit };

export interface ConsoleCallbacks extends RpcTarget {
  onControllerJoined(id: string, name: string): void;
  onControllerLeft(id: string): void;
  onSignal(from: string, signal: RTCSignal): void;
}

export interface ControllerCallbacks extends RpcTarget {
  onConsoleReady(): void;
  onConsoleGone(): void;
  onSignal(signal: RTCSignal): void;
}

// Exposed by the DO when role=console.
export interface ConsoleApi extends RpcTarget {
  join(callbacks: ConsoleCallbacks): { controllers: { id: string; name: string }[] };
  sendSignal(to: string, signal: RTCSignal): void;
}

// Exposed by the DO when role=controller.
export interface ControllerApi extends RpcTarget {
  join(callbacks: ControllerCallbacks): { id: string; name: string; consoleConnected: boolean };
  sendSignal(signal: RTCSignal): void; // implicitly addressed to the room's console
}
```

`join()` doubles as both the old `hello`/`welcome` handshake — the client calls it once right after connecting, hands over a callback stub, and gets back the initial state (matching the old `welcome` payload) in the same round trip.

### 3.4 Sketch

```ts
// src/lib/GameSession.ts
import { DurableObject } from "cloudflare:workers";
import { RpcTarget, newWebSocketRpcSession, type RpcStub } from "capnweb";
import type { ConsoleApi, ConsoleCallbacks, ControllerApi, ControllerCallbacks, RTCSignal } from "./signaling-api";

type Role = "console" | "controller";
type Session = { id: string; role: Role; name: string; callbacks: RpcStub<ConsoleCallbacks | ControllerCallbacks> };

export class GameSession extends DurableObject {
  sessions = new Map<WebSocket, Session>();

  async fetch(request: Request) {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected Upgrade: websocket", { status: 426 });
    }
    const role = new URL(request.url).searchParams.get("role") as Role;
    const { 0: client, 1: server } = new WebSocketPair();
    server.accept();

    if (role === "console") {
      for (const [ws, s] of this.sessions) {
        if (s.role === "console") { ws.close(4000, "replaced"); this.sessions.delete(ws); }
      }
      newWebSocketRpcSession(server, this.makeConsoleApi(server));
    } else {
      newWebSocketRpcSession(server, this.makeControllerApi(server));
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  private makeConsoleApi(ws: WebSocket): ConsoleApi {
    const self = this;
    return new (class extends RpcTarget implements ConsoleApi {
      join(callbacks: ConsoleCallbacks) {
        const controllers = [...self.sessions.values()].filter(s => s.role === "controller");
        self.sessions.set(ws, { id: "console", role: "console", name: "console", callbacks: callbacks.dup() });
        ws.addEventListener("close", () => self.handleClose(ws));
        // Any already-connected controllers should (re-)negotiate with the (possibly new) console.
        for (const s of controllers) (s.callbacks as RpcStub<ControllerCallbacks>).onConsoleReady();
        return { controllers: controllers.map(s => ({ id: s.id, name: s.name })) };
      }
      sendSignal(to: string, signal: RTCSignal) {
        self.sendToId(to, cb => (cb as RpcStub<ControllerCallbacks>).onSignal(signal));
      }
    })();
  }

  private makeControllerApi(ws: WebSocket): ControllerApi {
    const self = this;
    return new (class extends RpcTarget implements ControllerApi {
      join(callbacks: ControllerCallbacks) {
        const id = crypto.randomUUID();
        const name = self.nextPlayerName();
        const consoleConnected = [...self.sessions.values()].some(s => s.role === "console");
        self.sessions.set(ws, { id, role: "controller", name, callbacks: callbacks.dup() });
        ws.addEventListener("close", () => self.handleClose(ws));
        self.forConsole(cb => (cb as RpcStub<ConsoleCallbacks>).onControllerJoined(id, name));
        return { id, name, consoleConnected };
      }
      sendSignal(signal: RTCSignal) {
        const from = self.sessions.get(ws)!.id;
        self.forConsole(cb => (cb as RpcStub<ConsoleCallbacks>).onSignal(from, signal));
      }
    })();
  }

  private handleClose(ws: WebSocket) {
    const session = this.sessions.get(ws);
    this.sessions.delete(ws);
    if (!session) return;
    session.callbacks[Symbol.dispose]();
    if (session.role === "controller") {
      this.forConsole(cb => (cb as RpcStub<ConsoleCallbacks>).onControllerLeft(session.id));
    } else {
      for (const s of this.sessions.values()) {
        if (s.role === "controller") (s.callbacks as RpcStub<ControllerCallbacks>).onConsoleGone();
      }
    }
  }

  // ...sendToId / forConsole / nextPlayerName helpers: small lookups over `this.sessions`,
  // structurally the same role as the reference project's sendToPeer()/broadcast(), just
  // calling a method on a stored stub instead of ws.send(JSON.stringify(...)).
}
```

Client side (sketch — same shape for `console.ts` and `controller.ts`):

```ts
// console.ts
import { newWebSocketRpcSession, RpcTarget } from "capnweb";
import type { ConsoleApi, ConsoleCallbacks } from "@lib/signaling-api";

class MyConsoleCallbacks extends RpcTarget implements ConsoleCallbacks {
  onControllerJoined(id: string, name: string) { /* add row to UI, create RTCPeerConnection on first signal */ }
  onControllerLeft(id: string) { /* remove row, tear down peer connection */ }
  onSignal(from: string, signal: RTCSignal) { /* feed into that controller's RTCPeerConnection */ }
}

const api = newWebSocketRpcSession<ConsoleApi>(
  `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/api/signaling?code=${code}&role=console`,
);
const { controllers } = await api.join(new MyConsoleCallbacks());
// api.sendSignal(controllerId, signal) later, when relaying local ICE candidates / answers.
```

Note the `using`/disposal guidance from capnweb's docs applies here — this is a long-lived WebSocket session, so the callback stub the DO stores should be `.dup()`'d before retaining it past the `join()` call returning, and disposed on cleanup (shown above).

### 3.5 `wrangler.jsonc` additions

```jsonc
{
  "durable_objects": {
    "bindings": [{ "name": "GAME_SESSION", "class_name": "GameSession" }]
  },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["GameSession"] }]
}
```

### 3.6 `worker-entry.ts`

Same pattern as the reference project, but derive the DO id from the room code instead of the requester's IP:

```ts
if (url.pathname === '/api/signaling') {
  const code = url.searchParams.get('code');
  if (!code) return new Response('Missing code', { status: 400 });
  const id = env.GAME_SESSION.idFromName(code.toUpperCase());
  return env.GAME_SESSION.get(id).fetch(request);
}
```

## 4. Room codes

- Generated **client-side by the console** — no server round-trip needed to start a session, since the DO id is derived directly from the code via `idFromName`.
- Format: 5–6 characters from an unambiguous alphabet (uppercase letters and digits, excluding `0/O/1/I/L`) — long enough that two concurrently-active rooms colliding is very unlikely for a starter/demo use case, short enough to type manually as a fallback to scanning.
- Utility: `src/utils/generateRoomCode.ts`.
- The code is case-normalized (uppercased) before being used as the DO name, so it doesn't matter how it's typed or capitalized in the URL.
- **Known simplification:** codes aren't reserved or checked for collisions against other active rooms. Documented as a place to harden later (e.g. a KV-backed allocator) if this becomes a real product rather than a starter.

## 5. Page structure (Astro)

Single route handles both roles, matching the "QR code is just a link with a query param" requirement:

- **`src/pages/index.astro`** — `export const prerender = false;`. Reads `Astro.url.searchParams.get('code')` at request time:
  - **No `code`** → renders the console shell (`<ConsoleApp />`-equivalent markup + `src/scripts/console.ts`).
  - **`code` present** → renders the controller shell + `src/scripts/controller.ts`, passing the code into the script (e.g. via a `data-code` attribute, or reading `location.search` client-side — either works since it's the same param).

This keeps a single canonical URL pattern (`/` and `/?code=X`) rather than a separate `/controller` route, exactly matching the requested QR behavior.

### 5.1 File layout

```
src/
  lib/
    GameSession.ts           # Durable Object
    signaling-api.ts         # Shared capnweb RPC interfaces (§3.3) — imported by both DO and client scripts
  scripts/
    console.ts               # Console app entry (extends/replaces main.ts)
    controller.ts            # Controller app entry
    peer-connection.ts       # Shared: RTCPeerConnection wrapper (data channel setup, ICE handling)
  components/
    QrCode.astro / .ts        # Renders QR for a given URL (client-side lib, e.g. `qrcode`)
    ConnectionStatus.astro    # Per-controller status row
  utils/
    generateRoomCode.ts
  pages/
    index.astro
  worker-entry.ts
```

`peer-connection.ts` is shared between console and controller scripts since both sides need the same `RTCPeerConnection`/data-channel setup — only who initiates the offer differs (§6.1). `signaling-api.ts` replaces the old hand-rolled `signaling-client.ts` wrapper: it's just type declarations, since capnweb's `newWebSocketRpcSession()` handles the actual connection/reconnection plumbing (each script still needs its own small reconnect-with-backoff loop around it — see §6.3 — but no message parsing).

## 6. WebRTC layer

### 6.1 Who initiates

The **controller always initiates** the offer, once it knows a console is present (on receiving `welcome{consoleConnected:true}` or a later `console-ready`). This is simpler than the reference project's "offer lazily when there's something to send" approach, because here we always want the channel up immediately for responsive input — there's no equivalent of "nothing to send yet."

The console listens for inbound `signal` messages from unrecognized ids and lazily creates a matching `RTCPeerConnection` + registers an `ondatachannel` handler the first time it sees a given controller id.

### 6.2 Data channels

Two channels per connection, opened by the controller when it creates the `RTCPeerConnection`:

| Channel | Config | Used for |
|---|---|---|
| `input` | `{ ordered: false, maxRetransmits: 0 }` (unreliable/unordered — UDP-like) | High-frequency touch/pointer events. Stale positions aren't worth retransmitting; low latency matters more than delivery guarantees. |
| `control` | default (reliable, ordered) | Low-frequency, must-arrive messages: identity assignment, ping/pong, and future game-state messages. |

This two-channel split is a standard real-time game networking pattern and gives template users a ready-made place to add reliable game messages without touching the input path.

### 6.3 Reconnection behavior

- **Signaling socket:** both console and controller reconnect with backoff (e.g. 3s, matching the reference project) on close. Cap'n Web surfaces this via `stub.onRpcBroken()` on the session's main stub — treat that the same as a raw WebSocket `close` event and re-run `newWebSocketRpcSession()` + `join()`.
- **Console refresh/reconnect:** DO closes the stale console socket (which breaks its RPC session), the new one calls `join()` and gets the current controller list back directly as the return value, and the DO calls `onConsoleReady()` on every connected controller's stored callback stub so each one re-initiates a fresh `RTCPeerConnection` (old one is torn down client-side on `onConsoleGone()` or connection-state change). Controllers keep their assigned id/name only for the lifetime of their own socket — a console refresh doesn't reset them.
- **Controller refresh/reconnect:** treated as a brand-new controller (new id, new name/slot) — acceptable for a starter template; note in comments that persisting identity (e.g. via `localStorage` + a rejoin token) is a natural extension.
- **ICE failure / no TURN:** only public STUN (`stun.l.google.com:19302`) is configured by default, same as the reference project. This is usually fine when the console and phone share a network (the common case: same wifi), but a controller on cellular data or behind strict NAT may fail to connect. Document this as a known limitation with a comment showing where to add a TURN server via an environment variable/secret if needed.

## 7. Application-level message protocol (over the `input`/`control` data channels)

This is the seam where actual games get built. The starter only implements enough to prove the pipe works and to give a template to extend.

This layer stays plain JSON messages rather than capnweb, even on the reliable `control` channel: capnweb's RPC/disposal bookkeeping is designed for a stable session with a client and server, and adding it to *both* legs (DO signaling and the peer data channels) would mean two different stub lifecycles to manage for what's fundamentally simple, one-shot event passing. Reusing it here also wouldn't work uniformly, since the unreliable `input` channel can't support it at all (see §6.2) — so the transport would be split either way. Keeping this layer as plain messages keeps the two data channels symmetric and keeps the pattern game developers extend consistent.

**Controller → Console**, on `input` channel:

```ts
{ type: 'touch', phase: 'start' | 'move' | 'end' | 'cancel', pointerId: number, x: number, y: number /* normalized 0–1 */, t: number /* performance.now() */ }
```

**Console → Controller**, on `control` channel (starter demo only):

```ts
{ type: 'identity', name: string, color: string } // sent once, right after channel opens
```

**Both directions**, on `control` channel:

```ts
{ type: 'ping', t: number }
{ type: 'pong', t: number } // for latency display, optional nicety
```

Everything here is intentionally minimal and generic (`type` + payload) so a real game can add new message types without restructuring the transport.

## 8. UI behavior

### Console (`console.ts` + `index.astro` console shell)

- On load: generate room code, render QR code pointing at `${location.origin}/?code=${code}` (using a small client-side QR library such as `qrcode`), and open the signaling socket.
- Render one row per connected controller: name, connection state (`signaling` → `negotiating` → `connected` → `disconnected`), and a small live indicator (e.g. a dot that moves/lights up) driven by incoming `touch` messages — proof the data path works end-to-end.
- Rows appear/disappear as `controller-joined`/`controller-left` arrive from the DO and as each `RTCPeerConnection`'s state changes.

### Controller (`controller.ts` + `index.astro` controller shell)

- On load: read `code` from the URL, open the signaling socket, show a status line: `Connecting…` → `Waiting for console…` (if `consoleConnected: false`) → `Connected as <name>`.
- Full-viewport touch surface once connected; pointer/touch events are captured and sent over the `input` channel (throttled to a reasonable rate, e.g. via `requestAnimationFrame` batching, rather than one message per raw event).
- Shows its own assigned name/color once received via the `identity` control message.

## 9. Non-goals / explicit simplifications

- No in-app QR/code scanning — the QR code is just a deep link; the phone's native camera app handles scanning.
- No lobby/game-state machine (waiting room → playing → results) — out of scope for the starter; the `control` channel and the `GameSession` RPC interfaces (§3.3) are the extension points for building one.
- No TURN server by default — STUN only, documented limitation.
- No authentication/authorization on rooms — anyone with the code (or a guessed one) can join as a controller; acceptable for a party-game-in-person use case, not for anything sensitive.
- No persistence — room/session state lives only in the DO's in-memory `sessions` map for the lifetime of the connections, same as the reference project.
- `capnweb` is a young dependency (Cloudflare's own, but still shipping frequent releases) — pin an exact version and re-check its README/changelog if something in §3 doesn't match the installed API.

## 10. What to reuse vs. change from `astro-cloudflare-starter` / `quickshare-durable-objects`

| Keep as-is | Change |
|---|---|
| Astro + Cloudflare adapter setup, `wrangler.jsonc` base, path aliases, CI workflow | `SignalingServer` → `GameSession` (room-code-keyed instead of IP-keyed) |
| Pattern of routing `/api/signaling` to a DO in `worker-entry.ts` | Broadcast-to-all relay → directed relay by role/id, plus console/controller asymmetry |
| WebSocket reconnect-with-backoff pattern | Single symmetric peer list → console + list of controllers, with console-authoritative UI |
| — (new) | Hand-rolled `type`-tagged JSON signaling messages + `switch` dispatch → [capnweb](https://github.com/cloudflare/capnweb) RPC session per socket, with typed `join()`/`sendSignal()` calls and pushed callbacks (§3) |
| `RTCPeerConnection` + STUN setup, ICE candidate relay pattern | Lazy offer-on-send → controller always offers eagerly; single data channel → two channels (`input` unreliable, `control` reliable) |
