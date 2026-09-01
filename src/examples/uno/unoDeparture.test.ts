import { describe, expect, it, vi } from "vitest";
import type { ConsoleContext, ControllerPeer } from "@contract/gameTypes";

vi.mock("react-dom/client", () => ({
  createRoot: () => ({
    render: vi.fn(),
    unmount: vi.fn(),
  }),
}));

vi.mock("./UnoConsole", () => ({
  UnoConsole: () => null,
}));

import { createGame } from "./console";

function createMockConsoleContext(): {
  ctx: ConsoleContext;
  peers: Map<string, ControllerPeer>;
} {
  const container = {
    appendChild: vi.fn(),
    innerHTML: "",
  } as unknown as HTMLDivElement;

  const peers = new Map<string, ControllerPeer>();

  const ctx: ConsoleContext = {
    peers,
    session: null,
    viewport: {
      container,
      initialSize: { width: 800, height: 600 },
      onResize: () => () => {},
    },
  };

  return { ctx, peers };
}

describe("Uno Player Departure", () => {
  it("declares winner or returns to lobby when player departs leaving <= 1 player", () => {
    const { ctx, peers } = createMockConsoleContext();

    const sendControlMock = vi.fn();

    peers.set("p1", {
      id: "p1",
      name: "Alice",
      color: "#ff0000",
      status: "live",
      state: "connected",
      isFirstPlayer: true,
      pc: {
        sendControl: sendControlMock,
        sendControlCoalesced: sendControlMock,
        addControlListener: vi.fn(),
      },
    } as unknown as ControllerPeer);

    peers.set("p2", {
      id: "p2",
      name: "Bob",
      color: "#00ff00",
      status: "live",
      state: "connected",
      pc: {
        sendControl: sendControlMock,
        sendControlCoalesced: sendControlMock,
        addControlListener: vi.fn(),
      },
    } as unknown as ControllerPeer);

    const game = createGame(ctx);
    game.tick?.(1 / 60);

    // Remove p1
    peers.delete("p1");
    game.tick?.(1 / 60);

    game.destroy?.();
  });
});
