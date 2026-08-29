# Playwright Console+Controller Harness

**Date:** 2026-08-29
**Status:** Proposed
**Depends on:** `2026-08-28-004-relay-fallback-transport.md` (`force_transport` debug override — implemented)

## Motivation

Jules uses a Python Playwright workflow (`playwright.sync_api`) executed via `run_in_bash_session` against the local `astro dev` server (which runs on the Cloudflare adapter, so `GameSession` is a real, locally-emulated Durable Object — not a mock) to manually verify functionality and UI. Today that means executing complex multi-browser or multi-context scripts with separate tabs: one tab on `/play/<game>` for the console, and a separate tab per controller on `/play/<game>?code=<CODE>`. Verifying anything that spans roles — does the controller's tap actually move the dot on the console, does a reconnect banner clear correctly, does a second player's join show up in the lobby — requires Jules to navigate across separate tabs, making it impossible to capture the full multi-role state in a single screenshot for inspection (`read_image_file`) or frontend verification completion (`frontend_verification_complete`).

This doc proposes a single dev-only route, `/dev/harness`, that embeds one console and N controllers as iframes on one page, so Jules can drive and screenshot the whole console+controllers flow in one Playwright session against the real signaling DO and real WebRTC/relay transport — no mocking of `GameSession`, `PeerConnection`, or `RelayConnection`.

## Goals

- One URL Jules can open that shows a live console and any number of live controllers on one page, wired to the same room automatically (no manual QR-code or code-copying step).
- Exercises the real stack: real WebSocket signaling to the local DO, real `ConnectionOrchestrator`/`PeerConnection`/`RelayConnection` transport selection, real game logic (`src/examples/*` or, post-ejection, `src/logic/*`).
- Each embedded controller behaves like an independent device — distinct `rejoinToken`, distinct `playerName`, no cross-talk between controller frames.
- Works natively with Jules's Python Playwright verification toolset (`playwright.sync_api`): `frame_locator` against normal iframes, with a single `page.screenshot(...)` capturing all roles in one image.
- Configurable via query params (`game`, `players`, `transport`) so Jules can point it at any example without editing the harness.

## Non-goals

- Not a CI test suite. No assertions, no fixtures, no headless-run-on-every-PR wiring. This is a manual/agent-driven inspection tool, in the same spirit as the existing example switcher.
- Not a replacement for real multi-device testing before a game ships — same-machine iframes cannot validate cross-network NAT traversal, only that the signaling/negotiation/game-logic code paths run correctly.
- No change to `GameSession`, `ConnectionOrchestrator`, or any transport code. This is additive UI wiring on top of behavior that already exists (`force_transport`, `buildJoinUrl`, the example registry).
- Not included in the production build or the ejection flow — `bun ./scripts/eject.ts` should delete or ignore this route along with `src/examples/`, since it depends on `EXAMPLES`/`GameShell` in the same way the switcher does.

## Background: why naive iframes double-book player identity

`src/utils/deviceIdentity.ts` and `src/host/console.ts` store all per-device state in `sessionStorage`: `rejoin_token_<CODE>`, `playerName`, and (console side) `console_room_code` / `console_token_<CODE>`. `sessionStorage` is scoped per **top-level browsing context**, not per iframe — same-origin iframes sharing one tab share one `sessionStorage`. Give every iframe on the harness page `sandbox="allow-same-origin"` and every controller frame would write `rejoin_token_<CODE>` and `playerName` to the same bucket, so controller 2 would load controller 1's name and rejoin token and the two would effectively fight over one player slot.

