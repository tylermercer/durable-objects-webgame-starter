import { beforeEach, describe, expect, it, vi } from "vitest";
import { saveLocalGameState, loadLocalGameState, clearLocalGameState } from "./localGameState";

describe("localGameState", () => {
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

    saveLocalGameState(roomCode, state);
    const loaded = loadLocalGameState<typeof state>(roomCode);

    expect(loaded).toEqual(state);
    expect(mockStorage["game_state_ROOM123"]).toBe(JSON.stringify(state));
  });

  it("clears stored game state for a room code", () => {
    const roomCode = "ROOM123";
    saveLocalGameState(roomCode, { score: 100 });
    expect(loadLocalGameState(roomCode)).toEqual({ score: 100 });

    clearLocalGameState(roomCode);
    expect(loadLocalGameState(roomCode)).toBeNull();
    expect(mockStorage["game_state_ROOM123"]).toBeUndefined();
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
    saveLocalGameState(roomCode, { value: 123 });
    expect(loadLocalGameState(roomCode)).toEqual({ value: 123 });

    clearLocalGameState(roomCode);
    expect(loadLocalGameState(roomCode)).toBeNull();
  });
});
