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

export type UnknownControlMessage = { type: string } & Record<string, unknown>;

export type ControlMessage =
  | IdentityMessage
  | PingMessage
  | PongMessage
  | UnknownControlMessage;

export type UnknownInputMessage = { type: string } & Record<string, unknown>;

export type InputMessage = TouchMessage | UnknownInputMessage;

export type TransportMode = "p2p" | "relay";

export interface GameTransport {
  readonly mode: TransportMode;
  sendInput(msg: unknown): void;
  sendControl(msg: ControlMessage): void;
  sendControlCoalesced(key: string, msg: unknown): void;
  addInputListener(listener: (msg: InputMessage) => void): () => void;
  addControlListener(listener: (msg: ControlMessage) => void): () => void;
  onModeChange(listener: (mode: TransportMode) => void): () => void;
  close(): void;
}

export type CoalescingSendFn = (data: string) => boolean;
export type ChannelGetter = () => { readyState: string; send: (data: string) => void } | null;

export class CoalescingSender {
  private pending = new Map<string, unknown>();
  private flushing = false;
  private sendFn: (data: string) => boolean;

  constructor(fn: CoalescingSendFn | ChannelGetter) {
    this.sendFn = (data: string) => {
      const res = (fn as any)(data);
      if (typeof res === "boolean") {
        return res;
      }
      if (res && typeof res === "object" && res.readyState === "open") {
        res.send(data);
        return true;
      }
      return false;
    };
  }

  send(key: string, msg: unknown) {
    this.pending.set(key, msg); // overwrites any not-yet-sent value for this key
    if (!this.flushing) {
      this.flushing = true;
      queueMicrotask(() => this.flush());
    }
  }

  flush() {
    this.flushing = false;
    for (const [key, msg] of Array.from(this.pending.entries())) {
      const sent = this.sendFn(JSON.stringify(msg));
      if (sent) {
        this.pending.delete(key);
      } else {
        // Stop flushing if sender cannot deliver right now; remain in pending
        break;
      }
    }
  }
}
