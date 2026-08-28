const getStorageKey = (roomCode?: string) =>
  roomCode ? `rejoin_token_${roomCode}` : "rejoinToken";

export function getOrCreateRejoinToken(roomCode?: string): string {
  const key = getStorageKey(roomCode);
  try {
    if (typeof sessionStorage !== "undefined") {
      let token = sessionStorage.getItem(key);
      if (!token) {
        token = crypto.randomUUID();
        sessionStorage.setItem(key, token);
      }
      return token;
    }
  } catch {
    // Private browsing / storage disabled: fall back below
  }

  // Fallback to in-memory session store
  const sessionStore = ((globalThis as any).__sessionRejoinTokens ??= {});
  return (sessionStore[key] ??= crypto.randomUUID());
}

export function persistRejoinToken(token: string, roomCode?: string): void {
  const key = getStorageKey(roomCode);
  try {
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.setItem(key, token);
      return;
    }
  } catch {
    // Private browsing / storage disabled: fall back below
  }

  const sessionStore = ((globalThis as any).__sessionRejoinTokens ??= {});
  sessionStore[key] = token;
}

const NAME_KEY = "playerName";

export function getSavedName(): string {
  try {
    return sessionStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

export function saveName(name: string): void {
  try {
    sessionStorage.setItem(NAME_KEY, name);
  } catch {
    // best-effort; a fresh prompt next time is an acceptable fallback
  }
}

export function sanitizeName(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().slice(0, 20);
  return trimmed.length > 0 ? trimmed : null;
}
