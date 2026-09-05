import { describe, it, expect, vi, beforeEach } from "vitest";
import { QRScannerController } from "./qrScannerController";

describe("QRScannerController", () => {
  let modalEl: HTMLDialogElement;
  let videoEl: HTMLVideoElement;
  let canvasEl: HTMLCanvasElement;
  let statusEl: HTMLElement;
  let closeBtnEl: HTMLElement;

  function createMockElement(tag: string) {
    const listeners: Record<string, Function[]> = {};
    return {
      tag,
      open: false,
      style: {},
      textContent: "",
      srcObject: null,
      showModal: vi.fn(function (this: any) {
        this.open = true;
      }),
      close: vi.fn(function (this: any) {
        this.open = false;
      }),
      play: vi.fn().mockResolvedValue(undefined),
      addEventListener: vi.fn((event: string, cb: Function) => {
        listeners[event] = listeners[event] || [];
        listeners[event].push(cb);
      }),
      triggerEvent: (event: string, payload?: any) => {
        for (const cb of listeners[event] || []) cb(payload);
      },
    } as any;
  }

  beforeEach(() => {
    modalEl = createMockElement("dialog");
    videoEl = createMockElement("video");
    canvasEl = createMockElement("canvas");
    statusEl = createMockElement("p");
    closeBtnEl = createMockElement("button");

    vi.stubGlobal("window", {
      location: {
        origin: "https://example.com",
        href: "https://example.com/",
      },
      requestAnimationFrame: vi.fn(),
      cancelAnimationFrame: vi.fn(),
    });
  });

  it("opens modal and starts media stream on start()", async () => {
    const mockTrack = { stop: vi.fn() };
    const mockStream = { getTracks: () => [mockTrack] } as unknown as MediaStream;

    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: vi.fn().mockResolvedValue(mockStream),
      },
    });

    const controller = new QRScannerController({
      modalEl,
      videoEl,
      canvasEl,
      statusEl,
      closeBtnEl,
    });

    await controller.start();

    expect(modalEl.showModal).toHaveBeenCalled();
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({
      video: { facingMode: "environment" },
    });
    expect(videoEl.srcObject).toBe(mockStream);

    controller.stop();
    expect(mockTrack.stop).toHaveBeenCalled();
    expect(modalEl.close).toHaveBeenCalled();
  });

  it("handles scanned code and invokes onSuccess callback for same-origin room URL", () => {
    modalEl.open = true;
    const onSuccess = vi.fn();
    const controller = new QRScannerController({
      modalEl,
      videoEl,
      canvasEl,
      statusEl,
      closeBtnEl,
      onSuccess,
    });

    const currentOrigin = "https://example.com";
    controller.handleScannedCode(`${currentOrigin}/play/input-demo?code=2A3B4`);

    expect(onSuccess).toHaveBeenCalledWith(`${currentOrigin}/play/input-demo?code=2A3B4`);
    expect(modalEl.close).toHaveBeenCalled();
  });

  it("displays error and does not call onSuccess for invalid or cross-origin URLs", () => {
    const onSuccess = vi.fn();
    const controller = new QRScannerController({
      modalEl,
      videoEl,
      canvasEl,
      statusEl,
      closeBtnEl,
      onSuccess,
    });

    controller.handleScannedCode("https://otherdomain.com/?code=12345");

    expect(onSuccess).not.toHaveBeenCalled();
    expect(statusEl.textContent).toBe("QR code is for a different site");
  });
});
