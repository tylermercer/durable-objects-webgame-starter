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

    // Press KeyW (Up)
    dispatchKey("keydown", "KeyW");
    expect(listener).toHaveBeenCalledTimes(1);
    let msg = listener.mock.calls[0][0] as JoystickInputMessage;
    expect(msg.type).toBe("joystick");
    expect(msg.x).toBe(0);
    expect(msg.y).toBe(-1);
    expect(msg.firing).toBe(false);

    // Press KeyD (Right) -> Diagonal Up-Right
    dispatchKey("keydown", "KeyD");
    expect(listener).toHaveBeenCalledTimes(2);
    msg = listener.mock.calls[1][0] as JoystickInputMessage;
    expect(msg.x).toBeCloseTo(Math.SQRT1_2);
    expect(msg.y).toBeCloseTo(-Math.SQRT1_2);

    // Release KeyW -> Right only
    dispatchKey("keyup", "KeyW");
    expect(listener).toHaveBeenCalledTimes(3);
    msg = listener.mock.calls[2][0] as JoystickInputMessage;
    expect(msg.x).toBe(1);
    expect(msg.y).toBe(0);

    // Release KeyD -> Zero vector
    dispatchKey("keyup", "KeyD");
    expect(listener).toHaveBeenCalledTimes(4);
    msg = listener.mock.calls[3][0] as JoystickInputMessage;
    expect(msg.x).toBe(0);
    expect(msg.y).toBe(0);

    transport.close();
  });

  it("handles Arrow keys and action keys (Space) for firing", () => {
    const transport = new LocalKeyboardTransport();
    const listener = vi.fn();
    transport.addInputListener(listener);

    // Press ArrowDown + Space
    dispatchKey("keydown", "ArrowDown");
    dispatchKey("keydown", "Space");

    expect(listener).toHaveBeenCalledTimes(2);
    const msg = listener.mock.calls[1][0] as JoystickInputMessage;
    expect(msg.type).toBe("joystick");
    expect(msg.x).toBe(0);
    expect(msg.y).toBe(1);
    expect(msg.firing).toBe(true);

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
