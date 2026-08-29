import { describe, it, expect, vi } from "vitest";
import type { ConsoleContext, ControllerPeer } from "@contract/gameTypes";
import type { GameTransport, ControlMessage } from "@transport/transport";
import type { UnoControlMessage, PublicUnoState } from "./types";

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

function createMockTransport(): GameTransport & { controlListeners: ((msg: ControlMessage) => void)[]; sentControlMsgs: unknown[] } {
  const controlListeners: ((msg: ControlMessage) => void)[] = [];
  const sentControlMsgs: unknown[] = [];
  return {
    mode: "relay",
    controlListeners,
    sentControlMsgs,
    sendInput: vi.fn(),
    sendControl: vi.fn((msg) => sentControlMsgs.push(msg)),
    sendControlCoalesced: vi.fn((key, msg) => sentControlMsgs.push(msg)),
    addInputListener: vi.fn(() => () => {}),
    addControlListener: vi.fn((listener) => {
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

describe("UnoConsole integration", () => {
  it("attaches control listeners for live-relay peers and handles card plays", () => {
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
          status: "live-relay",
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
          status: "live-relay",
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
      .filter((m): m is { type: "gameState"; state: PublicUnoState } => (m as any)?.type === "gameState")
      .pop();

    expect(lastGameStateMsg).toBeDefined();
    expect(lastGameStateMsg!.state.phase).toBe("playing");
    expect(lastGameStateMsg!.state.turnPlayerId).toBe("peer-1");

    // Get hands sent to peer 1
    const p1HandMsg = p1Transport.sentControlMsgs
      .filter((m): m is { type: "yourHand"; hand: any[] } => (m as any)?.type === "yourHand")
      .pop();
    expect(p1HandMsg).toBeDefined();
    expect(p1HandMsg!.hand.length).toBe(7);

    // Play a valid card or a wild card from p1's hand
    const topCard = lastGameStateMsg!.state.topCard!;
    const activeColor = lastGameStateMsg!.state.activeColor!;

    const playableCard = p1HandMsg!.hand.find(
      c => c.color === "wild" || c.color === activeColor || c.value === topCard.value
    );

    if (playableCard) {
      const playMsg: UnoControlMessage = {
        type: "playCard",
        cardId: playableCard.id,
        chosenColor: playableCard.color === "wild" ? "red" : undefined,
      };

      p1Transport.controlListeners[0](playMsg as unknown as ControlMessage);

      // Verify turn advanced to peer-2 and p1 hand size is now 6
      const nextGameStateMsg = p1Transport.sentControlMsgs
        .filter((m): m is { type: "gameState"; state: PublicUnoState } => (m as any)?.type === "gameState")
        .pop();

      expect(nextGameStateMsg!.state.turnPlayerId).toBe("peer-2");
      expect(nextGameStateMsg!.state.players.find(p => p.id === "peer-1")?.cardCount).toBe(6);
    }

    instance.destroy?.();
  });
});
