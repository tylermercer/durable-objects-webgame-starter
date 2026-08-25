import type { RTCSignal } from "../lib/signaling-api";

export type TouchMessage = {
  type: "touch";
  phase: "start" | "move" | "end" | "cancel";
  pointerId: number;
  x: number; // normalized 0–1
  y: number; // normalized 0–1
  t: number; // performance.now()
};

export type IdentityMessage = {
  type: "identity";
  name: string;
  color: string;
};

export type PingMessage = {
  type: "ping";
  t: number;
};

export type PongMessage = {
  type: "pong";
  t: number;
};

export type ControlMessage = IdentityMessage | PingMessage | PongMessage;

export interface PeerConnectionCallbacks {
  onSignal: (signal: RTCSignal) => void;
  onStateChange?: (state: RTCPeerConnectionState) => void;
  onInputMessage?: (msg: TouchMessage) => void;
  onControlMessage?: (msg: ControlMessage) => void;
}

const STUN_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

export class PeerConnection {
  pc: RTCPeerConnection;
  inputChannel: RTCDataChannel | null = null;
  controlChannel: RTCDataChannel | null = null;

  constructor(
    public isInitiator: boolean,
    private callbacks: PeerConnectionCallbacks
  ) {
    this.pc = new RTCPeerConnection(STUN_CONFIG);

    this.pc.onicecandidate = event => {
      if (event.candidate) {
        this.callbacks.onSignal({ candidate: event.candidate.toJSON() });
      }
    };

    this.pc.onconnectionstatechange = () => {
      this.callbacks.onStateChange?.(this.pc.connectionState);
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

  private setupChannel(channel: RTCDataChannel) {
    channel.onmessage = event => {
      try {
        const data = JSON.parse(event.data);
        if (channel.label === "input" && data.type === "touch") {
          this.callbacks.onInputMessage?.(data as TouchMessage);
        } else if (channel.label === "control") {
          if (data.type === "ping") {
            this.sendControl({ type: "pong", t: data.t });
          }
          this.callbacks.onControlMessage?.(data as ControlMessage);
        }
      } catch {
        // Ignore unparseable message
      }
    };
  }

  async createOffer(): Promise<RTCSessionDescriptionInit> {
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    return offer;
  }

  async handleSignal(signal: RTCSignal) {
    if (signal.sdp) {
      await this.pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
      if (signal.sdp.type === "offer") {
        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        this.callbacks.onSignal({ sdp: answer });
      }
    } else if (signal.candidate) {
      await this.pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
    }
  }

  sendInput(msg: TouchMessage) {
    if (this.inputChannel && this.inputChannel.readyState === "open") {
      this.inputChannel.send(JSON.stringify(msg));
    }
  }

  sendControl(msg: ControlMessage) {
    if (this.controlChannel && this.controlChannel.readyState === "open") {
      this.controlChannel.send(JSON.stringify(msg));
    }
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
