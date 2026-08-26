const getStorageKey = (roomCode?: string) =>
  roomCode ? `rejoin_token_${roomCode}` : "rejoinToken";

export function getOrCreateRejoinToken(roomCode?: string): string {
  const key = getStorageKey(roomCode);
  try {
    if (typeof localStorage !== "undefined") {
      let token = localStorage.getItem(key);
      if (!token) {
        token = crypto.randomUUID();
        localStorage.setItem(key, token);
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
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(key, token);
      return;
    }
  } catch {
    // Private browsing / storage disabled: fall back below
  }

  const sessionStore = ((globalThis as any).__sessionRejoinTokens ??= {});
  sessionStore[key] = token;
}
