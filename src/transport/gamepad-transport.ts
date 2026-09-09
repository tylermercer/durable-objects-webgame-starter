import type { GameTransport, InputMessage, ControlMessage, TransportMode } from "./transport";

export class LocalGamepadTransport implements GameTransport {
  readonly mode: TransportMode = "local";
  readonly connectionState: RTCPeerConnectionState = "connected"; // no ICE, always "connected"

  private inputListeners = new Set<(msg: InputMessage) => void>();
  private pollHandle: number | null = null;
  private lastX: number | null = null;
  private lastY: number | null = null;
  private lastButtonsObj: Record<string, number> | null = null;

  constructor(private gamepadIndex: number, private buttonLabels: string[] = []) {
    this.startPolling();
  }

  setButtonLabels(labels: string[]) {
    this.buttonLabels = [...labels];
  }

  private startPolling() {
    const tick = () => {
      if (typeof navigator !== "undefined" && typeof navigator.getGamepads === "function") {
        const gamepads = navigator.getGamepads();
        const gp = gamepads[this.gamepadIndex];
        if (gp) {
          const rawButtons = gp.buttons.map((b) => b.value);
          const rawAxes = [...gp.axes];
          const now = performance.now();

          const { x, y } = gamepadToJoystick(rawButtons, rawAxes);

          const buttonsObj: Record<string, number> = {};
          for (let i = 0; i < this.buttonLabels.length; i++) {
            const label = this.buttonLabels[i];
            if (label) {
              buttonsObj[label] = rawButtons[i] ?? 0;
            }
          }

          const joystickChanged =
            this.lastX === null ||
            this.lastY === null ||
            Math.abs(x - this.lastX) > 0.001 ||
            Math.abs(y - this.lastY) > 0.001;

          const buttonsChanged =
            this.lastButtonsObj === null ||
            buttonsObjChanged(this.lastButtonsObj, buttonsObj);

          if (joystickChanged) {
            this.lastX = x;
            this.lastY = y;
            const joystickMsg: InputMessage = {
              type: "joystick",
              x,
              y,
              t: now,
            };
            for (const l of this.inputListeners) {
              l(joystickMsg);
            }
          }

          if (buttonsChanged) {
            this.lastButtonsObj = buttonsObj;
            const buttonsMsg: InputMessage = {
              type: "buttons",
              buttons: buttonsObj,
              t: now,
            };
            for (const l of this.inputListeners) {
              l(buttonsMsg);
            }
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

  sendInput() {} // nowhere to send — this peer *is* the input source
  sendControl() {} // no-op
  sendControlCoalesced() {}
  addInputListener(l: (msg: InputMessage) => void) {
    this.inputListeners.add(l);
    return () => this.inputListeners.delete(l);
  }
  addControlListener() {
    return () => {};
  }
  onModeChange() {
    return () => {};
  }
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

export function gamepadToJoystick(
  buttons: number[],
  axes: number[]
): { x: number; y: number } {
  let x = 0;
  let y = 0;

  const deadzone = 0.15;

  // Search pairs of axes for first active stick
  for (let i = 0; i < axes.length - 1; i += 2) {
    const rawX = axes[i] ?? 0;
    const rawY = axes[i + 1] ?? 0;
    const mag = Math.hypot(rawX, rawY);
    if (mag > deadzone) {
      x = rawX;
      y = rawY;
      break;
    }
  }

  // D-pad support (buttons 12: up, 13: down, 14: left, 15: right)
  if ((buttons[12] ?? 0) > 0.5) y -= 1;
  if ((buttons[13] ?? 0) > 0.5) y += 1;
  if ((buttons[14] ?? 0) > 0.5) x -= 1;
  if ((buttons[15] ?? 0) > 0.5) x += 1;

  const mag = Math.hypot(x, y);
  if (mag > 1.0) {
    x /= mag;
    y /= mag;
  }

  return { x, y };
}

function buttonsObjChanged(
  a: Record<string, number>,
  b: Record<string, number>
): boolean {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return true;
  for (const k of keysA) {
    if (b[k] === undefined || Math.abs(a[k] - b[k]) > 0.001) return true;
  }
  return false;
}
