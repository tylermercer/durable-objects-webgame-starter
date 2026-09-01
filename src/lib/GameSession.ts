import { DurableObject } from "cloudflare:workers";
import { RpcTarget, newWebSocketRpcSession, type RpcStub } from "capnweb";
import type { ConsoleApi, ConsoleCallbacks, ControllerApi, ControllerCallbacks, RTCSignal } from "./signaling-api";
import { sanitizeName } from "../utils/deviceIdentity";
import { createLogger } from "@utils/logger";

const logger = createLogger("GameSession");

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
const MAX_CONTROL_QUEUE_SIZE = 25;

export class GameSession extends DurableObject {
  sessions = new Map<WebSocket, Session>();
  rejoinTokens = new Map<string, ControllerRecord>();
  consoleToken: string | null = null;
  gracePeriodMs: number = DISCONNECT_GRACE_PERIOD_MS;
  maxPlayers: number | null = null;
  private nextPlayerNumber = 1;
  private currentFirstPlayerId: string | null = null;
  private hydrationPromise: Promise<void> | null = null;
  private controlQueues = new Map<string, unknown[]>();

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
      const maxP = await this.ctx.storage.get<number>("maxPlayers");
      if (maxP !== undefined) this.maxPlayers = maxP;
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

    logger.info(`WebSocket connection upgrade requested for role: ${role}`);

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
      logger.info(`First player ID updated -> ${newFirstPlayerId ?? "none"}`);
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
    logger.info("Disconnect grace period alarm triggered. Checking for expired player sessions...");
    const now = Date.now();
    let earliestNextDisconnect: number | null = null;
    let tokensChanged = false;

