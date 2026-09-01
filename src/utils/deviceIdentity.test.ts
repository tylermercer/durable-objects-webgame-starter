import { beforeEach, describe, expect, it, vi } from "vitest";
import { getOrCreateRejoinToken, persistRejoinToken, clearRejoinToken, getSavedName, saveName, sanitizeName } from "./deviceIdentity";

describe("deviceIdentity", () => {
  let mockStorage: Record<string, string> = {};

  beforeEach(() => {
    mockStorage = {};
    delete (globalThis as any).__sessionRejoinTokens;

    const fakeSessionStorage = {
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

    vi.stubGlobal("sessionStorage", fakeSessionStorage);
  });

  it("creates and persists a token in sessionStorage", () => {
    const token = getOrCreateRejoinToken("ROOM1");
    expect(token).toBeDefined();
    expect(mockStorage["rejoin_token_ROOM1"]).toBe(token);

    const retrieved = getOrCreateRejoinToken("ROOM1");
    expect(retrieved).toBe(token);
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

  it("falls back to in-memory storage when sessionStorage throws (private browsing)", () => {
    vi.stubGlobal("sessionStorage", {
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
    it("gets and saves name in sessionStorage", () => {
      expect(getSavedName()).toBe("");
      saveName("Alice");
      expect(getSavedName()).toBe("Alice");
    });

    it("handles sessionStorage errors gracefully for name persistence", () => {
      vi.stubGlobal("sessionStorage", {
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
