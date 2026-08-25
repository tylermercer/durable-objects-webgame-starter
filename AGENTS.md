# Agent Instructions

## tsconfig.json Import Aliases

The `tsconfig.json` file defines import aliases for cleaner and more maintainable import paths. When working with imports, prefer using these aliases:

- `@styles/*`: maps to `src/styles/*`
- `@components/*`: maps to `src/components/*`
- `@assets/*`: maps to `src/assets/*`
- `@layouts/*`: maps to `src/layouts/*`
- `@utils/*`: maps to `src/utils/*`

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
