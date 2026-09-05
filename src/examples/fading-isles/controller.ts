import type { GameTransport } from "@transport/transport";
import type { ControllerGameInstance } from "@contract/gameTypes";
import { InputStateSync } from "@utils/InputStateSync";
import type { FadingIslesControlMessage, JoystickState } from "./types";
import { WebHaptics } from "web-haptics";

export interface ControllerContext {
  peerConnection: GameTransport | null;
  isFirstPlayer?: () => boolean;
}

export function createGame(ctx: ControllerContext): ControllerGameInstance {
  const haptics = new WebHaptics();
  let joystickVector: JoystickState = { x: 0, y: 0 };
  let activeJoystickPointerId: number | null = null;
  let baseCenter = { x: 0, y: 0 };
  const maxRadius = 60;

  // Render controller UI container
  const appContainer = document.getElementById("touch-surface");
  const container = document.createElement("div");
  container.className = "fading-isles-controller";
  container.style.cssText = `
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: space-around;
    height: 100%;
    width: 100%;
    padding: 20px;
    box-sizing: border-box;
    user-select: none;
    touch-action: none;
    background: #0f172a;
    color: #ffffff;
    font-family: sans-serif;
  `;

  const statusText = document.createElement("div");
  statusText.style.cssText = "font-size: 20px; font-weight: bold; text-align: center; height: 32px;";
  statusText.textContent = "Fading Isles";
  container.appendChild(statusText);

  // Virtual Joystick Base
  const joystickBase = document.createElement("div");
  joystickBase.style.cssText = `
    position: relative;
    width: 160px;
    height: 160px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.1);
    border: 3px solid rgba(255, 255, 255, 0.3);
    box-shadow: 0 6px 16px rgba(0,0,0,0.5);
    display: flex;
    align-items: center;
    justify-content: center;
  `;

  const joystickStick = document.createElement("div");
  joystickStick.style.cssText = `
    position: absolute;
    width: 64px;
    height: 64px;
    border-radius: 50%;
    background: #3b82f6;
    box-shadow: 0 4px 12px rgba(0,0,0,0.4);
    transform: translate(0px, 0px);
    pointer-events: none;
  `;
  joystickBase.appendChild(joystickStick);
  container.appendChild(joystickBase);

  // Restart Button for controllers
  const restartBtn = document.createElement("button");
  restartBtn.style.cssText = `
    padding: 10px 24px;
    font-size: 16px;
    font-weight: bold;
    background: #ef4444;
    color: #ffffff;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    box-shadow: 0 4px 8px rgba(0,0,0,0.3);
  `;
  restartBtn.textContent = "Restart Level";
  restartBtn.addEventListener("click", () => {
    ctx.peerConnection?.sendControl({ type: "restartLevel" });
  });
  container.appendChild(restartBtn);

  if (appContainer) {
    appContainer.innerHTML = "";
    appContainer.appendChild(container);
  }

  // Control channel listener for roomState updates
  const unsubscribeControl = ctx.peerConnection?.addControlListener((msg) => {
    const cMsg = msg as unknown as FadingIslesControlMessage;
    if (cMsg.type === "roomState" && cMsg.snapshot) {
      const snap = cMsg.snapshot;
      if (snap.won) {
        statusText.textContent = `Level ${snap.levelNumber} Complete!`;
      } else {
        statusText.textContent = `Level ${snap.levelNumber}`;
      }
    }
  });

  // Streaming joystick state at 20Hz
  const inputSync = new InputStateSync(
    () => ctx.peerConnection,
    () => ({ x: joystickVector.x, y: joystickVector.y }),
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

  return {
    destroy: () => {
      haptics.destroy();
      inputSync.stop();
      unsubscribeControl?.();
      joystickBase.removeEventListener("pointerdown", onJoystickDown);
      joystickBase.removeEventListener("pointermove", onJoystickMove);
      joystickBase.removeEventListener("pointerup", onJoystickUp);
      joystickBase.removeEventListener("pointercancel", onJoystickUp);
      if (appContainer) {
        appContainer.innerHTML = "";
      }
    },
  };
}
