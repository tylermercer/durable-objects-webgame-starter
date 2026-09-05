import { describe, expect, it } from "vitest";
import { gamepadStateToJoystick } from "./console";

describe("Grid Dungeon gamepad input processing", () => {
  it("converts deadzone axes to joystick state", () => {
    // Within deadzone
    expect(gamepadStateToJoystick({ axes: [0.1, -0.1], buttons: [] })).toEqual({ x: 0, y: 0, firing: false });

    // Beyond deadzone
    const state = gamepadStateToJoystick({ axes: [0.8, -0.6], buttons: [] });
    expect(state.x).toBeCloseTo(0.8);
    expect(state.y).toBeCloseTo(-0.6);
    expect(state.firing).toBe(false);
  });

  it("converts D-pad buttons (12-15) to joystick direction vectors", () => {
    // D-pad Up (12)
    expect(gamepadStateToJoystick({ axes: [0, 0], buttons: [0,0,0,0,0,0,0,0,0,0,0,0, 1, 0, 0, 0] })).toEqual({ x: 0, y: -1, firing: false });

    // D-pad Right (15)
    expect(gamepadStateToJoystick({ axes: [0, 0], buttons: [0,0,0,0,0,0,0,0,0,0,0,0, 0, 0, 0, 1] })).toEqual({ x: 1, y: 0, firing: false });

    // Diagonal Up + Right (12 + 15) normalized
    const diag = gamepadStateToJoystick({ axes: [0, 0], buttons: [0,0,0,0,0,0,0,0,0,0,0,0, 1, 0, 0, 1] });
    expect(diag.x).toBeCloseTo(Math.SQRT1_2);
    expect(diag.y).toBeCloseTo(-Math.SQRT1_2);
    expect(diag.firing).toBe(false);
  });

  it("detects fire button inputs from face buttons and triggers/bumpers (0-7)", () => {
    // Face button A (0)
    expect(gamepadStateToJoystick({ axes: [0, 0], buttons: [1, 0, 0, 0] }).firing).toBe(true);

    // Face button B (1)
    expect(gamepadStateToJoystick({ axes: [0, 0], buttons: [0, 1, 0, 0] }).firing).toBe(true);

    // Right trigger / R2 (7)
    expect(gamepadStateToJoystick({ axes: [0, 0], buttons: [0, 0, 0, 0, 0, 0, 0, 1] }).firing).toBe(true);

    // D-pad only (12) should NOT trigger fire
    expect(gamepadStateToJoystick({ axes: [0, 0], buttons: [0,0,0,0,0,0,0,0,0,0,0,0, 1] }).firing).toBe(false);
  });
});
