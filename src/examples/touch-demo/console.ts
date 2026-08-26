import type { PeerConnection, TouchMessage } from "../../scripts/peer-connection";
import type { ConsoleGameInstance } from "../../scripts/gameTypes";
import type { RpcStub } from "capnweb";
import type { ConsoleApi } from "../../lib/signaling-api";

export interface ControllerPeer {
  id: string;
  name: string;
  color: string;
  isFirstPlayer?: boolean;
  pc: PeerConnection | null;
  state: string;
  lastTouch?: TouchMessage;
}

export interface ConsoleContext {
  session: RpcStub<ConsoleApi> | null;
  peers: Map<string, ControllerPeer>;
}

export function createGame(ctx: ConsoleContext): ConsoleGameInstance {
  const canvas = document.getElementById("touch-canvas") as HTMLCanvasElement | null;
  const ctx2d = canvas?.getContext("2d") || null;

  function resizeCanvas() {
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      canvas.width = rect.width * window.devicePixelRatio;
      canvas.height = rect.height * window.devicePixelRatio;
    }
  }

  if (typeof window !== "undefined" && canvas) {
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
  }

  return {
    tick: (_dt: number) => {},
    render: (_alpha: number) => {
      if (!ctx2d || !canvas) return;
      ctx2d.clearRect(0, 0, canvas.width, canvas.height);

      for (const controller of ctx.peers.values()) {
        if (
          controller.lastTouch &&
          controller.lastTouch.phase !== "end" &&
          controller.lastTouch.phase !== "cancel"
        ) {
          const x = controller.lastTouch.x * canvas.width;
          const y = controller.lastTouch.y * canvas.height;

          ctx2d.beginPath();
          ctx2d.arc(x, y, 20 * window.devicePixelRatio, 0, Math.PI * 2);
          ctx2d.fillStyle = controller.color;
          ctx2d.globalAlpha = 0.7;
          ctx2d.fill();

          ctx2d.beginPath();
          ctx2d.arc(x, y, 35 * window.devicePixelRatio, 0, Math.PI * 2);
          ctx2d.strokeStyle = controller.color;
          ctx2d.globalAlpha = 0.4;
          ctx2d.lineWidth = 3 * window.devicePixelRatio;
          ctx2d.stroke();

          ctx2d.globalAlpha = 1.0;
          ctx2d.fillStyle = "#ffffff";
          ctx2d.font = `${14 * window.devicePixelRatio}px sans-serif`;
          ctx2d.textAlign = "center";
          ctx2d.fillText(controller.name, x, y - 25 * window.devicePixelRatio);
        }
      }
    },
    destroy: () => {
      if (typeof window !== "undefined") {
        window.removeEventListener("resize", resizeCanvas);
      }
    }
  };
}
