import type { PeerConnection, TouchMessage } from "../../scripts/peer-connection";
import type { ControllerGameInstance } from "../../scripts/gameTypes";

export interface ControllerContext {
  peerConnection: PeerConnection | null;
  isFirstPlayer?: () => boolean;
}

export function createGame(ctx: ControllerContext): ControllerGameInstance {
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
  const onPointerDown = (e: PointerEvent) => handlePointer("start", e);
  const onPointerMove = (e: PointerEvent) => {
    if (e.buttons > 0) handlePointer("move", e);
  };
  const onPointerUp = (e: PointerEvent) => handlePointer("end", e);
  const onPointerCancel = (e: PointerEvent) => handlePointer("cancel", e);

  function handlePointer(phase: "start" | "move" | "end" | "cancel", e: PointerEvent) {
    if (!surface) return;
    e.preventDefault();
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
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
      if (surface) {
        surface.removeEventListener("pointerdown", onPointerDown);
        surface.removeEventListener("pointermove", onPointerMove);
        surface.removeEventListener("pointerup", onPointerUp);
        surface.removeEventListener("pointercancel", onPointerCancel);
      }
    }
  };
}
