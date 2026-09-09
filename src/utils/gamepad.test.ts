import { describe, it, expect } from "vitest";
import { isButtonLabelPressed, getButtonLabel } from "./gamepad";

describe("gamepad utils", () => {
  it("getButtonLabel retrieves label from buttonLabels array", () => {
    const msg = { buttonLabels: ["FIRE", "BOOST"] };
    expect(getButtonLabel(msg, 0)).toBe("FIRE");
    expect(getButtonLabel(msg, 1)).toBe("BOOST");
    expect(getButtonLabel(msg, 2)).toBeUndefined();
  });

  it("isButtonLabelPressed works with direct gamepad-button event", () => {
    const evtPress = { type: "gamepad-button", button: 0, pressed: true, buttonLabel: "FIRE" };
    const evtRelease = { type: "gamepad-button", button: 0, pressed: false, buttonLabel: "FIRE" };

    expect(isButtonLabelPressed(evtPress, "FIRE")).toBe(true);
    expect(isButtonLabelPressed(evtRelease, "FIRE")).toBe(false);
    expect(isButtonLabelPressed(evtPress, "BOOST")).toBe(false);
  });

  it("isButtonLabelPressed works with buttonLabels and buttons array", () => {
    const msg = {
      type: "gamepad-state",
      buttons: [1.0, 0.0],
      axes: [0, 0],
      buttonLabels: ["FIRE", "BOOST"],
    };

    expect(isButtonLabelPressed(msg, "FIRE")).toBe(true);
    expect(isButtonLabelPressed(msg, "BOOST")).toBe(false);
  });

  it("isButtonLabelPressed works with single buttonLabel on state/joystick message", () => {
    const msg = {
      type: "joystick",
      buttons: [0.0, 1.0],
      buttonLabel: "BOOST",
      buttonLabels: ["FIRE", "BOOST"],
    };

    expect(isButtonLabelPressed(msg, "BOOST")).toBe(true);
  });

  it("isButtonLabelPressed falls back to legacy button indices if buttonLabels is missing", () => {
    const legacyFire = { type: "joystick", firing: true, buttons: [1.0] };
    const legacyJump = { type: "gamepad-state", buttons: [1.0] };

    expect(isButtonLabelPressed(legacyFire, "FIRE")).toBe(true);
    expect(isButtonLabelPressed(legacyJump, "JUMP")).toBe(true);
  });
});
