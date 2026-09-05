import { newWebSocketRpcSession, RpcTarget, type RpcStub } from "capnweb";
import QRCode from "qrcode";
import type { ConsoleApi, ConsoleCallbacks, RTCSignal } from "../lib/signaling-api";
import { generateRoomCode } from "../utils/generateRoomCode";
import { createFixedTickLoop } from "../utils/gameLoop";
import type { GameTransport, TouchMessage, TransportMode } from "../transport/transport";
import { ConnectionOrchestrator } from "../transport/connectionOrchestrator";
import { loadConsoleGame, getGameControllerTypes } from "../contract/gameSource";
import { LocalGamepadTransport } from "../transport/gamepad-transport";
import { buildJoinUrl } from "../utils/buildJoinUrl";
import { isController } from "../utils/isController";
import type { ConsoleGameInstance, ConsoleGameModule, ControllerPeer, ViewportSize } from "../contract/gameTypes";
import { createPeerNotifier, type PeerNotifier } from "../utils/peerDeparture";
import { createLogger } from "@utils/logger";
import { QRScannerController } from "@utils/qrScannerController";

const logger = createLogger("ConsoleHost");

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
  controllerTypes: ConsoleGameModule["controllerTypes"] = null;
  modal: HTMLDialogElement | null = null;
  qrScanner: QRScannerController | null = null;
  gameLoop: { stop: () => void } | null = null;
  activeGame: ConsoleGameInstance | null = null;
  pendingKickTimers = new Map<string, ReturnType<typeof setTimeout>>();
  peerNotifier: PeerNotifier<ControllerPeer> = createPeerNotifier();

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
    this.controllerTypes = getGameControllerTypes() ?? null;
    logger.info(`ConsoleApp initialized with room code: ${this.code}, phoneMax: ${this.phoneMax ?? "unlimited"}, acceptsGamepads: ${this.acceptsGamepads()}`);
  }

  private get phoneMax(): number | null {
    return this.controllerTypes?.phone?.max ?? null;
  }

  private acceptsGamepads(): boolean {
    return !!this.controllerTypes?.gamepad;
  }

  async requestFullscreen(element: HTMLElement = document.documentElement): Promise<void> {
    try {
      if (element.requestFullscreen) {
        await element.requestFullscreen();
      } else if ((element as any).webkitRequestFullscreen) {
        await (element as any).webkitRequestFullscreen();
      } else if ((element as any).mozRequestFullScreen) {
        await (element as any).mozRequestFullScreen();
      } else if ((element as any).msRequestFullscreen) {
        await (element as any).msRequestFullscreen();
      }
    } catch (err) {
      logger.warn("Request fullscreen failed:", err);
    }
  }

  async init() {
    this.setupUIHandlers();
    this.setupGamepadListeners();
    this.renderHeader();
    this.connectSignaling();
  }

  private setupGamepadListeners() {
    if (typeof window === "undefined") return;

    window.addEventListener("gamepadconnected", (e: GamepadEvent) => {
      if (!this.acceptsGamepads()) return;
      const id = `gamepad-${e.gamepad.index}`;
      if (this.controllers.has(id)) return;

      const controller: ControllerState = {
        id,
        name: `Gamepad ${e.gamepad.index + 1}`,
        color: PLAYER_COLORS[this.controllers.size % PLAYER_COLORS.length],
        isFirstPlayer: false,
        pc: new LocalGamepadTransport(e.gamepad.index),
        orchestrator: null,
        state: "live",
        status: "live",
        signalingConnected: true,
      };
      this.controllers.set(id, controller);
      this.peerNotifier.notifyJoined(controller);
      this.peerNotifier.notifyReady(controller);
      this.updateControllerUI();
    });

    window.addEventListener("gamepaddisconnected", (e: GamepadEvent) => {
      this.removeController(`gamepad-${e.gamepad.index}`);
    });
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

      const gameMod = await loadConsoleGame();
      if (gameMod && gameMod.controllerTypes !== undefined) {
        this.controllerTypes = gameMod.controllerTypes;
      }
      if (!this.acceptsGamepads()) {
        for (const [id] of Array.from(this.controllers.entries())) {
          if (id.startsWith("gamepad-")) {
            this.removeController(id);
          }
        }
      }
      const { createGame } = gameMod;
      this.activeGame = createGame({
        session: this.api,
        roomCode: this.code,
        peers: this.controllers as Map<string, ControllerPeer>,
        onPeerJoined: this.peerNotifier.onPeerJoined,
        onPeerReady: this.peerNotifier.onPeerReady,
        onPeerLeft: this.peerNotifier.onPeerLeft,
        viewport: {
          container: surface ?? document.createElement("div"),
          initialSize: { width: rect.width, height: rect.height },
          onResize: (cb: (size: ViewportSize) => void) => {
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
      modalCloseBtn.addEventListener("click", () => {
        this.requestFullscreen();
        this.closeModal();
      });
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

    const scanBtn = document.getElementById("scan-code-btn");
    const qrModal = document.getElementById("qr-scanner-modal") as HTMLDialogElement | null;
    const qrVideo = document.getElementById("qr-video") as HTMLVideoElement | null;
    const qrCanvas = document.getElementById("qr-canvas-hidden") as HTMLCanvasElement | null;
    const qrStatus = document.getElementById("qr-scan-status");
    const qrCloseBtn = document.getElementById("qr-modal-close-btn");

    if (scanBtn && qrModal && qrVideo && qrCanvas && qrStatus && qrCloseBtn) {
      this.qrScanner = new QRScannerController({
        modalEl: qrModal,
        videoEl: qrVideo,
        canvasEl: qrCanvas,
        statusEl: qrStatus,
        closeBtnEl: qrCloseBtn,
      });

      scanBtn.addEventListener("click", () => {
        this.qrScanner?.start();
      });
    }
  }

  openModal() {
    this.updateControllerUI();
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
    logger.info(`First player changed to: ${firstPlayerId ?? "none"}`);
    this.firstPlayerId = firstPlayerId;
    for (const controller of this.controllers.values()) {
      controller.isFirstPlayer = (controller.id === firstPlayerId);
    }
    this.updateControllerUI();
  }

  connectSignaling() {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/api/signaling?code=${this.code}&role=console`;
    logger.info(`Connecting to signaling WebSocket: ${wsUrl}`);

    try {
      this.api = newWebSocketRpcSession<ConsoleApi>(wsUrl);
      this.api.onRpcBroken(() => {
        logger.warn("Signaling RPC session broken");
        this.scheduleReconnect();
      });

      const callbacks = new ConsoleCallbacksHandler(this);
      const token = this.getConsoleToken();
      this.api.join(callbacks, token, undefined, this.phoneMax ?? undefined).then(res => {
        this.reconnectAttempt = 0;
        logger.info(`Console joined signaling session for room ${this.code}. Controllers connected: ${res?.controllers?.length ?? 0}`);
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
          this.updateControllerUI();
        }
      }).catch(err => {
        logger.error("Failed to join signaling session as console:", err);
        this.scheduleReconnect();
      });
    } catch (err) {
      logger.error("Signaling connection error:", err);
      this.scheduleReconnect();
    }
  }

  scheduleReconnect() {
    if (this.reconnectTimer) return;
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

  private getOrCreateOrchestrator(controller: ControllerState): ConnectionOrchestrator {
    if (!controller.orchestrator) {
      logger.info(`Creating ConnectionOrchestrator for controller ${controller.name} (${controller.id})`);
      controller.orchestrator = new ConnectionOrchestrator(
        {
          isInitiator: false,
          getApi: () => this.api,
          peerId: controller.id,
        },
        {
          onSignal: (sig) => this.api?.sendSignal(controller.id, sig),
          onTransportChange: (transport) => {
            logger.info(`Transport changed for controller ${controller.name} (${controller.id}) -> ${transport.mode}`);
            controller.pc = transport;
            this.peerNotifier.notifyReady(controller);
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
            logger.info(`Peer connection state for ${controller.name} (${controller.id}) changed -> ${state}`);
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

    logger.info(`Controller registered: ${name} (id: ${id}, host: ${isFirstPlayer})`);

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
    this.peerNotifier.notifyJoined(controller);

    if (getForcedTransport() === "relay") {
      this.getOrCreateOrchestrator(controller);
    } else {
      this.updateControllerStatus(controller);
    }
  }

  handleControllerDisconnected(id: string) {
    const controller = this.controllers.get(id);
    if (controller) {
      logger.warn(`Controller signaling disconnected: ${controller.name} (${id})`);
      controller.signalingConnected = false;
      this.updateControllerStatus(controller);
    }
  }

  handleControllerRenamed(id: string, name: string) {
    const controller = this.controllers.get(id);
    if (controller) {
      logger.info(`Controller renamed: ${controller.name} -> ${name} (id: ${id})`);
      controller.name = name;
      this.updateControllerUI();
    }
  }

  kickController(id: string) {
    const controller = this.controllers.get(id);
    if (controller) {
      logger.info(`Kicking controller: ${controller.name} (${id})`);
      this.api?.kickController(id);
      this.removeController(id);
    }
  }

  handleControllerRejoined(id: string) {
    const controller = this.controllers.get(id);
    if (controller) {
      logger.info(`Controller signaling rejoined: ${controller.name} (${id})`);
      controller.signalingConnected = true;
      this.updateControllerStatus(controller);
    }
  }

  updateControllerStatus(controller: ControllerState) {
    const rtcState = controller.pc?.connectionState ?? null;
    const prevStatus = controller.status;
    controller.status = computePlayerStatus(controller.signalingConnected, rtcState, controller.pc?.mode);
    controller.state = controller.status;
    logger.info(`Player ${controller.name} (${controller.id}) status: ${prevStatus} -> ${controller.status} (signaling: ${controller.signalingConnected}, rtcState: ${rtcState}, transport: ${controller.pc?.mode ?? "none"})`);
    this.updateControllerUI();
  }

  removeController(id: string) {
    const controller = this.controllers.get(id);
    if (controller) {
      logger.info(`Controller removed/purged: ${controller.name} (${id})`);
      controller.orchestrator?.close();
      controller.orchestrator = null;
      controller.pc = null;
      this.controllers.delete(id);
      this.peerNotifier.notifyLeft(id);
      const timer = this.pendingKickTimers.get(id);
      if (timer) {
        clearTimeout(timer);
        this.pendingKickTimers.delete(id);
      }
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
    const sigType = "sdp" in signal && signal.sdp ? `SDP (${signal.sdp.type})` : "ICE candidate";
    logger.info(`Received signal from controller ${controller.name} (${from}): ${sigType}`);

    if ("sdp" in signal && signal.sdp && signal.sdp.type === "offer") {
      const state = controller.pc?.connectionState;
      if (!controller.pc || state === "failed" || state === "closed") {
        logger.info(`Resetting orchestrator for ${controller.name} (${from}) due to incoming offer on ${state ?? "null"} state`);
        controller.orchestrator?.close();
        controller.orchestrator = null;
        controller.pc = null;
      }
    }
    const orchestrator = this.getOrCreateOrchestrator(controller);
    orchestrator.handleSignal(signal).catch(err => {
      logger.error(`Error handling signal from ${from}:`, err);
    });
  }

  updateControllerUI() {
    const listEl = document.getElementById("controller-list");
    if (!listEl) return;

    const badgeEl = document.getElementById("player-limit-badge");
    const noticeEl = document.getElementById("room-full-notice");

    if (badgeEl) {
      if (this.phoneMax !== null) {
        badgeEl.textContent = `Limit: ${this.controllers.size}/${this.phoneMax}`;
        badgeEl.classList.remove("u-hidden");
      } else {
        badgeEl.classList.add("u-hidden");
      }
    }

    if (noticeEl) {
      if (this.phoneMax !== null && this.controllers.size >= this.phoneMax) {
        noticeEl.textContent = `Player limit reached (${this.controllers.size}/${this.phoneMax})`;
        noticeEl.classList.remove("u-hidden");
      } else {
        noticeEl.classList.add("u-hidden");
      }
    }

    const gamepadNoticeEl = document.getElementById("gamepad-support-notice");
    if (gamepadNoticeEl) {
      if (this.acceptsGamepads()) {
        gamepadNoticeEl.classList.remove("u-hidden");
      } else {
        gamepadNoticeEl.classList.add("u-hidden");
      }
    }

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

      if (controller.id.startsWith("gamepad-")) {
        const nameInput = document.createElement("input");
        nameInput.type = "text";
        nameInput.className = "gamepad-name-input";
        nameInput.value = controller.name;
        nameInput.placeholder = "Gamepad Name";
        nameInput.addEventListener("input", (e) => {
          const newName = (e.target as HTMLInputElement).value;
          controller.name = newName;
          this.peerNotifier.notifyJoined(controller);
        });
        row.appendChild(nameInput);
      } else {
        const nameEl = document.createElement("span");
        nameEl.className = "u-weight-bold";
        nameEl.textContent = controller.name;
        row.appendChild(nameEl);
      }

      if (controller.isFirstPlayer) {
        const hostBadge = document.createElement("span");
        hostBadge.className = "status-badge";
        hostBadge.style.backgroundColor = "#ffdc00";
        hostBadge.style.color = "#000000";
        hostBadge.style.fontWeight = "bold";
        hostBadge.style.marginLeft = "4px";
        hostBadge.textContent = "Host";
        row.appendChild(hostBadge);
      }

      const badge = document.createElement("span");
      badge.className = `status-badge status-${controller.status}`;
      badge.textContent = controller.pc?.mode === "local" ? "local" : controller.status === "live-relay" ? "relay" : controller.status;

      const kickBtn = document.createElement("button");
      kickBtn.className = "btn-kick-controller";
      kickBtn.type = "button";

      const isPending = this.pendingKickTimers.has(controller.id);
      if (isPending) {
        kickBtn.textContent = "Confirm?";
        kickBtn.classList.add("is-confirming");
      } else {
        kickBtn.textContent = "Kick";
      }

      kickBtn.title = `Kick ${controller.name}`;
      kickBtn.addEventListener("click", () => {
        if (this.pendingKickTimers.has(controller.id)) {
          const timer = this.pendingKickTimers.get(controller.id);
          if (timer) clearTimeout(timer);
          this.pendingKickTimers.delete(controller.id);
          this.kickController(controller.id);
        } else {
          kickBtn.textContent = "Confirm?";
          kickBtn.classList.add("is-confirming");
          const timer = setTimeout(() => {
            this.pendingKickTimers.delete(controller.id);
            this.updateControllerUI();
          }, 5000);
          this.pendingKickTimers.set(controller.id, timer);
        }
      });

      row.appendChild(badge);
      row.appendChild(kickBtn);
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
