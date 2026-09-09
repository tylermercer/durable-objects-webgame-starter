import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { LocalGamepadTransport } from "./gamepad-transport";
import type { InputMessage } from "./transport";

describe("LocalGamepadTransport", () => {
  let mockGamepads: (Gamepad | null)[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
    mockGamepads = [];
    vi.stubGlobal("requestAnimationFrame", (cb: Function) => setTimeout(cb, 16) as any);
    vi.stubGlobal("cancelAnimationFrame", (id: any) => clearTimeout(id));
    vi.stubGlobal("navigator", {
      getGamepads: () => mockGamepads,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("polled gamepad state and fires input listeners when buttons or axes change", () => {
    mockGamepads[0] = {
      index: 0,
      buttons: [{ value: 0 }, { value: 1 }],
      axes: [0.5, -0.5],
    } as any;

    const transport = new LocalGamepadTransport(0);
    const listener = vi.fn();
    transport.addInputListener(listener);

    expect(transport.mode).toBe("local");
    expect(transport.connectionState).toBe("connected");

    // Advance animation frame timer
    vi.advanceTimersByTime(16);

    expect(listener).toHaveBeenCalledTimes(3);
    const msgState = listener.mock.calls[0][0] as InputMessage;
    const msgJoystick = listener.mock.calls[1][0] as InputMessage;
    const msgButton = listener.mock.calls[2][0] as InputMessage;

    expect(msgState.type).toBe("gamepad-state");
    if (msgState.type === "gamepad-state") {
      expect(msgState.buttons).toEqual([0, 1]);
      expect(msgState.axes).toEqual([0.5, -0.5]);
    }

    expect(msgJoystick.type).toBe("joystick");
    if (msgJoystick.type === "joystick") {
      expect(msgJoystick.x).toBeCloseTo(0.5);
      expect(msgJoystick.y).toBeCloseTo(-0.5);
      expect(msgJoystick.firing).toBe(true);
    }

    expect(msgButton.type).toBe("gamepad-button");
    if (msgButton.type === "gamepad-button") {
      expect(msgButton.button).toBe(1);
      expect(msgButton.pressed).toBe(true);
    }

    // Tick again without changes -> listener should NOT be called again
    vi.advanceTimersByTime(16);
    expect(listener).toHaveBeenCalledTimes(3);

    // Update gamepad state
    mockGamepads[0] = {
      index: 0,
      buttons: [{ value: 0 }, { value: 0 }],
      axes: [0, 0],
    } as any;

    vi.advanceTimersByTime(16);
    expect(listener).toHaveBeenCalledTimes(6);

    transport.close();
  });
});
