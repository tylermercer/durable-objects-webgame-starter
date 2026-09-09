import { describe, it, expect } from "vitest";
import { isButtonLabelPressed } from "./gamepad";

describe("gamepad utils", () => {
  it("isButtonLabelPressed works with buttons event", () => {
    const evtPress = { type: "buttons", buttons: { FIRE: 1.0, BOOST: 0.0 } };
    const evtRelease = { type: "buttons", buttons: { FIRE: 0.0, BOOST: 0.0 } };

    expect(isButtonLabelPressed(evtPress, "FIRE")).toBe(true);
    expect(isButtonLabelPressed(evtRelease, "FIRE")).toBe(false);
    expect(isButtonLabelPressed(evtPress, "BOOST")).toBe(false);
    expect(isButtonLabelPressed(evtPress, "JUMP")).toBe(false);
  });
});
