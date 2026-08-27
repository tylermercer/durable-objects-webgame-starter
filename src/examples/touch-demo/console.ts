import type { ConsoleContext, ConsoleGameInstance } from "@contract/gameTypes";

export function createGame(ctx: ConsoleContext): ConsoleGameInstance {
  const canvas = document.createElement("canvas");
  canvas.style.display = "block";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  ctx.viewport.container.appendChild(canvas);

  const ctx2d = canvas.getContext("2d");

  function resizeCanvas(size: { width: number; height: number }) {
    if (size.width > 0 && size.height > 0) {
      canvas.width = size.width * window.devicePixelRatio;
      canvas.height = size.height * window.devicePixelRatio;
    }
  }

  resizeCanvas(ctx.viewport.initialSize);
  const unsubscribeResize = ctx.viewport.onResize(resizeCanvas);

  return {
    tick: (_dt: number) => {},
    render: (_alpha: number) => {
      if (!ctx2d) return;
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
      unsubscribeResize();
      canvas.remove();
    }
  };
}
