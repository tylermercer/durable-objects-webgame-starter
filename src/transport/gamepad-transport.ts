import type { GameTransport, InputMessage, ControlMessage, TransportMode } from "./transport";

export type { GamepadStateMessage } from "./transport";

export class LocalGamepadTransport implements GameTransport {
  readonly mode: TransportMode = "local";
  readonly connectionState: RTCPeerConnectionState = "connected"; // no ICE, always "connected"

  private inputListeners = new Set<(msg: InputMessage) => void>();
  private pollHandle: number | null = null;
  private lastButtons: number[] = [];
  private lastAxes: number[] = [];

  constructor(private gamepadIndex: number) {
    this.startPolling();
  }

  private startPolling() {
    const tick = () => {
      if (typeof navigator !== "undefined" && typeof navigator.getGamepads === "function") {
        const gamepads = navigator.getGamepads();
        const gp = gamepads[this.gamepadIndex];
        if (gp) {
          const buttons = gp.buttons.map((b) => b.value);
          const axes = [...gp.axes];
          if (changed(buttons, this.lastButtons) || changed(axes, this.lastAxes)) {
            this.lastButtons = buttons;
            this.lastAxes = axes;
            const msg: InputMessage = { type: "gamepad-state", buttons, axes, t: performance.now() };
            for (const l of this.inputListeners) l(msg);
          }
        }
      }
      if (typeof requestAnimationFrame !== "undefined") {
        this.pollHandle = requestAnimationFrame(tick);
      } else if (typeof setInterval !== "undefined") {
        this.pollHandle = setTimeout(tick, 16) as any;
      }
    };
    if (typeof requestAnimationFrame !== "undefined") {
      this.pollHandle = requestAnimationFrame(tick);
    } else if (typeof setInterval !== "undefined") {
      this.pollHandle = setTimeout(tick, 16) as any;
    }
  }

  sendInput() {}       // nowhere to send — this peer *is* the input source
  sendControl() {}     // no-op
  sendControlCoalesced() {}
  addInputListener(l: (msg: InputMessage) => void) {
    this.inputListeners.add(l);
    return () => this.inputListeners.delete(l);
  }
  addControlListener() { return () => {}; }
  onModeChange() { return () => {}; }
  close() {
    if (this.pollHandle !== null) {
      if (typeof cancelAnimationFrame !== "undefined") {
        cancelAnimationFrame(this.pollHandle);
      } else if (typeof clearTimeout !== "undefined") {
        clearTimeout(this.pollHandle);
      }
    }
    this.inputListeners.clear();
  }
}

function changed(a: number[], b: number[]) {
  return a.length !== b.length || a.some((v, i) => v !== b[i]);
}
