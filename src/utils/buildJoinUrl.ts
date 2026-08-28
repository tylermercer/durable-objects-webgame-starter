export function buildJoinUrl(origin: string, code: string): string {
  const pathname = typeof window !== "undefined" ? window.location.pathname : "";
  return `${origin}${pathname}?code=${code}`;
}
