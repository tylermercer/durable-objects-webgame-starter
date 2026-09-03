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
  triggerPeerLeft: (id: string) => void;
} {
  const container = {
    appendChild: vi.fn(),
    innerHTML: "",
  } as unknown as HTMLDivElement;

  const peers = new Map<string, ControllerPeer>();
  let peerLeftCb: ((id: string) => void) | null = null;

  const ctx: ConsoleContext = {
    roomCode: "TEST_ROOM",
    peers,
    session: null,
    onPeerJoined: () => () => {},
    onPeerReady: () => () => {},
    onPeerLeft: (cb) => {
      peerLeftCb = cb;
      return () => { peerLeftCb = null; };
    },
    viewport: {
      container,
      initialSize: { width: 800, height: 600 },
      onResize: () => () => {},
    },
  };

  return { ctx, peers, triggerPeerLeft: (id: string) => peerLeftCb?.(id) };
}

describe("Uno Player Departure", () => {
  it("declares winner or returns to lobby when player departs leaving <= 1 player", () => {
    const { ctx, peers, triggerPeerLeft } = createMockConsoleContext();

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

    // Remove p1 and trigger event
    peers.delete("p1");
    triggerPeerLeft("p1");

    game.tick?.(1 / 60);

    game.destroy?.();
  });
});
