import type { RpcStub } from "capnweb";
import type { ConsoleApi, ControllerApi, RTCSignal } from "../lib/signaling-api";
import type { ControlMessage, GameTransport, TouchMessage } from "./transport";
import { PeerConnection } from "./peer-connection";
import { RelayConnection } from "./relay-connection";
import { getForcedTransport } from "../host/console";
import { createLogger } from "@utils/logger";

const logger = createLogger("ConnectionOrchestrator");

export interface ConnectionOrchestratorCallbacks {
  onSignal: (signal: RTCSignal) => void;
  onTransportChange: (transport: GameTransport) => void;
  onStateChange?: (state: RTCPeerConnectionState) => void;
  onInputMessage?: (msg: TouchMessage) => void;
  onControlMessage?: (msg: ControlMessage) => void;
}

export interface ConnectionOrchestratorOptions {
  isInitiator: boolean;
  negotiationTimeoutMs?: number; // default 8000
  disconnectGraceMs?: number;    // default 4000
  forcedTransport?: "relay" | "rtc" | null;
  getApi: () => RpcStub<ConsoleApi | ControllerApi> | null;
  peerId?: string; // console side: target controller id; controller side: undefined
}

export class ConnectionOrchestrator {
  transport!: GameTransport;
  private negotiationTimer: ReturnType<typeof setTimeout> | null = null;
  private disconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private isClosed = false;

  constructor(
    private opts: ConnectionOrchestratorOptions,
    private callbacks: ConnectionOrchestratorCallbacks
  ) {
    const forced =
      opts.forcedTransport !== undefined
        ? opts.forcedTransport
        : getForcedTransport();

    logger.info(`Initializing (forced: ${forced ?? "none"}, isInitiator: ${opts.isInitiator}${opts.peerId ? `, peerId: ${opts.peerId}` : ""})`);

    if (forced === "relay") {
      this.initRelay();
    } else {
      this.initPeerConnection();
    }
  }

  private initRelay() {
    this.clearTimers();
    logger.info(`Initialized RelayConnection transport${this.opts.peerId ? ` for peer ${this.opts.peerId}` : ""}`);
    const relay = new RelayConnection(this.opts.getApi(), this.opts.peerId, {
      onInputMessage: this.callbacks.onInputMessage,
      onControlMessage: this.callbacks.onControlMessage,
    });
    this.transport = relay;
    this.callbacks.onTransportChange(relay);
  }

  private initPeerConnection() {
    this.clearTimers();
    logger.info(`Initialized PeerConnection transport (isInitiator: ${this.opts.isInitiator})`);
    const forced =
      this.opts.forcedTransport !== undefined
        ? this.opts.forcedTransport
        : getForcedTransport();

    const pc = new PeerConnection(this.opts.isInitiator, {
      onSignal: this.callbacks.onSignal,
      onStateChange: (state) => this.handlePeerStateChange(state),
      onInputMessage: this.callbacks.onInputMessage,
      onControlMessage: this.callbacks.onControlMessage,
    });

    this.transport = pc;
    this.callbacks.onTransportChange(pc);

    if (forced !== "rtc") {
      const timeoutMs = this.opts.negotiationTimeoutMs ?? 8000;
      logger.info(`Started negotiation timeout timer (${timeoutMs}ms)`);
      this.negotiationTimer = setTimeout(() => {
        this.negotiationTimer = null;
        if (this.transport.connectionState !== "connected") {
          logger.warn(`Negotiation timeout (${timeoutMs}ms) reached before WebRTC connected. Promoting to relay transport`);
          this.forcePromoteToRelay();
        }
      }, timeoutMs);
    }
  }

  private handlePeerStateChange(state: RTCPeerConnectionState) {
    if (this.isClosed) return;
    logger.info(`PeerConnection state changed -> ${state}`);
    this.callbacks.onStateChange?.(state);

    const forced =
      this.opts.forcedTransport !== undefined
        ? this.opts.forcedTransport
        : getForcedTransport();

    if (state === "connected") {
      logger.info("PeerConnection connected. Clearing active timers");
      this.clearTimers();
    } else if (state === "disconnected") {
      if (forced !== "rtc" && this.disconnectTimer === null) {
        const graceMs = this.opts.disconnectGraceMs ?? 4000;
        logger.info(`PeerConnection disconnected. Starting disconnect grace timer (${graceMs}ms)`);
        this.disconnectTimer = setTimeout(() => {
          this.disconnectTimer = null;
          if (this.transport.connectionState !== "connected") {
            logger.warn(`Disconnect grace period (${graceMs}ms) expired without WebRTC reconnecting. Promoting to relay transport`);
            this.forcePromoteToRelay();
          }
        }, graceMs);
      }
    } else if (state === "failed") {
      if (forced !== "rtc") {
        logger.warn("PeerConnection failed. Promoting to relay transport");
        this.forcePromoteToRelay();
      }
    }
  }

  async handleSignal(signal: RTCSignal): Promise<void> {
    if (this.isClosed) return;
    logger.debug(`Processing incoming RTCSignal: ${"sdp" in signal && signal.sdp ? `SDP (${signal.sdp.type})` : "ICE candidate"}`);
    if (this.transport instanceof PeerConnection) {
      await this.transport.handleSignal(signal);
    }
  }

  async createOffer(): Promise<RTCSessionDescriptionInit> {
    if (this.transport instanceof PeerConnection) {
      logger.info("Creating WebRTC SDP offer");
      return await this.transport.createOffer();
    }
    throw new Error("Cannot create offer: active transport is not a PeerConnection");
  }

  forcePromoteToRelay(): void {
    if (this.isClosed || this.transport.mode === "relay") return;
    logger.info("Force promoting transport from P2P to RelayConnection");
    this.transport.close();
    this.initRelay();
  }

  handleRelayInput(payload: unknown): void {
    if (this.isClosed) return;
    if (this.transport.mode !== "relay") {
      logger.info("Received relay input while in P2P mode. Promoting to RelayConnection");
      this.forcePromoteToRelay();
    }
    if (this.transport instanceof RelayConnection) {
      this.transport.handleRelayInput(payload);
    }
  }

  handleRelayControl(payload: unknown): void {
    if (this.isClosed) return;
    if (this.transport.mode !== "relay") {
      logger.info("Received relay control while in P2P mode. Promoting to RelayConnection");
      this.forcePromoteToRelay();
    }
    if (this.transport instanceof RelayConnection) {
      this.transport.handleRelayControl(payload);
    }
  }

  close(): void {
    logger.info("Closing ConnectionOrchestrator");
    this.isClosed = true;
    this.clearTimers();
    this.transport.close();
  }

  private clearTimers(): void {
    if (this.negotiationTimer !== null) {
      clearTimeout(this.negotiationTimer);
      this.negotiationTimer = null;
    }
    if (this.disconnectTimer !== null) {
      clearTimeout(this.disconnectTimer);
      this.disconnectTimer = null;
    }
  }
}
