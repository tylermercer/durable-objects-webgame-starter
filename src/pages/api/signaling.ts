import type { APIRoute } from "astro";

export const prerender = false;

export const GET: APIRoute = async ({ request, url, locals }) => {
  const code = url.searchParams.get("code");
  if (!code) return new Response("Missing code", { status: 400 });

  const env = locals.runtime.env;
  const id = env.GAME_SESSION.idFromName(code.toUpperCase());
  return env.GAME_SESSION.get(id).fetch(request);
};
