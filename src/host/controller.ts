import { newWebSocketRpcSession, RpcTarget, type RpcStub } from "capnweb";
import type { ControllerApi, ControllerCallbacks, RTCSignal } from "../lib/signaling-api";
import { ConnectionOrchestrator } from "@transport/connectionOrchestrator";
import type { GameTransport, IdentityMessage } from "@transport/transport";
import { loadControllerGame } from "@contract/gameSource";
import type { ControllerGameInstance } from "@contract/gameTypes";
import { getOrCreateRejoinToken, persistRejoinToken, getSavedName, saveName, sanitizeName } from "../utils/deviceIdentity";
import { isController } from "../utils/isController";
import { createLogger } from "@utils/logger";

const logger = createLogger("ControllerHost");

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
  orchestrator: ConnectionOrchestrator | null = null;
  reconnectTimer: number | null = null;
  private reconnectAttempt = 0;
  activeGame: ControllerGameInstance | null = null;
  chosenName: string = "";
  private loadGameToken = 0;

  constructor() {
    const params = new URLSearchParams(window.location.search);
    this.code = (params.get("code") || "").toUpperCase();
    logger.info(`ControllerApp initialized with room code: ${this.code}`);
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
    logger.info(`First player changed. Am host: ${this.isFirstPlayer}`);
    this.updatePlayerInfo(this.name, this.color);
  }

  connectSignaling() {
    if (!this.code) {
      logger.error("Missing room code in URL");
      this.updateStatus("Error: Missing room code.");
      return;
    }

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/api/signaling?code=${this.code}&role=controller`;
    logger.info(`Connecting to signaling server at ${wsUrl}`);

    try {
      this.api = newWebSocketRpcSession<ControllerApi>(wsUrl);

      this.api.onRpcBroken(() => {
        logger.warn("Signaling RPC session broken");
        this.scheduleReconnect();
      });

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
        logger.info(`Joined room ${this.code} as player '${res.name}' (id: ${res.id}, host: ${res.isFirstPlayer}, consoleConnected: ${res.consoleConnected})`);
        this.updatePlayerInfo(this.name, this.color);

        if (res.consoleConnected) {
          this.initiateWebRTC();
        } else {
          this.updateStatus(`Connected as ${this.name}. Waiting for console...`);
        }
      }).catch(err => {
        logger.error("Failed to join as controller:", err);
        const msg = String(err?.message || err);
        if (msg.includes("Room is full") || msg.includes("limit")) {
          this.updateStatus(msg);
        } else {
          this.scheduleReconnect();
        }
      });
    } catch (err) {
      logger.error("Signaling error:", err);
      this.scheduleReconnect();
    }
  }

  scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.updateStatus("Signaling broken. Reconnecting...");
    const base = Math.min(30000, 1000 * 2 ** this.reconnectAttempt);
    const jitter = Math.random() * base * 0.3;
    const delay = Math.round(base + jitter);
    logger.info(`Scheduling signaling reconnect attempt ${this.reconnectAttempt + 1} in ${delay}ms`);
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectAttempt++;
      this.connectSignaling();
    }, delay);
  }

  private async loadGame() {
    const token = ++this.loadGameToken;
    this.activeGame?.destroy?.();
    this.activeGame = null;

    if (!this.pc) return;

    try {
      const { createGame } = await loadControllerGame(new URL(window.location.href));
      if (token !== this.loadGameToken || !this.pc) return;
      this.activeGame = createGame({
        peerConnection: this.pc,
        isFirstPlayer: () => this.isFirstPlayer,
      });
    } catch (err) {
      logger.error("Failed to load controller game logic:", err);
    }
  }

  async initiateWebRTC() {
    logger.info("Initiating ConnectionOrchestrator for WebRTC/relay connection...");
    this.orchestrator?.close();

    this.orchestrator = new ConnectionOrchestrator(
      {
        isInitiator: true,
        getApi: () => this.api,
      },
      {
        onSignal: (signal) => {
          this.api?.sendSignal(signal);
        },
        onTransportChange: (transport) => {
          logger.info(`Transport changed -> ${transport.mode}`);
          this.pc = transport;
          if (transport.mode === "relay") {
            this.updateStatus("Connected to Console (Relay)");
          } else {
            this.updateStatus("Negotiating WebRTC with console...");
          }
          this.loadGame();
        },
        onStateChange: (state) => {
          logger.info(`WebRTC connection state -> ${state}`);
          if (state === "connected") {
            this.updateStatus("Connected to Console!");
          } else {
            this.updateStatus(`Connection state: ${state}`);
          }
        },
        onControlMessage: (msg) => {
          if (msg.type === "identity") {
            const identityMsg = msg as IdentityMessage;
            logger.info(`Received identity update: name='${identityMsg.name}', color='${identityMsg.color}'`);
            this.name = identityMsg.name;
            this.color = identityMsg.color;
            this.updatePlayerInfo(this.name, this.color);
          }
        },
      }
    );

    if (this.orchestrator.transport.mode === "p2p") {
      try {
        logger.info("Creating local WebRTC SDP offer to send to console");
        const offer = await this.orchestrator.createOffer();
        this.api?.sendSignal({ sdp: offer });
      } catch (err) {
        logger.error("Failed to create offer:", err);
      }
    }
  }

  handleConsoleGone() {
    logger.warn("Console disconnected. Cleaning up transport and active game");
    this.orchestrator?.close();
    this.orchestrator = null;
    this.activeGame?.destroy?.();
    this.activeGame = null;
    this.pc = null;
    this.updateStatus("Console disconnected. Waiting for console...");
  }

  handleSignal(signal: RTCSignal) {
    const sigType = "sdp" in signal && signal.sdp ? `SDP (${signal.sdp.type})` : "ICE candidate";
    logger.info(`Received RTCSignal from console: ${sigType}`);
    if (this.orchestrator) {
      this.orchestrator.handleSignal(signal).catch((err) => {
        logger.error("Error handling signal from console:", err);
      });
    }
  }

  handleRelayInput(payload: unknown) {
    logger.debug("Received relay input message from console");
    if (!this.orchestrator) {
      this.initiateWebRTC();
    }
    this.orchestrator?.handleRelayInput(payload);
  }

  handleRelayControl(payload: unknown) {
    logger.debug("Received relay control message from console");
    if (!this.orchestrator) {
      this.initiateWebRTC();
    }
    this.orchestrator?.handleRelayControl(payload);
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
