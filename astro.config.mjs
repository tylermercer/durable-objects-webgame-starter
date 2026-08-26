// @ts-check
import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";
import { defineConfig } from 'astro/config';
import { unified } from '@astrojs/markdown-remark';
import { generateRadixColorsSassFunctions } from "./lib/plugins/sass/radix-ui-colors/generateRadixColorsSassCustomFunction";
import remarkEmdash from './lib/plugins/remark/emdash.js';
import rawFonts from './lib/plugins/vite/rawFonts.js';

// https://astro.build/config
export default defineConfig({
  site: 'https://durable-objects-webgame-starter.tmercer.workers.dev',
  adapter: cloudflare(),
  integrations: [react()],
  markdown: {
    processor: unified(),
    remarkPlugins: [remarkEmdash],
  },
  vite: {
    plugins: [rawFonts(['.woff'])],
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
    css: {
      preprocessorOptions: {
        scss: {
          functions: {
            ...generateRadixColorsSassFunctions
          }
        }
      }
    },
  },
});