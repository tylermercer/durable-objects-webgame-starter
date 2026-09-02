import { beforeEach, describe, expect, it, vi } from "vitest";
import { getOrCreateRejoinToken, persistRejoinToken, clearRejoinToken, hasRejoinToken, getSavedName, saveName, sanitizeName } from "./deviceIdentity";

describe("deviceIdentity", () => {
  let mockStorage: Record<string, string> = {};

  beforeEach(() => {
    mockStorage = {};
    delete (globalThis as any).__sessionRejoinTokens;

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

  it("creates and persists a token in localStorage", () => {
    const token = getOrCreateRejoinToken("ROOM1");
    expect(token).toBeDefined();
    expect(mockStorage["rejoin_token_ROOM1"]).toBe(token);

    const retrieved = getOrCreateRejoinToken("ROOM1");
    expect(retrieved).toBe(token);
  });

  it("keys rejoin tokens by room code in localStorage", () => {
    const token1 = getOrCreateRejoinToken("ROOMA");
    const token2 = getOrCreateRejoinToken("ROOMB");

    expect(token1).not.toBe(token2);
    expect(mockStorage["rejoin_token_ROOMA"]).toBe(token1);
    expect(mockStorage["rejoin_token_ROOMB"]).toBe(token2);
  });

  it("updates token when persistRejoinToken is called", () => {
    getOrCreateRejoinToken("ROOM1");
    persistRejoinToken("new-token-123", "ROOM1");
    expect(mockStorage["rejoin_token_ROOM1"]).toBe("new-token-123");
    expect(getOrCreateRejoinToken("ROOM1")).toBe("new-token-123");
  });

  it("removes token when clearRejoinToken is called", () => {
    const token = getOrCreateRejoinToken("ROOM1");
    expect(mockStorage["rejoin_token_ROOM1"]).toBe(token);
    clearRejoinToken("ROOM1");
    expect(mockStorage["rejoin_token_ROOM1"]).toBeUndefined();
  });

  it("checks whether token exists via hasRejoinToken without side effects", () => {
    expect(hasRejoinToken("ROOM1")).toBe(false);
    expect(mockStorage["rejoin_token_ROOM1"]).toBeUndefined();

    const token = getOrCreateRejoinToken("ROOM1");
    expect(hasRejoinToken("ROOM1")).toBe(true);

    clearRejoinToken("ROOM1");
    expect(hasRejoinToken("ROOM1")).toBe(false);
  });

  it("falls back to in-memory storage when localStorage throws (private browsing)", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("SecurityError: Access is denied for this document");
      },
      setItem: () => {
        throw new Error("SecurityError: Access is denied for this document");
      }
    });

    const token1 = getOrCreateRejoinToken("ROOM2");
    expect(token1).toBeDefined();

    // Repeated call returns same token for same tab lifetime
    const token2 = getOrCreateRejoinToken("ROOM2");
    expect(token2).toBe(token1);

    persistRejoinToken("override-token", "ROOM2");
    expect(getOrCreateRejoinToken("ROOM2")).toBe("override-token");
  });

  describe("name persistence & sanitization", () => {
    it("gets and saves name in localStorage", () => {
      expect(getSavedName()).toBe("");
      saveName("Alice");
      expect(getSavedName()).toBe("Alice");
      expect(mockStorage["playerName"]).toBe("Alice");
    });

    it("handles localStorage errors gracefully for name persistence", () => {
      vi.stubGlobal("localStorage", {
        getItem: () => {
          throw new Error("SecurityError");
        },
        setItem: () => {
          throw new Error("SecurityError");
        }
      });

      expect(getSavedName()).toBe("");
      expect(() => saveName("Bob")).not.toThrow();
    });

    it("sanitizes player names correctly", () => {
      expect(sanitizeName(null)).toBeNull();
      expect(sanitizeName(undefined)).toBeNull();
      expect(sanitizeName("")).toBeNull();
      expect(sanitizeName("   ")).toBeNull();
      expect(sanitizeName("  Charlie  ")).toBe("Charlie");
      expect(sanitizeName("A very long player name that exceeds limits")).toBe("A very long player n");
    });
  });
});
