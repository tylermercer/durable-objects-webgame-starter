import { describe, it, expect } from "vitest";
import { gamepadStateToTownInput, controllerTypes } from "./console";

describe("3D Town Gamepad Input Processing", () => {
  it("exports gamepad and phone controller types", () => {
    expect(controllerTypes).toEqual({ phone: {}, gamepad: {} });
  });

  it("filters deadzones on analog sticks", () => {
    // Small inputs under deadzone threshold (0.15) should result in 0
    expect(gamepadStateToTownInput({ axes: [0.1, -0.1], buttons: [] })).toEqual({
      x: 0,
      y: 0,
      jump: false,
    });

    // Inputs above deadzone threshold should pass through
    const state = gamepadStateToTownInput({ axes: [0.8, -0.6], buttons: [] });
    expect(state.x).toBeCloseTo(0.8);
    expect(state.y).toBeCloseTo(-0.6);
    expect(state.jump).toBe(false);
  });

  it("maps D-pad buttons to direction vector", () => {
    // D-pad Up (button 12) -> y = -1
    expect(
      gamepadStateToTownInput({
        axes: [0, 0],
        buttons: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
      })
    ).toEqual({ x: 0, y: -1, jump: false });

    // D-pad Right (button 15) -> x = 1
    expect(
      gamepadStateToTownInput({
        axes: [0, 0],
        buttons: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
      })
    ).toEqual({ x: 1, y: 0, jump: false });

    // Diagonal D-pad (Up + Right) -> normalized vector length <= 1.0
    const diag = gamepadStateToTownInput({
      axes: [0, 0],
      buttons: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1],
    });
    expect(diag.x).toBeCloseTo(Math.SQRT1_2);
    expect(diag.y).toBeCloseTo(-Math.SQRT1_2);
  });

  it("triggers jump action when face buttons or shoulder triggers are pressed", () => {
    // Button 0 (A / Cross)
    expect(gamepadStateToTownInput({ axes: [0, 0], buttons: [1, 0, 0, 0] }).jump).toBe(true);

    // Button 1 (B / Circle)
    expect(gamepadStateToTownInput({ axes: [0, 0], buttons: [0, 1, 0, 0] }).jump).toBe(true);

    // Button 7 (Right Trigger)
    expect(
      gamepadStateToTownInput({ axes: [0, 0], buttons: [0, 0, 0, 0, 0, 0, 0, 1] }).jump
    ).toBe(true);

    // D-pad button (button 12) alone should NOT trigger jump
    expect(
      gamepadStateToTownInput({
        axes: [0, 0],
        buttons: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
      }).jump
    ).toBe(false);
  });
});
