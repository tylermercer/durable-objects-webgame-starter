# Agent Instructions

## tsconfig.json Import Aliases

The `tsconfig.json` file defines import aliases for cleaner and more maintainable import paths. **Always prefer using these path aliases everywhere** across the codebase instead of relative paths (`../` or `../../`):

- `@styles/*`: maps to `src/styles/*`
- `@components/*`: maps to `src/components/*`
- `@assets/*`: maps to `src/assets/*`
- `@layouts/*`: maps to `src/layouts/*`
- `@utils/*`: maps to `src/utils/*`
- `@examples/*`: maps to `src/examples/*`
- `@logic/*`: maps to `src/logic/*`
- `@host/*`: maps to `src/host/*`
- `@transport/*`: maps to `src/transport/*`
- `@contract/*`: maps to `src/contract/*`
- `@react/*`: maps to `src/react/*`

## Astro Configuration (astro.config.mjs)

The `astro.config.mjs` file contains the Astro project configuration. Key things to note:

- **Output Mode**: The site is configured for static output (`output: "static"`), but the project may have SSR routes, which will be designated by `export const prerender = false;` in the route Astro file.
- **Adapter**: It uses the `@astrojs/cloudflare` adapter for deployment.
- **Markdown**: A custom `remark-emdash` plugin is used to turn triple-hyphens into emdashes.
- **Vite Configuration**: Includes settings for raw font loading (used for OG images), and SSR external dependencies (to allow OG image generation at build time)

## Utility Functions (src/utils)

The `src/utils` directory contains various helper and utility functions, with each function typically residing in its own TypeScript file.

For example, `src/utils/getBaseUrl.ts` provides a function to get the base URL of the site, differentiating between production and development environments.

When looking for or creating reusable utility logic, check this directory first.

## Pages and Routing (src/pages)

The `src/pages` directory is where Astro's file-based routing happens. Each `.astro`, `.md`, or `.mdx` file in this directory (or its subdirectories) becomes a page on the site.

- **Static Routes**: Files like `src/pages/index.astro` create routes corresponding to their path (e.g., `/`).
- **Dynamic Routes**: The project uses dynamic routes for content collections. For example, `src/pages/posts/[slug].astro` generates pages for individual blog posts. The `getStaticPaths` function in these files is responsible for determining which paths are generated at build time.
- **API Routes**: Files in `src/pages/api/` are used to create API endpoints. For example, `src/pages/api/submit-form.ts`.

## WebGame Core Architecture

For complete architectural details, consult `design-docs/2026-08-24-core-architecture.md` as the authoritative source of truth.

### Key Files
- `src/lib/GameSession.ts`: Cloudflare Durable Object managing room sessions, presence, and capnweb RPC signaling relay.
- `src/lib/signaling-api.ts`: Shared capnweb RPC interface definitions for console and controller roles.
- `src/scripts/console.ts`: Client-side logic for the console application (host/shared screen).
- `src/scripts/controller.ts`: Client-side logic for controller application (player device/phone).
- `src/scripts/peer-connection.ts`: WebRTC peer connection manager handling data channels and ICE candidate exchanges.

### Data Channels & Protocols
The project uses two WebRTC data channels between the console and each controller:
- `input`: Unreliable and unordered channel used for high-frequency touch/pointer events.
- `control`: Reliable and ordered channel used for identity assignment, ping/pong latency checks, and game protocol messages.

When extending or building new gameplay features, extend the `control` channel's message protocol rather than modifying the signaling layer.

## Dev Harness & Playwright Verification

The dev-only route `/dev/harness` (`src/pages/dev/harness.astro`) embeds one console iframe (`#console-frame`) and N controller iframes (`.ctrl-frame`) on a single page, connected to the real Durable Object signaling backend and WebRTC/relay transport.

### Route & Query Parameters
- **URL**: `http://localhost:4321/dev/harness` (Only accessible in `DEV` mode; returns 404 when `!import.meta.env.DEV`).
- **Query Params**:
  - `game` (default `touch-demo`): Example game key matching `EXAMPLES` in `@examples/registry`.
  - `players` (default `2`): Number of controller iframes to render.
  - `transport` (default `relay`): Transport override (`relay`, `rtc`, or `auto`).

### Architecture & Isolation
- **Console Iframe (`#console-frame`)**: `sandbox="allow-scripts allow-same-origin allow-forms"`. Same-origin access allows the harness page to poll `consoleFrame.contentWindow.sessionStorage.getItem('console_room_code')` and dynamically set controller frame `src` attributes.
- **Controller Iframes (`.ctrl-frame`)**: `sandbox="allow-scripts allow-forms"` (without `allow-same-origin`). Each controller receives a unique opaque origin, isolating `sessionStorage` (`rejoin_token_<CODE>`, `playerName`) so embedded controllers act as independent devices without identity collisions.

### Python Playwright Verification Pattern
When verifying console + controller multi-device flows, write a Python script using `playwright.sync_api` (`/home/jules/verification/verify_harness.py`):

```python
from playwright.sync_api import sync_playwright, expect

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1280, "height": 960})

        # 1. Navigate to dev harness
        page.goto("http://localhost:4321/dev/harness?game=touch-demo&players=2&transport=relay")

        # 2. Access frame locators
        console = page.frame_locator("#console-frame")
        ctrl1 = page.frame_locator(".ctrl-frame").nth(0)
        ctrl2 = page.frame_locator(".ctrl-frame").nth(1)

        # 3. Wait for controllers to load room code URL and show join screen
        ctrl1.get_by_role("textbox").wait_for(state="visible", timeout=10000)

        # 4. Fill player names and join
        ctrl1.get_by_role("textbox").fill("Alice")
        ctrl1.get_by_role("button", name="Join").click()

        ctrl2.get_by_role("textbox").fill("Bob")
        ctrl2.get_by_role("button", name="Join").click()

        # 5. Capture combined console + controllers state in a single screenshot
        page.screenshot(path="/home/jules/verification/verification.png")
        browser.close()

if __name__ == "__main__":
    run()
```

Inspect the screenshot with `read_image_file('/home/jules/verification/verification.png')` and complete verification with `frontend_verification_complete('/home/jules/verification/verification.png')`.
