import { newWebSocketRpcSession, RpcTarget, type RpcStub } from "capnweb";
import QRCode from "qrcode";
import type { ConsoleApi, ConsoleCallbacks, RTCSignal } from "../lib/signaling-api";
import { generateRoomCode } from "../utils/generateRoomCode";
import { createFixedTickLoop } from "../utils/gameLoop";
import { PeerConnection, type TouchMessage } from "../transport/peer-connection";
import { loadConsoleGame, buildJoinUrl } from "../contract/gameSource";
import type { ConsoleGameInstance } from "../contract/gameTypes";

const PLAYER_COLORS = [
  "#FF4136", "#0074D9", "#2ECC40", "#FFDC00",
  "#B10DC9", "#FF851B", "#7FDBFF", "#F012BE"
];

export type PlayerConnectionStatus =
  | "live"          // signaling connected AND WebRTC data channel open
  | "reconnecting"  // signaling connected, WebRTC renegotiating (post-restartIce)
  | "grace-period"  // signaling dropped, within the DO's grace window
  | "gone";         // grace period expired, player purged

export interface ControllerState {
  id: string;
  name: string;
  color: string;
  isFirstPlayer: boolean;
  pc: PeerConnection | null;
  state: string;
  status: PlayerConnectionStatus;
  signalingConnected: boolean;
  lastTouch?: TouchMessage;
}

export function computePlayerStatus(
  signalingConnected: boolean,
  webrtcState: RTCPeerConnectionState | null
): PlayerConnectionStatus {
  if (!signalingConnected) {
    return "grace-period";
  }
  if (webrtcState === "connected") {
    return "live";
  }
  return "reconnecting";
}

class ConsoleCallbacksHandler extends RpcTarget implements ConsoleCallbacks {
  constructor(private app: ConsoleApp) {
    super();
  }

  onControllerJoined(id: string, name: string) {
    this.app.addController(id, name);
  }

  onControllerLeft(id: string) {
    this.app.removeController(id);
  }

  onControllerDisconnected(id: string) {
    this.app.handleControllerDisconnected(id);
  }

  onControllerRejoined(id: string) {
    this.app.handleControllerRejoined(id);
  }

  onSignal(from: string, signal: RTCSignal) {
    this.app.handleSignal(from, signal);
  }

  onFirstPlayerChanged(id: string | null) {
    this.app.handleFirstPlayerChanged(id);
  }

  onControllerRenamed(id: string, name: string) {
    this.app.handleControllerRenamed(id, name);
  }
}

export class ConsoleApp {
  code: string;
  controllers = new Map<string, ControllerState>();
  firstPlayerId: string | null = null;
  api: RpcStub<ConsoleApi> | null = null;
  reconnectTimer: number | null = null;
  private reconnectAttempt = 0;
  modal: HTMLDialogElement | null = null;
  gameLoop: { stop: () => void } | null = null;
  activeGame: ConsoleGameInstance | null = null;

  constructor() {
    let code: string | null = null;
    try {
      if (typeof localStorage !== "undefined") {
        code = localStorage.getItem("console_room_code");
      }
    } catch {
      // storage disabled / private browsing
    }
    if (!code) {
      code = generateRoomCode();
      try {
        if (typeof localStorage !== "undefined") {
          localStorage.setItem("console_room_code", code);
        }
      } catch {
        // storage disabled / private browsing
      }
    }
    this.code = code.toUpperCase();
  }

  async init() {
    this.setupUIHandlers();
    this.renderHeader();
    this.updateDemoViewVisibility();
    await this.initGame();
    this.connectSignaling();
  }

  async initGame() {
    try {
      this.activeGame?.destroy?.();
      const { createGame } = await loadConsoleGame();
      this.activeGame = createGame({
        session: this.api,
        peers: this.controllers
      });
      if (this.gameLoop) this.gameLoop.stop();
      this.gameLoop = createFixedTickLoop({
        tickRate: 30,
        onTick: (dt) => this.activeGame?.tick?.(dt),
        onRender: (alpha) => this.activeGame?.render?.(alpha),
      });
    } catch (err) {
      console.error("Failed to load console game:", err);
    }
  }

