import type { GameTransport } from "@transport/transport";
import { WebHaptics } from "web-haptics";

export interface VirtualGamepadOptions {
  container: HTMLElement;
  peerConnection: GameTransport | null;
  buttonLabels?: string[];
  title?: string;
  description?: string;
}

export interface VirtualGamepadInstance {
  destroy: () => void;
}

export function createVirtualGamepad(options: VirtualGamepadOptions): VirtualGamepadInstance {
  const haptics = new WebHaptics();
  const rawButtonLabels = options.buttonLabels ?? ["FIRE", "BOOST"];
  const buttonLabels = rawButtonLabels.slice(0, 2);

  const wrapper = document.createElement("div");
  wrapper.className = "virtual-gamepad";
  wrapper.style.cssText = `
    position: relative;
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    align-items: center;
    box-sizing: border-box;
    padding: 16px;
    user-select: none;
    -webkit-user-select: none;
    touch-action: none;
    background: radial-gradient(circle at center, #1e2436 0%, #0f121d 100%);
    color: #ffffff;
    font-family: system-ui, -apple-system, sans-serif;
    overflow: hidden;
  `;

  const header = document.createElement("div");
  header.style.cssText = `
    text-align: center;
    pointer-events: none;
    margin-top: 8px;
  `;
  const titleEl = document.createElement("h3");
  titleEl.textContent = options.title ?? "Virtual Gamepad";
  titleEl.style.cssText = "margin: 0 0 4px 0; font-size: 18px; font-weight: 700; color: #f1f5f9;";
  header.appendChild(titleEl);

  const descEl = document.createElement("p");
  descEl.textContent = options.description ?? "Use joystick and buttons to play";
  descEl.style.cssText = "margin: 0; font-size: 12px; opacity: 0.75;";
  header.appendChild(descEl);
  wrapper.appendChild(header);

  const controlsArea = document.createElement("div");
  controlsArea.style.cssText = `
    width: 100%;
    flex: 1;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 16px;
    box-sizing: border-box;
    padding: 12px 16px;
  `;
  wrapper.appendChild(controlsArea);

  // --- Joystick ---
  const joystickBase = document.createElement("div");
  joystickBase.className = "virtual-joystick-base";
  joystickBase.style.cssText = `
    position: relative;
    width: 130px;
    height: 130px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.08);
    border: 3px solid rgba(255, 255, 255, 0.2);
    box-shadow: inset 0 0 15px rgba(0, 0, 0, 0.5);
    display: flex;
    justify-content: center;
    align-items: center;
    touch-action: none;
  `;

  const joystickKnob = document.createElement("div");
  joystickKnob.className = "virtual-joystick-knob";
  joystickKnob.style.cssText = `
    width: 54px;
    height: 54px;
    border-radius: 50%;
    background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%);
    border: 2px solid #60a5fa;
    box-shadow: 0 4px 10px rgba(0,0,0,0.4);
    transform: translate(0px, 0px);
    transition: transform 0.05s ease-out;
    pointer-events: none;
  `;
  joystickBase.appendChild(joystickKnob);
  controlsArea.appendChild(joystickBase);

  // --- Buttons Area ---
  const buttonsArea = document.createElement("div");
  buttonsArea.className = "virtual-buttons-area";
  buttonsArea.style.cssText = `
    display: flex;
    flex-direction: ${buttonLabels.length === 2 ? "column" : "row"};
    gap: 16px;
    align-items: center;
    justify-content: center;
  `;
  controlsArea.appendChild(buttonsArea);

  let activeX = 0;
  let activeY = 0;
  const buttonStates: boolean[] = buttonLabels.map(() => false);
  const buttonElements: HTMLButtonElement[] = [];

  let activePointerId: number | null = null;

  function sendJoystickState() {
    if (!options.peerConnection) return;
    options.peerConnection.sendInput({
      type: "joystick",
      x: activeX,
      y: activeY,
      t: performance.now(),
    });
  }

  function sendButtonsState() {
    if (!options.peerConnection) return;
    const buttonsObj: Record<string, number> = {};
    buttonLabels.forEach((label, idx) => {
      buttonsObj[label] = buttonStates[idx] ? 1 : 0;
    });
    options.peerConnection.sendInput({
      type: "buttons",
      buttons: buttonsObj,
      t: performance.now(),
    });
  }

  function updateJoystickFromPointer(e: PointerEvent) {
    const rect = joystickBase.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    let dx = e.clientX - centerX;
    let dy = e.clientY - centerY;
    const maxRadius = rect.width / 2;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > maxRadius) {
      dx = (dx / dist) * maxRadius;
      dy = (dy / dist) * maxRadius;
    }

    const clampedDist = Math.min(dist, maxRadius);
    joystickKnob.style.transform = `translate(${dx}px, ${dy}px)`;

    const deadzone = 8;
    if (clampedDist < deadzone) {
      activeX = 0;
      activeY = 0;
    } else {
      activeX = dx / maxRadius;
      activeY = dy / maxRadius;
    }

    sendJoystickState();
  }

  const onJoystickDown = (e: PointerEvent) => {
    e.preventDefault();
    activePointerId = e.pointerId;
    joystickBase.setPointerCapture(e.pointerId);
    try { Promise.resolve(haptics.trigger("light")).catch(() => {}); } catch {}
    updateJoystickFromPointer(e);
  };

  const onJoystickMove = (e: PointerEvent) => {
    if (activePointerId === e.pointerId) {
      e.preventDefault();
      updateJoystickFromPointer(e);
    }
  };

  const onJoystickUp = (e: PointerEvent) => {
    if (activePointerId === e.pointerId) {
      e.preventDefault();
      activePointerId = null;
      activeX = 0;
      activeY = 0;
      joystickKnob.style.transform = "translate(0px, 0px)";
      sendJoystickState();
    }
  };

  joystickBase.addEventListener("pointerdown", onJoystickDown);
  joystickBase.addEventListener("pointermove", onJoystickMove);
  joystickBase.addEventListener("pointerup", onJoystickUp);
  joystickBase.addEventListener("pointercancel", onJoystickUp);

  // Render Action Buttons (up to 2)
  buttonLabels.forEach((label, idx) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = label;
    btn.style.cssText = `
      width: 76px;
      height: 76px;
      border-radius: 50%;
      background: linear-gradient(135deg, #10b981 0%, #047857 100%);
      border: 3px solid #34d399;
      color: #ffffff;
      font-weight: 800;
      font-size: 13px;
      letter-spacing: 0.5px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
      display: flex;
      justify-content: center;
      align-items: center;
      text-transform: uppercase;
      cursor: pointer;
      touch-action: none;
      outline: none;
      transition: transform 0.08s ease, background 0.08s ease;
    `;

    if (idx === 1 && buttonLabels.length === 2) {
      btn.style.background = "linear-gradient(135deg, #f59e0b 0%, #b45309 100%)";
      btn.style.borderColor = "#fbbf24";
    }

    const setPressed = (pressed: boolean, e?: PointerEvent) => {
      if (e) e.preventDefault();
      if (buttonStates[idx] !== pressed) {
        buttonStates[idx] = pressed;
        if (pressed) {
          btn.style.transform = "scale(0.92)";
          btn.style.filter = "brightness(1.2)";
          try { Promise.resolve(haptics.trigger("medium")).catch(() => {}); } catch {}
        } else {
          btn.style.transform = "scale(1.0)";
          btn.style.filter = "none";
        }

        sendButtonsState();
      }
    };

    const onBtnDown = (e: PointerEvent) => {
      btn.setPointerCapture(e.pointerId);
      setPressed(true, e);
    };

    const onBtnUp = (e: PointerEvent) => {
      setPressed(false, e);
    };

    btn.addEventListener("pointerdown", onBtnDown);
    btn.addEventListener("pointerup", onBtnUp);
    btn.addEventListener("pointercancel", onBtnUp);

    buttonElements.push(btn);
    buttonsArea.appendChild(btn);
  });

  options.container.appendChild(wrapper);

  return {
    destroy: () => {
      haptics.destroy();
      joystickBase.removeEventListener("pointerdown", onJoystickDown);
      joystickBase.removeEventListener("pointermove", onJoystickMove);
      joystickBase.removeEventListener("pointerup", onJoystickUp);
      joystickBase.removeEventListener("pointercancel", onJoystickUp);
      wrapper.remove();
    },
  };
}
