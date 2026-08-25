# Astroflare

An opinionated starter for Astro on Cloudflare Workers, based on the setup I use for [Innerhelm](https://innerhelm.com), [Evelyn Escobar Art](https://evelynescobar.art), [my personal site](https://tylermercer.net), and other projects.

- Deploys to Cloudflare's global edge network using Workers
- Uses GitHub actions for its deploy pipeline, powering daily builds and PR previews
- Uses the [@astrojs/cloudflare](https://docs.astro.build/en/guides/integrations-guide/cloudflare/) adapter and Astro's new intelligent `static` build mode. This allows you to opt-in to SSR on a per-route basis by adding `export const prerender = false` to a route.
- Provides other niceties to speed up development, outlined [below](#features).

## Getting started

1.  **Use this repo as a template** by clicking the "Use this template" button at the top of the GitHub page.
2.  **Clone your new repository** to your local machine:
    ```bash
    git clone https://github.com/your-username/your-new-repo.git
    cd your-new-repo
    ```
3.  **Run the initialization script** and follow the instructions:
    ```bash
    bun ./scripts/init.ts
    ```

The script will handle installing dependencies (via `pnpm`), customizing your project name and theme, and setting up the necessary GitHub Secrets for automatic deployment to Cloudflare.

## Features

### Core folder aliases

The folders in `src` have aliases that make it easy to reference their contents. Instead of needing to import (for example) `../../../utils/foobar.ts` to pull a utility function into a route, you can import `@utils/foobar.ts`, from anywhere in your project.

Aliases are configured for the following directories:

- `assets` - Image and other media files
- `content` - Your Astro Content Collections
- `components` - Reusable components
- `layouts` - Astro layouts
- `pages` - Astro routes
- `utils` - Other utilities. I keep utility functions in this folder, each with their own file.

### Daily builds

Your site will automatically be built and deployed each day at 15:00 UTC. This allows you to do scheduled posts, by filtering out posts with a future date from each build.

**To remove:** Remove the `cron` trigger in `.github/workflows/main.yml`.

### Commit hash logging

`@layouts/Base.astro` invokes the utility function `logCommitHash` (from `@utils`) to log the current build's commit hash on page load. This hash is provided by the deployment pipeline.

**To remove:** Delete `src/utils/logCommitHash.ts`, remove the script tag from `src/layouts/Base.astro`, and delete `PUBLIC_COMMIT_HASH: ${{ ... }}` from `.github/workflows/main.yml`.