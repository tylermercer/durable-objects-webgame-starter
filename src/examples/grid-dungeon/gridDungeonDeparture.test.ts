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
  let peerLeftCb: ((id: string) => void) | null = null;

  const ctx: ConsoleContext = {
    peers,
    session: null,
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
    triggerPeerLeft: (id: string) => peerLeftCb?.(id),
  };
}

describe("Grid Dungeon Player Departure", () => {
  it("removes player entity from registry when peer departs via event or polling", () => {
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

    const { ctx, peers, triggerPeerLeft } = createMockConsoleContext();

    peers.set("p1", {
      id: "p1",
      name: "Alice",
      color: "#ff0000",
      status: "live",
      state: "connected",
    } as ControllerPeer);

    const game = createGame(ctx);

    // Initial tick to register p1
    game.tick?.(1 / 60);

    // Trigger departure event
    peers.delete("p1");
    triggerPeerLeft("p1");

    game.tick?.(1 / 60);

    game.destroy?.();
  });
});
