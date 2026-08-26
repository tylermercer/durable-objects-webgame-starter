import { DurableObject } from "cloudflare:workers";
import { RpcTarget, newWebSocketRpcSession, type RpcStub } from "capnweb";
import type { ConsoleApi, ConsoleCallbacks, ControllerApi, ControllerCallbacks, RTCSignal } from "./signaling-api";
import { sanitizeName } from "../utils/deviceIdentity";

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
  gracePeriodMs: number = DISCONNECT_GRACE_PERIOD_MS;
  private nextPlayerNumber = 1;
  private currentFirstPlayerId: string | null = null;
  private hydrationPromise: Promise<void> | null = null;

  private hydrateIfNeeded(): Promise<void> {
    if (!this.hydrationPromise) {
      this.hydrationPromise = this.doHydrate();
    }
    return this.hydrationPromise;
  }

  private async doHydrate() {
    if (this.ctx?.storage?.get) {
      const storedTokens = await this.ctx.storage.get<[string, ControllerRecord][]>("rejoinTokens");
      if (storedTokens) this.rejoinTokens = new Map(storedTokens);
      const nextNum = await this.ctx.storage.get<number>("nextPlayerNumber");
      if (nextNum) this.nextPlayerNumber = nextNum;
      const grace = await this.ctx.storage.get<number>("gracePeriodMs");
      if (grace) this.gracePeriodMs = grace;
    }
  }

  private async persistRejoinTokens() {
    if (this.ctx?.storage?.put) {
      await this.ctx.storage.put("rejoinTokens", [...this.rejoinTokens.entries()]);
      await this.ctx.storage.put("nextPlayerNumber", this.nextPlayerNumber);
      await this.ctx.storage.put("gracePeriodMs", this.gracePeriodMs);
    }
  }

  async fetch(request: Request): Promise<Response> {
    await this.hydrateIfNeeded();

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

  private getFirstPlayerId(): string | null {
    for (const record of this.rejoinTokens.values()) {
      if (record.disconnectedAt === null) return record.id;
    }
    return null;
  }

  private checkAndBroadcastFirstPlayer() {
    const newFirstPlayerId = this.getFirstPlayerId();
    if (newFirstPlayerId !== this.currentFirstPlayerId) {
      this.currentFirstPlayerId = newFirstPlayerId;
      this.forConsole(cb => {
        try {
          (cb as RpcStub<ConsoleCallbacks>).onFirstPlayerChanged(newFirstPlayerId);
        } catch {
          // Ignore RPC failure
        }
      });
      for (const session of this.sessions.values()) {
        if (session.role === "controller") {
          try {
            (session.callbacks as RpcStub<ControllerCallbacks>).onFirstPlayerChanged(newFirstPlayerId);
          } catch {
            // Ignore RPC failure
          }
        }
      }
    }
  }

  async alarm(): Promise<void> {
    await this.hydrateIfNeeded();
    const now = Date.now();
    let earliestNextDisconnect: number | null = null;
    let tokensChanged = false;

    for (const [token, record] of Array.from(this.rejoinTokens.entries())) {
      if (record.disconnectedAt !== null) {
        const elapsed = now - record.disconnectedAt;
        if (elapsed >= this.gracePeriodMs) {
          this.rejoinTokens.delete(token);
          tokensChanged = true;
          this.forConsole(cb => (cb as RpcStub<ConsoleCallbacks>).onControllerLeft(record.id));
        } else {
          const remaining = this.gracePeriodMs - elapsed;
          const nextTime = now + remaining;
          if (earliestNextDisconnect === null || nextTime < earliestNextDisconnect) {
            earliestNextDisconnect = nextTime;
          }
        }
      }
    }

    if (tokensChanged) {
      await this.persistRejoinTokens();
    }

    this.checkAndBroadcastFirstPlayer();

    if (earliestNextDisconnect !== null && this.ctx?.storage?.setAlarm) {
      await this.ctx.storage.setAlarm(earliestNextDisconnect);
    }
  }

  private makeConsoleApi(ws: WebSocket): ConsoleApi {
    const self = this;
    return new (class extends RpcTarget implements ConsoleApi {
      async join(callbacks: ConsoleCallbacks, consoleToken?: string, gracePeriodMs?: number) {
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

        if (gracePeriodMs !== undefined && gracePeriodMs > 0) {
          self.gracePeriodMs = gracePeriodMs;
          if (self.ctx?.storage?.put) {
            await self.ctx.storage.put("gracePeriodMs", self.gracePeriodMs);
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

        self.currentFirstPlayerId = self.getFirstPlayerId();

        return {
          controllers: controllers.map(s => ({ id: s.id, name: s.name })),
          firstPlayerId: self.currentFirstPlayerId,
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
      async join(callbacks: ControllerCallbacks, rejoinToken?: string, name?: string) {
        const cleanName = sanitizeName(name);
        let id: string;
        let name_: string;
        let token: string;
        let isRejoin = false;
        let nameChangedOnRejoin = false;

        if (rejoinToken && self.rejoinTokens.has(rejoinToken)) {
          const record = self.rejoinTokens.get(rejoinToken)!;
          id = record.id;
          if (cleanName && cleanName !== record.name) {
            nameChangedOnRejoin = true;
          }
          name_ = cleanName ?? record.name;
          record.name = name_;
          token = rejoinToken;
          record.disconnectedAt = null;
          isRejoin = true;
        } else {
          id = crypto.randomUUID();
          name_ = cleanName ?? self.nextPlayerName();
          token = rejoinToken || crypto.randomUUID();
          self.rejoinTokens.set(token, {
            id,
            name: name_,
            disconnectedAt: null
          });
        }

        await self.persistRejoinTokens();

        const consoleConnected = [...self.sessions.values()].some(s => s.role === "console");

        self.sessions.set(ws, {
          id,
          role: "controller",
          name: name_,
          callbacks: (callbacks as unknown as RpcStub<ControllerCallbacks>).dup(),
          rejoinToken: token
        });

        ws.addEventListener("close", () => self.handleClose(ws));
        ws.addEventListener("error", () => self.handleClose(ws));

        // Announce controller join to console if not a seamless rejoin while connected
        if (!isRejoin) {
          self.forConsole(cb => (cb as RpcStub<ConsoleCallbacks>).onControllerJoined(id, name_));
        } else {
          self.forConsole(cb => {
            try {
              (cb as RpcStub<ConsoleCallbacks>).onControllerRejoined(id);
              if (nameChangedOnRejoin) {
                (cb as RpcStub<ConsoleCallbacks>).onControllerRenamed(id, name_);
              }
            } catch {
              // Ignore RPC failure
            }
          });
        }

        const firstPlayerId = self.getFirstPlayerId();
        const isFirstPlayer = (firstPlayerId === id);

        self.checkAndBroadcastFirstPlayer();

        return { id, name: name_, consoleConnected, rejoinToken: token, isFirstPlayer };
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
        await this.persistRejoinTokens();
        if (this.ctx?.storage?.setAlarm) {
          await this.ctx.storage.setAlarm(Date.now() + this.gracePeriodMs);
        }
        this.forConsole(cb => {
          try {
            (cb as RpcStub<ConsoleCallbacks>).onControllerDisconnected(session.id);
          } catch {
            // Ignore RPC failure
          }
        });
      } else {
        this.forConsole(cb => (cb as RpcStub<ConsoleCallbacks>).onControllerLeft(session.id));
      }
      this.checkAndBroadcastFirstPlayer();
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
