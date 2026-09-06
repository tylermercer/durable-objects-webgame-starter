import type { GameTransport } from "@transport/transport";
import type { ControllerGameInstance } from "@contract/gameTypes";
import { InputStateSync } from "@utils/InputStateSync";
import { WebHaptics } from "web-haptics";

export interface ControllerContext {
  peerConnection: GameTransport | null;
  isFirstPlayer?: () => boolean;
}

export interface TownJoystickState {
  x: number;
  y: number;
  jump: boolean;
}

export function createGame(ctx: ControllerContext): ControllerGameInstance {
  const haptics = new WebHaptics();
  const joystickState: TownJoystickState = { x: 0, y: 0, jump: false };

  const surface = document.getElementById("touch-surface");
  if (!surface) {
    return { destroy: () => haptics.destroy() };
  }

  surface.innerHTML = "";

  const container = document.createElement("div");
  container.style.cssText = `
    position: relative;
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    align-items: center;
    padding: 20px;
    box-sizing: border-box;
    user-select: none;
    -webkit-user-select: none;
    touch-action: none;
    font-family: system-ui, -apple-system, sans-serif;
    color: white;
  `;

  const header = document.createElement("div");
  header.style.cssText = `
    text-align: center;
    margin-top: 10px;
  `;
  header.innerHTML = `
    <h3 style="margin: 0; font-size: 20px; font-weight: 700;">3D Town Walk</h3>
    <p style="margin: 4px 0 0 0; font-size: 13px; opacity: 0.8;">Drag stick to move • Tap JUMP to hop</p>
  `;
  container.appendChild(header);

  const controlsRow = document.createElement("div");
  controlsRow.style.cssText = `
    width: 100%;
    max-width: 420px;
    display: flex;
    justify-content: space-around;
    align-items: center;
    margin-bottom: 24px;
  `;

  // Joystick Base
  const joyBase = document.createElement("div");
  joyBase.style.cssText = `
    position: relative;
    width: 130px;
    height: 130px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.15);
    border: 3px solid rgba(255, 255, 255, 0.35);
    box-shadow: 0 4px 16px rgba(0,0,0,0.3);
    display: flex;
    align-items: center;
    justify-content: center;
    touch-action: none;
  `;

  const joyKnob = document.createElement("div");
  joyKnob.style.cssText = `
    width: 52px;
    height: 52px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.9);
    box-shadow: 0 2px 8px rgba(0,0,0,0.4);
    transform: translate(0px, 0px);
    pointer-events: none;
  `;
  joyBase.appendChild(joyKnob);
  controlsRow.appendChild(joyBase);

  // Jump Button
  const jumpBtn = document.createElement("button");
  jumpBtn.style.cssText = `
    width: 100px;
    height: 100px;
    border-radius: 50%;
    background: linear-gradient(135deg, #3b82f6, #1d4ed8);
    border: 3px solid rgba(255, 255, 255, 0.5);
    color: white;
    font-size: 18px;
    font-weight: 800;
    box-shadow: 0 6px 16px rgba(29, 78, 216, 0.5);
    touch-action: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: transform 0.1s;
  `;
  jumpBtn.textContent = "JUMP";
  controlsRow.appendChild(jumpBtn);

  container.appendChild(controlsRow);
  surface.appendChild(container);

  // Pointer interactions for Joystick
  let activePointerId: number | null = null;
  let joyCenterX = 0;
  let joyCenterY = 0;
  const radius = 50;

  const updateJoystick = (clientX: number, clientY: number) => {
    const dx = clientX - joyCenterX;
    const dy = clientY - joyCenterY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    const clampedDist = Math.min(dist, radius);
    const angle = Math.atan2(dy, dx);

    const knobX = Math.cos(angle) * clampedDist;
    const knobY = Math.sin(angle) * clampedDist;

    joyKnob.style.transform = `translate(${knobX}px, ${knobY}px)`;

    joystickState.x = clampedDist > 5 ? knobX / radius : 0;
    joystickState.y = clampedDist > 5 ? knobY / radius : 0;
  };

  const onJoyPointerDown = (e: PointerEvent) => {
    if (activePointerId !== null) return;
    activePointerId = e.pointerId;
    joyBase.setPointerCapture(e.pointerId);

    const rect = joyBase.getBoundingClientRect();
    joyCenterX = rect.left + rect.width / 2;
    joyCenterY = rect.top + rect.height / 2;

    haptics.trigger("light");
    updateJoystick(e.clientX, e.clientY);
  };

  const onJoyPointerMove = (e: PointerEvent) => {
    if (e.pointerId === activePointerId) {
      updateJoystick(e.clientX, e.clientY);
    }
  };

  const onJoyPointerUp = (e: PointerEvent) => {
    if (e.pointerId === activePointerId) {
      activePointerId = null;
      joyKnob.style.transform = `translate(0px, 0px)`;
      joystickState.x = 0;
      joystickState.y = 0;
    }
  };

  joyBase.addEventListener("pointerdown", onJoyPointerDown);
  joyBase.addEventListener("pointermove", onJoyPointerMove);
  joyBase.addEventListener("pointerup", onJoyPointerUp);
  joyBase.addEventListener("pointercancel", onJoyPointerUp);

  // Jump Button interaction
  const onJumpDown = (e: PointerEvent) => {
    e.preventDefault();
    haptics.trigger("medium");
    joystickState.jump = true;
    jumpBtn.style.transform = "scale(0.92)";
  };

  const onJumpUp = (e: PointerEvent) => {
    e.preventDefault();
    joystickState.jump = false;
    jumpBtn.style.transform = "scale(1)";
  };

  jumpBtn.addEventListener("pointerdown", onJumpDown);
  jumpBtn.addEventListener("pointerup", onJumpUp);
  jumpBtn.addEventListener("pointercancel", onJumpUp);

  const sync = new InputStateSync(
    () => ctx.peerConnection,
    () => joystickState,
    30
  );
  sync.start();

  return {
    destroy: () => {
      sync.stop();
      haptics.destroy();
      surface.innerHTML = "";
    },
  };
}
