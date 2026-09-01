import type { RpcStub } from "capnweb";
import type { ConsoleApi } from "../lib/signaling-api";
import type { GameTransport, TouchMessage } from "@transport/transport";

export interface ViewportSize {
  width: number;
  height: number;
}

export interface GameViewport {
  /**
   * Empty element this game exclusively owns for the duration of its
   * createGame() call. Append canvases, mount React roots, set innerHTML —
   * whatever the game needs. Must be emptied/unmounted in destroy().
   */
  container: HTMLElement;
  /** Size of `container`, in CSS pixels, at the moment createGame() ran. */
  initialSize: ViewportSize;
  /**
   * Subscribe to later size changes (window resize, orientation change,
   * top bar height changing, etc). Returns an unsubscribe function — call
   * it from the game's destroy().
   */
  onResize: (callback: (size: ViewportSize) => void) => () => void;
}

export interface ControllerPeer {
  id: string;
  name: string;
  color: string;
  isFirstPlayer?: boolean;
  pc: GameTransport | null;
  state: string;
  status?: string;
  lastTouch?: TouchMessage;
}

export interface ConsoleContext {
  session: RpcStub<ConsoleApi> | null;
  peers: Map<string, ControllerPeer>;
  viewport: GameViewport;
  onPeerJoined?: (cb: (peer: ControllerPeer) => void) => () => void;
  onPeerLeft?: (cb: (id: string) => void) => () => void;
}

export interface ConsoleGameInstance {
  tick?: (dt: number) => void;
  render?: (alpha: number) => void;
  destroy?: () => void;
}

export interface ControllerGameInstance {
  destroy?: () => void;
}

export interface ConsoleGameModule {
  createGame(ctx: ConsoleContext): ConsoleGameInstance;
  maxPlayers?: number;
}

export interface ControllerGameModule {
  createGame(ctx: { peerConnection: GameTransport | null; isFirstPlayer: () => boolean }): ControllerGameInstance;
}
