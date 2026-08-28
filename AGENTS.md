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
