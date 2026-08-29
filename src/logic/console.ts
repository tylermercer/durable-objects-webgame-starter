import type { GameTransport, TouchMessage } from "@transport/transport";
import type { RpcStub } from "capnweb";
import type { ConsoleApi } from "../lib/signaling-api";

export interface ControllerPeer {
  id: string;
  name: string;
  color: string;
  pc: GameTransport | null;
  state: string;
  lastTouch?: TouchMessage;
}

export interface ConsoleContext {
  session: RpcStub<ConsoleApi> | null;
  peers: Map<string, ControllerPeer>;
}

export function createGame(_ctx: ConsoleContext) {
  // Implement your custom console game logic here.
  // See src/examples/ for reference implementations and README.md for transition steps.
  return {
    tick: (_dt: number) => {},
    render: (_alpha: number) => {}
  };
}
