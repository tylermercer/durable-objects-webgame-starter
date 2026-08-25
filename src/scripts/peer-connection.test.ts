import { describe, expect, it } from "vitest";
import type { ControlMessage, IdentityMessage, PingMessage, PongMessage, TouchMessage } from "./peer-connection";

describe("peer-connection message formats", () => {
  it("serializes and deserializes touch messages correctly", () => {
    const touchMsg: TouchMessage = {
      type: "touch",
      phase: "start",
      pointerId: 1,
      x: 0.5,
      y: 0.25,
      t: 1234.56
    };

    const json = JSON.stringify(touchMsg);
    const parsed = JSON.parse(json) as TouchMessage;

    expect(parsed.type).toBe("touch");
    expect(parsed.phase).toBe("start");
    expect(parsed.pointerId).toBe(1);
    expect(parsed.x).toBe(0.5);
    expect(parsed.y).toBe(0.25);
    expect(parsed.t).toBe(1234.56);
  });

  it("handles normalized touch coordinates bounds", () => {
    const minTouch: TouchMessage = {
      type: "touch",
      phase: "move",
      pointerId: 2,
      x: 0,
      y: 0,
      t: 100
    };

    const maxTouch: TouchMessage = {
      type: "touch",
      phase: "end",
      pointerId: 2,
      x: 1,
      y: 1,
      t: 200
    };

    expect(minTouch.x).toBeGreaterThanOrEqual(0);
    expect(minTouch.y).toBeGreaterThanOrEqual(0);
    expect(maxTouch.x).toBeLessThanOrEqual(1);
    expect(maxTouch.y).toBeLessThanOrEqual(1);
  });

  it("serializes and deserializes control messages correctly", () => {
    const identityMsg: IdentityMessage = {
      type: "identity",
      name: "Player 1",
      color: "#FF4136"
    };

    const pingMsg: PingMessage = {
      type: "ping",
      t: 500
    };

    const pongMsg: PongMessage = {
      type: "pong",
      t: 500
    };

    expect(JSON.parse(JSON.stringify(identityMsg))).toEqual(identityMsg);
    expect(JSON.parse(JSON.stringify(pingMsg))).toEqual(pingMsg);
    expect(JSON.parse(JSON.stringify(pongMsg))).toEqual(pongMsg);
  });
});
