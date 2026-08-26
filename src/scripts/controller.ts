import { newWebSocketRpcSession, RpcTarget, type RpcStub } from "capnweb";
import type { ControllerApi, ControllerCallbacks, RTCSignal } from "../lib/signaling-api";
import { PeerConnection } from "./peer-connection";
import { loadControllerGame } from "./gameSource";
import { getOrCreateRejoinToken, persistRejoinToken } from "../utils/deviceIdentity";

export interface ControllerContext {
  peerConnection: PeerConnection | null;
  isFirstPlayer: () => boolean;
}

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

  onFirstPlayerChanged(id: string | null) {
    this.app.handleFirstPlayerChanged(id);
  }
}

class ControllerApp {
  code: string;
  id: string = "";
  name: string = "";
  color: string = "";
  isFirstPlayer: boolean = false;
  api: RpcStub<ControllerApi> | null = null;
  pc: PeerConnection | null = null;
  reconnectTimer: number | null = null;
  private reconnectAttempt = 0;
  activeGame: unknown = null;

  constructor() {
    const params = new URLSearchParams(window.location.search);
    this.code = (params.get("code") || "").toUpperCase();
  }

  async init() {
    this.updateStatus("Connecting to signaling server...");
    this.connectSignaling();
  }

  handleFirstPlayerChanged(firstPlayerId: string | null) {
    this.isFirstPlayer = (firstPlayerId === this.id);
    this.updatePlayerInfo(this.name, this.color);
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
      const token = getOrCreateRejoinToken(this.code);

      this.api.join(callbacks, token).then(res => {
        this.reconnectAttempt = 0;
        this.id = res.id;
        this.name = res.name;
        this.isFirstPlayer = res.isFirstPlayer;
        if (res.rejoinToken) {
          persistRejoinToken(res.rejoinToken, this.code);
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
    const base = Math.min(30000, 1000 * 2 ** this.reconnectAttempt);
    const jitter = Math.random() * base * 0.3;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectAttempt++;
      this.connectSignaling();
    }, base + jitter);
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
          this.updateStatus(`Connected to Console!`);
        } else {
          this.updateStatus(`Connection state: ${state}`);
        }
      },
      onControlMessage: msg => {
        if (msg.type === "identity") {
          const identityMsg = msg as { type: "identity"; name: string; color: string };
          this.name = identityMsg.name;
          this.color = identityMsg.color;
          this.updatePlayerInfo(this.name, this.color);
        }
      }
    });

    try {
      const { createGame } = await loadControllerGame(new URL(window.location.href));
      this.activeGame = createGame({
        peerConnection: this.pc,
        isFirstPlayer: () => this.isFirstPlayer
      });
    } catch (err) {
      console.error("Failed to load controller game logic:", err);
    }

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

  updateStatus(text: string) {
    const statusEl = document.getElementById("controller-status");
    if (statusEl) statusEl.textContent = text;
  }

  updatePlayerInfo(name: string, color: string) {
    const nameEl = document.getElementById("player-name");
    if (nameEl) {
      nameEl.textContent = `${name || "Controller"}${this.isFirstPlayer ? " (Host)" : ""}`;
    }

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
