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
    server: {
      cors: false,
    },
    plugins: [
      {
        name: "cors-all",
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            res.setHeader("Access-Control-Allow-Origin", "*");
            res.setHeader("Access-Control-Allow-Methods", "*");
            res.setHeader("Access-Control-Allow-Headers", "*");
            next();
          });
        },
      },
    ],
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