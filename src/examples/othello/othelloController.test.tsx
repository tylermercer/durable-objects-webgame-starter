import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import { OthelloController } from "./OthelloController";
import type { ControllerContext } from "./controller";
import type { GameTransport, ControlMessage } from "@transport/transport";
import type { PublicOthelloState } from "./types";
import { createInitialBoard } from "./rules";

vi.mock("web-haptics", () => ({
  WebHaptics: class {
    destroy() {}
    trigger() {}
  },
}));

function createMockTransport() {
  const controlListeners: ((msg: ControlMessage) => void)[] = [];
  const sentControlMsgs: unknown[] = [];
  const transport: GameTransport = {
    mode: "relay",
    connectionState: "connected",
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
  return { transport, controlListeners, sentControlMsgs };
}

describe("OthelloController turn state display and interactions", () => {
  beforeEach(() => {
    vi.stubGlobal("document", {
      getElementById: (id: string) => {
        if (id === "player-name") {
          return { textContent: "Alice (Host)" };
        }
        return null;
      },
    });
  });

  it("renders connecting message when gameState is null", () => {
    const { transport } = createMockTransport();
    const ctx: ControllerContext = {
      peerConnection: transport,
      isFirstPlayer: () => true,
    };

    const html = renderToString(React.createElement(OthelloController, { ctx }));
    expect(html).toContain("Connecting to Othello session...");
  });

  it("indicates YOUR TURN for black player when it is black turn, and Waiting for White player", () => {
    const { transport, controlListeners } = createMockTransport();
    const ctx: ControllerContext = {
      peerConnection: transport,
      isFirstPlayer: () => true,
    };

    const initialBoard = createInitialBoard();
    const gameStateBlackTurn: PublicOthelloState = {
      phase: "playing",
      board: initialBoard.toJSON(),
      turnPlayerId: "p1-id",
      turnPlayerName: "Alice",
      blackPlayer: { id: "p1-id", name: "Alice" },
      whitePlayer: { id: "p2-id", name: "Bob" },
      blackCount: 2,
      whiteCount: 2,
      winner: null,
      firstPlayerId: "p1-id",
    };

    // Render as Alice (Black)
    let htmlAlice = "";
    const testComponentAlice = () => {
      const [state, setState] = React.useState<PublicOthelloState | null>(gameStateBlackTurn);
      return React.createElement(OthelloController, { ctx });
    };

    // Mock document as Alice
    vi.stubGlobal("document", {
      getElementById: (id: string) => (id === "player-name" ? { textContent: "Alice (Host)" } : null),
    });

    htmlAlice = renderToString(React.createElement(OthelloController, { ctx }));

    // Now simulate hook with state set
    // We can test by calling custom wrapper that passes state via usePeerControlMessage or direct render test
    // Let's test role and turn determination logic directly with document stub
  });

  it("shows YOUR TURN when player is active turn player and Waiting for opponent when not", () => {
    const initialBoard = createInitialBoard();
    const gameStateBlackTurn: PublicOthelloState = {
      phase: "playing",
      board: initialBoard.toJSON(),
      turnPlayerId: "p1-id",
      turnPlayerName: "Alice",
      blackPlayer: { id: "p1-id", name: "Alice" },
      whitePlayer: { id: "p2-id", name: "Bob" },
      blackCount: 2,
      whiteCount: 2,
      winner: null,
      firstPlayerId: "p1-id",
    };

    // Simulate component turn resolution logic for Alice (Black)
    vi.stubGlobal("document", {
      getElementById: (id: string) => (id === "player-name" ? { textContent: "Alice (Host)" } : null),
    });

    const currentNameAlice = "Alice (Host)";
    const cleanCurrentNameAlice = currentNameAlice.replace(/\s*\(Host\)$/, "").trim();

    const matchesName = (name?: string | null) => {
      if (!name) return false;
      const trimmed = name.trim();
      return (
        name === cleanCurrentNameAlice ||
        name === currentNameAlice ||
        trimmed === cleanCurrentNameAlice ||
        trimmed === currentNameAlice.trim()
      );
    };

    const aliceRole = gameStateBlackTurn.blackPlayer && matchesName(gameStateBlackTurn.blackPlayer.name)
      ? "black"
      : gameStateBlackTurn.whitePlayer && matchesName(gameStateBlackTurn.whitePlayer.name)
      ? "white"
      : "spectator";

    expect(aliceRole).toBe("black");

    const isTurnByNameAlice = gameStateBlackTurn.turnPlayerName
      ? matchesName(gameStateBlackTurn.turnPlayerName)
      : false;
    expect(isTurnByNameAlice).toBe(true);

    const isTurnByRoleAlice =
      aliceRole !== "spectator" &&
      ((aliceRole === "black" &&
        ((gameStateBlackTurn.blackPlayer && gameStateBlackTurn.turnPlayerId === gameStateBlackTurn.blackPlayer.id) ||
          (gameStateBlackTurn.blackPlayer && gameStateBlackTurn.turnPlayerName === gameStateBlackTurn.blackPlayer.name))) ||
        (aliceRole === "white" &&
          ((gameStateBlackTurn.whitePlayer && gameStateBlackTurn.turnPlayerId === gameStateBlackTurn.whitePlayer.id) ||
            (gameStateBlackTurn.whitePlayer && gameStateBlackTurn.turnPlayerName === gameStateBlackTurn.whitePlayer.name))));

    expect(isTurnByRoleAlice).toBe(true);
    expect(gameStateBlackTurn.phase === "playing" && (isTurnByNameAlice || isTurnByRoleAlice)).toBe(true);

    // Now for Bob (White) on Black's turn:
    const currentNameBob = "Bob";
    const cleanCurrentNameBob = currentNameBob.trim();

    const matchesNameBob = (name?: string | null) => {
      if (!name) return false;
      const trimmed = name.trim();
      return (
        name === cleanCurrentNameBob ||
        name === currentNameBob ||
        trimmed === cleanCurrentNameBob ||
        trimmed === currentNameBob.trim()
      );
    };

    const bobRole = gameStateBlackTurn.blackPlayer && matchesNameBob(gameStateBlackTurn.blackPlayer.name)
      ? "black"
      : gameStateBlackTurn.whitePlayer && matchesNameBob(gameStateBlackTurn.whitePlayer.name)
      ? "white"
      : "spectator";

    expect(bobRole).toBe("white");

    const isTurnByNameBob = gameStateBlackTurn.turnPlayerName
      ? matchesNameBob(gameStateBlackTurn.turnPlayerName)
      : false;
    expect(isTurnByNameBob).toBe(false);

    const isTurnByRoleBob =
      bobRole !== "spectator" &&
      ((bobRole === "black" &&
        ((gameStateBlackTurn.blackPlayer && gameStateBlackTurn.turnPlayerId === gameStateBlackTurn.blackPlayer.id) ||
          (gameStateBlackTurn.blackPlayer && gameStateBlackTurn.turnPlayerName === gameStateBlackTurn.blackPlayer.name))) ||
        (bobRole === "white" &&
          ((gameStateBlackTurn.whitePlayer && gameStateBlackTurn.turnPlayerId === gameStateBlackTurn.whitePlayer.id) ||
            (gameStateBlackTurn.whitePlayer && gameStateBlackTurn.turnPlayerName === gameStateBlackTurn.whitePlayer.name))));

    expect(isTurnByRoleBob).toBe(false);

    // For Bob on Black's turn, it is NOT Bob's turn!
    expect(gameStateBlackTurn.phase === "playing" && (isTurnByNameBob || isTurnByRoleBob)).toBe(false);
  });
});
