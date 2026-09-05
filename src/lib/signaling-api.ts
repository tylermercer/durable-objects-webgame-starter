import type { RpcTarget } from "capnweb";

export type RTCSignal = { sdp?: RTCSessionDescriptionInit } | { candidate?: RTCIceCandidateInit };

export interface ConsoleCallbacks extends RpcTarget {
  onControllerJoined(id: string, name: string): void;
  onControllerLeft(id: string): void;
  onControllerDisconnected(id: string): void;
  onControllerRejoined(id: string): void;
  onSignal(from: string, signal: RTCSignal): void;
  onFirstPlayerChanged(id: string | null): void;
  onControllerRenamed(id: string, name: string): void;
  onRelayInput(from: string, payload: unknown): void;
  onRelayControl(from: string, payload: unknown): void;
}

export interface ControllerCallbacks extends RpcTarget {
  onConsoleReady(): void;
  onConsoleGone(): void;
  onKicked(): void;
  onSignal(signal: RTCSignal): void;
  onFirstPlayerChanged(id: string | null): void;
  onRelayInput(payload: unknown): void;
  onRelayControl(payload: unknown): void;
}

// Exposed by the DO when role=console.
export interface ConsoleApi extends RpcTarget {
  join(
    callbacks: ConsoleCallbacks,
    consoleToken?: string,
    gracePeriodMs?: number,
    phoneMax?: number
  ):
    | { controllers: { id: string; name: string }[]; firstPlayerId: string | null; consoleToken: string }
    | Promise<{ controllers: { id: string; name: string }[]; firstPlayerId: string | null; consoleToken: string }>;
  kickController(id: string): void | Promise<void>;
  sendSignal(to: string, signal: RTCSignal): void;
  relayInput(to: string, payload: unknown): void;
  relayControl(to: string, payload: unknown): void;
}

// Exposed by the DO when role=controller.
export interface ControllerApi extends RpcTarget {
  join(
    callbacks: ControllerCallbacks,
    rejoinToken?: string,
    name?: string
  ):
    | { id: string; name: string; consoleConnected: boolean; rejoinToken: string; isFirstPlayer: boolean }
    | Promise<{ id: string; name: string; consoleConnected: boolean; rejoinToken: string; isFirstPlayer: boolean }>;
  sendSignal(signal: RTCSignal): void; // implicitly addressed to the room's console
  relayInput(payload: unknown): void;
  relayControl(payload: unknown): void;
}
