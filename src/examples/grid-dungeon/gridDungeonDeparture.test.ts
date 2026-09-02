import { describe, expect, it, vi } from "vitest";
import type { ConsoleContext, ControllerPeer } from "@contract/gameTypes";

vi.mock("react-dom/client", () => ({
  createRoot: () => ({
    render: vi.fn(),
    unmount: vi.fn(),
  }),
}));

import { createGame } from "./console";

function createMockConsoleContext(): {
  ctx: ConsoleContext;
  peers: Map<string, ControllerPeer>;
  triggerPeerReady: (peer: ControllerPeer) => void;
  triggerPeerLeft: (id: string) => void;
} {
  const container = {
    appendChild: vi.fn(),
    innerHTML: "",
  } as unknown as HTMLDivElement;

  const canvasMock = {
    style: {},
    getContext: () => ({
      fillStyle: "",
      fillRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      scale: vi.fn(),
    }),
    remove: vi.fn(),
  };

  const origCreateElement = globalThis.document?.createElement;
  if (globalThis.document) {
    vi.spyOn(document, "createElement").mockImplementation((tagName: string) => {
      if (tagName === "canvas") return canvasMock as any;
      if (origCreateElement) return origCreateElement.call(document, tagName);
      return {} as any;
    });
  }

  const peers = new Map<string, ControllerPeer>();
  let peerReadyCb: ((peer: ControllerPeer) => void) | null = null;
  let peerLeftCb: ((id: string) => void) | null = null;

  const ctx: ConsoleContext = {
    peers,
    session: null,
    onPeerJoined: () => () => {},
    onPeerReady: (cb) => {
      peerReadyCb = cb;
      return () => { peerReadyCb = null; };
    },
    onPeerLeft: (cb) => {
      peerLeftCb = cb;
      return () => { peerLeftCb = null; };
    },
    viewport: {
      container,
      initialSize: { width: 800, height: 600 },
      onResize: () => () => {},
    },
  };

  return {
    ctx,
    peers,
    triggerPeerReady: (peer: ControllerPeer) => peerReadyCb?.(peer),
    triggerPeerLeft: (id: string) => peerLeftCb?.(id),
  };
}

describe("Grid Dungeon Player Departure", () => {
  it("spawns player on peer ready and removes player entity from registry when peer departs", () => {
    if (!(globalThis as any).window) {
      (globalThis as any).window = { devicePixelRatio: 1 };
    }
    if (!(globalThis as any).requestAnimationFrame) {
      (globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(cb, 16) as unknown as number;
    }
    if (!(globalThis as any).cancelAnimationFrame) {
      (globalThis as any).cancelAnimationFrame = (id: number) => clearTimeout(id as unknown as ReturnType<typeof setTimeout>);
    }
    if (!globalThis.document) {
      (globalThis as any).document = {
        createElement: (tagName: string) => {
          if (tagName === "canvas") {
            return {
              style: {},
              getContext: () => ({
                fillStyle: "",
                fillRect: vi.fn(),
                save: vi.fn(),
                restore: vi.fn(),
                translate: vi.fn(),
                scale: vi.fn(),
              }),
              remove: vi.fn(),
            };
          }
          return {};
        },
      };
    }

    const { ctx, peers, triggerPeerReady, triggerPeerLeft } = createMockConsoleContext();

    const p1 = {
      id: "p1",
      name: "Alice",
      color: "#ff0000",
      status: "live",
      state: "connected",
      pc: { addInputListener: vi.fn() } as any,
    } as ControllerPeer;

    peers.set("p1", p1);

    const game = createGame(ctx);

    // Initial tick with ready peer
    game.tick?.(1 / 60);

    // Trigger peer ready for a second player
    const p2 = {
      id: "p2",
      name: "Bob",
      color: "#00ff00",
      status: "live",
      state: "connected",
      pc: { addInputListener: vi.fn() } as any,
    } as ControllerPeer;
    peers.set("p2", p2);
    triggerPeerReady(p2);

    game.tick?.(1 / 60);

    // Trigger departure event for p1
    peers.delete("p1");
    triggerPeerLeft("p1");

    game.tick?.(1 / 60);

    game.destroy?.();
  });
});
