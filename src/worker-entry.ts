export { GameSession } from "./lib/GameSession";
import exports from "@astrojs/cloudflare/entrypoints/server";

export default {
  async fetch(request: Request, env: any, ctx: any) {
    const url = new URL(request.url);
    if (url.pathname === "/api/signaling") {
      const code = url.searchParams.get("code");
      if (!code) return new Response("Missing code", { status: 400 });
      const id = env.GAME_SESSION.idFromName(code.toUpperCase());
      return env.GAME_SESSION.get(id).fetch(request);
    }
    return exports.fetch(request, env, ctx);
  }
};
