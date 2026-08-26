export interface CameraTarget {
  x: number;
  y: number;
}

export interface CameraOptions {
  viewportWidth: number;
  viewportHeight: number;
  worldWidth: number;
  worldHeight: number;
  /** How quickly the camera eases toward its target position, 0-1 per call to update(). Default: 1 (snap). */
  smoothing?: number;
}

export class Camera {
  x = 0;
  y = 0;

  constructor(private opts: CameraOptions) {}

  /** Centers on the bounding box of all targets (single target = follow that point). */
  update(targets: CameraTarget[]): void {
    if (targets.length === 0) return;
    const minX = Math.min(...targets.map((t) => t.x));
    const maxX = Math.max(...targets.map((t) => t.x));
    const minY = Math.min(...targets.map((t) => t.y));
    const maxY = Math.max(...targets.map((t) => t.y));

    const desiredX = clamp(
      (minX + maxX) / 2 - this.opts.viewportWidth / 2,
      0,
      Math.max(0, this.opts.worldWidth - this.opts.viewportWidth)
    );
    const desiredY = clamp(
      (minY + maxY) / 2 - this.opts.viewportHeight / 2,
      0,
      Math.max(0, this.opts.worldHeight - this.opts.viewportHeight)
    );

    const s = this.opts.smoothing ?? 1;
    this.x += (desiredX - this.x) * s;
    this.y += (desiredY - this.y) * s;
  }

  toScreen(worldPos: CameraTarget): CameraTarget {
    return { x: worldPos.x - this.x, y: worldPos.y - this.y };
  }

  getViewport() {
    return {
      x: this.x,
      y: this.y,
      width: this.opts.viewportWidth,
      height: this.opts.viewportHeight,
    };
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
