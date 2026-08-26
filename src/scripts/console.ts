import { newWebSocketRpcSession, RpcTarget, type RpcStub } from "capnweb";
import QRCode from "qrcode";
import type { ConsoleApi, ConsoleCallbacks, RTCSignal } from "../lib/signaling-api";
import { generateRoomCode } from "../utils/generateRoomCode";
import { createFixedTickLoop } from "../utils/gameLoop";
import { PeerConnection, type TouchMessage } from "./peer-connection";
import { loadConsoleGame, buildJoinUrl } from "./gameSource";

const PLAYER_COLORS = [
  "#FF4136", "#0074D9", "#2ECC40", "#FFDC00",
  "#B10DC9", "#FF851B", "#7FDBFF", "#F012BE"
];

export interface ControllerState {
  id: string;
  name: string;
  color: string;
  pc: PeerConnection | null;
  state: string;
  lastTouch?: TouchMessage;
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

  onSignal(from: string, signal: RTCSignal) {
    this.app.handleSignal(from, signal);
  }
}

class ConsoleApp {
  code: string;
  controllers = new Map<string, ControllerState>();
  api: RpcStub<ConsoleApi> | null = null;
  reconnectTimer: number | null = null;
  modal: HTMLDialogElement | null = null;
  gameLoop: { stop: () => void } | null = null;
  activeGame: { tick?: (dt: number) => void; render?: (alpha: number) => void } | null = null;

  constructor() {
    const urlParams = new URLSearchParams(window.location.search);
    let codeParam = urlParams.get("code");
    if (!codeParam) {
      codeParam = generateRoomCode();
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.set("code", codeParam);
      window.history.replaceState({}, "", newUrl.toString());
    }
    this.code = codeParam.toUpperCase();
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
      const { createGame } = await loadConsoleGame();
      this.activeGame = createGame({ session: this.api, peers: this.controllers });
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

  connectSignaling() {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/api/signaling?code=${this.code}&role=console`;

    try {
      this.api = newWebSocketRpcSession<ConsoleApi>(wsUrl);
      this.api.onRpcBroken(() => this.scheduleReconnect());

      const callbacks = new ConsoleCallbacksHandler(this);
      const token = this.getConsoleToken();
      this.api.join(callbacks, token).then(res => {
        if (res) {
          if (res.consoleToken) {
            localStorage.setItem(`console_token_${this.code}`, res.consoleToken);
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
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connectSignaling();
    }, 3000);
  }

  addController(id: string, name: string) {
    if (this.controllers.has(id)) return;

    const colorIndex = this.controllers.size % PLAYER_COLORS.length;
    const color = PLAYER_COLORS[colorIndex];

    const controller: ControllerState = {
      id,
      name,
      color,
      pc: null,
      state: "connecting"
    };

    this.controllers.set(id, controller);
    this.updateControllerUI();
    this.updateDemoViewVisibility();
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
          controller!.state = state;
          if (state === "connected") {
            controller!.pc?.sendControl({
              type: "identity",
              name: controller!.name,
              color: controller!.color
            });
          }
          this.updateControllerUI();
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

      const badge = document.createElement("span");
      badge.className = `status-badge status-${controller.state}`;
      badge.textContent = controller.state;

      row.appendChild(nameEl);
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
