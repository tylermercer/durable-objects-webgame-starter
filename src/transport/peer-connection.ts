import type { RTCSignal } from "../lib/signaling-api";
import {
  CoalescingSender,
  type ControlMessage,
  type GameTransport,
  type InputMessage,
  type PongMessage,
  type TouchMessage,
  type TransportMode,
} from "./transport";

export type {
  TouchMessage,
  IdentityMessage,
  PingMessage,
  PongMessage,
  UnknownControlMessage,
  ControlMessage,
  UnknownInputMessage,
  InputMessage,
  TransportMode,
  GameTransport,
} from "./transport";
export { CoalescingSender } from "./transport";

export interface PeerConnectionCallbacks {
  onSignal: (signal: RTCSignal) => void;
  onStateChange?: (state: RTCPeerConnectionState) => void;
  onInputMessage?: (msg: TouchMessage) => void;
  onControlMessage?: (msg: ControlMessage) => void;
}

const ICE_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

export class PeerConnection implements GameTransport {
  readonly mode: TransportMode = "p2p";
  pc: RTCPeerConnection;

  get connectionState(): RTCPeerConnectionState {
    return this.pc.connectionState;
  }
  inputChannel: RTCDataChannel | null = null;
  controlChannel: RTCDataChannel | null = null;
  pendingIceCandidates: RTCIceCandidateInit[] = [];
  private coalescingControlSender: CoalescingSender;
  private controlListeners: Array<(msg: ControlMessage) => void> = [];
  private inputListeners: Array<(msg: InputMessage) => void> = [];
  private modeListeners: Array<(mode: TransportMode) => void> = [];

  constructor(
    public isInitiator: boolean,
    private callbacks: PeerConnectionCallbacks
  ) {
    this.pc = new RTCPeerConnection(ICE_CONFIG);
    this.coalescingControlSender = new CoalescingSender((jsonStr) => {
      if (this.controlChannel && this.controlChannel.readyState === "open") {
        this.controlChannel.send(jsonStr);
        return true;
      }
      return false;
    });

    this.pc.onicecandidate = event => {
      if (event.candidate) {
        this.callbacks.onSignal({ candidate: event.candidate.toJSON() });
      }
    };

    this.pc.onconnectionstatechange = () => {
      const state = this.pc.connectionState;
      this.callbacks.onStateChange?.(state);
      if (state === "failed" && this.isInitiator) {
        this.restartIce().catch(() => {});
      }
    };

    if (this.isInitiator) {
      // Controller opens data channels
      this.inputChannel = this.pc.createDataChannel("input", {
        ordered: false,
        maxRetransmits: 0
      });
      this.setupChannel(this.inputChannel);

      this.controlChannel = this.pc.createDataChannel("control", {
        ordered: true
      });
      this.setupChannel(this.controlChannel);
    } else {
      // Console receives data channels
      this.pc.ondatachannel = event => {
        const channel = event.channel;
        if (channel.label === "input") {
          this.inputChannel = channel;
          this.setupChannel(channel);
        } else if (channel.label === "control") {
          this.controlChannel = channel;
          this.setupChannel(channel);
        }
      };
    }
  }

  onModeChange(listener: (mode: TransportMode) => void) {
    this.modeListeners.push(listener);
    // PeerConnection is fixed to "p2p", so notify immediately
    listener(this.mode);
    return () => {
      this.modeListeners = this.modeListeners.filter(l => l !== listener);
    };
  }

  addControlListener(listener: (msg: ControlMessage) => void) {
    this.controlListeners.push(listener);
    return () => {
      this.controlListeners = this.controlListeners.filter(l => l !== listener);
    };
  }

  addInputListener(listener: (msg: InputMessage) => void) {
    this.inputListeners.push(listener);
    return () => {
      this.inputListeners = this.inputListeners.filter(l => l !== listener);
    };
  }

  private setupChannel(channel: RTCDataChannel) {
    channel.onopen = () => {
      if (channel.label === "control") {
        this.coalescingControlSender.flush();
      }
    };

    channel.onmessage = event => {
      try {
        const data = JSON.parse(event.data);
        if (channel.label === "input") {
          if (data.type === "touch") {
            this.callbacks.onInputMessage?.(data as TouchMessage);
          }
          for (const listener of [...this.inputListeners]) {
            listener(data as InputMessage);
          }
        } else if (channel.label === "control") {
          if (data.type === "ping") {
            this.sendControl({ type: "pong", t: data.t });
          }
          this.callbacks.onControlMessage?.(data as ControlMessage);
          for (const listener of [...this.controlListeners]) {
            listener(data as ControlMessage);
          }
        }
      } catch {
        // Ignore unparseable message
      }
    };
  }

  async restartIce() {
    if (!this.isInitiator) return;
    const offer = await this.pc.createOffer({ iceRestart: true });
    await this.pc.setLocalDescription(offer);
    this.callbacks.onSignal({ sdp: offer });
  }

  startHeartbeat(intervalMs = 3000, onRtt?: (ms: number) => void) {
    const timer = setInterval(() => {
      const t = performance.now();
      this.sendControl({ type: "ping", t });
      const off = this.addControlListener(msg => {
        if (msg.type === "pong" && (msg as PongMessage).t === t) {
          onRtt?.(performance.now() - t);
          off();
        }
      });
    }, intervalMs);
    return () => clearInterval(timer);
  }

  async createOffer(): Promise<RTCSessionDescriptionInit> {
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    return offer;
  }

  async handleSignal(signal: RTCSignal) {
    if ("sdp" in signal && signal.sdp) {
      await this.pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
      await this.flushIceCandidates();
      if (signal.sdp.type === "offer") {
        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        this.callbacks.onSignal({ sdp: answer });
      }
    } else if ("candidate" in signal && signal.candidate) {
      if (this.pc.remoteDescription) {
        await this.pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
      } else {
        this.pendingIceCandidates.push(signal.candidate);
      }
    }
  }

  private async flushIceCandidates() {
    while (this.pendingIceCandidates.length > 0) {
      const candidate = this.pendingIceCandidates.shift()!;
      await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
    }
  }

  sendInput(msg: unknown) {
    if (this.inputChannel && this.inputChannel.readyState === "open") {
      this.inputChannel.send(JSON.stringify(msg));
    }
  }

  sendControl(msg: ControlMessage) {
    if (this.controlChannel && this.controlChannel.readyState === "open") {
      this.controlChannel.send(JSON.stringify(msg));
    }
  }

  sendControlCoalesced(key: string, msg: unknown) {
    this.coalescingControlSender.send(key, msg);
  }

  close() {
    if (this.inputChannel) {
      this.inputChannel.close();
      this.inputChannel = null;
    }
    if (this.controlChannel) {
      this.controlChannel.close();
      this.controlChannel = null;
    }
    this.pc.close();
  }
}
