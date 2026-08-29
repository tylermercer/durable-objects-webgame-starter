/// <reference types="astro/client" />

declare namespace App {
  interface Locals {
    runtime: import("@astrojs/cloudflare").Runtime<{
      GAME_SESSION: DurableObjectNamespace;
      METERED_APP_DOMAIN?: string;
      METERED_SECRET_KEY?: string;
    }>;
  }
}
