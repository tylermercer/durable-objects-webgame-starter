import type { APIRoute } from "astro";

export const prerender = false;

export const GET: APIRoute = async ({ request, locals }) => {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (!code) return new Response("Missing code", { status: 400 });
  const env = (locals as any).runtime?.env;
  if (!env || !env.GAME_SESSION) {
    return new Response("Durable Object binding GAME_SESSION not found", { status: 500 });
  }
  const id = env.GAME_SESSION.idFromName(code.toUpperCase());
  return env.GAME_SESSION.get(id).fetch(request);
};
