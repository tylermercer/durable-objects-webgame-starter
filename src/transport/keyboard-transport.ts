import type { GameTransport, InputMessage, ControlMessage, TransportMode, JoystickInputMessage } from "./transport";

const UP_KEYS = new Set(["KeyW", "ArrowUp"]);
const DOWN_KEYS = new Set(["KeyS", "ArrowDown"]);
const LEFT_KEYS = new Set(["KeyA", "ArrowLeft"]);
const RIGHT_KEYS = new Set(["KeyD", "ArrowRight"]);
const ACTION_KEYS = new Set([
  "Space",
  "Enter",
  "KeyZ",
  "KeyX",
  "KeyC",
  "KeyJ",
  "KeyK",
  "KeyL",
  "ShiftLeft",
  "ShiftRight",
]);

const ALL_GAMEPAD_KEYS = new Set([
  ...UP_KEYS,
  ...DOWN_KEYS,
  ...LEFT_KEYS,
  ...RIGHT_KEYS,
  ...ACTION_KEYS,
]);

export class LocalKeyboardTransport implements GameTransport {
  readonly mode: TransportMode = "local";
  readonly connectionState: RTCPeerConnectionState = "connected";

  private inputListeners = new Set<(msg: InputMessage) => void>();
  private pressedKeys = new Set<string>();
  private lastX = 0;
  private lastY = 0;
  private lastFiring = false;

  private onKeyDownBound = (e: KeyboardEvent) => this.handleKeyDown(e);
  private onKeyUpBound = (e: KeyboardEvent) => this.handleKeyUp(e);

  constructor() {
    if (typeof window !== "undefined") {
      window.addEventListener("keydown", this.onKeyDownBound);
      window.addEventListener("keyup", this.onKeyUpBound);
    }
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

    const mag = Math.sqrt(rawX * rawX + rawY * rawY);
    let x = rawX;
    let y = rawY;
    if (mag > 1.0) {
      x /= mag;
      y /= mag;
    }

    let firing = false;
    for (const k of this.pressedKeys) {
      if (ACTION_KEYS.has(k)) {
        firing = true;
        break;
      }
    }

    if (x !== this.lastX || y !== this.lastY || firing !== this.lastFiring) {
      this.lastX = x;
      this.lastY = y;
      this.lastFiring = firing;

      const msg: JoystickInputMessage = {
        type: "joystick",
        x,
        y,
        buttons: firing ? [1] : [0],
        firing,
        t: performance.now(),
      };

      for (const listener of this.inputListeners) {
        listener(msg);
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
    if (typeof window !== "undefined") {
      window.removeEventListener("keydown", this.onKeyDownBound);
      window.removeEventListener("keyup", this.onKeyUpBound);
    }
    this.inputListeners.clear();
    this.pressedKeys.clear();
  }
}
