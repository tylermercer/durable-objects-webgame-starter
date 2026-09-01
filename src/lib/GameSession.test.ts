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
      onControllerDisconnected: vi.fn(),
      onControllerRejoined: vi.fn(),
      onSignal: vi.fn(),
      onFirstPlayerChanged: vi.fn(),
      onControllerRenamed: vi.fn(),
      onRelayInput: vi.fn(),
      onRelayControl: vi.fn(),
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
      onFirstPlayerChanged: vi.fn(),
      onRelayInput: vi.fn(),
      onRelayControl: vi.fn(),
      [Symbol.dispose]: vi.fn()
    };

    const consoleCallbacks = {
      dup: () => consoleCallbacks,
      onControllerJoined: vi.fn(),
      onControllerLeft: vi.fn(),
      onControllerDisconnected: vi.fn(),
      onControllerRejoined: vi.fn(),
      onSignal: vi.fn(),
      onFirstPlayerChanged: vi.fn(),
      onControllerRenamed: vi.fn(),
      onRelayInput: vi.fn(),
      onRelayControl: vi.fn(),
      [Symbol.dispose]: vi.fn()
    };

    const consoleWs = createMockWebSocket();
    const controllerWs1 = createMockWebSocket();

    const consoleApi = (session as any).makeConsoleApi(consoleWs);
    await consoleApi.join(consoleCallbacks);

    const controllerApi1 = (session as any).makeControllerApi(controllerWs1);
    const joinRes1 = await controllerApi1.join(controllerCallbacks);

    expect(joinRes1.id).toBeDefined();
    expect(joinRes1.name).toBe("Player 1");
    expect(joinRes1.rejoinToken).toBeDefined();
    expect(joinRes1.isFirstPlayer).toBe(true);
    expect(consoleCallbacks.onControllerJoined).toHaveBeenCalledWith(joinRes1.id, "Player 1");
    expect(consoleCallbacks.onFirstPlayerChanged).toHaveBeenCalledWith(joinRes1.id);

    // Disconnect controller 1
    await (session as any).handleClose(controllerWs1);
    expect(ctx.storage.setAlarm).toHaveBeenCalled();
    // onControllerLeft should NOT be called yet because token is in grace period
    expect(consoleCallbacks.onControllerLeft).not.toHaveBeenCalledWith(joinRes1.id);

    // Rejoin with same token
    const controllerWs2 = createMockWebSocket();
    const controllerApi2 = (session as any).makeControllerApi(controllerWs2);
    const joinRes2 = await controllerApi2.join(controllerCallbacks, joinRes1.rejoinToken);

    expect(joinRes2.id).toBe(joinRes1.id);
    expect(joinRes2.name).toBe("Player 1");
    expect(joinRes2.isFirstPlayer).toBe(true);

    // Re-disconnect and let alarm fire after grace period
    await (session as any).handleClose(controllerWs2);

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 50000);

    await session.alarm();
    expect(consoleCallbacks.onControllerLeft).toHaveBeenCalledWith(joinRes1.id);
    vi.useRealTimers();
  });

  it("relays input and control messages and bounds control queues to 25 messages", async () => {
    const ctx = { storage: { setAlarm: vi.fn(async () => {}) } };
    const session = new GameSession(ctx as any, {} as any);

    const consoleCallbacks = {
      dup: function() { return this; },
      onControllerJoined: vi.fn(),
      onControllerLeft: vi.fn(),
      onControllerDisconnected: vi.fn(),
      onControllerRejoined: vi.fn(),
      onSignal: vi.fn(),
      onFirstPlayerChanged: vi.fn(),
      onControllerRenamed: vi.fn(),
      onRelayInput: vi.fn(),
      onRelayControl: vi.fn(),
      [Symbol.dispose]: vi.fn()
    };

    const controllerCallbacks = {
      dup: function() { return this; },
      onConsoleReady: vi.fn(),
      onConsoleGone: vi.fn(),
      onSignal: vi.fn(),
      onFirstPlayerChanged: vi.fn(),
      onRelayInput: vi.fn(),
      onRelayControl: vi.fn(),
      [Symbol.dispose]: vi.fn()
    };

    const consoleWs = createMockWebSocket();
    const consoleApi = (session as any).makeConsoleApi(consoleWs);
    await consoleApi.join(consoleCallbacks);

    const controllerWs = createMockWebSocket();
    const controllerApi = (session as any).makeControllerApi(controllerWs);
    const joinRes = await controllerApi.join(controllerCallbacks);
    const playerId = joinRes.id;

    // Test live forwarding
    controllerApi.relayInput({ type: "touch", x: 0.1, y: 0.2 });
    expect(consoleCallbacks.onRelayInput).toHaveBeenCalledWith(playerId, { type: "touch", x: 0.1, y: 0.2 });

    consoleApi.relayControl(playerId, { type: "privateDice", dice: [1, 2, 3] });
    expect(controllerCallbacks.onRelayControl).toHaveBeenCalledWith({ type: "privateDice", dice: [1, 2, 3] });

    // Disconnect controller
    await (session as any).handleClose(controllerWs);

    // Send 30 control messages to disconnected player -> queue capped at 25
    for (let i = 1; i <= 30; i++) {
      consoleApi.relayControl(playerId, { type: "state", msgId: i });
    }

    // Rejoin controller
    const controllerWs2 = createMockWebSocket();
    const controllerApi2 = (session as any).makeControllerApi(controllerWs2);
    controllerCallbacks.onRelayControl.mockClear();

    await controllerApi2.join(controllerCallbacks, joinRes.rejoinToken);

    // Verify 25 flushed messages (messages 6 to 30)
    expect(controllerCallbacks.onRelayControl).toHaveBeenCalledTimes(25);
    expect(controllerCallbacks.onRelayControl).toHaveBeenNthCalledWith(1, { type: "state", msgId: 6 });
    expect(controllerCallbacks.onRelayControl).toHaveBeenLastCalledWith({ type: "state", msgId: 30 });
  });

  it("tracks and broadcasts first connected player changes", async () => {
    const ctx = { storage: { setAlarm: vi.fn(async () => {}) } };
    const session = new GameSession(ctx as any, {} as any);

    const makeControllerCb = () => ({
      dup: function() { return this; },
      onConsoleReady: vi.fn(),
      onConsoleGone: vi.fn(),
      onSignal: vi.fn(),
      onFirstPlayerChanged: vi.fn(),
      onRelayInput: vi.fn(),
      onRelayControl: vi.fn(),
      [Symbol.dispose]: vi.fn()
    });

    const consoleCallbacks = {
      dup: function() { return this; },
      onControllerJoined: vi.fn(),
      onControllerLeft: vi.fn(),
      onControllerDisconnected: vi.fn(),
      onControllerRejoined: vi.fn(),
      onSignal: vi.fn(),
      onFirstPlayerChanged: vi.fn(),
      onControllerRenamed: vi.fn(),
      onRelayInput: vi.fn(),
      onRelayControl: vi.fn(),
      [Symbol.dispose]: vi.fn()
    };

    const consoleWs = createMockWebSocket();
    const consoleApi = (session as any).makeConsoleApi(consoleWs);
    const consoleJoinRes = await consoleApi.join(consoleCallbacks);
    expect(consoleJoinRes.firstPlayerId).toBeNull();

    const cb1 = makeControllerCb();
    const ws1 = createMockWebSocket();
    const api1 = (session as any).makeControllerApi(ws1);
    const p1 = await api1.join(cb1);

    expect(p1.isFirstPlayer).toBe(true);
    expect(consoleCallbacks.onFirstPlayerChanged).toHaveBeenLastCalledWith(p1.id);

    const cb2 = makeControllerCb();
    const ws2 = createMockWebSocket();
    const api2 = (session as any).makeControllerApi(ws2);
    const p2 = await api2.join(cb2);

    expect(p2.isFirstPlayer).toBe(false);

    // Disconnect p1 -> p2 becomes first player
    await (session as any).handleClose(ws1);
    expect(consoleCallbacks.onFirstPlayerChanged).toHaveBeenLastCalledWith(p2.id);
    expect(cb2.onFirstPlayerChanged).toHaveBeenLastCalledWith(p2.id);

    // Reconnect p1 -> p1 gets first player status back (earliest join order)
    const ws1_reconnect = createMockWebSocket();
    const api1_reconnect = (session as any).makeControllerApi(ws1_reconnect);
    const p1_reconnect = await api1_reconnect.join(cb1, p1.rejoinToken);

    expect(p1_reconnect.isFirstPlayer).toBe(true);
    expect(consoleCallbacks.onFirstPlayerChanged).toHaveBeenLastCalledWith(p1.id);
  });

  it("hydrates rejoin tokens and nextPlayerNumber from storage upon cold start", async () => {
    const storageMap = new Map<string, any>();
    storageMap.set("rejoinTokens", [
      ["existing-token", { id: "p1-id", name: "Player 1", disconnectedAt: null }]
    ]);
    storageMap.set("nextPlayerNumber", 5);
    storageMap.set("gracePeriodMs", 20000);

    const ctx = {
      storage: {
        get: vi.fn(async (key: string) => storageMap.get(key)),
        put: vi.fn(async (key: string, val: any) => storageMap.set(key, val)),
        setAlarm: vi.fn(async () => {})
      }
    };

    const session = new GameSession(ctx as any, {} as any);
    await (session as any).hydrateIfNeeded();

    expect(session.rejoinTokens.get("existing-token")).toEqual({ id: "p1-id", name: "Player 1", disconnectedAt: null });
    expect(session.gracePeriodMs).toBe(20000);

    const controllerWs = createMockWebSocket();
    const controllerApi = (session as any).makeControllerApi(controllerWs);

    const cb = {
      dup: function() { return this; },
      onConsoleReady: vi.fn(),
      onConsoleGone: vi.fn(),
      onSignal: vi.fn(),
      onFirstPlayerChanged: vi.fn(),
      onRelayInput: vi.fn(),
      onRelayControl: vi.fn(),
      [Symbol.dispose]: vi.fn()
    };

    const joinRes = await controllerApi.join(cb, "existing-token");
    expect(joinRes.id).toBe("p1-id");
    expect(joinRes.name).toBe("Player 1");

    const newJoinRes = await controllerApi.join(cb);
    expect(newJoinRes.name).toBe("Player 5");
  });

  it("enforces maxPlayers limit for new controllers but permits rejoining", async () => {
    const storageMap = new Map<string, any>();
    const ctx = {
      storage: {
        get: vi.fn(async (key: string) => storageMap.get(key)),
        put: vi.fn(async (key: string, val: any) => storageMap.set(key, val)),
        setAlarm: vi.fn(async () => {})
      }
    };
    const session = new GameSession(ctx as any, {} as any);

    const makeControllerCb = () => ({
      dup: function() { return this; },
      onConsoleReady: vi.fn(),
      onConsoleGone: vi.fn(),
      onSignal: vi.fn(),
      onFirstPlayerChanged: vi.fn(),
      onRelayInput: vi.fn(),
      onRelayControl: vi.fn(),
      [Symbol.dispose]: vi.fn()
    });

    const consoleCallbacks = {
      dup: function() { return this; },
      onControllerJoined: vi.fn(),
      onControllerLeft: vi.fn(),
      onControllerDisconnected: vi.fn(),
      onControllerRejoined: vi.fn(),
      onSignal: vi.fn(),
      onFirstPlayerChanged: vi.fn(),
      onControllerRenamed: vi.fn(),
      onRelayInput: vi.fn(),
      onRelayControl: vi.fn(),
      [Symbol.dispose]: vi.fn()
    };

    const consoleWs = createMockWebSocket();
    const consoleApi = (session as any).makeConsoleApi(consoleWs);
    await consoleApi.join(consoleCallbacks, undefined, undefined, 2);

    expect(session.maxPlayers).toBe(2);
    expect(ctx.storage.put).toHaveBeenCalledWith("maxPlayers", 2);

    // Join player 1
    const cb1 = makeControllerCb();
    const ws1 = createMockWebSocket();
    const api1 = (session as any).makeControllerApi(ws1);
    const p1 = await api1.join(cb1);

    // Join player 2
    const cb2 = makeControllerCb();
    const ws2 = createMockWebSocket();
    const api2 = (session as any).makeControllerApi(ws2);
    await api2.join(cb2);

    // Join player 3 -> should fail because maxPlayers is 2
    const cb3 = makeControllerCb();
    const ws3 = createMockWebSocket();
    const api3 = (session as any).makeControllerApi(ws3);
    await expect(api3.join(cb3)).rejects.toThrow("Room is full. Maximum limit of 2 players reached.");

    // Disconnect p1 and rejoin with token -> should succeed
    await (session as any).handleClose(ws1);
    const ws1_reconnect = createMockWebSocket();
    const api1_reconnect = (session as any).makeControllerApi(ws1_reconnect);
    const p1_reconnect = await api1_reconnect.join(cb1, p1.rejoinToken);
    expect(p1_reconnect.id).toBe(p1.id);
  });

  it("handles kickController: notifies controller, purges rejoinToken, closes WS, and notifies console", async () => {
    const ctx = {
      storage: {
        get: vi.fn(async () => null),
        put: vi.fn(async () => {}),
        setAlarm: vi.fn(async () => {})
      }
    };
    const session = new GameSession(ctx as any, {} as any);

    const controllerCallbacks = {
      dup: function() { return this; },
      onConsoleReady: vi.fn(),
      onConsoleGone: vi.fn(),
      onKicked: vi.fn(),
      onSignal: vi.fn(),
      onFirstPlayerChanged: vi.fn(),
      onRelayInput: vi.fn(),
      onRelayControl: vi.fn(),
      [Symbol.dispose]: vi.fn()
    };

    const consoleCallbacks = {
      dup: function() { return this; },
      onControllerJoined: vi.fn(),
      onControllerLeft: vi.fn(),
      onControllerDisconnected: vi.fn(),
      onControllerRejoined: vi.fn(),
      onSignal: vi.fn(),
      onFirstPlayerChanged: vi.fn(),
      onControllerRenamed: vi.fn(),
      onRelayInput: vi.fn(),
      onRelayControl: vi.fn(),
      [Symbol.dispose]: vi.fn()
    };

    const consoleWs = createMockWebSocket();
    const consoleApi = (session as any).makeConsoleApi(consoleWs);
    await consoleApi.join(consoleCallbacks);

    const controllerWs = createMockWebSocket();
    const controllerApi = (session as any).makeControllerApi(controllerWs);
    const joinRes = await controllerApi.join(controllerCallbacks);

    expect(joinRes.id).toBeDefined();
    expect(session.rejoinTokens.has(joinRes.rejoinToken)).toBe(true);

    // Console kicks controller
    await consoleApi.kickController(joinRes.id);

    expect(controllerCallbacks.onKicked).toHaveBeenCalled();
    expect(controllerWs.close).toHaveBeenCalledWith(4001, "kicked");
    expect(session.rejoinTokens.has(joinRes.rejoinToken)).toBe(false);
    expect(consoleCallbacks.onControllerLeft).toHaveBeenCalledWith(joinRes.id);

    // If controller attempts to rejoin with old token, it should be rejected as kicked
    const controllerWsRejoin = createMockWebSocket();
    const controllerApiRejoin = (session as any).makeControllerApi(controllerWsRejoin);
    await expect(controllerApiRejoin.join(controllerCallbacks, joinRes.rejoinToken)).rejects.toThrow("You have been removed from this session.");
  });

  it("rejects join attempt from offline kicked token", async () => {
    const ctx = {
      storage: {
        get: vi.fn(async () => null),
        put: vi.fn(async () => {}),
        setAlarm: vi.fn(async () => {})
      }
    };
    const session = new GameSession(ctx as any, {} as any);

    const controllerCallbacks = {
      dup: function() { return this; },
      onConsoleReady: vi.fn(),
      onConsoleGone: vi.fn(),
      onKicked: vi.fn(),
      onSignal: vi.fn(),
      onFirstPlayerChanged: vi.fn(),
      onRelayInput: vi.fn(),
      onRelayControl: vi.fn(),
      [Symbol.dispose]: vi.fn()
    };

    const consoleCallbacks = {
      dup: function() { return this; },
      onControllerJoined: vi.fn(),
      onControllerLeft: vi.fn(),
      onControllerDisconnected: vi.fn(),
      onControllerRejoined: vi.fn(),
      onSignal: vi.fn(),
      onFirstPlayerChanged: vi.fn(),
      onControllerRenamed: vi.fn(),
      onRelayInput: vi.fn(),
      onRelayControl: vi.fn(),
      [Symbol.dispose]: vi.fn()
    };

    const consoleWs = createMockWebSocket();
    const consoleApi = (session as any).makeConsoleApi(consoleWs);
    await consoleApi.join(consoleCallbacks);

    const controllerWs = createMockWebSocket();
    const controllerApi = (session as any).makeControllerApi(controllerWs);
    const joinRes = await controllerApi.join(controllerCallbacks);

    // Simulate controller going offline / disconnected
    await (session as any).handleClose(controllerWs);

    // Console kicks the offline controller
    await consoleApi.kickController(joinRes.id);

    // Later, offline controller comes back online and attempts join with stale token
    const controllerWsOffline = createMockWebSocket();
    const controllerApiOffline = (session as any).makeControllerApi(controllerWsOffline);
    await expect(controllerApiOffline.join(controllerCallbacks, joinRes.rejoinToken)).rejects.toThrow("You have been removed from this session.");
  });

  describe("Room lifetime and cleanup", () => {
    const makeConsoleCb = () => ({
      dup: function() { return this; },
      onControllerJoined: vi.fn(),
      onControllerLeft: vi.fn(),
      onControllerDisconnected: vi.fn(),
      onControllerRejoined: vi.fn(),
      onSignal: vi.fn(),
      onFirstPlayerChanged: vi.fn(),
      onControllerRenamed: vi.fn(),
      onRelayInput: vi.fn(),
      onRelayControl: vi.fn(),
      [Symbol.dispose]: vi.fn()
    });

    const makeControllerCb = () => ({
      dup: function() { return this; },
      onConsoleReady: vi.fn(),
      onConsoleGone: vi.fn(),
      onKicked: vi.fn(),
      onSignal: vi.fn(),
      onFirstPlayerChanged: vi.fn(),
      onRelayInput: vi.fn(),
      onRelayControl: vi.fn(),
      [Symbol.dispose]: vi.fn()
    });

    it("wipes storage and resets in-memory state when room remains empty past 24 hours", async () => {
      const storageMap = new Map<string, any>();
      const ctx = {
        storage: {
          get: vi.fn(async (key: string) => storageMap.get(key)),
          put: vi.fn(async (key: string, val: any) => storageMap.set(key, val)),
          delete: vi.fn(async (key: string) => storageMap.delete(key)),
          deleteAll: vi.fn(async () => storageMap.clear()),
          setAlarm: vi.fn(async () => {})
        }
      };
      const session = new GameSession(ctx as any, {} as any);

      const consoleWs = createMockWebSocket();
      const consoleApi = (session as any).makeConsoleApi(consoleWs);
      await consoleApi.join(makeConsoleCb(), undefined, undefined, 4);

      const controllerWs = createMockWebSocket();
      const controllerApi = (session as any).makeControllerApi(controllerWs);
      await controllerApi.join(makeControllerCb());

      // Disconnect controller then console -> sessions empty
      await (session as any).handleClose(controllerWs);
      await (session as any).handleClose(consoleWs);

      expect(session.sessions.size).toBe(0);
      expect(session.roomEmptySince).not.toBeNull();
      expect(ctx.storage.put).toHaveBeenCalledWith("roomEmptySince", session.roomEmptySince);

      // Fast forward past 24 hours (24 * 60 * 60 * 1000 + 1000 ms)
      vi.useFakeTimers();
      const futureTime = session.roomEmptySince! + 24 * 60 * 60 * 1000 + 1000;
      vi.setSystemTime(futureTime);

      await session.alarm();

      expect(ctx.storage.deleteAll).toHaveBeenCalled();
      expect(session.roomEmptySince).toBeNull();
      expect(session.rejoinTokens.size).toBe(0);
      expect(session.kickedTokens.size).toBe(0);
      expect(session.consoleToken).toBeNull();
      expect(session.maxPlayers).toBeNull();
      expect((session as any).nextPlayerNumber).toBe(1);

      vi.useRealTimers();
    });

    it("clears roomEmptySince on join and prevents room cleanup if reconnected before threshold", async () => {
      const storageMap = new Map<string, any>();
      const ctx = {
        storage: {
          get: vi.fn(async (key: string) => storageMap.get(key)),
          put: vi.fn(async (key: string, val: any) => storageMap.set(key, val)),
          delete: vi.fn(async (key: string) => storageMap.delete(key)),
          deleteAll: vi.fn(async () => storageMap.clear()),
          setAlarm: vi.fn(async () => {})
        }
      };
      const session = new GameSession(ctx as any, {} as any);

      const consoleWs = createMockWebSocket();
      const consoleApi = (session as any).makeConsoleApi(consoleWs);
      await consoleApi.join(makeConsoleCb());

      // Disconnect console -> room empty
      await (session as any).handleClose(consoleWs);
      expect(session.roomEmptySince).not.toBeNull();

      // Controller joins before 24h deadline
      const controllerWs = createMockWebSocket();
      const controllerApi = (session as any).makeControllerApi(controllerWs);
      await controllerApi.join(makeControllerCb());

      expect(session.roomEmptySince).toBeNull();
      expect(ctx.storage.delete).toHaveBeenCalledWith("roomEmptySince");

      // Advance time to 24h past original empty time and trigger alarm
      vi.useFakeTimers();
      vi.setSystemTime(Date.now() + 25 * 60 * 60 * 1000);

      await session.alarm();

      // Storage should NOT have been deleted because room is no longer empty
      expect(ctx.storage.deleteAll).not.toHaveBeenCalled();

      vi.useRealTimers();
    });

    it("never wipes storage for an active session continuously connected past 24 hours", async () => {
      const storageMap = new Map<string, any>();
      const ctx = {
        storage: {
          get: vi.fn(async (key: string) => storageMap.get(key)),
          put: vi.fn(async (key: string, val: any) => storageMap.set(key, val)),
          delete: vi.fn(async (key: string) => storageMap.delete(key)),
          deleteAll: vi.fn(async () => storageMap.clear()),
          setAlarm: vi.fn(async () => {})
        }
      };
      const session = new GameSession(ctx as any, {} as any);

      const consoleWs = createMockWebSocket();
      const consoleApi = (session as any).makeConsoleApi(consoleWs);
      await consoleApi.join(makeConsoleCb());

      const controllerWs = createMockWebSocket();
      const controllerApi = (session as any).makeControllerApi(controllerWs);
      await controllerApi.join(makeControllerCb());

      expect(session.roomEmptySince).toBeNull();

      // Advance time past 24 hours without disconnecting anyone
      vi.useFakeTimers();
      vi.setSystemTime(Date.now() + 30 * 60 * 60 * 1000);

      await session.alarm();

      expect(ctx.storage.deleteAll).not.toHaveBeenCalled();
      expect(session.sessions.size).toBe(2);

      vi.useRealTimers();
    });

    it("allows a fresh join after storage cleanup that behaves like a brand-new room", async () => {
      const storageMap = new Map<string, any>();
      const ctx = {
        storage: {
          get: vi.fn(async (key: string) => storageMap.get(key)),
          put: vi.fn(async (key: string, val: any) => storageMap.set(key, val)),
          delete: vi.fn(async (key: string) => storageMap.delete(key)),
          deleteAll: vi.fn(async () => storageMap.clear()),
          setAlarm: vi.fn(async () => {})
        }
      };
      const session = new GameSession(ctx as any, {} as any);

      const consoleWs1 = createMockWebSocket();
      const consoleApi1 = (session as any).makeConsoleApi(consoleWs1);
      const res1 = await consoleApi1.join(makeConsoleCb(), undefined, undefined, 2);
      const oldConsoleToken = res1.consoleToken;

      await (session as any).handleClose(consoleWs1);

      // Trigger cleanup
      vi.useFakeTimers();
      vi.setSystemTime(Date.now() + 25 * 60 * 60 * 1000);
      await session.alarm();
      vi.useRealTimers();

      expect(ctx.storage.deleteAll).toHaveBeenCalled();

      // Fresh console join
      const consoleWs2 = createMockWebSocket();
      const consoleApi2 = (session as any).makeConsoleApi(consoleWs2);
      const res2 = await consoleApi2.join(makeConsoleCb());

      expect(res2.consoleToken).not.toBe(oldConsoleToken);
      expect(session.maxPlayers).toBeNull();

      // Controller join gets Player 1
      const controllerWs = createMockWebSocket();
      const controllerApi = (session as any).makeControllerApi(controllerWs);
      const ctrlRes = await controllerApi.join(makeControllerCb());

      expect(ctrlRes.name).toBe("Player 1");
    });
  });
});
