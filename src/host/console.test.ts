import { describe, expect, it, beforeEach, vi } from "vitest";
import { ConsoleApp } from "./console";

describe("ConsoleApp room code persistence", () => {
  let mockStorage: Record<string, string> = {};

  beforeEach(() => {
    mockStorage = {};

    vi.stubGlobal("localStorage", {
      getItem: vi.fn((key: string) => mockStorage[key] ?? null),
      setItem: vi.fn((key: string, val: string) => {
        mockStorage[key] = val;
      }),
      clear: vi.fn(() => {
        mockStorage = {};
      }),
      removeItem: vi.fn((key: string) => {
        delete mockStorage[key];
      })
    });

    vi.stubGlobal("window", {
      location: {
        search: "",
        origin: "http://localhost:4321",
        href: "http://localhost:4321/"
      },
      history: {
        replaceState: vi.fn()
      }
    });
  });

  it("generates a new room code and persists it in localStorage if none exists", () => {
    expect(localStorage.getItem("console_room_code")).toBeNull();

    const app = new ConsoleApp();

    expect(app.code).toBeDefined();
    expect(app.code.length).toBeGreaterThan(0);
    expect(localStorage.getItem("console_room_code")).toBe(app.code);
  });

  it("reuses the existing room code from localStorage on subsequent instantiation (refresh)", () => {
    localStorage.setItem("console_room_code", "ROOM123");

    const app = new ConsoleApp();

    expect(app.code).toBe("ROOM123");
    expect(localStorage.getItem("console_room_code")).toBe("ROOM123");
  });

  it("does not mutate window.location or call history.replaceState with code query param", () => {
    const replaceStateSpy = vi.spyOn(window.history, "replaceState");

    const app = new ConsoleApp();

    expect(replaceStateSpy).not.toHaveBeenCalled();
    expect(window.location.search).not.toContain("code=");
  });
});
