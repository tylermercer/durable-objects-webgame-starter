import { newWebSocketRpcSession, RpcTarget, type RpcStub } from "capnweb";
import QRCode from "qrcode";
import type { ConsoleApi, ConsoleCallbacks, RTCSignal } from "../lib/signaling-api";
import { generateRoomCode } from "../utils/generateRoomCode";
import { createFixedTickLoop } from "../utils/gameLoop";
import type { GameTransport, TouchMessage, TransportMode } from "../transport/transport";
import { ConnectionOrchestrator } from "../transport/connectionOrchestrator";
import { loadConsoleGame } from "../contract/gameSource";
import { buildJoinUrl } from "../utils/buildJoinUrl";
import { isController } from "../utils/isController";
import type { ConsoleGameInstance, ControllerPeer, ViewportSize } from "../contract/gameTypes";

const PLAYER_COLORS = [
  "#FF4136", "#0074D9", "#2ECC40", "#FFDC00",
  "#B10DC9", "#FF851B", "#7FDBFF", "#F012BE"
];

export type PlayerConnectionStatus =
  | "live"          // signaling connected AND WebRTC data channel open
  | "live-relay"    // signaling connected AND using DO relay transport
  | "reconnecting"  // signaling connected, WebRTC renegotiating
  | "grace-period"  // signaling dropped, within the DO's grace window
  | "gone";         // grace period expired, player purged

export interface ControllerState extends ControllerPeer {
  id: string;
  name: string;
  color: string;
  isFirstPlayer: boolean;
  pc: GameTransport | null;
  orchestrator?: ConnectionOrchestrator | null;
  state: string;
  status: PlayerConnectionStatus;
  signalingConnected: boolean;
  lastTouch?: TouchMessage;
}

export function getForcedTransport(): "relay" | "rtc" | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const val = params.get("force_transport")?.toLowerCase();
  if (val === "relay" || val === "rtc") return val;
  return null;
}

