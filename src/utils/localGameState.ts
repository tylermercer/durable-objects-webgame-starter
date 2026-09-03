const memoryStore = new Map<string, string>();

export function saveLocalGameState(roomCode: string, state: unknown): void {
  if (!roomCode) return;
  const key = `game_state_${roomCode}`;
  const serialized = JSON.stringify(state);
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(key, serialized);
      return;
    }
  } catch (err) {
    console.error("Failed to save local game state to localStorage:", err);
  }
  memoryStore.set(key, serialized);
}

export function loadLocalGameState<T = unknown>(roomCode: string): T | null {
  if (!roomCode) return null;
  const key = `game_state_${roomCode}`;
  try {
    if (typeof localStorage !== "undefined") {
      const saved = localStorage.getItem(key);
      if (saved) {
        return JSON.parse(saved) as T;
      }
      return null;
    }
  } catch (err) {
    console.error("Failed to load local game state from localStorage:", err);
  }
  const memorySaved = memoryStore.get(key);
  if (memorySaved) {
    try {
      return JSON.parse(memorySaved) as T;
    } catch {
      return null;
    }
  }
  return null;
}

export function clearLocalGameState(roomCode: string): void {
  if (!roomCode) return;
  const key = `game_state_${roomCode}`;
  memoryStore.delete(key);
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem(key);
    }
  } catch (err) {
    console.error("Failed to clear local game state from localStorage:", err);
  }
}
