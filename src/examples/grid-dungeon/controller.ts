import type { GameTransport } from "@transport/transport";
import type { ControllerGameInstance } from "@contract/gameTypes";
import { InputStateSync } from "../../utils/InputStateSync";
import type { JoystickState, DungeonControlMessage } from "./types";
import { WebHaptics } from "web-haptics";

export interface ControllerContext {
  peerConnection: GameTransport | null;
  isFirstPlayer?: () => boolean;
}

export function createGame(ctx: ControllerContext): ControllerGameInstance {
  const haptics = new WebHaptics();
  let joystickVector: JoystickState = { x: 0, y: 0 };
  let isFiring = false;
  let activeJoystickPointerId: number | null = null;
  let activeFirePointerId: number | null = null;
  let baseCenter = { x: 0, y: 0 };
  const maxRadius = 55;

  // Render controller UI container
  const appContainer = document.getElementById("touch-surface");
  const container = document.createElement("div");
  container.className = "grid-dungeon-controller";
  container.style.cssText = `
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: space-around;
    height: 100%;
    width: 100%;
    padding: 16px;
    box-sizing: border-box;
    user-select: none;
    touch-action: none;
    background: #181820;
    color: #ffffff;
    font-family: sans-serif;
  `;

  const statusText = document.createElement("div");
  statusText.style.cssText = "font-size: 18px; font-weight: bold; text-align: center; height: 28px;";
  statusText.textContent = "Use joystick to move & Fire to shoot";
  container.appendChild(statusText);

  // Controls Row (Joystick + Fire Button)
  const controlsRow = document.createElement("div");
  controlsRow.style.cssText = `
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: space-around;
    width: 100%;
    max-width: 480px;
    flex: 1;
  `;

  // Virtual Joystick container
  const joystickBase = document.createElement("div");
  joystickBase.style.cssText = `
    position: relative;
    width: 140px;
    height: 140px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.1);
    border: 3px solid rgba(255, 255, 255, 0.3);
    box-shadow: 0 4px 12px rgba(0,0,0,0.5);
    display: flex;
    align-items: center;
    justify-content: center;
  `;

  const joystickStick = document.createElement("div");
  joystickStick.style.cssText = `
    position: absolute;
    width: 56px;
    height: 56px;
    border-radius: 50%;
    background: #3080ff;
    box-shadow: 0 2px 8px rgba(0,0,0,0.4);
    transform: translate(0px, 0px);
    pointer-events: none;
  `;
  joystickBase.appendChild(joystickStick);
  controlsRow.appendChild(joystickBase);

  // Fire Button
  const fireButton = document.createElement("div");
  fireButton.style.cssText = `
    position: relative;
    width: 110px;
    height: 110px;
    border-radius: 50%;
    background: #ff4136;
    border: 4px solid #ff725c;
    box-shadow: 0 4px 14px rgba(255, 65, 54, 0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 20px;
    font-weight: bold;
    color: #ffffff;
    letter-spacing: 1px;
    cursor: pointer;
    transition: transform 0.08s ease, background-color 0.08s ease;
  `;
  fireButton.textContent = "FIRE";
  controlsRow.appendChild(fireButton);

  container.appendChild(controlsRow);

  if (appContainer) {
    appContainer.innerHTML = "";
    appContainer.appendChild(container);
  }

  // Update status when room state snapshot arrives
  const unsubscribeControl = ctx.peerConnection?.addControlListener((msg) => {
    const dMsg = msg as unknown as DungeonControlMessage;
    if (dMsg.type === "roomState" && dMsg.snapshot) {
      const snap = dMsg.snapshot;
      if (snap.phase === "lobby") {
        if (snap.gameOverSurvivedWaves !== undefined && snap.gameOverSurvivedWaves !== null) {
          statusText.textContent = `Game Over! Survived ${snap.gameOverSurvivedWaves} wave${snap.gameOverSurvivedWaves === 1 ? "" : "s"}`;
        } else if (snap.countdown !== null) {
          statusText.textContent = `Starting in ${Math.ceil(snap.countdown)}...`;
        } else {
          statusText.textContent = `Lobby - Stand in start area (${snap.players.length} active)`;
        }
      } else {
        const waveLabel = snap.wave ? `Wave ${snap.wave}` : "Dungeon";
        const livesLabel = snap.lives !== undefined ? ` | Lives: ${snap.lives}` : "";
        statusText.textContent = `${waveLabel}${livesLabel}`;
      }

      if (snap.players) {
        const playerName = sessionStorage.getItem("playerName");
        const myPlayer = snap.players.find((p) => p.name === playerName) || (snap.players.length === 1 ? snap.players[0] : null);
        if (myPlayer) {
          if (myPlayer.attackType === "melee") {
            fireButton.textContent = "MELEE";
            fireButton.style.background = "#ff4136";
            fireButton.style.borderColor = "#ff725c";
          } else {
            fireButton.textContent = "FIRE";
            fireButton.style.background = "#ff4136";
            fireButton.style.borderColor = "#ff725c";
          }
        }
      }
    }
  });

  // Streaming input state at 20Hz over input channel/transport
  const inputSync = new InputStateSync(
    () => ctx.peerConnection,
    () => ({ x: joystickVector.x, y: joystickVector.y, firing: isFiring }),
    20
  );
  inputSync.start();

  function updateJoystickPosition(clientX: number, clientY: number) {
    const dx = clientX - baseCenter.x;
    const dy = clientY - baseCenter.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist === 0) {
      joystickVector = { x: 0, y: 0 };
      joystickStick.style.transform = `translate(0px, 0px)`;
      return;
    }

    const clampedDist = Math.min(dist, maxRadius);
    const normX = dx / dist;
    const normY = dy / dist;

    const stickX = normX * clampedDist;
    const stickY = normY * clampedDist;

    joystickStick.style.transform = `translate(${stickX}px, ${stickY}px)`;
    joystickVector = {
      x: normX * (clampedDist / maxRadius),
      y: normY * (clampedDist / maxRadius),
    };
  }

  // Joystick Pointer Handlers
  function onJoystickDown(e: PointerEvent) {
    if (activeJoystickPointerId !== null) return;
    activeJoystickPointerId = e.pointerId;
    joystickBase.setPointerCapture(e.pointerId);
    haptics.trigger("light");

    const rect = joystickBase.getBoundingClientRect();
    baseCenter = {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
    updateJoystickPosition(e.clientX, e.clientY);
  }

  function onJoystickMove(e: PointerEvent) {
    if (e.pointerId === activeJoystickPointerId) {
      updateJoystickPosition(e.clientX, e.clientY);
    }
  }

  function onJoystickUp(e: PointerEvent) {
    if (e.pointerId === activeJoystickPointerId) {
      activeJoystickPointerId = null;
      joystickVector = { x: 0, y: 0 };
      joystickStick.style.transform = `translate(0px, 0px)`;
    }
  }

  joystickBase.addEventListener("pointerdown", onJoystickDown);
  joystickBase.addEventListener("pointermove", onJoystickMove);
  joystickBase.addEventListener("pointerup", onJoystickUp);
  joystickBase.addEventListener("pointercancel", onJoystickUp);

  // Fire Button Pointer Handlers
  function onFireDown(e: PointerEvent) {
    if (activeFirePointerId !== null) return;
    activeFirePointerId = e.pointerId;
    fireButton.setPointerCapture(e.pointerId);
    isFiring = true;
    haptics.trigger("light");
    fireButton.style.transform = "scale(0.92)";
    fireButton.style.background = "#e70000";
  }

  function onFireUp(e: PointerEvent) {
    if (e.pointerId === activeFirePointerId) {
      activeFirePointerId = null;
      isFiring = false;
      fireButton.style.transform = "scale(1)";
      fireButton.style.background = "#ff4136";
    }
  }

  fireButton.addEventListener("pointerdown", onFireDown);
  fireButton.addEventListener("pointerup", onFireUp);
  fireButton.addEventListener("pointercancel", onFireUp);

  return {
    destroy: () => {
      haptics.destroy();
      inputSync.stop();
      unsubscribeControl?.();
      joystickBase.removeEventListener("pointerdown", onJoystickDown);
      joystickBase.removeEventListener("pointermove", onJoystickMove);
      joystickBase.removeEventListener("pointerup", onJoystickUp);
      joystickBase.removeEventListener("pointercancel", onJoystickUp);
      fireButton.removeEventListener("pointerdown", onFireDown);
      fireButton.removeEventListener("pointerup", onFireUp);
      fireButton.removeEventListener("pointercancel", onFireUp);
      if (appContainer) {
        appContainer.innerHTML = "";
      }
    },
  };
}
