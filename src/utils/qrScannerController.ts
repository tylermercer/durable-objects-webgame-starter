import jsQR from "jsqr";
import { parseAndValidateJoinUrl } from "./qrScan";
import { createLogger } from "./logger";

const logger = createLogger("QRScannerController");

export interface QRScannerControllerOptions {
  modalEl: HTMLDialogElement;
  videoEl: HTMLVideoElement;
  canvasEl: HTMLCanvasElement;
  statusEl: HTMLElement;
  closeBtnEl: HTMLElement;
  onSuccess?: (targetUrl: string) => void;
}

export class QRScannerController {
  private modalEl: HTMLDialogElement;
  private videoEl: HTMLVideoElement;
  private canvasEl: HTMLCanvasElement;
  private statusEl: HTMLElement;
  private closeBtnEl: HTMLElement;
  private onSuccess?: (targetUrl: string) => void;

  private stream: MediaStream | null = null;
  private animationFrameId: number | null = null;
  private isScanning: boolean = false;

  constructor(options: QRScannerControllerOptions) {
    this.modalEl = options.modalEl;
    this.videoEl = options.videoEl;
    this.canvasEl = options.canvasEl;
    this.statusEl = options.statusEl;
    this.closeBtnEl = options.closeBtnEl;
    this.onSuccess = options.onSuccess;

    this.setupListeners();
  }

  private setupListeners() {
    this.closeBtnEl.addEventListener("click", () => {
      this.stop();
    });

    this.modalEl.addEventListener("click", (e) => {
      if (e.target === this.modalEl) {
        this.stop();
      }
    });

    this.modalEl.addEventListener("close", () => {
      this.stop();
    });
  }

  public async start(): Promise<void> {
    this.updateStatus("Position the room QR code in front of your camera.");

    if (!this.modalEl.open) {
      this.modalEl.showModal();
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      this.updateStatus("Camera access is not supported by your browser.", true);
      return;
    }

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      this.videoEl.srcObject = this.stream;
      await this.videoEl.play();
      this.isScanning = true;
      this.scanLoop();
    } catch (err) {
      logger.error("Failed to access camera stream:", err);
      this.updateStatus("Unable to access camera. Please allow camera permissions.", true);
    }
  }

  public stop(): void {
    this.isScanning = false;

    if (this.animationFrameId !== null) {
      if (typeof cancelAnimationFrame !== "undefined") {
        cancelAnimationFrame(this.animationFrameId);
      }
      this.animationFrameId = null;
    }

    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        track.stop();
      }
      this.stream = null;
    }

    if (this.videoEl) {
      this.videoEl.srcObject = null;
    }

    if (this.modalEl && this.modalEl.open) {
      this.modalEl.close();
    }
  }

  private scanLoop = (): void => {
    if (!this.isScanning) return;

    if (this.videoEl.readyState === this.videoEl.HAVE_ENOUGH_DATA) {
      const width = this.videoEl.videoWidth;
      const height = this.videoEl.videoHeight;

      if (width > 0 && height > 0) {
        this.canvasEl.width = width;
        this.canvasEl.height = height;

        const ctx = this.canvasEl.getContext("2d", { willReadFrequently: true });
        if (ctx) {
          ctx.drawImage(this.videoEl, 0, 0, width, height);
          const imageData = ctx.getImageData(0, 0, width, height);
          const code = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: "dontInvert",
          });

          if (code && code.data) {
            this.handleScannedCode(code.data);
          }
        }
      }
    }

    if (this.isScanning && typeof requestAnimationFrame !== "undefined") {
      this.animationFrameId = requestAnimationFrame(this.scanLoop);
    }
  };

  public handleScannedCode(scannedText: string): void {
    const currentOrigin = typeof window !== "undefined" ? window.location.origin : "http://localhost";
    const result = parseAndValidateJoinUrl(scannedText, currentOrigin);

    if (result.valid && result.targetUrl) {
      logger.info(`Successfully scanned valid join URL for room: ${result.code}`);
      this.stop();
      if (this.onSuccess) {
        this.onSuccess(result.targetUrl);
      } else {
        window.location.href = result.targetUrl;
      }
    } else {
      const errorMsg = result.error || "Invalid QR code";
      logger.warn(`Scanned invalid QR code: ${errorMsg}`);
      this.updateStatus(errorMsg, true);
    }
  }

  private updateStatus(text: string, isError: boolean = false): void {
    if (this.statusEl) {
      this.statusEl.textContent = text;
      if (isError) {
        this.statusEl.style.color = "var(--red-9, #e5484d)";
      } else {
        this.statusEl.style.color = "";
      }
    }
  }
}
