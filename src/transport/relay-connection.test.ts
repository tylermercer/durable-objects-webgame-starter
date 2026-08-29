import { describe, expect, it, vi } from "vitest";
import { RelayConnection } from "./relay-connection";
import type { RpcStub } from "capnweb";
import type { ConsoleApi, ControllerApi } from "../lib/signaling-api";
import type { TouchMessage } from "./transport";

describe("RelayConnection", () => {
  it("reports relay mode and notifies onModeChange listener", () => {
    const relay = new RelayConnection(null, "player-1");
    expect(relay.mode).toBe("relay");

    const modeSpy = vi.fn();
    relay.onModeChange(modeSpy);
    expect(modeSpy).toHaveBeenCalledWith("relay");
  });

  it("relays input and control messages through ConsoleApi when peerId is provided", () => {
    const mockConsoleApi = {
      relayInput: vi.fn(),
      relayControl: vi.fn(),
    } as unknown as RpcStub<ConsoleApi>;

    const relay = new RelayConnection(mockConsoleApi, "player-1");

    relay.sendInput({ type: "touch", x: 0.5, y: 0.5 });
    expect(mockConsoleApi.relayInput).toHaveBeenCalledWith("player-1", { type: "touch", x: 0.5, y: 0.5 });

    relay.sendControl({ type: "identity", name: "Alice", color: "#FF0000" });
    expect(mockConsoleApi.relayControl).toHaveBeenCalledWith("player-1", {
      type: "identity",
      name: "Alice",
      color: "#FF0000",
    });
  });

  it("relays input and control messages through ControllerApi when peerId is undefined", () => {
    const mockControllerApi = {
      relayInput: vi.fn(),
      relayControl: vi.fn(),
    } as unknown as RpcStub<ControllerApi>;

    const relay = new RelayConnection(mockControllerApi);

    relay.sendInput({ type: "flap" });
    expect(mockControllerApi.relayInput).toHaveBeenCalledWith({ type: "flap" });

    relay.sendControl({ type: "ping", t: 100 });
    expect(mockControllerApi.relayControl).toHaveBeenCalledWith({ type: "ping", t: 100 });
  });

  it("dispatches handleRelayInput and handleRelayControl to listeners", () => {
    const onInputMsg = vi.fn();
    const onControlMsg = vi.fn();
    const inputListener = vi.fn();
    const controlListener = vi.fn();

    const relay = new RelayConnection(null, undefined, {
      onInputMessage: onInputMsg,
      onControlMessage: onControlMsg,
    });

    relay.addInputListener(inputListener);
    relay.addControlListener(controlListener);

    const touchMsg: TouchMessage = {
      type: "touch",
      phase: "start",
      pointerId: 1,
      x: 0.1,
      y: 0.2,
      t: 50,
    };

    relay.handleRelayInput(touchMsg);
    expect(onInputMsg).toHaveBeenCalledWith(touchMsg);
    expect(inputListener).toHaveBeenCalledWith(touchMsg);

    const controlMsg = { type: "identity", name: "Bob", color: "#00FF00" };
    relay.handleRelayControl(controlMsg);
    expect(onControlMsg).toHaveBeenCalledWith(controlMsg);
    expect(controlListener).toHaveBeenCalledWith(controlMsg);
  });

  it("automatically responds to ping with pong in handleRelayControl", () => {
    const mockControllerApi = {
      relayControl: vi.fn(),
    } as unknown as RpcStub<ControllerApi>;

    const relay = new RelayConnection(mockControllerApi);
    relay.handleRelayControl({ type: "ping", t: 12345 });

    expect(mockControllerApi.relayControl).toHaveBeenCalledWith({ type: "pong", t: 12345 });
  });

  it("coalesces control messages by key until microtask flush", async () => {
    const mockConsoleApi = {
      relayControl: vi.fn(),
    } as unknown as RpcStub<ConsoleApi>;

    const relay = new RelayConnection(mockConsoleApi, "p1");

    relay.sendControlCoalesced("score", { type: "score", val: 10 });
    relay.sendControlCoalesced("score", { type: "score", val: 20 });

    expect(mockConsoleApi.relayControl).not.toHaveBeenCalled();

    await Promise.resolve();

    expect(mockConsoleApi.relayControl).toHaveBeenCalledTimes(1);
    expect(mockConsoleApi.relayControl).toHaveBeenCalledWith("p1", { type: "score", val: 20 });
  });
});
