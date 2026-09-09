import type { GameTransport, InputMessage, ControlMessage, TransportMode } from "./transport";

export type { GamepadStateMessage } from "./transport";

export class LocalGamepadTransport implements GameTransport {
  readonly mode: TransportMode = "local";
  readonly connectionState: RTCPeerConnectionState = "connected"; // no ICE, always "connected"

  private inputListeners = new Set<(msg: InputMessage) => void>();
  private pollHandle: number | null = null;
  private lastButtons: number[] = [];
  private lastAxes: number[] = [];

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
          const buttons = gp.buttons.map((b) => b.value);
          const axes = [...gp.axes];
          if (changed(buttons, this.lastButtons) || changed(axes, this.lastAxes)) {
            const previousButtons = this.lastButtons;
            this.lastButtons = buttons;
            this.lastAxes = axes;
            const now = performance.now();
            const { x, y, firing } = gamepadToJoystick(buttons, axes);

            // Find pressed button label if any
            let activeLabel: string | undefined;
            for (let i = 0; i < buttons.length; i++) {
              if (buttons[i] > 0.5 && this.buttonLabels[i]) {
                activeLabel = this.buttonLabels[i];
                break;
              }
            }

            const stateMsg: InputMessage = {
              type: "gamepad-state",
              buttons,
              axes,
              buttonLabels: this.buttonLabels,
              buttonLabel: activeLabel,
              t: now,
            };
            const joystickMsg: InputMessage = {
              type: "joystick",
              x,
              y,
              buttons,
              buttonLabels: this.buttonLabels,
              buttonLabel: activeLabel,
              firing,
              t: now,
            };

            // Emit button change events for buttons whose pressed state changed
            const buttonEvents: InputMessage[] = [];
            const maxLen = Math.max(buttons.length, previousButtons.length);
            for (let i = 0; i < maxLen; i++) {
              const prevVal = previousButtons[i] ?? 0;
              const currVal = buttons[i] ?? 0;
              const prevPressed = prevVal > 0.5;
              const currPressed = currVal > 0.5;
              if (prevPressed !== currPressed || (currPressed && Math.abs(currVal - prevVal) > 0.01)) {
                buttonEvents.push({
                  type: "gamepad-button",
                  button: i,
                  value: currVal,
                  pressed: currPressed,
                  buttonLabel: this.buttonLabels[i],
                  t: now,
                });
              }
            }

            for (const l of this.inputListeners) {
              l(stateMsg);
              l(joystickMsg);
              for (const btnEvt of buttonEvents) {
                l(btnEvt);
              }
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

export function gamepadToJoystick(buttons: number[], axes: number[]): { x: number; y: number; firing: boolean } {
  let x = 0;
  let y = 0;

  const rawX = axes[0] ?? 0;
  const rawY = axes[1] ?? 0;
  const deadzone = 0.15;
  if (Math.abs(rawX) > deadzone) x += rawX;
  if (Math.abs(rawY) > deadzone) y += rawY;

  if ((buttons[12] ?? 0) > 0.5) y -= 1;
  if ((buttons[13] ?? 0) > 0.5) y += 1;
  if ((buttons[14] ?? 0) > 0.5) x -= 1;
  if ((buttons[15] ?? 0) > 0.5) x += 1;

  const mag = Math.sqrt(x * x + y * y);
  if (mag > 1.0) {
    x /= mag;
    y /= mag;
  }

  const firing = buttons.slice(0, 8).some((b) => (b ?? 0) > 0.5);

  return { x, y, firing };
}

function changed(a: number[], b: number[]) {
  return a.length !== b.length || a.some((v, i) => v !== b[i]);
}
