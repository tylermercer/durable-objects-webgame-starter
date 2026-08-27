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

    const requestAnimationFrame = vi.fn((cb) => setTimeout(cb, 0));
    const cancelAnimationFrame = vi.fn();

    vi.stubGlobal("requestAnimationFrame", requestAnimationFrame);
    vi.stubGlobal("cancelAnimationFrame", cancelAnimationFrame);

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

describe("ConsoleApp start screen and add-players button behavior", () => {
  let mockStorage: Record<string, string> = {};

  function createMockElement(id: string) {
    const classList = new Set<string>();
    return {
      id,
      innerHTML: "",
      classList: {
        add: (cls: string) => classList.add(cls),
        remove: (cls: string) => classList.delete(cls),
        contains: (cls: string) => classList.has(cls)
      },
      getBoundingClientRect: () => ({ width: 800, height: 600 }),
      addEventListener: vi.fn()
    };
  }

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
      },
      addEventListener: vi.fn(),
      setTimeout: vi.fn(),
      requestAnimationFrame,
      cancelAnimationFrame
    });
  });

  it("init() does not auto-start game even if selected_example exists in localStorage", async () => {
    const elements: Record<string, ReturnType<typeof createMockElement>> = {
      "start-screen": createMockElement("start-screen"),
      "add-players-btn": createMockElement("add-players-btn")
    };
    elements["add-players-btn"].classList.add("u-hidden");

    vi.stubGlobal("document", {
      getElementById: (id: string) => elements[id] ?? null,
      createElement: () => createMockElement("div")
    });

    localStorage.setItem("selected_example", "flappy-royale");
    const app = new ConsoleApp();
    const initGameSpy = vi.spyOn(app, "initGame");
    vi.spyOn(app, "connectSignaling").mockImplementation(() => {});

    await app.init();

    expect(initGameSpy).not.toHaveBeenCalled();
    expect(elements["start-screen"].classList.contains("u-hidden")).toBe(false);
  });

  it("initGame() hides start screen and unhides add-players-btn", async () => {
    const elements: Record<string, ReturnType<typeof createMockElement>> = {
      "start-screen": createMockElement("start-screen"),
      "add-players-btn": createMockElement("add-players-btn"),
      "game-surface": createMockElement("game-surface")
    };
    elements["add-players-btn"].classList.add("u-hidden");

    vi.stubGlobal("document", {
      getElementById: (id: string) => elements[id] ?? null,
      createElement: () => createMockElement("div")
    });

    const gameSource = await import("../contract/gameSource");
    vi.spyOn(gameSource, "loadConsoleGame").mockResolvedValue({
      createGame: vi.fn().mockReturnValue({
        destroy: vi.fn()
      }) as any
    });

    const app = new ConsoleApp();

    await app.initGame();

    expect(elements["start-screen"].classList.contains("u-hidden")).toBe(true);
    expect(elements["add-players-btn"].classList.contains("u-hidden")).toBe(false);
  });
});