    for (const [token, record] of Array.from(this.rejoinTokens.entries())) {
      if (record.disconnectedAt !== null) {
        const elapsed = now - record.disconnectedAt;
        if (elapsed >= this.gracePeriodMs) {
          logger.info(`Purged expired controller session: ${record.name} (${record.id})`);
          this.rejoinTokens.delete(token);
          this.controlQueues.delete(record.id);
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
      async join(callbacks: ConsoleCallbacks, consoleToken?: string, gracePeriodMs?: number, maxPlayers?: number) {
        if (!self.consoleToken && self.ctx?.storage?.get) {
          self.consoleToken = (await self.ctx.storage.get<string>("consoleToken")) ?? null;
        }

        if (self.consoleToken && consoleToken !== self.consoleToken) {
          logger.warn("Console join rejected: invalid console token");
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

        if (maxPlayers !== undefined && maxPlayers > 0) {
          self.maxPlayers = maxPlayers;
          if (self.ctx?.storage?.put) {
            await self.ctx.storage.put("maxPlayers", self.maxPlayers);
          }
        } else if (maxPlayers === null || maxPlayers === 0) {
          self.maxPlayers = null;
          if (self.ctx?.storage?.delete) {
            await self.ctx.storage.delete("maxPlayers");
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

        logger.info(`Console joined signaling session. Connected controllers count: ${controllers.length}`);

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

        // Flush any queued control messages for console
        const consoleQueue = self.controlQueues.get("console");
        if (consoleQueue && consoleQueue.length > 0) {
          logger.info(`Flushing ${consoleQueue.length} queued relay control messages for console`);
          for (const item of consoleQueue as Array<{ from: string; payload: unknown }>) {
            try {
              (callbacks as unknown as RpcStub<ConsoleCallbacks>).onRelayControl(item.from, item.payload);
            } catch {
              // Ignore RPC failure
            }
          }
          self.controlQueues.delete("console");
        }

        return {
          controllers: controllers.map(s => ({ id: s.id, name: s.name })),
          firstPlayerId: self.currentFirstPlayerId,
          consoleToken: self.consoleToken
        };
      }

      async kickController(id: string): Promise<void> {
        logger.info(`Console requested kick for controller ID: ${id}`);
        // Find rejoin token corresponding to controller ID
        let foundToken: string | null = null;
        for (const [token, record] of self.rejoinTokens.entries()) {
          if (record.id === id) {
            foundToken = token;
            break;
          }
        }

        if (foundToken) {
          self.rejoinTokens.delete(foundToken);
          await self.persistRejoinTokens();
        }

        self.controlQueues.delete(id);

        // Find and close active session if connected
        for (const [ws, session] of Array.from(self.sessions.entries())) {
          if (session.id === id) {
            try {
              (session.callbacks as RpcStub<ControllerCallbacks>).onKicked();
            } catch {
              // Ignore RPC failure
            }
            try {
              ws.close(4001, "kicked");
            } catch {
              // Ignore if already closed
            }
            self.sessions.delete(ws);
          }
        }

        // Notify console that controller has left
        self.forConsole(cb => {
          try {
            (cb as RpcStub<ConsoleCallbacks>).onControllerLeft(id);
          } catch {
            // Ignore RPC failure
          }
        });

        self.checkAndBroadcastFirstPlayer();
      }

      sendSignal(to: string, signal: RTCSignal) {
        self.sendToId(to, cb => (cb as RpcStub<ControllerCallbacks>).onSignal(signal));
      }

      relayInput(to: string, payload: unknown) {
        self.sendToId(to, cb => (cb as RpcStub<ControllerCallbacks>).onRelayInput(payload));
      }

      relayControl(to: string, payload: unknown) {
        let delivered = false;
        self.sendToId(to, cb => {
          delivered = true;
          (cb as RpcStub<ControllerCallbacks>).onRelayControl(payload);
        });

        if (!delivered) {
          let queue = self.controlQueues.get(to);
          if (!queue) {
            queue = [];
            self.controlQueues.set(to, queue);
          }
          queue.push(payload);
          if (queue.length > MAX_CONTROL_QUEUE_SIZE) {
            queue.shift();
          }
        }
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
          if (self.maxPlayers !== null && self.rejoinTokens.size >= self.maxPlayers) {
            logger.warn(`Controller join rejected: player limit of ${self.maxPlayers} reached`);
            throw new Error(`Room is full. Maximum limit of ${self.maxPlayers} players reached.`);
          }
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

        const firstPlayerId = self.getFirstPlayerId();
        const isFirstPlayer = (firstPlayerId === id);

        logger.info(`Controller joined session: '${name_}' (id: ${id}, isRejoin: ${isRejoin}, isHost: ${isFirstPlayer}, consoleConnected: ${consoleConnected})`);

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

        self.checkAndBroadcastFirstPlayer();

        // Flush any queued control messages for this controller ID
        const controllerQueue = self.controlQueues.get(id);
        if (controllerQueue && controllerQueue.length > 0) {
          logger.info(`Flushing ${controllerQueue.length} queued relay control messages for controller ${id}`);
          for (const payload of controllerQueue) {
            try {
              (callbacks as unknown as RpcStub<ControllerCallbacks>).onRelayControl(payload);
            } catch {
              // Ignore RPC failure
            }
          }
          self.controlQueues.delete(id);
        }

        return { id, name: name_, consoleConnected, rejoinToken: token, isFirstPlayer };
      }

      sendSignal(signal: RTCSignal) {
        const session = self.sessions.get(ws);
        if (!session) return;
        const from = session.id;
        self.forConsole(cb => (cb as RpcStub<ConsoleCallbacks>).onSignal(from, signal));
      }

      relayInput(payload: unknown) {
        const session = self.sessions.get(ws);
        if (!session) return;
        const from = session.id;
        self.forConsole(cb => (cb as RpcStub<ConsoleCallbacks>).onRelayInput(from, payload));
      }

      relayControl(payload: unknown) {
        const session = self.sessions.get(ws);
        if (!session) return;
        const from = session.id;
        let delivered = false;

        self.forConsole(cb => {
          delivered = true;
          (cb as RpcStub<ConsoleCallbacks>).onRelayControl(from, payload);
        });

        if (!delivered) {
          let queue = self.controlQueues.get("console") as Array<{ from: string; payload: unknown }> | undefined;
          if (!queue) {
            queue = [];
            self.controlQueues.set("console", queue as unknown as unknown[]);
          }
          queue.push({ from, payload });
          if (queue.length > MAX_CONTROL_QUEUE_SIZE) {
            queue.shift();
          }
        }
      }
    })();
  }

  private async handleClose(ws: WebSocket) {
    const session = this.sessions.get(ws);
    if (!session) return;
    this.sessions.delete(ws);

    logger.info(`WebSocket closed for role: ${session.role}, id: ${session.id}`);

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
