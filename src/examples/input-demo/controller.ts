import type { GameTransport, TouchMessage } from "@transport/transport";
import type { ControllerGameInstance } from "@contract/gameTypes";
import { WebHaptics } from "web-haptics";

export interface ControllerContext {
  peerConnection: GameTransport | null;
  isFirstPlayer?: () => boolean;
}

export function createGame(ctx: ControllerContext): ControllerGameInstance {
  const haptics = new WebHaptics();
  let pendingTouch: TouchMessage | null = null;
  let rafPending = false;
  let rafId: number | null = null;

  function scheduleTouchSend() {
    if (rafPending) return;
    rafPending = true;

    rafId = requestAnimationFrame(() => {
      rafPending = false;
      rafId = null;
      if (pendingTouch && ctx.peerConnection) {
        ctx.peerConnection.sendInput(pendingTouch);
        pendingTouch = null;
      }
    });
  }

  const surface = document.getElementById("touch-surface");
  if (surface) {
    surface.innerHTML = `
      <div style="pointer-events: none; position: absolute; top: 16px; left: 16px; right: 16px; text-align: center; color: rgba(255, 255, 255, 0.7); font-family: sans-serif;">
        <h3 style="margin: 0 0 4px 0; font-size: 16px; font-weight: 600;">Input Demo</h3>
        <p style="margin: 0; font-size: 12px; opacity: 0.8;">Touch anywhere on screen to send position to console</p>
      </div>
    `;
    surface.style.position = "relative";
  }

  const onPointerDown = (e: PointerEvent) => handlePointer("start", e);
  const onPointerMove = (e: PointerEvent) => {
    if (e.buttons > 0) handlePointer("move", e);
  };
  const onPointerUp = (e: PointerEvent) => handlePointer("end", e);
  const onPointerCancel = (e: PointerEvent) => handlePointer("cancel", e);

  function handlePointer(phase: "start" | "move" | "end" | "cancel", e: PointerEvent) {
    if (!surface) return;
    e.preventDefault();

    if (phase === "start") {
      haptics.trigger("light");
    }
    const rect = surface.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));

    pendingTouch = {
      type: "touch",
      phase,
      pointerId: e.pointerId,
      x,
      y,
      t: performance.now()
    };

    scheduleTouchSend();
  }

  if (surface) {
    surface.addEventListener("pointerdown", onPointerDown);
    surface.addEventListener("pointermove", onPointerMove);
    surface.addEventListener("pointerup", onPointerUp);
    surface.addEventListener("pointercancel", onPointerCancel);
  }

  return {
    destroy: () => {
      haptics.destroy();
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
      if (surface) {
        surface.innerHTML = "";
        surface.removeEventListener("pointerdown", onPointerDown);
        surface.removeEventListener("pointermove", onPointerMove);
        surface.removeEventListener("pointerup", onPointerUp);
        surface.removeEventListener("pointercancel", onPointerCancel);
      }
    }
  };
}
