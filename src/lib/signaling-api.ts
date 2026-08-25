import type { RpcTarget } from "capnweb";

export type RTCSignal = { sdp?: RTCSessionDescriptionInit } | { candidate?: RTCIceCandidateInit };

export interface ConsoleCallbacks extends RpcTarget {
  onControllerJoined(id: string, name: string): void;
  onControllerLeft(id: string): void;
  onSignal(from: string, signal: RTCSignal): void;
}

export interface ControllerCallbacks extends RpcTarget {
  onConsoleReady(): void;
  onConsoleGone(): void;
  onSignal(signal: RTCSignal): void;
}

// Exposed by the DO when role=console.
export interface ConsoleApi extends RpcTarget {
  join(callbacks: ConsoleCallbacks): { controllers: { id: string; name: string }[] } | Promise<{ controllers: { id: string; name: string }[] }>;
  sendSignal(to: string, signal: RTCSignal): void;
}

// Exposed by the DO when role=controller.
export interface ControllerApi extends RpcTarget {
  join(callbacks: ControllerCallbacks): { id: string; name: string; consoleConnected: boolean } | Promise<{ id: string; name: string; consoleConnected: boolean }>;
  sendSignal(signal: RTCSignal): void; // implicitly addressed to the room's console
}
