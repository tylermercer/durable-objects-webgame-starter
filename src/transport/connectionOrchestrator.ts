import type { RpcStub } from "capnweb";
import type { ConsoleApi, ControllerApi, RTCSignal } from "../lib/signaling-api";
import type { ControlMessage, GameTransport, TouchMessage } from "./transport";
import { PeerConnection } from "./peer-connection";
import { RelayConnection } from "./relay-connection";
import { getForcedTransport } from "../host/console";

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

    if (forced === "relay") {
      this.initRelay();
    } else {
      this.initPeerConnection();
    }
  }

  private initRelay() {
    this.clearTimers();
    const relay = new RelayConnection(this.opts.getApi(), this.opts.peerId, {
      onInputMessage: this.callbacks.onInputMessage,
      onControlMessage: this.callbacks.onControlMessage,
    });
    this.transport = relay;
    this.callbacks.onTransportChange(relay);
  }

  private initPeerConnection() {
    this.clearTimers();
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
      this.negotiationTimer = setTimeout(() => {
        this.negotiationTimer = null;
        if (
          this.transport.mode === "p2p" &&
          (this.transport as PeerConnection).pc.connectionState !== "connected"
        ) {
          this.forcePromoteToRelay();
        }
      }, timeoutMs);
    }
  }

  private handlePeerStateChange(state: RTCPeerConnectionState) {
    if (this.isClosed) return;
    this.callbacks.onStateChange?.(state);

    const forced =
      this.opts.forcedTransport !== undefined
        ? this.opts.forcedTransport
        : getForcedTransport();

    if (state === "connected") {
      this.clearTimers();
    } else if (state === "disconnected") {
      if (forced !== "rtc" && this.disconnectTimer === null) {
        const graceMs = this.opts.disconnectGraceMs ?? 4000;
        this.disconnectTimer = setTimeout(() => {
          this.disconnectTimer = null;
          if (
            this.transport.mode === "p2p" &&
            (this.transport as PeerConnection).pc.connectionState !== "connected"
          ) {
            this.forcePromoteToRelay();
          }
        }, graceMs);
      }
    } else if (state === "failed") {
      if (forced !== "rtc") {
        this.forcePromoteToRelay();
      }
    }
  }

  async handleSignal(signal: RTCSignal): Promise<void> {
    if (this.isClosed) return;
    if (this.transport instanceof PeerConnection) {
      await this.transport.handleSignal(signal);
    }
  }

  async createOffer(): Promise<RTCSessionDescriptionInit> {
    if (this.transport instanceof PeerConnection) {
      return await this.transport.createOffer();
    }
    throw new Error("Cannot create offer: active transport is not a PeerConnection");
  }

  forcePromoteToRelay(): void {
    if (this.isClosed || this.transport.mode === "relay") return;
    this.transport.close();
    this.initRelay();
  }

  handleRelayInput(payload: unknown): void {
    if (this.isClosed) return;
    if (this.transport.mode !== "relay") {
      this.forcePromoteToRelay();
    }
    if (this.transport instanceof RelayConnection) {
      this.transport.handleRelayInput(payload);
    }
  }

  handleRelayControl(payload: unknown): void {
    if (this.isClosed) return;
    if (this.transport.mode !== "relay") {
      this.forcePromoteToRelay();
    }
    if (this.transport instanceof RelayConnection) {
      this.transport.handleRelayControl(payload);
    }
  }

  close(): void {
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
