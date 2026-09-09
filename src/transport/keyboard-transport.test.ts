import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { LocalKeyboardTransport } from "./keyboard-transport";
import type { JoystickInputMessage } from "./transport";

describe("LocalKeyboardTransport", () => {
  let listeners: Record<string, Function[]> = {};

  beforeEach(() => {
    vi.useFakeTimers();
    listeners = {};

    vi.stubGlobal("window", {
      addEventListener: (type: string, cb: Function) => {
        listeners[type] = listeners[type] || [];
        listeners[type].push(cb);
      },
      removeEventListener: (type: string, cb: Function) => {
        if (listeners[type]) {
          listeners[type] = listeners[type].filter((l) => l !== cb);
        }
      },
    });

    vi.stubGlobal("performance", {
      now: () => 100,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function dispatchKey(type: "keydown" | "keyup", code: string, target?: any) {
    const event = {
      code,
      preventDefault: vi.fn(),
      target: target ?? null,
    };
    for (const l of listeners[type] || []) {
      l(event);
    }
  }

  it("has correct initial properties and modes", () => {
    const transport = new LocalKeyboardTransport();
    expect(transport.mode).toBe("local");
    expect(transport.connectionState).toBe("connected");
    transport.close();
  });

  it("translates WASD and Arrow keys into normalized joystick vectors and fires input listeners", () => {
    const transport = new LocalKeyboardTransport();
    const listener = vi.fn();
    transport.addInputListener(listener);

    // Press KeyW (Up) -> emits gamepad-state and joystick
    dispatchKey("keydown", "KeyW");
    const msgs1 = listener.mock.calls.map((c) => c[0]);
    const joystickMsg1 = msgs1.find((m) => m.type === "joystick") as JoystickInputMessage;
    expect(joystickMsg1).toBeDefined();
    expect(joystickMsg1.x).toBe(0);
    expect(joystickMsg1.y).toBe(-1);
    expect(joystickMsg1.firing).toBe(false);

    listener.mockClear();

    // Press KeyD (Right) -> Diagonal Up-Right
    dispatchKey("keydown", "KeyD");
    const msgs2 = listener.mock.calls.map((c) => c[0]);
    const joystickMsg2 = msgs2.find((m) => m.type === "joystick") as JoystickInputMessage;
    expect(joystickMsg2.x).toBeCloseTo(Math.SQRT1_2);
    expect(joystickMsg2.y).toBeCloseTo(-Math.SQRT1_2);

    listener.mockClear();

    // Release KeyW -> Right only
    dispatchKey("keyup", "KeyW");
    const msgs3 = listener.mock.calls.map((c) => c[0]);
    const joystickMsg3 = msgs3.find((m) => m.type === "joystick") as JoystickInputMessage;
    expect(joystickMsg3.x).toBe(1);
    expect(joystickMsg3.y).toBe(0);

    listener.mockClear();

    // Release KeyD -> Zero vector
    dispatchKey("keyup", "KeyD");
    const msgs4 = listener.mock.calls.map((c) => c[0]);
    const joystickMsg4 = msgs4.find((m) => m.type === "joystick") as JoystickInputMessage;
    expect(joystickMsg4.x).toBe(0);
    expect(joystickMsg4.y).toBe(0);

    transport.close();
  });

  it("handles Arrow keys and action keys (Space) for firing", () => {
    const transport = new LocalKeyboardTransport(["FIRE"]);
    const listener = vi.fn();
    transport.addInputListener(listener);

    // Press ArrowDown + Space
    dispatchKey("keydown", "ArrowDown");
    dispatchKey("keydown", "Space");

    const allMsgs = listener.mock.calls.map((c) => c[0]);
    const joystickMsg = allMsgs.find((m) => m.type === "joystick" && m.firing) as JoystickInputMessage;
    expect(joystickMsg).toBeDefined();
    expect(joystickMsg.x).toBe(0);
    expect(joystickMsg.y).toBe(1);
    expect(joystickMsg.firing).toBe(true);
    expect(joystickMsg.buttonLabel).toBe("FIRE");

    const btnMsg = allMsgs.find((m) => m.type === "gamepad-button");
    expect(btnMsg).toBeDefined();
    expect(btnMsg.buttonLabel).toBe("FIRE");
    expect(btnMsg.pressed).toBe(true);

    transport.close();
  });

  it("ignores key events when target is an editable HTML input element", () => {
    const transport = new LocalKeyboardTransport();
    const listener = vi.fn();
    transport.addInputListener(listener);

    const mockInput = {
      tagName: "INPUT",
      isContentEditable: false,
    };

    dispatchKey("keydown", "KeyW", mockInput);
    expect(listener).not.toHaveBeenCalled();

    transport.close();
  });
});
