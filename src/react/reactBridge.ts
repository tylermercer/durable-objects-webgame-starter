import { useEffect } from "react";
import type { GameTransport, ControlMessage } from "@transport/transport";

export function usePeerControlMessage(
  pc: GameTransport | null,
  handler: (msg: ControlMessage) => void
) {
  useEffect(() => {
    if (!pc) return;
    return pc.addControlListener(handler);
  }, [pc, handler]);
}
