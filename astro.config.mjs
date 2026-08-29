// @ts-check
import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";
import { defineConfig } from 'astro/config';
import { unified } from '@astrojs/markdown-remark';

// https://astro.build/config
export default defineConfig({
  site: 'https://durable-objects-webgame-starter.tmercer.workers.dev',
  session: false,
  output: 'server',
  adapter: cloudflare(),
  integrations: [react()],
  markdown: {
    processor: unified(),
  },
  vite: {
    ssr: {
      external: [
        'astro/container',
        'crypto',
        'fs',
        'path',
        'sharp',
        'esbuild',
      ].flatMap(id => [id, `node:${id}`]),
    },
  },
});