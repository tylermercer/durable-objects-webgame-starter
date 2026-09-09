import type { GameTransport } from "@transport/transport";
import type { ControllerGameInstance } from "@contract/gameTypes";
import { createVirtualGamepad, type VirtualGamepadInstance } from "@components/VirtualGamepad";

export interface ControllerContext {
  peerConnection: GameTransport | null;
  isFirstPlayer?: () => boolean;
}

export function createGame(ctx: ControllerContext): ControllerGameInstance {
  const surface = document.getElementById("touch-surface");
  let gamepadInstance: VirtualGamepadInstance | null = null;

  if (surface) {
    surface.innerHTML = "";
    gamepadInstance = createVirtualGamepad({
      container: surface,
      peerConnection: ctx.peerConnection,
      buttonLabels: ["FIRE", "BOOST"],
      title: "Input Demo",
      description: "Touch controls or virtual gamepad",
    });
  }

  return {
    destroy: () => {
      gamepadInstance?.destroy();
      if (surface) {
        surface.innerHTML = "";
      }
    },
  };
}
