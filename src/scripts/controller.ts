import { newWebSocketRpcSession, RpcTarget, type RpcStub } from "capnweb";
import type { ControllerApi, ControllerCallbacks, RTCSignal } from "../lib/signaling-api";
import { PeerConnection, type TouchMessage } from "./peer-connection";

class ControllerCallbacksHandler extends RpcTarget implements ControllerCallbacks {
  constructor(private app: ControllerApp) {
    super();
  }

  onConsoleReady() {
    this.app.initiateWebRTC();
  }

  onConsoleGone() {
    this.app.handleConsoleGone();
  }

  onSignal(signal: RTCSignal) {
    this.app.handleSignal(signal);
  }
}

class ControllerApp {
  code: string;
  id: string = "";
  name: string = "";
  color: string = "";
  api: RpcStub<ControllerApi> | null = null;
  pc: PeerConnection | null = null;
  pendingTouch: TouchMessage | null = null;
  rafPending = false;
  reconnectTimer: number | null = null;

  constructor() {
    const params = new URLSearchParams(window.location.search);
    this.code = (params.get("code") || "").toUpperCase();
  }

  async init() {
    this.updateStatus("Connecting to signaling server...");
    this.setupTouchSurface();
    this.connectSignaling();
  }

  private getRejoinToken(): string {
    let token = localStorage.getItem("rejoinToken");
    if (!token) {
      token = crypto.randomUUID();
      localStorage.setItem("rejoinToken", token);
    }
    return token;
  }

  connectSignaling() {
    if (!this.code) {
      this.updateStatus("Error: Missing room code.");
      return;
    }

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/api/signaling?code=${this.code}&role=controller`;

    try {
      this.api = newWebSocketRpcSession<ControllerApi>(wsUrl);

      this.api.onRpcBroken(() => this.scheduleReconnect());

      const callbacks = new ControllerCallbacksHandler(this);
      const token = this.getRejoinToken();

      this.api.join(callbacks, token).then(res => {
        this.id = res.id;
        this.name = res.name;
        if (res.rejoinToken) {
          localStorage.setItem("rejoinToken", res.rejoinToken);
        }
        this.updatePlayerInfo(this.name, this.color);

        if (res.consoleConnected) {
          this.initiateWebRTC();
        } else {
          this.updateStatus(`Connected as ${this.name}. Waiting for console...`);
        }
      }).catch(err => {
        console.error("Failed to join as controller:", err);
        this.scheduleReconnect();
      });
    } catch (err) {
      console.error("Signaling error:", err);
      this.scheduleReconnect();
    }
  }

  scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.updateStatus("Signaling broken. Reconnecting...");
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connectSignaling();
    }, 3000);
  }

  async initiateWebRTC() {
    if (this.pc) {
      this.pc.close();
    }

    this.updateStatus(`Negotiating WebRTC with console...`);

    this.pc = new PeerConnection(true, {
      onSignal: signal => {
        this.api?.sendSignal(signal);
      },
      onStateChange: state => {
        if (state === "connected") {
          this.updateStatus(`Connected to Console! Touch screen to send input.`);
        } else {
          this.updateStatus(`Connection state: ${state}`);
        }
      },
      onControlMessage: msg => {
        if (msg.type === "identity") {
          this.name = msg.name;
          this.color = msg.color;
          this.updatePlayerInfo(this.name, this.color);
        }
      }
    });

    try {
      const offer = await this.pc.createOffer();
      this.api?.sendSignal({ sdp: offer });
    } catch (err) {
      console.error("Failed to create offer:", err);
    }
  }

  handleConsoleGone() {
    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }
    this.updateStatus(`Console disconnected. Waiting for console...`);
  }

  handleSignal(signal: RTCSignal) {
    if (this.pc) {
      this.pc.handleSignal(signal).catch(err => {
        console.error("Error handling signal from console:", err);
      });
    }
  }

  setupTouchSurface() {
    const surface = document.getElementById("touch-surface");
    if (!surface) return;

    const handlePointer = (phase: "start" | "move" | "end" | "cancel", e: PointerEvent) => {
      e.preventDefault();
      const rect = surface.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));

      this.pendingTouch = {
        type: "touch",
        phase,
        pointerId: e.pointerId,
        x,
        y,
        t: performance.now()
      };

      this.scheduleTouchSend();
    };

    surface.addEventListener("pointerdown", e => handlePointer("start", e));
    surface.addEventListener("pointermove", e => {
      if (e.buttons > 0) handlePointer("move", e);
    });
    surface.addEventListener("pointerup", e => handlePointer("end", e));
    surface.addEventListener("pointercancel", e => handlePointer("cancel", e));
  }

  scheduleTouchSend() {
    if (this.rafPending) return;
    this.rafPending = true;

    requestAnimationFrame(() => {
      this.rafPending = false;
      if (this.pendingTouch && this.pc) {
        this.pc.sendInput(this.pendingTouch);
        this.pendingTouch = null;
      }
    });
  }

  updateStatus(text: string) {
    const statusEl = document.getElementById("controller-status");
    if (statusEl) statusEl.textContent = text;
  }

  updatePlayerInfo(name: string, color: string) {
    const nameEl = document.getElementById("player-name");
    if (nameEl) nameEl.textContent = name || "Controller";

    const headerEl = document.getElementById("controller-header");
    if (headerEl && color) {
      headerEl.style.backgroundColor = color;
      headerEl.style.color = "#ffffff";
    }
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("DOMContentLoaded", () => {
    const app = new ControllerApp();
    app.init();
  });
}
