import type { ConsoleContext, ConsoleGameInstance, ControllerPeer } from "@contract/gameTypes";
import { TileGrid } from "@utils/tileGrid";
import { TurnOrder } from "@utils/turnOrder";
import { RoundFlow } from "@utils/roundFlow";
import { createStore } from "@react/reactStore";
import { createRoot, type Root } from "react-dom/client";
import React from "react";
import { OthelloConsole } from "./OthelloConsole";
import { applyMove, countPieces, createInitialBoard, hasAnyLegalMove, isValidMove } from "./rules";
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

  const attachedListeners = new Set<string>();
  const knownPlayerIds = new Set<string>();

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
      roundFlow.transition("waiting");
      broadcastState();
      persistState();
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
    if (!ctx.session) return;
    const stateToSave: PersistedOthelloState = {
      board: board.toJSON(),
      turnOrder: turnOrder.toJSON(),
      roundFlow: roundFlow.toJSON(),
      blackId,
      whiteId,
      winner,
    };
    ctx.session.saveGameState(stateToSave).catch(err => {
      console.error("Failed to persist Othello game state:", err);
    });
  }

  if (ctx.session) {
    ctx.session
      .loadGameState()
      .then(saved => {
        if (saved && typeof saved === "object") {
          const state = saved as PersistedOthelloState;
          if (state.board) board = TileGrid.fromJSON(state.board);
          if (state.turnOrder) turnOrder = new TurnOrder([], state.turnOrder);
          if (state.roundFlow) roundFlow = new RoundFlow<OthelloPhase>("waiting", state.roundFlow);
          blackId = state.blackId ?? null;
          whiteId = state.whiteId ?? null;
          winner = state.winner ?? null;
          broadcastState();
        }
      })
      .catch(err => {
        console.error("Failed to load persisted game state:", err);
      });
  }

  function syncRemovedPlayers() {
    for (const id of Array.from(knownPlayerIds)) {
      if (!ctx.peers.has(id)) {
        knownPlayerIds.delete(id);
        turnOrder.removePlayer(id);
        if (id === blackId) blackId = null;
        if (id === whiteId) whiteId = null;
      }
    }
    for (const id of ctx.peers.keys()) knownPlayerIds.add(id);

    if (roundFlow.is("playing") && (!blackId || !whiteId)) {
      finishGame();
    }
  }

  function syncPeersAndListeners() {
    for (const id of attachedListeners) {
      const peer = ctx.peers.get(id);
      if (!peer || !peer.pc || !isConnected(peer)) {
        attachedListeners.delete(id);
      }
    }

    for (const [id, peer] of ctx.peers) {
      const isLive = isConnected(peer);
      if (peer.pc && isLive && !attachedListeners.has(id)) {
        attachedListeners.add(id);
        peer.pc.addControlListener(msg => {
          handleControlMessage(id, msg as unknown as OthelloControlMessage);
        });

        peer.pc.sendControlCoalesced("gameState", { type: "gameState", state: getPublicOthelloState() });
      }
    }
  }

  return {
    tick: () => {
      syncPeersAndListeners();
      if (roundFlow.is("playing")) syncRemovedPlayers();
      store.set(getPublicOthelloState());
    },

    destroy: () => {
      root.unmount();
      ctx.viewport.container.innerHTML = "";
    },
  };
}
