import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@styles": path.resolve(import.meta.dirname, "./src/styles"),
      "@components": path.resolve(import.meta.dirname, "./src/components"),
      "@assets": path.resolve(import.meta.dirname, "./src/assets"),
      "@layouts": path.resolve(import.meta.dirname, "./src/layouts"),
      "@utils": path.resolve(import.meta.dirname, "./src/utils"),
      "@examples": path.resolve(import.meta.dirname, "./src/examples"),
      "@logic": path.resolve(import.meta.dirname, "./src/logic"),
      "@host": path.resolve(import.meta.dirname, "./src/host"),
      "@transport": path.resolve(import.meta.dirname, "./src/transport"),
      "@contract": path.resolve(import.meta.dirname, "./src/contract"),
      "@react": path.resolve(import.meta.dirname, "./src/react"),
    },
  },
});