The fix is to only grant `allow-same-origin` to the console iframe (there's exactly one, so no collision risk, and the harness needs to read `console_room_code` back out of it). Controller iframes get `sandbox="allow-scripts allow-forms"` **without** `allow-same-origin`, which gives each one a unique opaque origin per navigation. Opaque origins still permit `fetch`/`WebSocket`/`RTCPeerConnection` (sandbox doesn't gate networking, and the local dev server doesn't do origin-based auth on the signaling endpoint), but each frame's `sessionStorage` is private to that frame's opaque origin — exactly the "separate device" isolation real phones give you for free. The tradeoff: an opaque-origin frame's storage doesn't survive that frame's own reload, so this harness can't be used to test rejoin-after-refresh for a single controller in isolation (see Non-goals / Open questions).

## Design

### Route

`src/pages/dev/harness.astro`, guarded by `export const prerender = false;` plus a runtime check that returns a 404 outside `import.meta.env.DEV`, so it can never ship in a production build even if someone forgets to delete it during ejection.

Query params:

| Param | Default | Meaning |
|---|---|---|
| `game` | `touch-demo` | Key into `EXAMPLES` (`@examples/registry`) — same ids the switcher uses. |
| `players` | `2` | Number of controller iframes to render. |
| `transport` | `relay` | Forwarded to every controller (and the console, where relevant) as `force_transport`. Set to `rtc` to exercise real P2P, or omit/`auto` to leave transport selection untouched. |

### Layout

```
/dev/harness?game=liars-dice&players=3
┌─────────────────────────────────────────────┐
│ Console  (#console-frame)                    │
│  /play/liars-dice?force_transport=relay      │
└─────────────────────────────────────────────┘
┌───────────┐ ┌───────────┐ ┌───────────┐
│Controller1│ │Controller2│ │Controller3│
│.ctrl-frame│ │.ctrl-frame│ │.ctrl-frame│
│(src set   │ │(src set   │ │(src set   │
│ once code │ │ once code │ │ once code │
│ is known) │ │ is known) │ │ is known) │
└───────────┘ └───────────┘ └───────────┘
```

Console iframe: `sandbox="allow-scripts allow-same-origin allow-forms"`, `src="/play/<game>?force_transport=<transport>"`.

Controller iframes: `sandbox="allow-scripts allow-forms"`, `src` left empty until the room code is available, then set to `buildJoinUrl`'s own format — `/play/<game>?code=<CODE>&force_transport=<transport>` — reproduced client-side rather than imported, since `buildJoinUrl` reads `window.location` of its caller and the harness needs the *console frame's* pathname, not its own.

### Wiring script

A small inline script on the harness page polls the console iframe for its room code (available once `console.ts` either restores it from its own `sessionStorage` or generates a fresh one via `generateRoomCode()`), then stamps that code onto every controller iframe's `src`:

```js
const consoleFrame = document.getElementById('console-frame');
const gate = setInterval(() => {
  const code = consoleFrame.contentWindow?.sessionStorage.getItem('console_room_code');
  if (!code) return;
  clearInterval(gate);
  document.querySelectorAll('.ctrl-frame').forEach((frame) => {
    frame.src = `/play/${game}?code=${code}&force_transport=${transport}`;
  });
}, 200);
```

This works because the console frame *does* have `allow-same-origin`, so it's genuinely same-origin with the parent page and its `contentWindow.sessionStorage` is directly readable — no `postMessage` plumbing needed. Reading is polled rather than event-driven since `console.ts` doesn't currently emit a "room code ready" event; adding one is a one-line, low-risk addition to `console.ts` if the polling proves flaky in practice (see Open questions).

Each controller frame still goes through its normal name-entry screen on load (`getSavedName()` returns empty in a fresh opaque-origin frame, so `init()` shows `#name-screen`) — Jules's Python Playwright script fills that in per-frame via `page.frame_locator('.ctrl-frame').nth(i)`, same as it would on a real phone. This is deliberate: it keeps the harness exercising the real join UI rather than short-circuiting it.

### Interacting with it via Playwright

When verifying frontend changes, Jules writes a Python script (`/home/jules/verification/verify_harness.py`) using `playwright.sync_api` and runs it with `python /home/jules/verification/verify_harness.py` via `run_in_bash_session`.

- `page.frame_locator('#console-frame')` for console assertions/clicks.
- `page.frame_locator('.ctrl-frame').nth(i)` for controller `i`.
- `page.screenshot(path='/home/jules/verification/verification.png')` on the top-level page captures the console and all embedded controllers in a single image.
- Visual inspection is done via `read_image_file('/home/jules/verification/verification.png')`, and verification is finalized with `frontend_verification_complete('/home/jules/verification/verification.png')`.

#### Example Python Playwright Verification Script

```python
from playwright.sync_api import sync_playwright, expect

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        # Allocate sufficient viewport dimensions for console + side-by-side controllers
        page = browser.new_page(viewport={"width": 1280, "height": 960})

        # 1. Navigate to the harness for the desired game and player count
        page.goto("http://localhost:4321/dev/harness?game=touch-demo&players=2&transport=relay")

        # 2. Access console and controller frame locators
        console = page.frame_locator("#console-frame")
        ctrl1 = page.frame_locator(".ctrl-frame").nth(0)
        ctrl2 = page.frame_locator(".ctrl-frame").nth(1)

        # 3. Wait for controller frames to receive the dynamically populated room code URL
        ctrl1.get_by_role("textbox").wait_for(state="visible", timeout=10000)

        # 4. Fill in player names on both controllers
        ctrl1.get_by_role("textbox").fill("Alice")
        ctrl1.get_by_role("button", name="Join").click()

        ctrl2.get_by_role("textbox").fill("Bob")
        ctrl2.get_by_role("button", name="Join").click()

        # 5. Verify interaction (e.g. click on controller 1 surface)
        ctrl1.locator("#touch-surface").click(position={"x": 100, "y": 150})

        # 6. Take full-page screenshot capturing console + all controllers simultaneously
        page.screenshot(path="/home/jules/verification/verification.png")
        browser.close()

if __name__ == "__main__":
    run()
```

## Implementation plan

1. Add `src/pages/dev/harness.astro` with the route guard, query-param parsing, and the layout above, importing `EXAMPLES` from `@examples/registry` the same way `index.astro` does.
2. Add the polling/wiring script as a small inline `<script define:vars={...}>` block (no new module needed — this is harness-only glue, not reusable app code).
3. Confirm `bun ./scripts/eject.ts` either already skips `src/pages/dev/` or add it to the same deletion step that removes `src/pages/play/` and `src/examples/`, since the harness is meaningless once the example registry is gone.
4. Manually verify using Jules's Python Playwright workflow against each of the four existing examples (`touch-demo`, `liars-dice`, `flappy-royale`, `grid-dungeon`) with `players` set to 1, 2, and the example's practical max.

## Testing

- No automated tests — this is a dev tool, not shipped behavior (see Non-goals).
- Manual verification checklist for the initial implementation:
  - Loading `/dev/harness?game=touch-demo&players=2` results in both controller frames auto-joining the same room code within the polling window, with no name/token collisions (each shows its own name-entry screen, and both can pick different names).
  - Touch input from controller frame 1 moves only that player's dot on the console frame; same for frame 2.
  - `transport=relay` forces relay on every frame (verify via existing status UI, same indicator used for the `force_transport` param today); `transport=rtc` allows real P2P negotiation between same-machine frames.
  - Reloading a single controller frame gets a fresh opaque origin and re-shows the name screen (expected, documented limitation — not a bug).
  - Route 404s when built for production (`pnpm build && pnpm preview`, confirm `/dev/harness` isn't reachable).

## Open questions

- Is polling `sessionStorage` for `console_room_code` reliable enough, or should `console.ts` gain a one-line custom event (`window.dispatchEvent(new CustomEvent('console-room-ready', { detail: code }))`) that the harness can listen for instead? Recommend starting with polling since it requires zero changes to shipped code, and only adding the event if Jules reports flakiness in practice.
- Should the harness support a "console has no controllers yet" screenshot vs. "controllers joined" screenshot as two distinct states Jules can request, or is a single fully-joined view sufficient? Leaning toward leaving this to Jules's Python Playwright verification script (it can take `page.screenshot()` at any point in execution) rather than building state capture into the harness itself.
- Worth adding a `names` param (comma-separated) so Jules can pre-fill controller names instead of typing them per frame? Would save a few interactions per script run but adds param-parsing surface for a tool only Jules uses — recommend deferring until it's clear how often Jules re-runs this against the same game.
