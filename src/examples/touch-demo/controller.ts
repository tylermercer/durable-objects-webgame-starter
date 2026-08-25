import type { PeerConnection, TouchMessage } from "../../scripts/peer-connection";

export interface ControllerContext {
  peerConnection: PeerConnection | null;
}

export function createGame(ctx: ControllerContext) {
  let pendingTouch: TouchMessage | null = null;
  let rafPending = false;

  function scheduleTouchSend() {
    if (rafPending) return;
    rafPending = true;

    requestAnimationFrame(() => {
      rafPending = false;
      if (pendingTouch && ctx.peerConnection) {
        ctx.peerConnection.sendInput(pendingTouch);
        pendingTouch = null;
      }
    });
  }

  const surface = document.getElementById("touch-surface");
  if (surface) {
    const handlePointer = (phase: "start" | "move" | "end" | "cancel", e: PointerEvent) => {
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
    };

    surface.addEventListener("pointerdown", e => handlePointer("start", e));
    surface.addEventListener("pointermove", e => {
      if (e.buttons > 0) handlePointer("move", e);
    });
    surface.addEventListener("pointerup", e => handlePointer("end", e));
    surface.addEventListener("pointercancel", e => handlePointer("cancel", e));
  }

  return {};
}
