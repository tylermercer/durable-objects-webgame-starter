# Design Doc: Mobile Portrait Game Testing Page

## Context & Motivation

During local development and production testing of mobile-first party web games, engineers often need to simulate both the shared screen (**Console**) and player input device (**Controller**) on a single mobile device held in portrait orientation.

When testing on a physical phone or a simulated mobile viewport, having the Console on the top half of the screen and the Controller on the bottom half allows a single developer to inspect game loop rendering, state synchronization, and touch input responsiveness without switching tabs or needing a secondary computer screen.

## Goals

1. Provide a mobile portrait testing harness page (e.g. `/dev/portrait` or `/dev/mobile-portrait`) available in both development and production builds.
2. Render two zoomed-out `iframe` containers:
   - **Top half**: Console host view.
   - **Bottom half**: Controller client view.
3. Automatically pair the Controller iframe to the Console room once the Console signaling session is ready.
4. Ensure viewports and scaling inside both iframes remain accurate while disallowing fullscreen mode inside the embedded frames.

## Proposed Architecture & Design

### 1. Zoom Wrapper Component (`src/components/Zoom.astro`)

To scale down content inside iframes without distorting CSS layout dimensions or touch target coordinates, a reusable `Zoom` Astro component encapsulates CSS `transform: scale()`:

```astro
---
const { class: className = '', scale, ...rest } = Astro.props;
---
<style>
.zoom {
  overflow: hidden;
  --zoom-scale: .5;
  height: 100%;
  width: 100%;
}

.zoom-inner {
  transform-origin: 0 0;
  transform: scale(var(--zoom-scale));
  width: calc(100% / var(--zoom-scale));
  height: calc(100% / var(--zoom-scale));
}
</style>
<div class={"zoom " + className} style={scale ? `--zoom-scale: ${scale};` : ''} {...rest}>
  <div class="zoom-inner">
    <slot />
  </div>
</div>
```

### 2. Page Layout (`src/pages/dev/portrait.astro`)

The page is configured for SSR (`export const prerender = false;`) and split vertically into two 50vh flex halves:
- **Top Half (`.console-half`)**: Renders `<Zoom scale={scale}>` containing `<iframe id="console-frame" src={consoleSrc} allow="fullscreen 'none'" sandbox="allow-scripts allow-same-origin allow-forms" />`.
- **Bottom Half (`.controller-half`)**: Renders `<Zoom scale={scale}>` containing `<iframe class="ctrl-frame" allow="fullscreen 'none'" sandbox="allow-scripts allow-same-origin allow-forms" />`.

#### Disallowing Fullscreen inside Iframes
Both iframes explicitly omit `allowfullscreen` and specify `allow="fullscreen 'none'"`. This prevents controller buttons or browsers from expanding iframe content into native fullscreen over the portrait split view.

### 3. Mobile Viewport Console Role Override (`force_console=1`)

By default, `GameShell.astro` displays a "Join Game" form card on narrow/mobile viewports (`@media (max-width: 768px)`). Because the top console iframe has a narrow width in a mobile portrait layout, `GameShell.astro` and `Base.astro` need a mechanism to force console rendering:

1. **`src/layouts/Base.astro`**:
   Checks URL search parameters for `force_console` and adds `force-console` class to `document.documentElement`:
   ```html
   <script is:inline>
     const params = new URLSearchParams(location.search);
     if (params.has('code')) document.documentElement.classList.add('has-code');
     if (params.has('force_console')) document.documentElement.classList.add('force-console');
   </script>
   ```

2. **`src/components/GameShell.astro`**:
   Adds CSS rules to override mobile media query hiding when `html.force-console` is present:
   ```css
   :global(html.force-console) .console-shell {
     display: flex !important;
   }
   :global(html.force-console) .controller-shell,
   :global(html.force-console) .join-form-card {
     display: none !important;
   }
   ```

3. **Console URL**:
   The top console iframe URL is constructed as:
   ```ts
   const consoleSrc = `/play/${game}?force_console=1${transportQuery}`;
   ```

### 4. Cross-Iframe Auto-Pairing via `postMessage`

To prevent the Controller iframe from connecting to a room code before the Console signaling WebSocket session is joined:

1. **`ConsoleApp` (`src/host/console.ts`)**:
   - Listens for window `message` events matching `{ type: 'GET_CONSOLE_ROOM_CODE' }`.
   - When the Console signaling `join()` promise resolves, sets internal flag `isSignalingReady = true` and posts `{ type: 'CONSOLE_ROOM_READY', code: this.code }` to `window.parent`.
   - Responds to `GET_CONSOLE_ROOM_CODE` queries from `window.parent` whenever `isSignalingReady` is true.

2. **Parent Page Script (`src/pages/dev/portrait.astro`)**:
   - Listens for `CONSOLE_ROOM_READY` message from `window.parent`.
   - Polls `consoleFrame.contentWindow.postMessage({ type: 'GET_CONSOLE_ROOM_CODE' }, '*')` every 200ms until `CONSOLE_ROOM_READY` is received.
   - Once received, sets `.ctrl-frame` `src` to `/play/${game}?code=${code}${transportQuery}`.

## Verification & Testing Plan

1. **Playwright E2E Verification**:
   - Launch Playwright with a mobile portrait viewport (e.g. 390x844).
   - Navigate to `/dev/portrait?game=touch-demo&transport=relay`.
   - Wait for `postMessage` pairing; confirm Controller join form appears in bottom frame.
   - Fill player name, submit "Join Game", and verify status updates to `Connected to Console (Relay)` in both frames.
   - Capture screenshot and inspect visually.
2. **Build Verification**:
   - Run `pnpm test` and `pnpm build` to confirm static/SSR route compilation succeeds.
