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

    expect(listener).toHaveBeenCalledTimes(1);
    const msg = listener.mock.calls[0][0] as InputMessage;
    expect(msg.type).toBe("gamepad-state");
    if (msg.type === "gamepad-state") {
      expect(msg.buttons).toEqual([0, 1]);
      expect(msg.axes).toEqual([0.5, -0.5]);
    }

    // Tick again without changes -> listener should NOT be called again
    vi.advanceTimersByTime(16);
    expect(listener).toHaveBeenCalledTimes(1);

    // Update gamepad state
    mockGamepads[0] = {
      index: 0,
      buttons: [{ value: 0 }, { value: 0 }],
      axes: [0, 0],
    } as any;

    vi.advanceTimersByTime(16);
    expect(listener).toHaveBeenCalledTimes(2);

    transport.close();
  });
});
