import type { GameTransport, InputMessage, ControlMessage, TransportMode } from "./transport";

const UP_KEYS = new Set(["KeyW", "ArrowUp"]);
const DOWN_KEYS = new Set(["KeyS", "ArrowDown"]);
const LEFT_KEYS = new Set(["KeyA", "ArrowLeft"]);
const RIGHT_KEYS = new Set(["KeyD", "ArrowRight"]);

const BTN_0_KEYS = new Set(["Space", "Enter", "KeyZ", "KeyJ", "ShiftLeft"]);
const BTN_1_KEYS = new Set(["KeyX", "KeyK", "ShiftRight"]);
const BTN_2_KEYS = new Set(["KeyC", "KeyL"]);

const ALL_ACTION_KEYS = new Set([
  ...BTN_0_KEYS,
  ...BTN_1_KEYS,
  ...BTN_2_KEYS,
]);

const ALL_GAMEPAD_KEYS = new Set([
  ...UP_KEYS,
  ...DOWN_KEYS,
  ...LEFT_KEYS,
  ...RIGHT_KEYS,
  ...ALL_ACTION_KEYS,
]);

export class LocalKeyboardTransport implements GameTransport {
  readonly mode: TransportMode = "local";
  readonly connectionState: RTCPeerConnectionState = "connected";

  private inputListeners = new Set<(msg: InputMessage) => void>();
  private pressedKeys = new Set<string>();
  private lastX: number | null = null;
  private lastY: number | null = null;
  private lastButtonsObj: Record<string, number> | null = null;

  private onKeyDownBound = (e: KeyboardEvent) => this.handleKeyDown(e);
  private onKeyUpBound = (e: KeyboardEvent) => this.handleKeyUp(e);

  constructor(private buttonLabels: string[] = []) {
    if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
      window.addEventListener("keydown", this.onKeyDownBound);
      window.addEventListener("keyup", this.onKeyUpBound);
    }
  }

  setButtonLabels(labels: string[]) {
    this.buttonLabels = [...labels];
  }

  private isEditableTarget(target: EventTarget | null): boolean {
    if (!target || typeof target !== "object") return false;
    const tagName = (target as any).tagName ? String((target as any).tagName).toLowerCase() : "";
    return (
      tagName === "input" ||
      tagName === "textarea" ||
      tagName === "select" ||
      !!(target as any).isContentEditable
    );
  }

  private handleKeyDown(e: KeyboardEvent) {
    if (this.isEditableTarget(e.target)) return;
    if (ALL_GAMEPAD_KEYS.has(e.code)) {
      e.preventDefault();
      if (!this.pressedKeys.has(e.code)) {
        this.pressedKeys.add(e.code);
        this.updateState();
      }
    }
  }

  private handleKeyUp(e: KeyboardEvent) {
    if (this.isEditableTarget(e.target)) return;
    if (ALL_GAMEPAD_KEYS.has(e.code)) {
      e.preventDefault();
      if (this.pressedKeys.has(e.code)) {
        this.pressedKeys.delete(e.code);
        this.updateState();
      }
    }
  }

  private updateState() {
    let rawX = 0;
    let rawY = 0;

    for (const k of this.pressedKeys) {
      if (UP_KEYS.has(k)) rawY -= 1;
      if (DOWN_KEYS.has(k)) rawY += 1;
      if (LEFT_KEYS.has(k)) rawX -= 1;
      if (RIGHT_KEYS.has(k)) rawX += 1;
    }

    const mag = Math.hypot(rawX, rawY);
    let x = rawX;
    let y = rawY;
    if (mag > 1.0) {
      x /= mag;
      y /= mag;
    }

    const buttonsObj: Record<string, number> = {};
    for (let i = 0; i < this.buttonLabels.length; i++) {
      const label = this.buttonLabels[i];
      if (!label) continue;

      let pressed = false;
      for (const k of this.pressedKeys) {
        if (i === 0 && (BTN_0_KEYS.has(k) || (this.buttonLabels.length === 1 && ALL_ACTION_KEYS.has(k)))) {
          pressed = true;
          break;
        }
        if (i === 1 && BTN_1_KEYS.has(k)) {
          pressed = true;
          break;
        }
        if (i === 2 && BTN_2_KEYS.has(k)) {
          pressed = true;
          break;
        }
      }
      buttonsObj[label] = pressed ? 1 : 0;
    }

    const now = performance.now();

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
      for (const listener of this.inputListeners) {
        listener(joystickMsg);
      }
    }

    if (buttonsChanged && this.buttonLabels.length > 0) {
      this.lastButtonsObj = buttonsObj;
      const buttonsMsg: InputMessage = {
        type: "buttons",
        buttons: buttonsObj,
        t: now,
      };
      for (const listener of this.inputListeners) {
        listener(buttonsMsg);
      }
    }
  }

  sendInput() {}
  sendControl() {}
  sendControlCoalesced() {}

  addInputListener(listener: (msg: InputMessage) => void) {
    this.inputListeners.add(listener);
    return () => this.inputListeners.delete(listener);
  }

  addControlListener() {
    return () => {};
  }

  onModeChange() {
    return () => {};
  }

  close() {
    if (typeof window !== "undefined" && typeof window.removeEventListener === "function") {
      window.removeEventListener("keydown", this.onKeyDownBound);
      window.removeEventListener("keyup", this.onKeyUpBound);
    }
    this.inputListeners.clear();
    this.pressedKeys.clear();
  }
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
