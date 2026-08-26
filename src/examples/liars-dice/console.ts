import type { PeerConnection, TouchMessage } from "../../scripts/peer-connection";
import type { RpcStub } from "capnweb";
import type { ConsoleApi } from "../../lib/signaling-api";
import type { PlayerConnectionStatus } from "../../scripts/console";
import { createRng } from "../../utils/rng";
import { isValidBid, resolveChallenge } from "./rules";
import type {
  Bid,
  ChallengeResult,
  GamePhase,
  LiarsDiceControlMessage,
  PersistedGameState,
  PlayerPublicInfo,
  PublicGameState,
} from "./types";

export interface ControllerPeer {
  id: string;
  name: string;
  color: string;
  isFirstPlayer?: boolean;
  pc: PeerConnection | null;
  state: string;
  status?: PlayerConnectionStatus;
  lastTouch?: TouchMessage;
}

export interface ConsoleContext {
  session: RpcStub<ConsoleApi> | null;
  peers: Map<string, ControllerPeer>;
}

const REVEAL_DURATION = 6; // 6 seconds reveal display

export function createGame(ctx: ConsoleContext) {
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
  let lastRenderedHtml = "";

  const attachedListeners = new Set<string>();

  // Helper to find the current first connected player ID
  function getFirstPlayerId(): string | null {
    for (const peer of ctx.peers.values()) {
      if (peer.isFirstPlayer && (peer.status === "live" || peer.state === "connected")) {
        return peer.id;
      }
    }
    // Fallback: earliest connected peer in Map iteration order
    for (const peer of ctx.peers.values()) {
      if (peer.status === "live" || peer.state === "connected") return peer.id;
    }
    return null;
  }

  // Ensure DOM container in #demo-view
  const demoView = document.getElementById("demo-view");
  let gameContainer = document.getElementById("liars-dice-console");

  if (demoView) {
    demoView.classList.remove("u-hidden");
    const heading = demoView.querySelector("h2");
    if (heading && heading.textContent === "Live Touch Visualization") {
      heading.style.display = "none";
    }
    const canvasContainer = demoView.querySelector(".canvas-container");
    if (canvasContainer) {
      (canvasContainer as HTMLElement).style.display = "none";
    }
    if (!gameContainer) {
      gameContainer = document.createElement("div");
      gameContainer.id = "liars-dice-console";
      gameContainer.className = "liars-dice-console l-stack l-space-m";
      demoView.appendChild(gameContainer);
    }
  }

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
    // Sort deterministically
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

    // Initialize dice counts for any new peers
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

    // Advance round seed and roll hands
    roundSeed = Math.floor(Math.random() * 2147483647);
    rollHands();

    currentBid = null;
    phase = "bidding";

    if (lastChallengeResult) {
      // Loser starts next round if still active, else next player
      const loserIndex = turnOrder.indexOf(lastChallengeResult.loserId);
      turnIndex = loserIndex >= 0 ? loserIndex : 0;
    } else {
      turnIndex = (turnNumberSeedIndex(roundNumber)) % turnOrder.length;
    }

    lastChallengeResult = null;
    winner = null;

    // Send private dice hands to all connected peers
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

    const players: PlayerPublicInfo[] = Array.from(ctx.peers.values()).map(peer => {
      const diceCount = playerDiceCounts.get(peer.id) ?? 5;
      const isConnected = peer.status ? (peer.status === "live") : (peer.state === "connected");
      return {
        id: peer.id,
        name: peer.name,
        color: peer.color,
        diceCount,
        isTurn: peer.id === turnPlayerId,
        connected: isConnected
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

  function broadcastState() {
    const state = getPublicGameState();
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

    // Loser loses 1 die
    const currentCount = playerDiceCounts.get(result.loserId) ?? 5;
    const newCount = Math.max(0, currentCount - 1);
    playerDiceCounts.set(result.loserId, newCount);

    // Check for game over
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
    // Remove listeners for peers that no longer exist or whose connection state was reset
    for (const id of attachedListeners) {
      const peer = ctx.peers.get(id);
      if (!peer || !peer.pc || (peer.status ? peer.status !== "live" : peer.state !== "connected")) {
        attachedListeners.delete(id);
      }
    }

    // Check for new peer connections and attach message listeners when control channel is open
    for (const [id, peer] of ctx.peers) {
      if (peer.pc && peer.pc.controlChannel?.readyState === "open" && !attachedListeners.has(id)) {
        attachedListeners.add(id);
        peer.pc.addControlListener((msg) => {
          handleControlMessage(id, msg as unknown as LiarsDiceControlMessage);
        });

        // Send existing dice hand and state if rejoining mid-round
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
        // Auto-initialize player dice counts for new connections
        for (const [id] of ctx.peers) {
          if (!playerDiceCounts.has(id)) {
            playerDiceCounts.set(id, 5);
          }
        }
      } else if (phase === "bidding") {
        // Bidding phase - waiting for player input
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
        }
      }
    },

    render: (_alpha: number) => {
      if (!gameContainer) return;

      const state = getPublicGameState();
      const diceIcons = ["🎲", "⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];

      let html = `
        <div class="ld-card l-box l-stack l-space-s" style="background:#1e1e24; color:#fff; padding:1.5rem; border-radius:12px; box-shadow:0 4px 12px rgba(0,0,0,0.3);">
          <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #333; padding-bottom:0.75rem;">
            <h2 style="margin:0; font-size:1.5rem;">🎲 Liar's Dice</h2>
            <div style="font-size:0.9rem; color:#aaa;">
              Round ${state.roundNumber} &bull; Total Dice in Play: <strong>${state.totalDiceInPlay}</strong>
            </div>
          </div>
      `;

      if (state.phase === "waiting") {
        html += `
          <div style="text-align:center; padding:2rem 1rem;">
            <h3 style="margin-bottom:0.5rem;">Waiting for Players...</h3>
            <p style="color:#aaa;">Need at least 2 players connected via QR code to play.</p>
            <p style="font-weight:bold; color:#0070f3;">Connected Players: ${ctx.peers.size}</p>
            ${ctx.peers.size >= 2 ? `
              <button id="ld-start-btn" style="padding:0.75rem 2rem; font-size:1.2rem; font-weight:bold; background:#2ecc40; color:#fff; border:none; border-radius:8px; cursor:pointer;">
                Start Game
              </button>
            ` : ""}
          </div>
        `;
      } else if (state.phase === "bidding") {
        html += `
          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:1rem; margin-top:0.5rem;">
            <div style="background:#2b2b36; padding:1rem; border-radius:8px; text-align:center;">
              <div style="font-size:0.85rem; color:#aaa; text-transform:uppercase;">Current Bid</div>
              <div style="font-size:1.8rem; font-weight:bold; color:#ffdc00; margin:0.5rem 0;">
                ${state.currentBid ? `${state.currentBid.count} &times; ${diceIcons[state.currentBid.face] || state.currentBid.face}` : "No bids yet"}
              </div>
              <div style="font-size:0.9rem; color:#bbb;">
                ${state.currentBid ? `by ${state.currentBid.bidderName}` : "Waiting for first bid"}
              </div>
            </div>

            <div style="background:#2b2b36; padding:1rem; border-radius:8px; text-align:center;">
              <div style="font-size:0.85rem; color:#aaa; text-transform:uppercase;">Turn</div>
              <div style="font-size:1.4rem; font-weight:bold; color:#7fdbff; margin:0.5rem 0;">
                ${state.turnPlayerName || "—"}
              </div>
            </div>
          </div>
        `;
      } else if (state.phase === "revealing" && state.lastChallengeResult) {
        const res = state.lastChallengeResult;
        html += `
          <div style="background:#2b2b36; padding:1.25rem; border-radius:8px; text-align:center; margin-top:0.5rem;">
            <h3 style="margin:0 0 0.5rem 0; color:#ff4136;">⚡ Challenge Revealed!</h3>
            <p style="font-size:1.1rem; margin:0.25rem 0;">
              <strong>${res.challengerName}</strong> called Liar on <strong>${res.bidderName}</strong>'s bid of
              <strong>${res.bid.count} &times; ${diceIcons[res.bid.face]}</strong>.
            </p>
            <div style="font-size:1.4rem; font-weight:bold; color:#ffdc00; margin:0.75rem 0;">
              Actual count of ${diceIcons[res.bid.face]}s: ${res.actualCount}
            </div>
            <p style="font-size:1.1rem; font-weight:bold; color:${res.challengeSuccess ? '#2ecc40' : '#ff4136'};">
              ${res.challengeSuccess ? `Challenge Success! ${res.bidderName} lied!` : `Challenge Failed! ${res.bidderName} told the truth!`}
            </p>
            <p style="font-size:0.95rem; color:#aaa;">
              <strong>${res.loserName}</strong> loses 1 die!
            </p>
          </div>
        `;
      } else if (state.phase === "gameOver" && state.winner) {
        html += `
          <div style="text-align:center; padding:2rem 1rem;">
            <h2 style="font-size:2rem; color:#ffdc00; margin-bottom:0.5rem;">🏆 Game Over!</h2>
            <h3 style="font-size:1.5rem; color:#fff;">Winner: ${state.winner.name}</h3>
            <button id="ld-newgame-btn" style="margin-top:1.5rem; padding:0.75rem 2rem; font-size:1.1rem; font-weight:bold; background:#0070f3; color:#fff; border:none; border-radius:8px; cursor:pointer;">
              Play Again
            </button>
          </div>
        `;
      }

      // Players table / list
      html += `
        <div style="margin-top:1rem;">
          <h4 style="margin-bottom:0.5rem; color:#aaa; font-size:0.9rem; text-transform:uppercase;">Players & Dice</h4>
          <div style="display:flex; flex-direction:column; gap:0.5rem;">
      `;

      for (const p of state.players) {
        const isTurn = p.id === state.turnPlayerId && state.phase === "bidding";
        const diceArray = playerHands.get(p.id) || [];
        const isRevealing = state.phase === "revealing" || state.phase === "gameOver";

        html += `
          <div style="display:flex; justify-content:space-between; align-items:center; background:${isTurn ? '#3a3a4c' : '#272733'}; border-left:4px solid ${p.color}; padding:0.6rem 1rem; border-radius:6px;">
            <div style="display:flex; align-items:center; gap:0.5rem;">
              <span style="font-weight:bold;">${p.name}</span>
              ${p.id === state.firstPlayerId ? `<span style="font-size:0.75rem; background:#ffdc00; color:#000; padding:2px 6px; border-radius:4px; font-weight:bold;">HOST</span>` : ""}
              ${isTurn ? `<span style="font-size:0.75rem; background:#7fdbff; color:#000; padding:2px 6px; border-radius:4px; font-weight:bold;">TURN</span>` : ""}
              ${!p.connected ? `<span style="font-size:0.75rem; background:#ff4136; color:#fff; padding:2px 6px; border-radius:4px;">OFFLINE</span>` : ""}
            </div>
            <div style="display:flex; align-items:center; gap:0.75rem;">
              <span style="font-size:1.1rem;">
                ${isRevealing ? (
                  diceArray.map(d => `<span style="margin:0 1px; ${state.lastChallengeResult && d === state.lastChallengeResult.bid.face ? 'color:#ffdc00; font-weight:bold;' : 'color:#ccc;'}">${diceIcons[d] || d}</span>`).join('')
                ) : (
                  Array(p.diceCount).fill("🎲").join(" ")
                )}
              </span>
              <span style="font-weight:bold; color:#aaa;">(${p.diceCount})</span>
            </div>
          </div>
        `;
      }

      html += `
          </div>
        </div>
      </div>
      `;

      if (html === lastRenderedHtml) return;
      lastRenderedHtml = html;
      gameContainer.innerHTML = html;

      // Event listener for Start Game / Play Again buttons
      const startBtn = document.getElementById("ld-start-btn");
      if (startBtn) {
        startBtn.addEventListener("click", () => startNextRound(true));
      }
      const newGameBtn = document.getElementById("ld-newgame-btn");
      if (newGameBtn) {
        newGameBtn.addEventListener("click", () => {
          playerDiceCounts.clear();
          roundNumber = 0;
          lastChallengeResult = null;
          winner = null;
          startNextRound(false);
        });
      }
    }
  };
}
