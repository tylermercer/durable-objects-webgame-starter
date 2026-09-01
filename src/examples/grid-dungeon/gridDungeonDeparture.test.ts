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
} {
  const container = {
    appendChild: vi.fn(),
    innerHTML: "",
  } as unknown as HTMLDivElement;

  // Mock canvas element if created
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

  const ctx: ConsoleContext = {
    peers,
    session: null,
    viewport: {
      container,
      initialSize: { width: 800, height: 600 },
      onResize: () => () => {},
    },
  };

  return { ctx, peers };
}

describe("Grid Dungeon Player Departure", () => {
  it("removes player entity from registry when peer departs", () => {
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
      // Create minimal document object if running in node environment without DOM
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

    const { ctx, peers } = createMockConsoleContext();

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

    // Remove p1 from ctx.peers (player departure)
    peers.delete("p1");

    // Second tick triggers diffDepartedPeers and registry.remove("p1")
    game.tick?.(1 / 60);

    game.destroy?.();
  });
});