export function computePlayerStatus(
  signalingConnected: boolean,
  webrtcState: RTCPeerConnectionState | null,
  transportMode?: TransportMode
): PlayerConnectionStatus {
  if (!signalingConnected) {
    return "grace-period";
  }
  if (transportMode === "relay") {
    return "live-relay";
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

  onRelayInput(from: string, payload: unknown) {
    this.app.handleRelayInput(from, payload);
  }

  onRelayControl(from: string, payload: unknown) {
    this.app.handleRelayControl(from, payload);
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

  private resizeSubscribers = new Set<(size: ViewportSize) => void>();
  private resizeObserver: ResizeObserver | null = null;

  constructor() {
    let code: string | null = null;
    try {
      if (typeof sessionStorage !== "undefined") {
        code = sessionStorage.getItem("console_room_code");
      }
    } catch {
      // storage disabled / private browsing
    }
    if (!code) {
      code = generateRoomCode();
      try {
        if (typeof sessionStorage !== "undefined") {
          sessionStorage.setItem("console_room_code", code);
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
    this.connectSignaling();
  }

  private ensureResizeObserver() {
    if (this.resizeObserver) return;
    const viewportEl = document.getElementById("game-viewport");
    if (!viewportEl) return;

    let pending: ViewportSize | null = null;
    this.resizeObserver = new ResizeObserver((entries) => {
      const box = entries[0]?.contentBoxSize?.[0];
      if (!box) return;
      pending = { width: box.inlineSize, height: box.blockSize };
      requestAnimationFrame(() => {
        if (!pending) return;
        const size = pending;
        pending = null;
        for (const cb of this.resizeSubscribers) cb(size);
      });
    });
    this.resizeObserver.observe(viewportEl);
  }

  async initGame() {
    try {
      this.activeGame?.destroy?.();
      this.resizeSubscribers.clear();

      const surface = document.getElementById("game-surface");
      if (surface) {
        surface.innerHTML = "";
        surface.classList.remove("u-hidden");
      }
      document.getElementById("start-screen")?.classList.add("u-hidden");
      document.getElementById("add-players-btn")?.classList.remove("u-hidden");

      this.ensureResizeObserver();
      const rect = surface ? surface.getBoundingClientRect() : { width: 800, height: 600 };

      const { createGame } = await loadConsoleGame();
      this.activeGame = createGame({
        session: this.api,
        peers: this.controllers as Map<string, ControllerPeer>,
        viewport: {
          container: surface ?? document.createElement("div"),
          initialSize: { width: rect.width, height: rect.height },
          onResize: (cb) => {
            this.resizeSubscribers.add(cb);
            return () => this.resizeSubscribers.delete(cb);
          },
        },
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

    const copyLinkBtn = document.getElementById("copy-link-btn");
    if (copyLinkBtn) {
      copyLinkBtn.addEventListener("click", async () => {
        const joinUrl = buildJoinUrl(window.location.origin, this.code);
        try {
          await navigator.clipboard.writeText(joinUrl);
          const originalText = copyLinkBtn.textContent;
          copyLinkBtn.textContent = "Copied!";
          setTimeout(() => {
            copyLinkBtn.textContent = originalText;
          }, 2000);
        } catch (err) {
          console.error("Failed to copy join link:", err);
        }
      });
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
          window.location.href = buildJoinUrl(window.location.origin, encodeURIComponent(code));
        }
      });
    }

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

  async handleModalClosed() {
    const addPlayersBtn = document.getElementById("add-players-btn");
    if (addPlayersBtn) {
      addPlayersBtn.classList.remove("u-hidden");
    }

    if (!this.activeGame) {
      await this.initGame();
    }
  }

  renderHeader() {
    const roomCodeEl = document.getElementById("room-code");
    if (roomCodeEl) roomCodeEl.textContent = this.code;

    const roomCodeInlineEl = document.getElementById("room-code-inline");
    if (roomCodeInlineEl) roomCodeInlineEl.textContent = this.code;

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
    return sessionStorage.getItem(`console_token_${this.code}`) || undefined;
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
            sessionStorage.setItem(`console_token_${this.code}`, res.consoleToken);
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

  private getOrCreateOrchestrator(controller: ControllerState): ConnectionOrchestrator {
    if (!controller.orchestrator) {
      controller.orchestrator = new ConnectionOrchestrator(
        {
          isInitiator: false,
          getApi: () => this.api,
          peerId: controller.id,
        },
        {
          onSignal: (sig) => this.api?.sendSignal(controller.id, sig),
          onTransportChange: (transport) => {
            controller.pc = transport;
            this.updateControllerStatus(controller);
            if (transport.mode === "relay") {
              transport.sendControl({
                type: "identity",
                name: controller.name,
                color: controller.color,
              });
            }
          },
          onStateChange: (state) => {
            this.updateControllerStatus(controller);
            if (state === "connected") {
              controller.pc?.sendControl({
                type: "identity",
                name: controller.name,
                color: controller.color,
              });
            }
          },
          onInputMessage: (msg) => {
            controller.lastTouch = msg;
          },
        }
      );
    }
    return controller.orchestrator;
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
      orchestrator: null,
      state: "reconnecting",
      status: "reconnecting",
      signalingConnected: true
    };

    this.controllers.set(id, controller);

    if (getForcedTransport() === "relay") {
      this.getOrCreateOrchestrator(controller);
    } else {
      this.updateControllerStatus(controller);
    }
  }

  handleControllerDisconnected(id: string) {
    const controller = this.controllers.get(id);
    if (controller) {
      controller.signalingConnected = false;
      controller.orchestrator?.close();
      controller.orchestrator = null;
      controller.pc = null;
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
      controller.orchestrator?.close();
      controller.orchestrator = null;
      controller.pc = null;
      this.updateControllerStatus(controller);
    }
  }

  updateControllerStatus(controller: ControllerState) {
    const rtcState = controller.pc?.connectionState ?? null;
    controller.status = computePlayerStatus(controller.signalingConnected, rtcState, controller.pc?.mode);
    controller.state = controller.status;
    this.updateControllerUI();
  }

  removeController(id: string) {
    const controller = this.controllers.get(id);
    if (controller) {
      controller.orchestrator?.close();
      controller.orchestrator = null;
      controller.pc = null;
      this.controllers.delete(id);
      this.updateControllerUI();
    }
  }

  private getOrCreateController(id: string): ControllerState {
    let controller = this.controllers.get(id);
    if (!controller) {
      this.addController(id, `Player ${this.controllers.size + 1}`);
      controller = this.controllers.get(id)!;
    }
    return controller;
  }

  handleRelayInput(from: string, payload: unknown) {
    const controller = this.getOrCreateController(from);
    const orchestrator = this.getOrCreateOrchestrator(controller);
    orchestrator.handleRelayInput(payload);
  }

  handleRelayControl(from: string, payload: unknown) {
    const controller = this.getOrCreateController(from);
    const orchestrator = this.getOrCreateOrchestrator(controller);
    orchestrator.handleRelayControl(payload);
  }

  handleSignal(from: string, signal: RTCSignal) {
    const controller = this.getOrCreateController(from);
    if ("sdp" in signal && signal.sdp && signal.sdp.type === "offer") {
      controller.orchestrator?.close();
      controller.orchestrator = null;
      controller.pc = null;
    }
    const orchestrator = this.getOrCreateOrchestrator(controller);
    orchestrator.handleSignal(signal).catch(err => {
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
      badge.textContent = controller.status === "live-relay" ? "relay" : controller.status;

      row.appendChild(badge);
      listEl.appendChild(row);
    }
  }
}

if (typeof window !== "undefined" && !isController()) {
  window.addEventListener("DOMContentLoaded", () => {
    const app = new ConsoleApp();
    app.init();
  });
}
