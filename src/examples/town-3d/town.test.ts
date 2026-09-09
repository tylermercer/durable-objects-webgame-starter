import { describe, it, expect } from "vitest";
import { controllerTypes } from "./console";

describe("3D Town Controller Configuration", () => {
  it("exports gamepad and phone controller types", () => {
    expect(controllerTypes).toEqual({ phone: {}, gamepad: { buttonLabels: ["JUMP"] } });
  });
});
