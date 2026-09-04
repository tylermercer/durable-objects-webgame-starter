import { describe, expect, it } from "vitest";
import { gamepadStateToJoystick } from "./console";

describe("Grid Dungeon gamepad input processing", () => {
  it("converts deadzone axes to joystick state", () => {
    // Within deadzone
    expect(gamepadStateToJoystick({ axes: [0.1, -0.1], buttons: [] })).toEqual({ x: 0, y: 0 });

    // Beyond deadzone
    const state = gamepadStateToJoystick({ axes: [0.8, -0.6], buttons: [] });
    expect(state.x).toBeCloseTo(0.8);
    expect(state.y).toBeCloseTo(-0.6);
  });

  it("converts D-pad buttons (12-15) to joystick direction vectors", () => {
    // D-pad Up (12)
    expect(gamepadStateToJoystick({ axes: [0, 0], buttons: [0,0,0,0,0,0,0,0,0,0,0,0, 1, 0, 0, 0] })).toEqual({ x: 0, y: -1 });

    // D-pad Right (15)
    expect(gamepadStateToJoystick({ axes: [0, 0], buttons: [0,0,0,0,0,0,0,0,0,0,0,0, 0, 0, 0, 1] })).toEqual({ x: 1, y: 0 });

    // Diagonal Up + Right (12 + 15) normalized
    const diag = gamepadStateToJoystick({ axes: [0, 0], buttons: [0,0,0,0,0,0,0,0,0,0,0,0, 1, 0, 0, 1] });
    expect(diag.x).toBeCloseTo(Math.SQRT1_2);
    expect(diag.y).toBeCloseTo(-Math.SQRT1_2);
  });
});
