import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createVirtualGamepad } from "./VirtualGamepad";

describe("VirtualGamepad", () => {
  beforeEach(() => {
    const createMockElem = (tag: string) => {
      const children: any[] = [];
      const listeners: Record<string, Function> = {};
      const classList = new Set<string>();
      const elem: any = {
        tagName: tag.toUpperCase(),
        type: "",
        textContent: "",
        className: "",
        style: {},
        children,
        appendChild: (child: any) => {
          children.push(child);
          return child;
        },
        querySelectorAll: (sel: string) => {
          const results: any[] = [];
          const collect = (node: any) => {
            if (node.tagName?.toLowerCase() === sel) results.push(node);
            for (const c of node.children || []) collect(c);
          };
          collect(elem);
          return results;
        },
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
        setAttribute: vi.fn(),
        click: vi.fn(),
        addEventListener: (evt: string, cb: Function) => {
          listeners[evt] = cb;
        },
        removeEventListener: vi.fn(),
        setPointerCapture: vi.fn(),
        dispatchEvent: (e: any) => {
          if (listeners[e.type]) listeners[e.type](e);
        },
        remove: () => {},
      };
      return elem;
    };

    const bodyElem = createMockElem("body");
    vi.stubGlobal("document", {
      createElement: (tag: string) => createMockElem(tag),
      getElementById: () => null,
      querySelector: () => null,
      body: bodyElem,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders joystick and configured action buttons and sends input state", () => {
    const container = document.createElement("div");
    const sentInputs: any[] = [];
    const mockTransport: any = {
      sendInput: (msg: any) => sentInputs.push(msg),
    };

    const gamepad = createVirtualGamepad({
      container,
      peerConnection: mockTransport,
      buttonLabels: ["FIRE", "BOOST"],
      title: "Test Gamepad",
    });

    expect(container.children.length).toBe(1);
    const wrapper = container.children[0];
    expect(wrapper.className).toBe("virtual-gamepad");

    const buttons = container.querySelectorAll("button");
    expect(buttons.length).toBe(2);
    expect(buttons[0].textContent).toBe("FIRE");
    expect(buttons[1].textContent).toBe("BOOST");

    // Simulate button press
    const fireBtn = buttons[0];
    fireBtn.dispatchEvent({ type: "pointerdown", pointerId: 1, preventDefault: vi.fn() });

    expect(sentInputs.length).toBeGreaterThan(0);
    const btnMsg = sentInputs.find((m) => m.type === "gamepad-button");
    expect(btnMsg).toBeDefined();
    expect(btnMsg.buttonLabel).toBe("FIRE");
    expect(btnMsg.pressed).toBe(true);

    gamepad.destroy();
  });
});
