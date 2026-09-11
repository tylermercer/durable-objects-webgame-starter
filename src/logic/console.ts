import type { ConsoleContext, ConsoleGameInstance, ControllerPeer, ConsoleStorage } from "@contract/gameTypes";

export type { ConsoleContext, ConsoleGameInstance, ControllerPeer, ConsoleStorage };

export function createGame(_ctx: ConsoleContext): ConsoleGameInstance {
  // Implement your custom console game logic here.
  // See src/examples/ for reference implementations and README.md for transition steps.
  return {
    tick: (_dt: number) => {},
    render: (_alpha: number) => {}
  };
}
