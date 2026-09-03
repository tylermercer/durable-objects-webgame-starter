import type { ConsoleContext, ConsoleGameInstance, ControllerPeer } from "@contract/gameTypes";
import { TileGrid } from "@utils/tileGrid";
import { TurnOrder } from "@utils/turnOrder";
import { RoundFlow } from "@utils/roundFlow";
import { createStore } from "@react/reactStore";
import { createRoot, type Root } from "react-dom/client";
import React from "react";
import { OthelloConsole } from "./OthelloConsole";
import { applyMove, countPieces, createInitialBoard, hasAnyLegalMove, isValidMove } from "./rules";
import { saveLocalGameState, loadLocalGameState, clearLocalGameState } from "@utils/localGameState";
import type {
  CellState,
  OthelloControlMessage,
  OthelloPhase,
  PersistedOthelloState,
  PublicOthelloState,
} from "./types";

export function createGame(ctx: ConsoleContext): ConsoleGameInstance {
  let board: TileGrid<CellState> = createInitialBoard();
  let turnOrder: TurnOrder = new TurnOrder([]);
  let roundFlow: RoundFlow<OthelloPhase> = new RoundFlow<OthelloPhase>("waiting");
  let blackId: string | null = null;
  let whiteId: string | null = null;
  let winner: { id: string; name: string; color: "black" | "white" | "tie" } | null = null;

  function attachPeerListener(peer: ControllerPeer) {
    if (peer.pc) {
      peer.pc.addControlListener(msg => {
        handleControlMessage(peer.id, msg as unknown as OthelloControlMessage);
      });
      peer.pc.sendControlCoalesced("gameState", { type: "gameState", state: getPublicOthelloState() });
    }
  }

  const unsubscribePeerReady = ctx.onPeerReady((peer) => {
    attachPeerListener(peer);
  });

  const unsubscribePeerLeft = ctx.onPeerLeft((id) => {
    turnOrder.removePlayer(id);
    if (id === blackId) blackId = null;
    if (id === whiteId) whiteId = null;

    if (roundFlow.is("playing") && (!blackId || !whiteId)) {
      finishGame();
    }
  });

  for (const peer of ctx.peers.values()) {
    attachPeerListener(peer);
  }

  function getFirstPlayerId(): string | null {
    for (const peer of ctx.peers.values()) {
      if (peer.isFirstPlayer && (peer.status === "live" || peer.status === "live-relay" || peer.state === "connected")) {
        return peer.id;
      }
    }
    for (const peer of ctx.peers.values()) {
      if (peer.status === "live" || peer.status === "live-relay" || peer.state === "connected") return peer.id;
    }
    return null;
  }

  function isConnected(peer: ControllerPeer): boolean {
    return peer.status ? (peer.status === "live" || peer.status === "live-relay") : peer.state === "connected";
  }

  function finishGame() {
    const counts = countPieces(board);
    const blackPeer = blackId ? ctx.peers.get(blackId) : null;
    const whitePeer = whiteId ? ctx.peers.get(whiteId) : null;

    if (counts.black > counts.white) {
      winner = {
        id: blackId ?? "black",
        name: blackPeer ? blackPeer.name : "Black",
        color: "black",
      };
    } else if (counts.white > counts.black) {
      winner = {
        id: whiteId ?? "white",
        name: whitePeer ? whitePeer.name : "White",
        color: "white",
      };
    } else {
      winner = {
        id: "tie",
        name: "Tie",
        color: "tie",
      };
    }

    roundFlow.transition("roundOver");
  }

  function skipPlayersWithNoMoves() {
    if (!blackId || !whiteId || !roundFlow.is("playing")) return;
    let attempts = 0;
    const total = turnOrder.all().length;
    while (attempts < total) {
      const currentId = turnOrder.current();
      if (!currentId) break;
      const currentRole: "black" | "white" = currentId === blackId ? "black" : "white";
      if (hasAnyLegalMove(board, currentRole)) {
        return;
      }
      turnOrder.advance();
      attempts++;
    }
    finishGame();
  }

  function startNextGame() {
    const livePeers = Array.from(ctx.peers.values()).filter(isConnected);
    if (livePeers.length < 2) {
      clearLocalGameState(ctx.roomCode);
      roundFlow.transition("waiting");
      broadcastState();
      return;
    }

    blackId = livePeers[0].id;
    whiteId = livePeers[1].id;
    board = createInitialBoard();
    turnOrder = new TurnOrder([blackId, whiteId]);
    winner = null;
    roundFlow.transition("playing");

    skipPlayersWithNoMoves();

    broadcastState();
    persistState();
  }

  function handleControlMessage(fromId: string, msg: OthelloControlMessage) {
    const peer = ctx.peers.get(fromId);
    if (!peer) return;

    const firstPlayerId = getFirstPlayerId();

    if (msg.type === "requestStart") {
      if (fromId === firstPlayerId && roundFlow.is("waiting") && ctx.peers.size >= 2) {
        startNextGame();
      }
      return;
    }

    if (msg.type === "playAgain") {
      if (fromId === firstPlayerId && roundFlow.is("roundOver")) {
        startNextGame();
      }
      return;
    }

    if (!roundFlow.is("playing")) return;
    if (!turnOrder.isCurrent(fromId)) return;

    if (msg.type === "placePiece") {
      const playerColor: "black" | "white" = fromId === blackId ? "black" : "white";
      const pos = { x: msg.x, y: msg.y };

      if (!isValidMove(board, playerColor, pos)) return;

      applyMove(board, playerColor, pos);
      turnOrder.advance();

      const counts = countPieces(board);
      if (counts.black + counts.white === board.width * board.height) {
        finishGame();
      } else {
        skipPlayersWithNoMoves();
      }

      broadcastState();
      persistState();
    }
  }

  function getPublicOthelloState(): PublicOthelloState {
    const turnPlayerId = turnOrder.current();
    const turnPeer = turnPlayerId ? ctx.peers.get(turnPlayerId) : null;
    const blackPeer = blackId ? ctx.peers.get(blackId) : null;
    const whitePeer = whiteId ? ctx.peers.get(whiteId) : null;
    const counts = countPieces(board);

    const players = Array.from(ctx.peers.values()).map(peer => {
      let pieceColor: "black" | "white" | null = null;
      let count = 0;
      if (peer.id === blackId) {
        pieceColor = "black";
        count = counts.black;
      } else if (peer.id === whiteId) {
        pieceColor = "white";
        count = counts.white;
      }

      return {
        id: peer.id,
        name: peer.name,
        color: peer.color,
        pieceColor,
        isTurn: peer.id === turnPlayerId,
        connected: isConnected(peer),
        count,
      };
    });

    return {
      phase: roundFlow.current(),
      board: board.toJSON(),
      turnPlayerId,
      turnPlayerName: turnPeer ? turnPeer.name : null,
      blackPlayer: blackPeer ? { id: blackPeer.id, name: blackPeer.name } : null,
      whitePlayer: whitePeer ? { id: whitePeer.id, name: whitePeer.name } : null,
      blackCount: counts.black,
      whiteCount: counts.white,
      winner,
      firstPlayerId: getFirstPlayerId(),
      players,
    };
  }

  const store = createStore<PublicOthelloState>(getPublicOthelloState());

  const root: Root = createRoot(ctx.viewport.container);
  root.render(
    React.createElement(OthelloConsole, {
      store,
      ctx,
      onStartGame: () => startNextGame(),
    })
  );

  function broadcastState() {
    const state = getPublicOthelloState();
    store.set(state);
    for (const peer of ctx.peers.values()) {
      if (peer.pc) {
        peer.pc.sendControlCoalesced("gameState", { type: "gameState", state });
      }
    }
  }

  function persistState() {
    const stateToSave: PersistedOthelloState = {
      board: board.toJSON(),
      turnOrder: turnOrder.toJSON(),
      roundFlow: roundFlow.toJSON(),
      blackId,
      whiteId,
      winner,
    };
    saveLocalGameState(ctx.roomCode, stateToSave);
  }

  const saved = loadLocalGameState<PersistedOthelloState>(ctx.roomCode);
  if (saved && typeof saved === "object") {
    if (saved.board) board = TileGrid.fromJSON(saved.board);
    if (saved.turnOrder) turnOrder = new TurnOrder([], saved.turnOrder);
    if (saved.roundFlow) roundFlow = new RoundFlow<OthelloPhase>("waiting", saved.roundFlow);
    blackId = saved.blackId ?? null;
    whiteId = saved.whiteId ?? null;
    winner = saved.winner ?? null;
  }

  return {
    tick: () => {
      store.set(getPublicOthelloState());
    },

    destroy: () => {
      unsubscribePeerReady();
      unsubscribePeerLeft();
      root.unmount();
      ctx.viewport.container.innerHTML = "";
    },
  };
}
