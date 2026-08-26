import type { PeerConnection } from "../../scripts/peer-connection";
import type { ControllerGameInstance } from "../../scripts/gameTypes";
import { createRoot, type Root } from "react-dom/client";
import React from "react";
import { LiarsDiceController } from "./LiarsDiceController";

export interface ControllerContext {
  peerConnection: PeerConnection | null;
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
    root.render(React.createElement(LiarsDiceController, { ctx }));
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
