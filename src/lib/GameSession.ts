import { DurableObject } from "cloudflare:workers";
import { RpcTarget, newWebSocketRpcSession, type RpcStub } from "capnweb";
import type { ConsoleApi, ConsoleCallbacks, ControllerApi, ControllerCallbacks, RTCSignal } from "./signaling-api";

type Role = "console" | "controller";

type Session = {
  id: string;
  role: Role;
  name: string;
  callbacks: RpcStub<ConsoleCallbacks | ControllerCallbacks>;
  rejoinToken?: string;
};

type ControllerRecord = {
  id: string;
  name: string;
  disconnectedAt: number | null;
};

const DISCONNECT_GRACE_PERIOD_MS = 45000;

export class GameSession extends DurableObject {
  sessions = new Map<WebSocket, Session>();
  rejoinTokens = new Map<string, ControllerRecord>();
  consoleToken: string | null = null;
  private nextPlayerNumber = 1;

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected Upgrade: websocket", { status: 426 });
    }

    const url = new URL(request.url);
    const role = url.searchParams.get("role") as Role;

    if (role !== "console" && role !== "controller") {
      return new Response("Invalid role. Expected 'console' or 'controller'", { status: 400 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    server.accept();

    if (role === "console") {
      newWebSocketRpcSession(server, this.makeConsoleApi(server));
    } else {
      newWebSocketRpcSession(server, this.makeControllerApi(server));
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  async alarm(): Promise<void> {
    const now = Date.now();
    let earliestNextDisconnect: number | null = null;

    for (const [token, record] of Array.from(this.rejoinTokens.entries())) {
      if (record.disconnectedAt !== null) {
        const elapsed = now - record.disconnectedAt;
        if (elapsed >= DISCONNECT_GRACE_PERIOD_MS) {
          this.rejoinTokens.delete(token);
          this.forConsole(cb => (cb as RpcStub<ConsoleCallbacks>).onControllerLeft(record.id));
        } else {
          const remaining = DISCONNECT_GRACE_PERIOD_MS - elapsed;
          const nextTime = now + remaining;
          if (earliestNextDisconnect === null || nextTime < earliestNextDisconnect) {
            earliestNextDisconnect = nextTime;
          }
        }
      }
    }

    if (earliestNextDisconnect !== null && this.ctx?.storage?.setAlarm) {
      await this.ctx.storage.setAlarm(earliestNextDisconnect);
    }
  }

  private makeConsoleApi(ws: WebSocket): ConsoleApi {
    const self = this;
    return new (class extends RpcTarget implements ConsoleApi {
      async join(callbacks: ConsoleCallbacks, consoleToken?: string) {
        if (!self.consoleToken && self.ctx?.storage?.get) {
          self.consoleToken = (await self.ctx.storage.get<string>("consoleToken")) ?? null;
        }

        if (self.consoleToken && consoleToken !== self.consoleToken) {
          throw new Error("Invalid console token");
        }

        if (!self.consoleToken) {
          self.consoleToken = consoleToken || crypto.randomUUID();
          if (self.ctx?.storage?.put) {
            await self.ctx.storage.put("consoleToken", self.consoleToken);
          }
        }

        for (const [otherWs, s] of self.sessions) {
          if (s.role === "console") {
            try {
              otherWs.close(4000, "replaced");
            } catch {
              // Ignore if already closed
            }
            self.sessions.delete(otherWs);
          }
        }

        const controllers = [...self.sessions.values()].filter(s => s.role === "controller");
        self.sessions.set(ws, {
          id: "console",
          role: "console",
          name: "console",
          callbacks: (callbacks as unknown as RpcStub<ConsoleCallbacks>).dup()
        });

        ws.addEventListener("close", () => self.handleClose(ws));
        ws.addEventListener("error", () => self.handleClose(ws));

        // Notify existing controllers that a console is ready
        for (const s of controllers) {
          try {
            (s.callbacks as RpcStub<ControllerCallbacks>).onConsoleReady();
          } catch {
            // Callback invocation error handling
          }
        }

        return {
          controllers: controllers.map(s => ({ id: s.id, name: s.name })),
          consoleToken: self.consoleToken
        };
      }

      sendSignal(to: string, signal: RTCSignal) {
        self.sendToId(to, cb => (cb as RpcStub<ControllerCallbacks>).onSignal(signal));
      }

      async saveGameState(state: unknown): Promise<void> {
        if (self.ctx?.storage?.put) {
          await self.ctx.storage.put("gameState", state);
        }
      }

      async loadGameState(): Promise<unknown> {
        if (self.ctx?.storage?.get) {
          const state = await self.ctx.storage.get("gameState");
          return state ?? null;
        }
        return null;
      }
    })();
  }

  private makeControllerApi(ws: WebSocket): ControllerApi {
    const self = this;
    return new (class extends RpcTarget implements ControllerApi {
      join(callbacks: ControllerCallbacks, rejoinToken?: string) {
        let id: string;
        let name: string;
        let token: string;
        let isRejoin = false;

        if (rejoinToken && self.rejoinTokens.has(rejoinToken)) {
          const record = self.rejoinTokens.get(rejoinToken)!;
          id = record.id;
          name = record.name;
          token = rejoinToken;
          record.disconnectedAt = null;
          isRejoin = true;
        } else {
          id = crypto.randomUUID();
          name = self.nextPlayerName();
          token = rejoinToken || crypto.randomUUID();
          self.rejoinTokens.set(token, {
            id,
            name,
            disconnectedAt: null
          });
        }

        const consoleConnected = [...self.sessions.values()].some(s => s.role === "console");

        self.sessions.set(ws, {
          id,
          role: "controller",
          name,
          callbacks: (callbacks as unknown as RpcStub<ControllerCallbacks>).dup(),
          rejoinToken: token
        });

        ws.addEventListener("close", () => self.handleClose(ws));
        ws.addEventListener("error", () => self.handleClose(ws));

        // Announce controller join to console if not a seamless rejoin while connected
        if (!isRejoin) {
          self.forConsole(cb => (cb as RpcStub<ConsoleCallbacks>).onControllerJoined(id, name));
        }

        return { id, name, consoleConnected, rejoinToken: token };
      }

      sendSignal(signal: RTCSignal) {
        const session = self.sessions.get(ws);
        if (!session) return;
        const from = session.id;
        self.forConsole(cb => (cb as RpcStub<ConsoleCallbacks>).onSignal(from, signal));
      }
    })();
  }

  private async handleClose(ws: WebSocket) {
    const session = this.sessions.get(ws);
    if (!session) return;
    this.sessions.delete(ws);

    try {
      session.callbacks[Symbol.dispose]();
    } catch {
      // Ignore disposal error
    }

    if (session.role === "controller") {
      if (session.rejoinToken && this.rejoinTokens.has(session.rejoinToken)) {
        const record = this.rejoinTokens.get(session.rejoinToken)!;
        record.disconnectedAt = Date.now();
        if (this.ctx?.storage?.setAlarm) {
          await this.ctx.storage.setAlarm(Date.now() + DISCONNECT_GRACE_PERIOD_MS);
        }
      } else {
        this.forConsole(cb => (cb as RpcStub<ConsoleCallbacks>).onControllerLeft(session.id));
      }
    } else {
      for (const s of this.sessions.values()) {
        if (s.role === "controller") {
          try {
            (s.callbacks as RpcStub<ControllerCallbacks>).onConsoleGone();
          } catch {
            // Ignore error
          }
        }
      }
    }
  }

  private sendToId(id: string, fn: (cb: RpcStub<ConsoleCallbacks | ControllerCallbacks>) => void) {
    for (const session of this.sessions.values()) {
      if (session.id === id) {
        try {
          fn(session.callbacks);
        } catch {
          // Ignore RPC failure
        }
        break;
      }
    }
  }

  private forConsole(fn: (cb: RpcStub<ConsoleCallbacks>) => void) {
    for (const session of this.sessions.values()) {
      if (session.role === "console") {
        try {
          fn(session.callbacks as RpcStub<ConsoleCallbacks>);
        } catch {
          // Ignore RPC failure
        }
      }
    }
  }

  private nextPlayerName(): string {
    const name = `Player ${this.nextPlayerNumber}`;
    this.nextPlayerNumber++;
    return name;
  }
}
