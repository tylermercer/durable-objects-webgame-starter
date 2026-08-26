import { describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => {
  return {
    DurableObject: class DurableObject {
      constructor(public ctx: any, public env: any) {}
    }
  };
});

import { GameSession } from "./GameSession";

function createMockWebSocket(): WebSocket {
  const listeners: Record<string, Function[]> = {};
  return {
    addEventListener: vi.fn((event: string, fn: Function) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(fn);
    }),
    removeEventListener: vi.fn(),
    close: vi.fn(),
    send: vi.fn()
  } as unknown as WebSocket;
}

describe("GameSession Durable Object", () => {
  it("rejects non-websocket upgrade requests with status 426", async () => {
    const state = {} as any;
    const env = {} as any;
    const session = new GameSession(state, env);

    const request = new Request("http://localhost/api/signaling?code=TEST1&role=console");
    const response = await session.fetch(request);

    expect(response.status).toBe(426);
    const text = await response.text();
    expect(text).toContain("Expected Upgrade: websocket");
  });

  it("rejects websocket requests with invalid role with status 400", async () => {
    const state = {} as any;
    const env = {} as any;
    const session = new GameSession(state, env);

    const request = new Request("http://localhost/api/signaling?code=TEST1&role=invalid", {
      headers: { Upgrade: "websocket" }
    });
    const response = await session.fetch(request);

    expect(response.status).toBe(400);
    const text = await response.text();
    expect(text).toContain("Invalid role");
  });

  it("saves and loads game state via storage", async () => {
    const storageMap = new Map<string, any>();
    const ctx = {
      storage: {
        put: vi.fn(async (key: string, val: any) => storageMap.set(key, val)),
        get: vi.fn(async (key: string) => storageMap.get(key)),
        setAlarm: vi.fn(async () => {})
      }
    };
    const session = new GameSession(ctx as any, {} as any);
    const consoleApi = (session as any).makeConsoleApi(createMockWebSocket());

    await consoleApi.saveGameState({ score: 100, seed: 12345 });
    expect(ctx.storage.put).toHaveBeenCalledWith("gameState", { score: 100, seed: 12345 });

    const loaded = await consoleApi.loadGameState();
    expect(loaded).toEqual({ score: 100, seed: 12345 });
  });

  it("persists, returns, and validates console token", async () => {
    const storageMap = new Map<string, any>();
    const ctx = {
      storage: {
        put: vi.fn(async (key: string, val: any) => storageMap.set(key, val)),
        get: vi.fn(async (key: string) => storageMap.get(key)),
        setAlarm: vi.fn(async () => {})
      }
    };
    const session = new GameSession(ctx as any, {} as any);

    const consoleCallbacks = {
      dup: () => consoleCallbacks,
      onControllerJoined: vi.fn(),
      onControllerLeft: vi.fn(),
      onSignal: vi.fn(),
      [Symbol.dispose]: vi.fn()
    };

    const consoleWs1 = createMockWebSocket();
    const consoleApi1 = (session as any).makeConsoleApi(consoleWs1);
    const joinRes1 = await consoleApi1.join(consoleCallbacks);

    expect(joinRes1.consoleToken).toBeDefined();
    expect(ctx.storage.put).toHaveBeenCalledWith("consoleToken", joinRes1.consoleToken);

    // Rejoin with correct token
    const consoleWs2 = createMockWebSocket();
    const consoleApi2 = (session as any).makeConsoleApi(consoleWs2);
    const joinRes2 = await consoleApi2.join(consoleCallbacks, joinRes1.consoleToken);

    expect(joinRes2.consoleToken).toBe(joinRes1.consoleToken);

    // Rejoin with invalid token should throw error
    const consoleWs3 = createMockWebSocket();
    const consoleApi3 = (session as any).makeConsoleApi(consoleWs3);
    await expect(consoleApi3.join(consoleCallbacks, "invalid-token")).rejects.toThrow("Invalid console token");
  });

  it("handles rejoin tokens and disconnect grace period alarm", async () => {
    const ctx = {
      storage: {
        setAlarm: vi.fn(async () => {})
      }
    };
    const session = new GameSession(ctx as any, {} as any);

    const controllerCallbacks = {
      dup: () => controllerCallbacks,
      onConsoleReady: vi.fn(),
      onConsoleGone: vi.fn(),
      onSignal: vi.fn(),
      [Symbol.dispose]: vi.fn()
    };

    const consoleCallbacks = {
      dup: () => consoleCallbacks,
      onControllerJoined: vi.fn(),
      onControllerLeft: vi.fn(),
      onSignal: vi.fn(),
      [Symbol.dispose]: vi.fn()
    };

    const consoleWs = createMockWebSocket();
    const controllerWs1 = createMockWebSocket();

    const consoleApi = (session as any).makeConsoleApi(consoleWs);
    consoleApi.join(consoleCallbacks);

    const controllerApi1 = (session as any).makeControllerApi(controllerWs1);
    const joinRes1 = controllerApi1.join(controllerCallbacks);

    expect(joinRes1.id).toBeDefined();
    expect(joinRes1.name).toBe("Player 1");
    expect(joinRes1.rejoinToken).toBeDefined();
    expect(consoleCallbacks.onControllerJoined).toHaveBeenCalledWith(joinRes1.id, "Player 1");

    // Disconnect controller 1
    (session as any).handleClose(controllerWs1);
    expect(ctx.storage.setAlarm).toHaveBeenCalled();
    // onControllerLeft should NOT be called yet because token is in grace period
    expect(consoleCallbacks.onControllerLeft).not.toHaveBeenCalledWith(joinRes1.id);

    // Rejoin with same token
    const controllerWs2 = createMockWebSocket();
    const controllerApi2 = (session as any).makeControllerApi(controllerWs2);
    const joinRes2 = controllerApi2.join(controllerCallbacks, joinRes1.rejoinToken);

    expect(joinRes2.id).toBe(joinRes1.id);
    expect(joinRes2.name).toBe("Player 1");

    // Re-disconnect and let alarm fire after grace period
    (session as any).handleClose(controllerWs2);

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 50000);

    await session.alarm();
    expect(consoleCallbacks.onControllerLeft).toHaveBeenCalledWith(joinRes1.id);
    vi.useRealTimers();
  });
});
