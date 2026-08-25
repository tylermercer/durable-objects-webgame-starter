import type { PeerConnection } from "../../scripts/peer-connection";
import type { FlappyControlMessage, RoundStateSnapshot } from "./types";

export interface ControllerContext {
  peerConnection: PeerConnection | null;
}

export function createGame(ctx: ControllerContext) {
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
        const me = latestSnapshot.birds.find(
          (b) => b.name === (document.getElementById("player-name")?.textContent || "")
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

    const currentName = document.getElementById("player-name")?.textContent || "";
    const me = latestSnapshot?.birds.find((b) => b.name === currentName);
    const phase = latestSnapshot?.phase || "waiting";
    const aliveCount = latestSnapshot
      ? latestSnapshot.birds.filter((b) => b.alive).length
      : 0;

    let buttonColor = "#0070f3"; // Blue default
    let statusText = "TAP TO FLAP! 🐤";
    let subText = "Keep tapping to stay airborne";

    if (phase === "waiting") {
      buttonColor = "#2ecc40"; // Green
      statusText = "START GAME 🚀";
      subText = "Tap anywhere to launch round!";
    } else if (phase === "roundOver") {
      buttonColor = "#2ecc40"; // Green
      statusText = "PLAY AGAIN 🔄";
      if (latestSnapshot?.winner?.name === currentName) {
        subText = "🏆 VICTORY ROYALE! You won!";
      } else if (latestSnapshot?.winner) {
        subText = `Winner: ${latestSnapshot.winner.name}`;
      } else {
        subText = "Round Over!";
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

    const flapBtn = document.getElementById("flap-btn");
    if (flapBtn) {
      flapBtn.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        handleFlap();
      });
    }
  }

  render();

  return {};
}
