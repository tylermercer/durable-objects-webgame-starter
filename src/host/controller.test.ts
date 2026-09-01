import { describe, expect, it, beforeEach, vi } from "vitest";
import { ControllerApp } from "./controller";

describe("ControllerApp Fullscreen and Wake Lock behavior", () => {
  let elements: Record<string, any> = {};
  let documentListeners: Record<string, Function[]> = {};

  function createMockElement(id: string) {
    const classList = new Set<string>();
    return {
      id,
      value: "",
      classList: {
        add: (cls: string) => classList.add(cls),
        remove: (cls: string) => classList.delete(cls),
        contains: (cls: string) => classList.has(cls)
      },
      addEventListener: vi.fn()
    };
  }

  beforeEach(() => {
    elements = {
      "name-screen": createMockElement("name-screen"),
      "controller-main": createMockElement("controller-main"),
      "player-name-input": createMockElement("player-name-input"),
      "name-form": createMockElement("name-form"),
      "fullscreen-btn": createMockElement("fullscreen-btn")
    };
    elements["fullscreen-btn"].classList.add("u-hidden");

    documentListeners = {};

    vi.stubGlobal("window", {
      location: {
        search: "?code=TEST1",
        origin: "http://localhost:4321",
        host: "localhost:4321",
        protocol: "http:",
        href: "http://localhost:4321/?code=TEST1"
      }
    });

    vi.stubGlobal("sessionStorage", {
      getItem: vi.fn().mockReturnValue(null),
      setItem: vi.fn(),
      clear: vi.fn(),
      removeItem: vi.fn()
    });

    vi.stubGlobal("localStorage", {
      getItem: vi.fn().mockReturnValue(null),
      setItem: vi.fn(),
      clear: vi.fn(),
      removeItem: vi.fn()
    });

    vi.stubGlobal("document", {
      getElementById: (id: string) => elements[id] ?? null,
      documentElement: {
        requestFullscreen: vi.fn().mockResolvedValue(undefined)
      },
      fullscreenElement: null,
      visibilityState: "visible",
      addEventListener: vi.fn((event: string, cb: Function) => {
        documentListeners[event] = documentListeners[event] || [];
        documentListeners[event].push(cb);
      })
    });

    vi.stubGlobal("navigator", {
      wakeLock: {
        request: vi.fn().mockResolvedValue({
          addEventListener: vi.fn()
        })
      }
    });
  });

  it("requests fullscreen and wake lock on name submission", async () => {
    let nameFormSubmitCb: ((e: any) => void) | null = null;
    elements["name-form"].addEventListener = vi.fn((event: string, cb: any) => {
      if (event === "submit") nameFormSubmitCb = cb;
    });

    const app = new ControllerApp();
    vi.spyOn(app, "connectSignaling").mockImplementation(() => {});

    await app.init();

    expect(nameFormSubmitCb).not.toBeNull();
    elements["player-name-input"].value = "Alice";

    const mockEvent = { preventDefault: vi.fn() };
    const requestFsSpy = vi.spyOn(app, "requestFullscreen");
    const requestWakeSpy = vi.spyOn(app, "requestWakeLock");

    nameFormSubmitCb!(mockEvent);

    expect(app.hasSubmittedName).toBe(true);
    expect(requestFsSpy).toHaveBeenCalled();
    expect(requestWakeSpy).toHaveBeenCalled();
    expect(navigator.wakeLock.request).toHaveBeenCalledWith("screen");
  });

  it("shows fullscreen button if exited fullscreen after name submit", async () => {
    let nameFormSubmitCb: ((e: any) => void) | null = null;
    elements["name-form"].addEventListener = vi.fn((event: string, cb: any) => {
      if (event === "submit") nameFormSubmitCb = cb;
    });

    const app = new ControllerApp();
    vi.spyOn(app, "connectSignaling").mockImplementation(() => {});

    await app.init();

    elements["player-name-input"].value = "Bob";
    nameFormSubmitCb!({ preventDefault: vi.fn() });

    // Simulate exiting fullscreen (fullscreenElement = null)
    (document as any).fullscreenElement = null;

    // Trigger fullscreenchange event
    const fsCbs = documentListeners["fullscreenchange"] || [];
    for (const cb of fsCbs) cb();

    expect(elements["fullscreen-btn"].classList.contains("u-hidden")).toBe(false);
  });

  it("hides fullscreen button when active fullscreen is reported", async () => {
    const app = new ControllerApp();
    vi.spyOn(app, "connectSignaling").mockImplementation(() => {});

    await app.init();

    app.hasSubmittedName = true;
    (document as any).fullscreenElement = document.documentElement;

    app.updateFullscreenButtonVisibility();

    expect(elements["fullscreen-btn"].classList.contains("u-hidden")).toBe(true);
  });

  it("requests fullscreen on fullscreen button click", async () => {
    let fullscreenBtnClickCb: (() => void) | null = null;
    elements["fullscreen-btn"].addEventListener = vi.fn((event: string, cb: any) => {
      if (event === "click") fullscreenBtnClickCb = cb;
    });

    const app = new ControllerApp();
    vi.spyOn(app, "connectSignaling").mockImplementation(() => {});

    await app.init();

    expect(fullscreenBtnClickCb).not.toBeNull();

    const requestFsSpy = vi.spyOn(app, "requestFullscreen");
    fullscreenBtnClickCb!();

    expect(requestFsSpy).toHaveBeenCalled();
  });

  it("re-requests wake lock on visibilitychange when visible and name submitted", async () => {
    const app = new ControllerApp();
    vi.spyOn(app, "connectSignaling").mockImplementation(() => {});

    await app.init();

    app.hasSubmittedName = true;

    const requestWakeSpy = vi.spyOn(app, "requestWakeLock");
    const visCbs = documentListeners["visibilitychange"] || [];

    for (const cb of visCbs) cb();

    expect(requestWakeSpy).toHaveBeenCalled();
  });

  it("handles handleKicked by clearing token, closing connections, and switching UI to name screen", async () => {
    const app = new ControllerApp();
    vi.spyOn(app, "connectSignaling").mockImplementation(() => {});

    await app.init();

    app.id = "p1-id";
    app.name = "Alice";
    app.hasSubmittedName = true;
    app.chosenName = "Alice";
    app.orchestrator = { close: vi.fn() } as any;
    app.activeGame = { destroy: vi.fn() } as any;

    app.handleKicked();

    expect(app.id).toBe("");
    expect(app.name).toBe("");
    expect(app.hasSubmittedName).toBe(false);
    expect(app.orchestrator).toBeNull();
    expect(app.activeGame).toBeNull();
    expect(elements["name-screen"].classList.contains("u-hidden")).toBe(false);
    expect(elements["controller-main"].classList.contains("u-hidden")).toBe(true);
  });
});
