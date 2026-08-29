import type { GameTransport } from "@transport/transport";

export interface ControllerContext {
  peerConnection: GameTransport | null;
}

export function createGame(_ctx: ControllerContext) {
  // Implement your custom controller game logic here.
  // See src/examples/ for reference implementations and README.md for transition steps.
  return {};
}
