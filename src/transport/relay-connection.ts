import type { RpcStub } from "capnweb";
import type { ConsoleApi, ControllerApi } from "../lib/signaling-api";
import {
  CoalescingSender,
  type ControlMessage,
  type GameTransport,
  type InputMessage,
  type PongMessage,
  type TouchMessage,
  type TransportMode,
} from "./transport";
import { createLogger } from "@utils/logger";

const logger = createLogger("RelayConnection");

export interface RelayConnectionCallbacks {
  onInputMessage?: (msg: TouchMessage) => void;
  onControlMessage?: (msg: ControlMessage) => void;
}

export class RelayConnection implements GameTransport {
  readonly mode: TransportMode = "relay";

  get connectionState(): RTCPeerConnectionState {
    return "connected";
  }

  private inputListeners: Array<(msg: InputMessage) => void> = [];
  private controlListeners: Array<(msg: ControlMessage) => void> = [];
  private modeListeners: Array<(mode: TransportMode) => void> = [];
  private coalescingControlSender: CoalescingSender;

  constructor(
    public api: RpcStub<ConsoleApi | ControllerApi> | null,
    public peerId?: string, // Target controller ID if this is console side; undefined if controller side
    private callbacks?: RelayConnectionCallbacks
  ) {
    logger.info(`Created RelayConnection (${peerId ? `target peer: ${peerId}` : "controller -> console"})`);
    this.coalescingControlSender = new CoalescingSender((jsonStr) => {
      try {
        const parsed = JSON.parse(jsonStr) as ControlMessage;
        this.sendControl(parsed);
        return true;
      } catch {
        return false;
      }
    });
  }

  onModeChange(listener: (mode: TransportMode) => void) {
    this.modeListeners.push(listener);
    listener(this.mode);
    return () => {
      this.modeListeners = this.modeListeners.filter((l) => l !== listener);
    };
  }

  addControlListener(listener: (msg: ControlMessage) => void) {
    this.controlListeners.push(listener);
    return () => {
      this.controlListeners = this.controlListeners.filter((l) => l !== listener);
    };
  }

  addInputListener(listener: (msg: InputMessage) => void) {
    this.inputListeners.push(listener);
    return () => {
      this.inputListeners = this.inputListeners.filter((l) => l !== listener);
    };
  }

  handleRelayInput(payload: unknown) {
    if (!payload || typeof payload !== "object") return;
    logger.debug("Received relay input message");
    const msg = payload as InputMessage;
    if (msg.type === "touch") {
      this.callbacks?.onInputMessage?.(msg as TouchMessage);
    }
    for (const listener of [...this.inputListeners]) {
      listener(msg);
    }
  }

  handleRelayControl(payload: unknown) {
    if (!payload || typeof payload !== "object") return;
    const msg = payload as ControlMessage;
    logger.debug(`Received relay control message: ${msg.type}`);
    if (msg.type === "ping") {
      this.sendControl({ type: "pong", t: msg.t });
    }
    this.callbacks?.onControlMessage?.(msg);
    for (const listener of [...this.controlListeners]) {
      listener(msg);
    }
  }

  startHeartbeat(intervalMs = 3000, onRtt?: (ms: number) => void) {
    const timer = setInterval(() => {
      const t = performance.now();
      this.sendControl({ type: "ping", t });
      const off = this.addControlListener((msg) => {
        if (msg.type === "pong" && (msg as PongMessage).t === t) {
          onRtt?.(performance.now() - t);
          off();
        }
      });
    }, intervalMs);
    return () => clearInterval(timer);
  }

  sendInput(msg: unknown) {
    if (!this.api) return;
    try {
      logger.debug(`Sending relay input message to ${this.peerId ?? "console"}`);
      if (this.peerId !== undefined) {
        (this.api as RpcStub<ConsoleApi>).relayInput(this.peerId, msg);
      } else {
        (this.api as RpcStub<ControllerApi>).relayInput(msg);
      }
    } catch (err) {
      console.error("RelayConnection sendInput error:", err);
    }
  }

  sendControl(msg: ControlMessage) {
    if (!this.api) return;
    try {
      logger.debug(`Sending relay control message (${msg.type}) to ${this.peerId ?? "console"}`);
      if (this.peerId !== undefined) {
        (this.api as RpcStub<ConsoleApi>).relayControl(this.peerId, msg);
      } else {
        (this.api as RpcStub<ControllerApi>).relayControl(msg);
      }
    } catch (err) {
      console.error("RelayConnection sendControl error:", err);
    }
  }

  sendControlCoalesced(key: string, msg: unknown) {
    this.coalescingControlSender.send(key, msg);
  }

  close() {
    logger.info("Closing RelayConnection");
    this.inputListeners = [];
    this.controlListeners = [];
    this.modeListeners = [];
  }
}
