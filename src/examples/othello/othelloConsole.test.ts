import { describe, it, expect, vi } from "vitest";
import type { ConsoleContext, ControllerPeer } from "@contract/gameTypes";
import type { GameTransport, ControlMessage } from "@transport/transport";
import type { PublicOthelloState } from "./types";

vi.mock("react-dom/client", () => ({
  createRoot: () => ({
    render: vi.fn(),
    unmount: vi.fn(),
  }),
}));

vi.mock("./OthelloConsole", () => ({
  OthelloConsole: () => null,
}));

import { createGame } from "./console";

function createMockTransport(): GameTransport & {
  controlListeners: ((msg: ControlMessage) => void)[];
  sentControlMsgs: unknown[];
} {
  const controlListeners: ((msg: ControlMessage) => void)[] = [];
  const sentControlMsgs: unknown[] = [];
  return {
    mode: "relay",
    controlListeners,
    sentControlMsgs,
    sendInput: vi.fn(),
    sendControl: vi.fn(msg => sentControlMsgs.push(msg)),
    sendControlCoalesced: vi.fn((key, msg) => sentControlMsgs.push(msg)),
    addInputListener: vi.fn(() => () => {}),
    addControlListener: vi.fn(listener => {
      controlListeners.push(listener);
      return () => {
        const idx = controlListeners.indexOf(listener);
        if (idx !== -1) controlListeners.splice(idx, 1);
      };
    }),
    onModeChange: vi.fn(() => () => {}),
    close: vi.fn(),
  };
}

describe("OthelloConsole integration", () => {
  it("attaches control listeners, starts game, and handles piece placement", () => {
    const container = {} as any;
    const p1Transport = createMockTransport();
    const p2Transport = createMockTransport();

    const peers = new Map<string, ControllerPeer>([
      [
        "peer-1",
        {
          id: "peer-1",
          name: "Alice",
          color: "#ff0000",
          isFirstPlayer: true,
          status: "live",
          state: "connected",
          pc: p1Transport,
        },
      ],
      [
        "peer-2",
        {
          id: "peer-2",
          name: "Bob",
          color: "#00ff00",
          isFirstPlayer: false,
          status: "live",
          state: "connected",
          pc: p2Transport,
        },
      ],
    ]);

    const ctx: ConsoleContext = {
      viewport: {
        container,
        initialSize: { width: 800, height: 600 },
        onResize: () => () => {},
      },
      peers,
      session: null,
    };

    const instance = createGame(ctx);

    // Tick to attach listeners
    instance.tick?.(0.016);

    expect(p1Transport.controlListeners.length).toBe(1);
    expect(p2Transport.controlListeners.length).toBe(1);

    // Peer 1 sends requestStart
    p1Transport.controlListeners[0]({ type: "requestStart" });

    // Find gameState broadcast in sent messages
    const lastGameStateMsg = p1Transport.sentControlMsgs
      .filter((m): m is { type: "gameState"; state: PublicOthelloState } => (m as any)?.type === "gameState")
      .pop();

    expect(lastGameStateMsg).toBeDefined();
    expect(lastGameStateMsg!.state.phase).toBe("playing");
    expect(lastGameStateMsg!.state.turnPlayerId).toBe("peer-1");
    expect(lastGameStateMsg!.state.blackPlayer?.id).toBe("peer-1");
    expect(lastGameStateMsg!.state.whitePlayer?.id).toBe("peer-2");
    expect(lastGameStateMsg!.state.blackCount).toBe(2);
    expect(lastGameStateMsg!.state.whiteCount).toBe(2);

    // Peer 1 (Black) places piece at (2, 3)
    p1Transport.controlListeners[0]({ type: "placePiece", x: 2, y: 3 });

    const nextGameStateMsg = p1Transport.sentControlMsgs
      .filter((m): m is { type: "gameState"; state: PublicOthelloState } => (m as any)?.type === "gameState")
      .pop();

    expect(nextGameStateMsg!.state.turnPlayerId).toBe("peer-2");
    expect(nextGameStateMsg!.state.blackCount).toBe(4);
    expect(nextGameStateMsg!.state.whiteCount).toBe(1);

    instance.destroy?.();
  });
});
