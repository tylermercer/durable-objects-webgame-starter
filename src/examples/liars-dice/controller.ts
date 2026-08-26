import type { PeerConnection } from "../../scripts/peer-connection";
import { isValidBid } from "./rules";
import type {
  LiarsDiceControlMessage,
  PublicGameState,
} from "./types";

export interface ControllerContext {
  peerConnection: PeerConnection | null;
  isFirstPlayer?: () => boolean;
}

export function createGame(ctx: ControllerContext) {
  let myDice: number[] = [];
  let gameState: PublicGameState | null = null;
  let selectedCount = 1;
  let selectedFace = 2;

  const diceIcons = ["🎲", "⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];

  const surface = document.getElementById("touch-surface");
  if (surface) {
    surface.style.display = "block";
    const instructions = surface.querySelector(".touch-instructions");
    if (instructions) {
      (instructions as HTMLElement).style.display = "none";
    }
  }

  if (ctx.peerConnection) {
    ctx.peerConnection.addControlListener((msg) => {
      const ldMsg = msg as unknown as LiarsDiceControlMessage;
      if (ldMsg.type === "privateDice") {
        myDice = ldMsg.dice;
        render();
      } else if (ldMsg.type === "gameState") {
        gameState = ldMsg.state;

        // Auto-adjust default selected bid to be valid if possible
        if (gameState && gameState.currentBid) {
          const cb = gameState.currentBid;
          if (cb.face < 6) {
            selectedCount = cb.count;
            selectedFace = cb.face + 1;
          } else {
            selectedCount = cb.count + 1;
            selectedFace = 1;
          }
        } else {
          selectedCount = 1;
          selectedFace = 2;
        }

        render();
      }
    });
  }

  function sendStartRequest() {
    if (!ctx.peerConnection) return;
    ctx.peerConnection.sendControl({
      type: "requestStart"
    } as unknown as LiarsDiceControlMessage);
  }

  function sendBid() {
    if (!ctx.peerConnection || !gameState) return;
    const totalDice = gameState.totalDiceInPlay;
    if (isValidBid(gameState.currentBid, { count: selectedCount, face: selectedFace }, totalDice)) {
      ctx.peerConnection.sendControl({
        type: "bid",
        count: selectedCount,
        face: selectedFace
      } as unknown as LiarsDiceControlMessage);
    }
  }

  function sendChallenge() {
    if (!ctx.peerConnection || !gameState || !gameState.currentBid) return;
    ctx.peerConnection.sendControl({
      type: "challenge"
    } as unknown as LiarsDiceControlMessage);
  }

  function render() {
    if (!surface) return;

    if (!gameState) {
      surface.innerHTML = `
        <div style="padding:2rem; text-align:center; color:#888;">
          Connecting to console...
        </div>
      `;
      return;
    }

    const isFirst = ctx.isFirstPlayer ? ctx.isFirstPlayer() : false;

    const isMyTurn = gameState.turnPlayerName === document.getElementById("player-name")?.textContent ||
      gameState.players.some(p => p.isTurn && p.connected);

    // Try matching player by name in header
    const currentName = document.getElementById("player-name")?.textContent || "";
    const cleanCurrentName = currentName.replace(/\s*\(Host\)$/, "");
    const me = gameState.players.find(p => p.name === cleanCurrentName || p.name === currentName);
    const isActuallyMyTurn = me ? me.isTurn : isMyTurn;

    const totalDice = gameState.totalDiceInPlay;
    const bidValid = isActuallyMyTurn && gameState.phase === "bidding" &&
      isValidBid(gameState.currentBid, { count: selectedCount, face: selectedFace }, totalDice);

    const connectedPlayersCount = gameState.players.filter(p => p.connected).length;
    const firstPlayerName = gameState.firstPlayerId
      ? gameState.players.find(p => p.id === gameState.firstPlayerId)?.name || "host"
      : "host";

    let html = `
      <div class="controller-liars-dice l-stack l-space-s" style="padding:1rem; max-width:400px; margin:0 auto; width:100%; box-sizing:border-box;">
        <!-- Private Dice Box -->
        <div style="background:#222; border:1px solid #444; border-radius:10px; padding:0.75rem 1rem; text-align:center;">
          <div style="font-size:0.75rem; text-transform:uppercase; color:#888; margin-bottom:0.25rem;">Your Dice</div>
          <div style="font-size:1.8rem; font-weight:bold; letter-spacing:4px;">
            ${myDice.length > 0 ? myDice.map(d => diceIcons[d] || d).join(" ") : "(No dice)"}
          </div>
        </div>

        <!-- Status Banner -->
        <div style="background:${isActuallyMyTurn && gameState.phase === 'bidding' ? '#1b3b22' : '#2b2b36'}; border:1px solid ${isActuallyMyTurn && gameState.phase === 'bidding' ? '#2ecc40' : '#444'}; border-radius:8px; padding:0.75rem; text-align:center;">
    `;

    if (gameState.phase === "waiting") {
      if (isFirst) {
        if (connectedPlayersCount >= 2) {
          html += `
            <div style="font-size:0.95rem; color:#2ecc40; font-weight:bold; margin-bottom:0.5rem;">You are the host! Ready to start game.</div>
            <button id="btn-request-start" style="padding:0.75rem 1.5rem; font-size:1.1rem; font-weight:bold; background:#2ecc40; color:#fff; border:none; border-radius:8px; cursor:pointer;">
              Start Game 🚀
            </button>
          `;
        } else {
          html += `<div style="font-size:0.95rem; color:#aaa;">Waiting for at least 2 players to connect...</div>`;
        }
      } else {
        html += `<div style="font-size:0.95rem; color:#aaa;">Waiting for <strong>${firstPlayerName}</strong> to start…</div>`;
      }
    } else if (gameState.phase === "bidding") {
      if (isActuallyMyTurn) {
        html += `
          <div style="font-size:1.1rem; font-weight:bold; color:#2ecc40;">🔥 YOUR TURN!</div>
        `;
      } else {
        html += `
          <div style="font-size:0.95rem; color:#aaa;">
            Waiting for <strong>${gameState.turnPlayerName || "player"}</strong> to bid...
          </div>
        `;
      }
    } else if (gameState.phase === "revealing") {
      html += `<div style="font-size:1rem; font-weight:bold; color:#ff4136;">⚡ Challenge Revealed on Console!</div>`;
    } else if (gameState.phase === "gameOver") {
      html += `<div style="font-size:1rem; font-weight:bold; color:#ffdc00;">🏆 Game Over! ${gameState.winner ? `${gameState.winner.name} won!` : ''}</div>`;
    }

    html += `</div>`;

    // Current Bid Display
    if (gameState.currentBid) {
      html += `
        <div style="background:#1a1a24; border-radius:8px; padding:0.5rem 0.75rem; display:flex; justify-content:space-between; align-items:center;">
          <span style="font-size:0.8rem; color:#888;">Current Bid:</span>
          <span style="font-size:1.1rem; font-weight:bold; color:#ffdc00;">
            ${gameState.currentBid.count} &times; ${diceIcons[gameState.currentBid.face]} (${gameState.currentBid.bidderName})
          </span>
        </div>
      `;
    }

    // Bid & Challenge Controls (Only visible on your turn during bidding phase)
    if (gameState.phase === "bidding" && isActuallyMyTurn) {
      html += `
        <div style="background:#222; border-radius:10px; padding:0.75rem; display:flex; flex-direction:column; gap:0.75rem;">
          <div style="font-size:0.85rem; font-weight:bold; color:#aaa; text-transform:uppercase; text-align:center;">Make a Bid</div>

          <!-- Quantity Picker -->
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <span style="font-size:0.9rem; color:#ccc;">Quantity:</span>
            <div style="display:flex; align-items:center; gap:0.5rem;">
              <button id="qty-minus" style="width:36px; height:36px; font-size:1.2rem; font-weight:bold; background:#333; color:#fff; border:1px solid #555; border-radius:6px; cursor:pointer;">-</button>
              <span style="font-size:1.3rem; font-weight:bold; width:30px; text-align:center;">${selectedCount}</span>
              <button id="qty-plus" style="width:36px; height:36px; font-size:1.2rem; font-weight:bold; background:#333; color:#fff; border:1px solid #555; border-radius:6px; cursor:pointer;">+</button>
            </div>
          </div>

          <!-- Face Picker -->
          <div>
            <div style="font-size:0.9rem; color:#ccc; margin-bottom:0.4rem;">Face Value:</div>
            <div style="display:grid; grid-template-columns: repeat(6, 1fr); gap:4px;">
      `;

      for (let f = 1; f <= 6; f++) {
        const isSelected = selectedFace === f;
        html += `
          <button class="face-btn" data-face="${f}" style="padding:6px 0; font-size:1.3rem; background:${isSelected ? '#0070f3' : '#333'}; color:#fff; border:${isSelected ? '2px solid #fff' : '1px solid #555'}; border-radius:6px; cursor:pointer;">
            ${diceIcons[f]}
          </button>
        `;
      }

      html += `
            </div>
          </div>

          <!-- Action Buttons -->
          <div style="display:flex; gap:0.5rem; margin-top:0.25rem;">
            <button id="btn-place-bid" ${bidValid ? '' : 'disabled'} style="flex:1; padding:0.75rem; font-size:1rem; font-weight:bold; background:${bidValid ? '#0070f3' : '#444'}; color:${bidValid ? '#fff' : '#888'}; border:none; border-radius:8px; cursor:${bidValid ? 'pointer' : 'not-allowed'};">
              Place Bid
            </button>
            ${gameState.currentBid ? `
              <button id="btn-challenge" style="flex:1; padding:0.75rem; font-size:1rem; font-weight:bold; background:#ff4136; color:#fff; border:none; border-radius:8px; cursor:pointer;">
                Liar! ⚡
              </button>
            ` : ''}
          </div>
        </div>
      `;
    }

    html += `</div>`;
    surface.innerHTML = html;

    const reqStartBtn = document.getElementById("btn-request-start");
    if (reqStartBtn) {
      reqStartBtn.addEventListener("click", () => {
        sendStartRequest();
      });
    }

    // Attach control listeners
    const minusBtn = document.getElementById("qty-minus");
    if (minusBtn) {
      minusBtn.addEventListener("click", () => {
        if (selectedCount > 1) {
          selectedCount--;
          render();
        }
      });
    }

    const plusBtn = document.getElementById("qty-plus");
    if (plusBtn) {
      plusBtn.addEventListener("click", () => {
        if (selectedCount < totalDice) {
          selectedCount++;
          render();
        }
      });
    }

    const faceBtns = surface.querySelectorAll(".face-btn");
    faceBtns.forEach(btn => {
      btn.addEventListener("click", (e) => {
        const face = Number((e.currentTarget as HTMLElement).getAttribute("data-face"));
        if (face >= 1 && face <= 6) {
          selectedFace = face;
          render();
        }
      });
    });

    const bidBtn = document.getElementById("btn-place-bid");
    if (bidBtn) {
      bidBtn.addEventListener("click", () => {
        sendBid();
      });
    }

    const challengeBtn = document.getElementById("btn-challenge");
    if (challengeBtn) {
      challengeBtn.addEventListener("click", () => {
        sendChallenge();
      });
    }
  }

  render();

  return {};
}
