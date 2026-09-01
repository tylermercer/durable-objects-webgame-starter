import type { ConsoleContext, ConsoleGameInstance } from "@contract/gameTypes";
import { createRng } from "../../utils/rng";
import { diffDepartedPeers } from "../../utils/peerDeparture";
import { createStore } from "@react/reactStore";
import { isValidBid, resolveChallenge } from "./rules";
import { createRoot, type Root } from "react-dom/client";
import React from "react";
import { LiarsDiceConsole } from "./LiarsDiceConsole";
import type {
  Bid,
  ChallengeResult,
  GamePhase,
  LiarsDiceControlMessage,
  PersistedGameState,
  PlayerPublicInfo,
  PublicGameState,
} from "./types";

const REVEAL_DURATION = 6; // 6 seconds reveal display

export function createGame(ctx: ConsoleContext): ConsoleGameInstance {
  let phase: GamePhase = "waiting";
  let roundNumber = 1;
  let roundSeed = Math.floor(Math.random() * 2147483647);
  let playerDiceCounts: Map<string, number> = new Map(); // id -> diceCount (default 5)
  let playerHands: Map<string, number[]> = new Map(); // id -> dice array
  let turnOrder: string[] = []; // player IDs with diceCount > 0
  let turnIndex = 0;
  let currentBid: Bid | null = null;
  let revealTimer = 0;
  let lastChallengeResult: ChallengeResult | null = null;
  let winner: { id: string; name: string } | null = null;

  const attachedListeners = new Set<string>();
  const knownPlayerIds = new Set<string>();

  function handlePeerLeft(id: string) {
    if (phase === "bidding") {
      const currentTurnPlayerId = turnOrder[turnIndex % Math.max(1, turnOrder.length)];
      const wasCurrentTurn = (id === currentTurnPlayerId);
      turnOrder = turnOrder.filter(pId => pId !== id);
      if (turnOrder.length < 2) {
        phase = "waiting";
        broadcastState();
        persistState();
      } else if (wasCurrentTurn) {
        turnIndex = turnIndex % turnOrder.length;
        broadcastState();
        persistState();
      }
    }
  }

  const unsubscribePeerLeft = ctx.onPeerLeft?.(handlePeerLeft);

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

  function getTotalDiceInPlay(): number {
    let total = 0;
    for (const id of turnOrder) {
      total += playerDiceCounts.get(id) ?? 0;
    }
    return total;
  }

  function getPublicGameState(): PublicGameState {
    const totalDice = getTotalDiceInPlay();
    const turnPlayerId = turnOrder.length > 0 ? turnOrder[turnIndex % turnOrder.length] : null;
    const turnPeer = turnPlayerId ? ctx.peers.get(turnPlayerId) : null;
    const isRevealing = phase === "revealing" || phase === "gameOver";

    const players: PlayerPublicInfo[] = Array.from(ctx.peers.values()).map(peer => {
      const diceCount = playerDiceCounts.get(peer.id) ?? 5;
      const isConnected = peer.status ? (peer.status === "live" || peer.status === "live-relay") : (peer.state === "connected");
      return {
        id: peer.id,
        name: peer.name,
        color: peer.color,
        diceCount,
        isTurn: peer.id === turnPlayerId,
        connected: isConnected,
        dice: isRevealing ? playerHands.get(peer.id) : undefined,
      };
    });

    return {
      phase,
      roundNumber,
      turnPlayerId,
      turnPlayerName: turnPeer ? turnPeer.name : null,
      currentBid,
      totalDiceInPlay: totalDice,
      players,
      lastChallengeResult,
      winner,
      firstPlayerId: getFirstPlayerId()
    };
  }

  const store = createStore<PublicGameState>(getPublicGameState());

  const root: Root = createRoot(ctx.viewport.container);
  root.render(
    React.createElement(LiarsDiceConsole, {
      store,
      ctx,
      onStartRound: (keepRoundNumber) => startNextRound(keepRoundNumber),
      onNewGame: () => {
        playerDiceCounts.clear();
        roundNumber = 0;
        lastChallengeResult = null;
        winner = null;
        startNextRound(false);
      },
    })
  );

  // Load persisted state if available
  if (ctx.session) {
    ctx.session.loadGameState().then(saved => {
      if (saved && typeof saved === "object") {
        const state = saved as PersistedGameState;
        if (state.roundNumber) roundNumber = state.roundNumber;
        if (state.roundSeed) roundSeed = state.roundSeed;
        if (state.phase) phase = state.phase;
        if (state.currentBid !== undefined) currentBid = state.currentBid;
        if (state.turnIndex !== undefined) turnIndex = state.turnIndex;
        if (state.lastChallengeResult !== undefined) lastChallengeResult = state.lastChallengeResult;
        if (state.winner !== undefined) winner = state.winner;

        if (state.playerDiceCounts) {
          playerDiceCounts = new Map(Object.entries(state.playerDiceCounts));
        }
        if (phase === "bidding" || phase === "revealing") {
          rollHands();
        }
        broadcastState();
      }
    }).catch(err => {
      console.error("Failed to load persisted game state:", err);
    });
  }

  function getActivePlayerIds(): string[] {
    const active: string[] = [];
    for (const [id] of ctx.peers) {
      const count = playerDiceCounts.get(id) ?? 5;
      if (count > 0) {
        active.push(id);
      }
    }
    return active.sort();
  }

  function rollHands() {
    const rng = createRng(roundSeed);
    playerHands.clear();
    const activeIds = getActivePlayerIds();

    for (const id of activeIds) {
      const diceCount = playerDiceCounts.get(id) ?? 5;
      const hand: number[] = [];
      for (let i = 0; i < diceCount; i++) {
        hand.push(Math.floor(rng() * 6) + 1);
      }
      playerHands.set(id, hand);
    }
  }

  function startNextRound(keepRoundNumber = false) {
    if (!keepRoundNumber) {
      roundNumber++;
    }

    for (const [id] of ctx.peers) {
      if (!playerDiceCounts.has(id)) {
        playerDiceCounts.set(id, 5);
      }
    }

    turnOrder = getActivePlayerIds();

    if (turnOrder.length < 2) {
      phase = "waiting";
      broadcastState();
      persistState();
      return;
    }

    roundSeed = Math.floor(Math.random() * 2147483647);
    rollHands();

    currentBid = null;
    phase = "bidding";

    if (lastChallengeResult) {
      const loserIndex = turnOrder.indexOf(lastChallengeResult.loserId);
      turnIndex = loserIndex >= 0 ? loserIndex : 0;
    } else {
      turnIndex = turnNumberSeedIndex(roundNumber) % turnOrder.length;
    }

    lastChallengeResult = null;
    winner = null;

    for (const [id, peer] of ctx.peers) {
      const hand = playerHands.get(id);
      if (hand && peer.pc) {
        peer.pc.sendControl({ type: "privateDice", dice: hand });
      }
    }

    broadcastState();
    persistState();
  }

  function turnNumberSeedIndex(n: number): number {
    return Math.abs(n) % Math.max(1, turnOrder.length);
  }

  function broadcastState() {
    const state = getPublicGameState();
    store.set(state);
    for (const peer of ctx.peers.values()) {
      if (peer.pc) {
        peer.pc.sendControlCoalesced("gameState", { type: "gameState", state });
      }
    }
  }

  function persistState() {
    if (!ctx.session) return;
    const diceCountsObj: Record<string, number> = {};
    for (const [id, count] of playerDiceCounts) {
      diceCountsObj[id] = count;
    }

    const stateToSave: PersistedGameState = {
      roundNumber,
      roundSeed,
      playerDiceCounts: diceCountsObj,
      currentBid,
      turnIndex,
      phase,
      lastChallengeResult,
      winner
    };

    ctx.session.saveGameState(stateToSave).catch(err => {
      console.error("Failed to persist game state:", err);
    });
  }

  function handleControlMessage(fromId: string, msg: LiarsDiceControlMessage) {
    const peer = ctx.peers.get(fromId);
    if (!peer) return;

    const firstPlayerId = getFirstPlayerId();

    if (msg.type === "requestStart") {
      if (fromId === firstPlayerId && phase === "waiting" && getActivePlayerIds().length >= 2) {
        startNextRound(true);
      }
      return;
    }

    if (msg.type === "bid") {
      if (phase !== "bidding") return;
      if (turnOrder[turnIndex] !== fromId) return;

      const totalDice = getTotalDiceInPlay();
      if (isValidBid(currentBid, { count: msg.count, face: msg.face }, totalDice)) {
        currentBid = {
          count: msg.count,
          face: msg.face,
          bidderId: fromId,
          bidderName: peer.name
        };
        turnIndex = (turnIndex + 1) % turnOrder.length;
        broadcastState();
        persistState();
      }
    } else if (msg.type === "challenge") {
      if (phase !== "bidding" || !currentBid) return;
      if (turnOrder[turnIndex] !== fromId) return;

      executeChallenge(fromId, peer.name);
    } else if (msg.type === "nextRound") {
      if (fromId === firstPlayerId && (phase === "revealing" || phase === "waiting" || phase === "gameOver")) {
        startNextRound();
      }
    }
  }

  function executeChallenge(challengerId: string, challengerName: string) {
    if (!currentBid) return;

    const allHandsObj: Record<string, number[]> = {};
    for (const [id, hand] of playerHands) {
      allHandsObj[id] = hand;
    }

    const playerNamesObj: Record<string, string> = {};
    for (const [id, peer] of ctx.peers) {
      playerNamesObj[id] = peer.name;
    }

    const result = resolveChallenge(
      currentBid,
      challengerId,
      challengerName,
      allHandsObj,
      playerNamesObj
    );

    lastChallengeResult = result;
    phase = "revealing";
    revealTimer = REVEAL_DURATION;

    const currentCount = playerDiceCounts.get(result.loserId) ?? 5;
    const newCount = Math.max(0, currentCount - 1);
    playerDiceCounts.set(result.loserId, newCount);

    const activeRemaining = getActivePlayerIds();
    if (activeRemaining.length === 1) {
      const winnerId = activeRemaining[0];
      const winnerPeer = ctx.peers.get(winnerId);
      winner = { id: winnerId, name: winnerPeer ? winnerPeer.name : "Player" };
    }

    broadcastState();
    persistState();
  }

  function syncPeersAndListeners() {
    if (!ctx.onPeerLeft) {
      const { departed } = diffDepartedPeers(knownPlayerIds, ctx.peers);
      for (const id of departed) handlePeerLeft(id);
    }

    for (const id of attachedListeners) {
      const peer = ctx.peers.get(id);
      if (!peer || !peer.pc || (peer.status ? (peer.status !== "live" && peer.status !== "live-relay") : peer.state !== "connected")) {
        attachedListeners.delete(id);
      }
    }

    for (const [id, peer] of ctx.peers) {
      const isLive = peer.status ? (peer.status === "live" || peer.status === "live-relay") : (peer.state === "connected");
      if (peer.pc && isLive && !attachedListeners.has(id)) {
        attachedListeners.add(id);
        peer.pc.addControlListener((msg) => {
          handleControlMessage(id, msg as unknown as LiarsDiceControlMessage);
        });

        const hand = playerHands.get(id);
        if (hand) {
          peer.pc.sendControl({ type: "privateDice", dice: hand } as unknown as LiarsDiceControlMessage);
        }
        peer.pc.sendControlCoalesced("gameState", { type: "gameState", state: getPublicGameState() });
      }
    }
  }

  return {
    tick: (dt: number) => {
      syncPeersAndListeners();

      if (phase === "waiting") {
        for (const [id] of ctx.peers) {
          if (!playerDiceCounts.has(id)) {
            playerDiceCounts.set(id, 5);
          }
        }
        store.set(getPublicGameState());
      } else if (phase === "bidding") {
        store.set(getPublicGameState());
      } else if (phase === "revealing") {
        revealTimer -= dt;
        if (revealTimer <= 0) {
          if (winner) {
            phase = "gameOver";
            broadcastState();
            persistState();
          } else {
            startNextRound();
          }
        } else {
          store.set(getPublicGameState());
        }
      }
    },

    destroy: () => {
      unsubscribePeerLeft?.();
      root.unmount();
      ctx.viewport.container.innerHTML = "";
    },
  };
}
