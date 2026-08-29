import { newWebSocketRpcSession, RpcTarget, type RpcStub } from "capnweb";
import type { ControllerApi, ControllerCallbacks, RTCSignal } from "../lib/signaling-api";
import { PeerConnection } from "@transport/peer-connection";
import { RelayConnection } from "@transport/relay-connection";
import type { GameTransport, IdentityMessage } from "@transport/transport";
import { loadControllerGame } from "@contract/gameSource";
import type { ControllerGameInstance } from "@contract/gameTypes";
import { getOrCreateRejoinToken, persistRejoinToken, getSavedName, saveName, sanitizeName } from "../utils/deviceIdentity";
import { isController } from "../utils/isController";
import { getForcedTransport } from "./console";

export interface ControllerContext {
  peerConnection: GameTransport | null;
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

  onRelayInput(payload: unknown) {
    this.app.handleRelayInput(payload);
  }

  onRelayControl(payload: unknown) {
    this.app.handleRelayControl(payload);
  }
}

class ControllerApp {
  code: string;
  id: string = "";
  name: string = "";
  color: string = "";
  isFirstPlayer: boolean = false;
  api: RpcStub<ControllerApi> | null = null;
  pc: GameTransport | null = null;
  reconnectTimer: number | null = null;
  negotiationTimer: number | null = null;
  disconnectTimer: number | null = null;
  private reconnectAttempt = 0;
  activeGame: ControllerGameInstance | null = null;
  chosenName: string = "";

  constructor() {
    const params = new URLSearchParams(window.location.search);
    this.code = (params.get("code") || "").toUpperCase();
  }

  async init() {
    const savedName = getSavedName();
    const nameScreen = document.getElementById("name-screen");
    const controllerMain = document.getElementById("controller-main");
    const nameInput = document.getElementById("player-name-input") as HTMLInputElement;
    const nameForm = document.getElementById("name-form") as HTMLFormElement;

    if (nameInput && savedName) {
      nameInput.value = savedName;
    }

    if (savedName && sanitizeName(savedName)) {
      this.chosenName = savedName;
      if (nameScreen) nameScreen.classList.add("u-hidden");
      if (controllerMain) controllerMain.classList.remove("u-hidden");
      this.startConnection();
    } else if (nameForm && nameScreen && controllerMain) {
      nameScreen.classList.remove("u-hidden");
      controllerMain.classList.add("u-hidden");
      nameForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const raw = nameInput?.value || "";
        const clean = sanitizeName(raw);
        if (clean) {
          saveName(clean);
          this.chosenName = clean;
        }
        nameScreen.classList.add("u-hidden");
        controllerMain.classList.remove("u-hidden");
        this.startConnection();
      });
    } else {
      this.startConnection();
    }
  }

  private startConnection() {
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

      this.api.join(callbacks, token, this.chosenName || undefined).then(res => {
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

  async promoteToRelay() {
    if (this.negotiationTimer) {
      clearTimeout(this.negotiationTimer);
      this.negotiationTimer = null;
    }
    if (this.disconnectTimer) {
      clearTimeout(this.disconnectTimer);
      this.disconnectTimer = null;
    }

    this.activeGame?.destroy?.();
    this.activeGame = null;

    if (this.pc) {
      this.pc.close();
    }

    const relay = new RelayConnection(this.api, undefined, {
      onControlMessage: msg => {
        if (msg.type === "identity") {
          const identityMsg = msg as IdentityMessage;
          this.name = identityMsg.name;
          this.color = identityMsg.color;
          this.updatePlayerInfo(this.name, this.color);
        }
      }
    });

    this.pc = relay;
    this.updateStatus("Connected to Console (Relay)");

    try {
      const { createGame } = await loadControllerGame(new URL(window.location.href));
      this.activeGame = createGame({
        peerConnection: this.pc,
        isFirstPlayer: () => this.isFirstPlayer
      });
    } catch (err) {
      console.error("Failed to load controller game logic:", err);
    }
  }

  async initiateWebRTC() {
    const forced = getForcedTransport();

    if (forced === "relay") {
      await this.promoteToRelay();
      return;
    }

    this.activeGame?.destroy?.();
    this.activeGame = null;

    if (this.pc) {
      this.pc.close();
    }

    this.updateStatus(`Negotiating WebRTC with console...`);

    const pc = new PeerConnection(true, {
      onSignal: signal => {
        this.api?.sendSignal(signal);
      },
      onStateChange: state => {
        if (state === "connected") {
          if (this.negotiationTimer) {
            clearTimeout(this.negotiationTimer);
            this.negotiationTimer = null;
          }
          if (this.disconnectTimer) {
            clearTimeout(this.disconnectTimer);
            this.disconnectTimer = null;
          }
          this.updateStatus(`Connected to Console!`);
        } else if (state === "disconnected") {
          this.updateStatus(`Connection state: ${state}`);
          if (forced !== "rtc" && !this.disconnectTimer) {
            this.disconnectTimer = window.setTimeout(() => {
              this.disconnectTimer = null;
              if (this.pc?.mode === "p2p" && (this.pc as PeerConnection).pc.connectionState !== "connected") {
                this.promoteToRelay();
              }
            }, 4000);
          }
        } else if (state === "failed") {
          this.updateStatus(`Connection state: ${state}`);
          if (forced !== "rtc") {
            this.promoteToRelay();
          }
        } else {
          this.updateStatus(`Connection state: ${state}`);
        }
      },
      onControlMessage: msg => {
        if (msg.type === "identity") {
          const identityMsg = msg as IdentityMessage;
          this.name = identityMsg.name;
          this.color = identityMsg.color;
          this.updatePlayerInfo(this.name, this.color);
        }
      }
    });

    this.pc = pc;

    if (forced !== "rtc" && !this.negotiationTimer) {
      this.negotiationTimer = window.setTimeout(() => {
        this.negotiationTimer = null;
        if (this.pc?.mode === "p2p" && (this.pc as PeerConnection).pc.connectionState !== "connected") {
          this.promoteToRelay();
        }
      }, 8000);
    }

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
      const offer = await pc.createOffer();
      this.api?.sendSignal({ sdp: offer });
    } catch (err) {
      console.error("Failed to create offer:", err);
    }
  }

  handleConsoleGone() {
    if (this.negotiationTimer) {
      clearTimeout(this.negotiationTimer);
      this.negotiationTimer = null;
    }
    if (this.disconnectTimer) {
      clearTimeout(this.disconnectTimer);
      this.disconnectTimer = null;
    }
    this.activeGame?.destroy?.();
    this.activeGame = null;
    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }
    this.updateStatus(`Console disconnected. Waiting for console...`);
  }

  handleSignal(signal: RTCSignal) {
    if (this.pc && this.pc instanceof PeerConnection) {
      this.pc.handleSignal(signal).catch(err => {
        console.error("Error handling signal from console:", err);
      });
    }
  }

  handleRelayInput(payload: unknown) {
    if (this.pc?.mode !== "relay") {
      this.promoteToRelay();
    }
    if (this.pc instanceof RelayConnection) {
      this.pc.handleRelayInput(payload);
    }
  }

  handleRelayControl(payload: unknown) {
    if (this.pc?.mode !== "relay") {
      this.promoteToRelay();
    }
    if (this.pc instanceof RelayConnection) {
      this.pc.handleRelayControl(payload);
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

if (typeof window !== "undefined" && isController()) {
  window.addEventListener("DOMContentLoaded", () => {
    const app = new ControllerApp();
    app.init();
  });
}
