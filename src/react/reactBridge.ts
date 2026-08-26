import { useEffect } from "react";
import type { PeerConnection, ControlMessage } from "@transport/peer-connection";

export function usePeerControlMessage(
  pc: PeerConnection | null,
  handler: (msg: ControlMessage) => void
) {
  useEffect(() => {
    if (!pc) return;
    return pc.addControlListener(handler);
  }, [pc, handler]);
}
