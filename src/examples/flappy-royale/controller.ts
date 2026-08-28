import type { PeerConnection } from "@transport/peer-connection";
import type { FlappyControlMessage, RoundStateSnapshot } from "./types";
import { WebHaptics } from "web-haptics";

export interface ControllerContext {
  peerConnection: PeerConnection | null;
  isFirstPlayer?: () => boolean;
}

export function createGame(ctx: ControllerContext) {
  const haptics = new WebHaptics();
  let myPlace: number | null = null;
  let isDead = false;
  let latestSnapshot: RoundStateSnapshot | null = null;

  const surface = document.getElementById("touch-surface");
  if (surface) {
    surface.style.display = "block";
    const instructions = surface.querySelector(".touch-instructions");
    if (instructions) {
      (instructions as HTMLElement).style.display = "none";
    }
  }

  function handleFlap() {
    if (!ctx.peerConnection) return;
    const isFirst = ctx.isFirstPlayer ? ctx.isFirstPlayer() : false;
    const phase = latestSnapshot?.phase || "waiting";

    // Non-first players cannot start the game in lobby or results screen
    if ((phase === "waiting" || phase === "roundOver") && !isFirst) {
      return;
    }

    haptics.trigger("light");

    // Send discrete flap message on both input (unreliable fast) and control (fallback)
    ctx.peerConnection.sendInput({ type: "flap" });
    ctx.peerConnection.sendControl({ type: "flap" });
  }

  if (ctx.peerConnection) {
    ctx.peerConnection.addControlListener((msg) => {
      const fMsg = msg as FlappyControlMessage;
      if (fMsg.type === "died") {
        isDead = true;
        myPlace = fMsg.place;
        render();
      } else if (fMsg.type === "roundState") {
        latestSnapshot = fMsg.snapshot;

        // Check player status from snapshot
        const rawName = document.getElementById("player-name")?.textContent || "";
        const currentName = rawName.replace(/\s*\(Host\)$/, "");
        const me = latestSnapshot.birds.find(
          (b) => b.name === currentName || b.name === rawName
        );
        if (me) {
          if (!me.alive) {
            isDead = true;
            if (me.place) myPlace = me.place;
          } else {
            isDead = false;
            myPlace = null;
          }
        }
        render();
      } else if (fMsg.type === "roundOver") {
        render();
      }
    });
  }

  function render() {
    if (!surface) return;

    const rawName = document.getElementById("player-name")?.textContent || "";
    const currentName = rawName.replace(/\s*\(Host\)$/, "");
    const me = latestSnapshot?.birds.find((b) => b.name === currentName || b.name === rawName);
    const phase = latestSnapshot?.phase || "waiting";
    const aliveCount = latestSnapshot
      ? latestSnapshot.birds.filter((b) => b.alive).length
      : 0;

    const isFirst = ctx.isFirstPlayer ? ctx.isFirstPlayer() : false;
    const firstPlayerName = latestSnapshot?.firstPlayerId
      ? (latestSnapshot.birds.find(b => b.id === latestSnapshot?.firstPlayerId)?.name || "first player")
      : "first player";

    let buttonColor = "#0070f3"; // Blue default
    let statusText = "TAP TO FLAP! 🐤";
    let subText = "Keep tapping to stay airborne";

    if (phase === "waiting") {
      if (isFirst) {
        buttonColor = "#2ecc40"; // Green
        statusText = "START GAME 🚀";
        subText = "Tap anywhere to launch round!";
      } else {
        buttonColor = "#333333";
        statusText = "WAITING... ⏳";
        subText = `Waiting for ${firstPlayerName} to start…`;
      }
    } else if (phase === "roundOver") {
      if (isFirst) {
        buttonColor = "#2ecc40"; // Green
        statusText = "PLAY AGAIN 🔄";
        if (latestSnapshot?.winner?.name === currentName || latestSnapshot?.winner?.name === rawName) {
          subText = "🏆 VICTORY ROYALE! You won!";
        } else if (latestSnapshot?.winner) {
          subText = `Winner: ${latestSnapshot.winner.name}`;
        } else {
          subText = "Round Over!";
        }
      } else {
        buttonColor = "#333333";
        statusText = "ROUND OVER";
        subText = `Waiting for ${firstPlayerName} to start next round…`;
      }
    } else if (isDead || (me && !me.alive)) {
      buttonColor = "#333333"; // Dark gray
      statusText = "ELIMINATED 💀";
      const placeText = myPlace || me?.place;
      subText = placeText ? `You placed #${placeText}! Spectating...` : "Spectating live round...";
    } else if (me) {
      subText = `Birds Remaining: ${aliveCount}`;
    }

    surface.innerHTML = `
      <div id="flap-btn" style="
        width: 100%;
        height: 100%;
        min-height: 70vh;
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        background: ${buttonColor};
        color: #ffffff;
        user-select: none;
        -webkit-user-select: none;
        touch-action: manipulation;
        border-radius: 16px;
        box-shadow: 0 8px 24px rgba(0,0,0,0.3);
        cursor: pointer;
        padding: 2rem;
        box-sizing: border-box;
        text-align: center;
        transition: background 0.2s ease;
      ">
        <div style="font-size: 2.5rem; font-weight: 900; margin-bottom: 0.5rem; text-transform: uppercase;">
          ${statusText}
        </div>
        <div style="font-size: 1.2rem; font-weight: 500; opacity: 0.9;">
          ${subText}
        </div>
      </div>
    `;

  }

  const onPointerDown = (e: PointerEvent) => {
    e.preventDefault();
    handleFlap();
  };

  if (surface) {
    surface.addEventListener("pointerdown", onPointerDown);
  }

  render();

  return {
    destroy: () => {
      haptics.destroy();
      if (surface) {
        surface.removeEventListener("pointerdown", onPointerDown);
      }
    },
  };
}
