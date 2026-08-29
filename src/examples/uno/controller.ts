import type { GameTransport } from "@transport/transport";
import type { ControllerGameInstance } from "@contract/gameTypes";
import { createRoot, type Root } from "react-dom/client";
import React from "react";
import { UnoController } from "./UnoController";

export interface ControllerContext {
  peerConnection: GameTransport | null;
  isFirstPlayer?: () => boolean;
}

export function createGame(ctx: ControllerContext): ControllerGameInstance {
  let root: Root | null = null;
  const surface = document.getElementById("touch-surface");

  if (surface) {
    surface.style.display = "block";
    const instructions = surface.querySelector(".touch-instructions");
    if (instructions) {
      (instructions as HTMLElement).style.display = "none";
    }
    root = createRoot(surface);
    root.render(React.createElement(UnoController, { ctx }));
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
