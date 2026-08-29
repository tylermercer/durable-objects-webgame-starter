import type { GameTransport } from "@transport/transport";
import type { ControllerGameInstance } from "@contract/gameTypes";
import { createRoot, type Root } from "react-dom/client";
import React from "react";
import { OthelloController } from "./OthelloController";

export interface ControllerContext {
  peerConnection: GameTransport | null;
  isFirstPlayer?: () => boolean;
}

export function createGame(ctx: ControllerContext): ControllerGameInstance {
  let root: Root | null = null;
  const surface = document.getElementById("touch-surface");

  if (surface && ctx.peerConnection) {
    surface.style.display = "block";
    const instructions = surface.querySelector(".touch-instructions");
    if (instructions) {
      (instructions as HTMLElement).style.display = "none";
    }
    root = createRoot(surface);
    root.render(React.createElement(OthelloController, { ctx }));
  }

  return {
    destroy: () => {
      root?.unmount();
      if (surface) {
        surface.innerHTML = "";
      }
    },
  };
}