  setupUIHandlers() {
    this.modal = document.getElementById("room-modal") as HTMLDialogElement;

    const newGameBtn = document.getElementById("new-game-btn");
    if (newGameBtn) {
      newGameBtn.addEventListener("click", () => this.openModal());
    }

    const addPlayersBtn = document.getElementById("add-players-btn");
    if (addPlayersBtn) {
      addPlayersBtn.addEventListener("click", () => this.openModal());
    }

    const modalCloseBtn = document.getElementById("modal-close-btn");
    if (modalCloseBtn) {
      modalCloseBtn.addEventListener("click", () => this.closeModal());
    }

    if (this.modal) {
      this.modal.addEventListener("click", (e) => {
        if (e.target === this.modal) {
          this.closeModal();
        }
      });
      this.modal.addEventListener("close", () => {
        this.handleModalClosed();
      });
    }

    const joinForm = document.getElementById("join-game-form") as HTMLFormElement;
    const joinInput = document.getElementById("join-code-input") as HTMLInputElement;
    if (joinForm && joinInput) {
      joinForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const code = joinInput.value.trim().toUpperCase();
        if (code) {
          window.location.href = `/?code=${encodeURIComponent(code)}`;
        }
      });
    }

    window.addEventListener("example-changed", async () => {
      this.renderHeader();
      await this.initGame();
    });
  }

  openModal() {
    if (this.modal && !this.modal.open) {
      this.modal.showModal();
    }
  }

  closeModal() {
    if (this.modal && this.modal.open) {
      this.modal.close();
    }
  }

  handleModalClosed() {
    const startScreen = document.getElementById("start-screen");
    if (startScreen) {
      startScreen.classList.add("u-hidden");
    }

    const addPlayersBtn = document.getElementById("add-players-btn");
    if (addPlayersBtn) {
      addPlayersBtn.classList.remove("u-hidden");
    }
  }

  updateDemoViewVisibility() {
    const demoView = document.getElementById("demo-view");
    if (!demoView) return;

    if (this.controllers.size > 0) {
      demoView.classList.remove("u-hidden");
    } else {
      demoView.classList.add("u-hidden");
    }
  }

  renderHeader() {
    const roomCodeEl = document.getElementById("room-code");
    if (roomCodeEl) roomCodeEl.textContent = this.code;

    const joinUrl = buildJoinUrl(window.location.origin, this.code);

    const qrContainer = document.getElementById("qr-canvas") as HTMLCanvasElement;
    if (qrContainer) {
      QRCode.toCanvas(qrContainer, joinUrl, { width: 180, margin: 1 }, err => {
        if (err) console.error("Failed to render QR code", err);
      });
    }

    const qrUrlEl = document.getElementById("qr-url");
    if (qrUrlEl) {
      qrUrlEl.textContent = joinUrl;
    }
  }

  private getConsoleToken(): string | undefined {
    return localStorage.getItem(`console_token_${this.code}`) || undefined;
  }

  handleFirstPlayerChanged(firstPlayerId: string | null) {
    this.firstPlayerId = firstPlayerId;
    for (const controller of this.controllers.values()) {
      controller.isFirstPlayer = (controller.id === firstPlayerId);
    }
    this.updateControllerUI();
  }

  connectSignaling() {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/api/signaling?code=${this.code}&role=console`;

    try {
      this.api = newWebSocketRpcSession<ConsoleApi>(wsUrl);
      this.api.onRpcBroken(() => this.scheduleReconnect());

      const callbacks = new ConsoleCallbacksHandler(this);
      const token = this.getConsoleToken();
      this.api.join(callbacks, token).then(res => {
        this.reconnectAttempt = 0;
        if (res) {
          if (res.consoleToken) {
            localStorage.setItem(`console_token_${this.code}`, res.consoleToken);
          }
          if (res.firstPlayerId !== undefined) {
            this.firstPlayerId = res.firstPlayerId;
          }
          if (res.controllers) {
            for (const c of res.controllers) {
              this.addController(c.id, c.name);
            }
          }
        }
      }).catch(err => {
        console.error("Failed to join as console:", err);
        this.scheduleReconnect();
      });
    } catch (err) {
      console.error("Signaling connection error:", err);
      this.scheduleReconnect();
    }
  }

  scheduleReconnect() {
    if (this.reconnectTimer) return;
    const base = Math.min(30000, 1000 * 2 ** this.reconnectAttempt);
    const jitter = Math.random() * base * 0.3;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectAttempt++;
      this.connectSignaling();
    }, base + jitter);
  }

  addController(id: string, name: string) {
    if (this.controllers.has(id)) return;

    const colorIndex = this.controllers.size % PLAYER_COLORS.length;
    const color = PLAYER_COLORS[colorIndex];
    const isFirstPlayer = (id === this.firstPlayerId);

    const controller: ControllerState = {
      id,
      name,
      color,
      isFirstPlayer,
      pc: null,
      state: "reconnecting",
      status: "reconnecting",
      signalingConnected: true
    };

    this.controllers.set(id, controller);
    this.updateControllerStatus(controller);
    this.updateDemoViewVisibility();
  }

  handleControllerDisconnected(id: string) {
    const controller = this.controllers.get(id);
    if (controller) {
      controller.signalingConnected = false;
      this.updateControllerStatus(controller);
    }
  }

  handleControllerRenamed(id: string, name: string) {
    const controller = this.controllers.get(id);
    if (controller) {
      controller.name = name;
      this.updateControllerUI();
    }
  }

  handleControllerRejoined(id: string) {
    const controller = this.controllers.get(id);
    if (controller) {
      controller.signalingConnected = true;
      this.updateControllerStatus(controller);
    }
  }

  updateControllerStatus(controller: ControllerState) {
    const rtcState = controller.pc?.pc.connectionState ?? null;
    controller.status = computePlayerStatus(controller.signalingConnected, rtcState);
    controller.state = controller.status;
    this.updateControllerUI();
  }

  removeController(id: string) {
    const controller = this.controllers.get(id);
    if (controller) {
      controller.pc?.close();
      this.controllers.delete(id);
      this.updateControllerUI();
      this.updateDemoViewVisibility();
    }
  }

  handleSignal(from: string, signal: RTCSignal) {
    let controller = this.controllers.get(from);
    if (!controller) {
      this.addController(from, `Player ${this.controllers.size + 1}`);
      controller = this.controllers.get(from)!;
    }

    if (!controller.pc) {
      controller.pc = new PeerConnection(false, {
        onSignal: sig => {
          this.api?.sendSignal(from, sig);
        },
        onStateChange: state => {
          this.updateControllerStatus(controller!);
          if (state === "connected") {
            controller!.pc?.sendControl({
              type: "identity",
              name: controller!.name,
              color: controller!.color
            });
          }
        },
        onInputMessage: msg => {
          controller!.lastTouch = msg;
        }
      });
    }

    controller.pc.handleSignal(signal).catch(err => {
      console.error(`Error handling signal from ${from}:`, err);
    });
  }

  updateControllerUI() {
    const listEl = document.getElementById("controller-list");
    if (!listEl) return;

    listEl.innerHTML = "";

    if (this.controllers.size === 0) {
      const emptyEl = document.createElement("div");
      emptyEl.className = "u-step--1 u-color-muted";
      emptyEl.textContent = "No controllers connected yet. Scan QR code to join!";
      listEl.appendChild(emptyEl);
      return;
    }

    for (const controller of this.controllers.values()) {
      const row = document.createElement("div");
      row.className = "controller-row l-cluster l-space-xs";
      row.style.borderLeft = `4px solid ${controller.color}`;
      row.style.paddingLeft = "8px";
      row.style.marginBottom = "8px";

      const nameEl = document.createElement("span");
      nameEl.className = "u-weight-bold";
      nameEl.textContent = controller.name;

      if (controller.isFirstPlayer) {
        const hostBadge = document.createElement("span");
        hostBadge.className = "status-badge";
        hostBadge.style.backgroundColor = "#ffdc00";
        hostBadge.style.color = "#000000";
        hostBadge.style.fontWeight = "bold";
        hostBadge.style.marginLeft = "4px";
        hostBadge.textContent = "Host";
        row.appendChild(nameEl);
        row.appendChild(hostBadge);
      } else {
        row.appendChild(nameEl);
      }

      const badge = document.createElement("span");
      badge.className = `status-badge status-${controller.status}`;
      badge.textContent = controller.status;

      row.appendChild(badge);
      listEl.appendChild(row);
    }
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("DOMContentLoaded", () => {
    const app = new ConsoleApp();
    app.init();
  });
}
