import { describe, expect, it } from "vitest";
import { controllerTypes } from "./console";

describe("Grid Dungeon controller configuration", () => {
  it("exports controller types with FIRE button label", () => {
    expect(controllerTypes).toEqual({
      phone: {},
      gamepad: {
        buttonLabels: ["FIRE"],
      },
    });
  });
});
