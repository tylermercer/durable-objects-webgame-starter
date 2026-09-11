import { beforeEach, describe, expect, it, vi } from "vitest";
import { saveRoomState, getSavedRoomState, clearSavedRoomState, createConsoleStorage } from "./localGameState";

describe("localGameState and ConsoleStorage", () => {
  let mockStorage: Record<string, string> = {};

  beforeEach(() => {
    mockStorage = {};
    const fakeLocalStorage = {
      getItem: vi.fn((key: string) => mockStorage[key] ?? null),
      setItem: vi.fn((key: string, val: string) => {
        mockStorage[key] = val;
      }),
      clear: vi.fn(() => {
        mockStorage = {};
      }),
      removeItem: vi.fn((key: string) => {
        delete mockStorage[key];
      }),
      length: 0,
      key: vi.fn(() => null)
    };
    vi.stubGlobal("localStorage", fakeLocalStorage);
  });

  it("saves and loads game state in localStorage by room code", () => {
    const roomCode = "ROOM123";
    const state = { score: 42, player: "Alice" };

    saveRoomState(roomCode, state);
    const loaded = getSavedRoomState<typeof state>(roomCode);

    expect(loaded).toEqual(state);
    expect(mockStorage["game_state_ROOM123"]).toBe(JSON.stringify(state));
  });

  it("clears stored game state for a room code", () => {
    const roomCode = "ROOM123";
    saveRoomState(roomCode, { score: 100 });
    expect(getSavedRoomState(roomCode)).toEqual({ score: 100 });

    clearSavedRoomState(roomCode);
    expect(getSavedRoomState(roomCode)).toBeNull();
    expect(mockStorage["game_state_ROOM123"]).toBeUndefined();
  });

  it("provides createConsoleStorage with saveRoomState, getSavedRoomState, and clearSavedRoomState", () => {
    const roomCode = "CONSOLE_ROOM";
    const storage = createConsoleStorage(roomCode);
    const state = { level: 5, coins: 99 };

    expect(storage.getSavedRoomState()).toBeNull();

    storage.saveRoomState(state);
    expect(storage.getSavedRoomState()).toEqual(state);

    storage.clearSavedRoomState();
    expect(storage.getSavedRoomState()).toBeNull();
  });

  it("falls back gracefully when localStorage throws error", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("SecurityError");
      },
      removeItem: () => {
        throw new Error("SecurityError");
      }
    });

    const roomCode = "ROOM_FALLBACK";
    saveRoomState(roomCode, { value: 123 });
    expect(getSavedRoomState(roomCode)).toEqual({ value: 123 });

    clearSavedRoomState(roomCode);
    expect(getSavedRoomState(roomCode)).toBeNull();
  });
});
