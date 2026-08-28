// src/utils/isController.ts — single source of truth,
// used by the inline head script in Base.astro (duplicated by hand) AND by both host bootstraps.
export function isController(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).has("code");
}
