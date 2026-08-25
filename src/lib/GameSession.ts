import { DurableObject } from "cloudflare:workers";
import { RpcTarget, newWebSocketRpcSession, type RpcStub } from "capnweb";
import type { ConsoleApi, ConsoleCallbacks, ControllerApi, ControllerCallbacks, RTCSignal } from "./signaling-api";

type Role = "console" | "controller";

type Session = {
  id: string;
  role: Role;
  name: string;
  callbacks: RpcStub<ConsoleCallbacks | ControllerCallbacks>;
};

export class GameSession extends DurableObject {
  sessions = new Map<WebSocket, Session>();
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
      for (const [ws, s] of this.sessions) {
        if (s.role === "console") {
          try {
            ws.close(4000, "replaced");
          } catch {
            // Ignore if already closed
          }
          this.sessions.delete(ws);
        }
      }
      newWebSocketRpcSession(server, this.makeConsoleApi(server));
    } else {
      newWebSocketRpcSession(server, this.makeControllerApi(server));
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  private makeConsoleApi(ws: WebSocket): ConsoleApi {
    const self = this;
    return new (class extends RpcTarget implements ConsoleApi {
      join(callbacks: ConsoleCallbacks) {
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
          controllers: controllers.map(s => ({ id: s.id, name: s.name }))
        };
      }

      sendSignal(to: string, signal: RTCSignal) {
        self.sendToId(to, cb => (cb as RpcStub<ControllerCallbacks>).onSignal(signal));
      }
    })();
  }

  private makeControllerApi(ws: WebSocket): ControllerApi {
    const self = this;
    return new (class extends RpcTarget implements ControllerApi {
      join(callbacks: ControllerCallbacks) {
        const id = crypto.randomUUID();
        const name = self.nextPlayerName();
        const consoleConnected = [...self.sessions.values()].some(s => s.role === "console");

        self.sessions.set(ws, {
          id,
          role: "controller",
          name,
          callbacks: (callbacks as unknown as RpcStub<ControllerCallbacks>).dup()
        });

        ws.addEventListener("close", () => self.handleClose(ws));
        ws.addEventListener("error", () => self.handleClose(ws));

        // Announce new controller to console
        self.forConsole(cb => (cb as RpcStub<ConsoleCallbacks>).onControllerJoined(id, name));

        return { id, name, consoleConnected };
      }

      sendSignal(signal: RTCSignal) {
        const session = self.sessions.get(ws);
        if (!session) return;
        const from = session.id;
        self.forConsole(cb => (cb as RpcStub<ConsoleCallbacks>).onSignal(from, signal));
      }
    })();
  }

  private handleClose(ws: WebSocket) {
    const session = this.sessions.get(ws);
    if (!session) return;
    this.sessions.delete(ws);

    try {
      session.callbacks[Symbol.dispose]();
    } catch {
      // Ignore disposal error
    }

    if (session.role === "controller") {
      this.forConsole(cb => (cb as RpcStub<ConsoleCallbacks>).onControllerLeft(session.id));
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
