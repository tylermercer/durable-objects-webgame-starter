import type { PeerConnection } from "@transport/peer-connection";

export interface ControllerContext {
  peerConnection: PeerConnection | null;
}

export function createGame(_ctx: ControllerContext) {
  // Implement your custom controller game logic here.
  // See src/examples/ for reference implementations and README.md for transition steps.
  return {};
}
