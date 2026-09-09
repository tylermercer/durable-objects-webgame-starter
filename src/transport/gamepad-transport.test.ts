import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { LocalGamepadTransport, gamepadToJoystick } from "./gamepad-transport";
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

  it("polled gamepad state and fires input listeners with joystick and buttons events", () => {
    mockGamepads[0] = {
      index: 0,
      buttons: [{ value: 0 }, { value: 1 }],
      axes: [0.5, -0.5],
    } as any;

    const transport = new LocalGamepadTransport(0, ["FIRE", "BOOST"]);
    const listener = vi.fn();
    transport.addInputListener(listener);

    expect(transport.mode).toBe("local");
    expect(transport.connectionState).toBe("connected");

    // Advance animation frame timer
    vi.advanceTimersByTime(16);

    expect(listener).toHaveBeenCalledTimes(2);
    const msgJoystick = listener.mock.calls[0][0] as InputMessage;
    const msgButtons = listener.mock.calls[1][0] as InputMessage;

    expect(msgJoystick.type).toBe("joystick");
    if (msgJoystick.type === "joystick") {
      expect(msgJoystick.x).toBeCloseTo(0.5);
      expect(msgJoystick.y).toBeCloseTo(-0.5);
    }

    expect(msgButtons.type).toBe("buttons");
    if (msgButtons.type === "buttons") {
      expect(msgButtons.buttons).toEqual({ FIRE: 0, BOOST: 1 });
    }

    // Tick again without changes -> listener should NOT be called again
    vi.advanceTimersByTime(16);
    expect(listener).toHaveBeenCalledTimes(2);

    // Update gamepad state
    mockGamepads[0] = {
      index: 0,
      buttons: [{ value: 0 }, { value: 0 }],
      axes: [0, 0],
    } as any;

    vi.advanceTimersByTime(16);
    expect(listener).toHaveBeenCalledTimes(4);

    transport.close();
  });

  it("only exposes labeled buttons in the buttons event payload", () => {
    mockGamepads[0] = {
      index: 0,
      buttons: [{ value: 1 }, { value: 0 }, { value: 1 }],
      axes: [0, 0],
    } as any;

    const transport = new LocalGamepadTransport(0, ["JUMP"]);
    const listener = vi.fn();
    transport.addInputListener(listener);

    vi.advanceTimersByTime(16);

    const buttonsMsg = listener.mock.calls.find(
      (call) => (call[0] as InputMessage).type === "buttons"
    )?.[0] as InputMessage;

    expect(buttonsMsg).toBeDefined();
    if (buttonsMsg.type === "buttons") {
      expect(buttonsMsg.buttons).toEqual({ JUMP: 1 });
      expect(buttonsMsg.buttons[0 as any]).toBeUndefined();
    }

    transport.close();
  });

  it("selects active secondary joystick when primary joystick is inactive", () => {
    // Primary stick axes[0,1] is inactive (0, 0), Secondary stick axes[2,3] is active (0.8, -0.6)
    const axes = [0, 0, 0.8, -0.6];
    const buttons = [0, 0];

    const { x, y } = gamepadToJoystick(buttons, axes);
    expect(x).toBeCloseTo(0.8);
    expect(y).toBeCloseTo(-0.6);
  });
});
