import type { RpcTarget } from "capnweb";

export type RTCSignal = { sdp?: RTCSessionDescriptionInit } | { candidate?: RTCIceCandidateInit };

export interface ConsoleCallbacks extends RpcTarget {
  onControllerJoined(id: string, name: string): void;
  onControllerLeft(id: string): void;
  onSignal(from: string, signal: RTCSignal): void;
  onFirstPlayerChanged(id: string | null): void;
}

export interface ControllerCallbacks extends RpcTarget {
  onConsoleReady(): void;
  onConsoleGone(): void;
  onSignal(signal: RTCSignal): void;
  onFirstPlayerChanged(id: string | null): void;
}

// Exposed by the DO when role=console.
export interface ConsoleApi extends RpcTarget {
  join(
    callbacks: ConsoleCallbacks,
    consoleToken?: string
  ):
    | { controllers: { id: string; name: string }[]; firstPlayerId: string | null; consoleToken: string }
    | Promise<{ controllers: { id: string; name: string }[]; firstPlayerId: string | null; consoleToken: string }>;
  sendSignal(to: string, signal: RTCSignal): void;
  saveGameState(state: unknown): void;
  loadGameState(): unknown | Promise<unknown>;
}

// Exposed by the DO when role=controller.
export interface ControllerApi extends RpcTarget {
  join(
    callbacks: ControllerCallbacks,
    rejoinToken?: string
  ):
    | { id: string; name: string; consoleConnected: boolean; rejoinToken: string; isFirstPlayer: boolean }
    | Promise<{ id: string; name: string; consoleConnected: boolean; rejoinToken: string; isFirstPlayer: boolean }>;
  sendSignal(signal: RTCSignal): void; // implicitly addressed to the room's console
}
