import type { PeerConnection } from "@transport/peer-connection";
import type { ControllerGameInstance } from "@contract/gameTypes";
import { InputStateSync } from "../../utils/InputStateSync";
import type { JoystickState, DungeonControlMessage } from "./types";

export interface ControllerContext {
  peerConnection: PeerConnection | null;
  isFirstPlayer?: () => boolean;
}

export function createGame(ctx: ControllerContext): ControllerGameInstance {
  let joystickVector: JoystickState = { x: 0, y: 0 };
  let activePointerId: number | null = null;
  let baseCenter = { x: 0, y: 0 };
  const maxRadius = 60;

  // Render controller UI container
  const appContainer = document.getElementById("touch-surface");
  const container = document.createElement("div");
  container.className = "grid-dungeon-controller";
  container.style.cssText = `
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    width: 100%;
    user-select: none;
    touch-action: none;
    background: #181820;
    color: #ffffff;
    font-family: sans-serif;
  `;

  const statusText = document.createElement("div");
  statusText.style.cssText = "margin-bottom: 24px; font-size: 18px; font-weight: bold;";
  statusText.textContent = "Use joystick to move";
  container.appendChild(statusText);

  // Virtual Joystick container
  const joystickBase = document.createElement("div");
  joystickBase.style.cssText = `
    position: relative;
    width: 160px;
    height: 160px;
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
    width: 64px;
    height: 64px;
    border-radius: 50%;
    background: #3080ff;
    box-shadow: 0 2px 8px rgba(0,0,0,0.4);
    transform: translate(0px, 0px);
    pointer-events: none;
  `;
  joystickBase.appendChild(joystickStick);
  container.appendChild(joystickBase);

  if (appContainer) {
    appContainer.innerHTML = "";
    appContainer.appendChild(container);
  }

  // Update status when room state snapshot arrives
  const unsubscribeControl = ctx.peerConnection?.addControlListener((msg) => {
    const dMsg = msg as unknown as DungeonControlMessage;
    if (dMsg.type === "roomState" && dMsg.snapshot) {
      statusText.textContent = `Dungeon Explorer (${dMsg.snapshot.players.length} active)`;
    }
  });

  // Streaming joystick state at 20Hz over WebRTC input channel
  const inputSync = new InputStateSync(
    () => ctx.peerConnection?.inputChannel ?? null,
    () => joystickVector,
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

  function onPointerDown(e: PointerEvent) {
    if (activePointerId !== null) return;
    activePointerId = e.pointerId;
    joystickBase.setPointerCapture(e.pointerId);

    const rect = joystickBase.getBoundingClientRect();
    baseCenter = {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
    updateJoystickPosition(e.clientX, e.clientY);
  }

  function onPointerMove(e: PointerEvent) {
    if (e.pointerId === activePointerId) {
      updateJoystickPosition(e.clientX, e.clientY);
    }
  }

  function onPointerUp(e: PointerEvent) {
    if (e.pointerId === activePointerId) {
      activePointerId = null;
      joystickVector = { x: 0, y: 0 };
      joystickStick.style.transform = `translate(0px, 0px)`;
    }
  }

  joystickBase.addEventListener("pointerdown", onPointerDown);
  joystickBase.addEventListener("pointermove", onPointerMove);
  joystickBase.addEventListener("pointerup", onPointerUp);
  joystickBase.addEventListener("pointercancel", onPointerUp);

  return {
    destroy: () => {
      inputSync.stop();
      unsubscribeControl?.();
      joystickBase.removeEventListener("pointerdown", onPointerDown);
      joystickBase.removeEventListener("pointermove", onPointerMove);
      joystickBase.removeEventListener("pointerup", onPointerUp);
      joystickBase.removeEventListener("pointercancel", onPointerUp);
      if (appContainer) {
        appContainer.innerHTML = "";
      }
    },
  };
}
