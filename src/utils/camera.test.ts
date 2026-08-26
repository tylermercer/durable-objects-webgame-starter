import { describe, expect, it } from "vitest";
import { Camera } from "./camera";

describe("Camera", () => {
  it("centers on a single target when instant snapping (default smoothing)", () => {
    const camera = new Camera({
      viewportWidth: 800,
      viewportHeight: 600,
      worldWidth: 2000,
      worldHeight: 2000,
    });

    camera.update([{ x: 1000, y: 1000 }]);

    // Desired center (1000, 1000) minus half viewport (400, 300) = (600, 700)
    expect(camera.x).toBe(600);
    expect(camera.y).toBe(700);
  });

  it("centers on the bounding box of multiple targets", () => {
    const camera = new Camera({
      viewportWidth: 800,
      viewportHeight: 600,
      worldWidth: 2000,
      worldHeight: 2000,
    });

    camera.update([
      { x: 400, y: 500 },
      { x: 1000, y: 900 },
    ]);

    // Bounding box center: x = (400 + 1000) / 2 = 700, y = (500 + 900) / 2 = 700
    // Desired camera position: x = 700 - 400 = 300, y = 700 - 300 = 400
    expect(camera.x).toBe(300);
    expect(camera.y).toBe(400);
  });

  it("does not update position when targets array is empty", () => {
    const camera = new Camera({
      viewportWidth: 800,
      viewportHeight: 600,
      worldWidth: 2000,
      worldHeight: 2000,
    });
    camera.x = 100;
    camera.y = 100;

    camera.update([]);
    expect(camera.x).toBe(100);
    expect(camera.y).toBe(100);
  });

  it("clamps camera position to world bounds", () => {
    const camera = new Camera({
      viewportWidth: 800,
      viewportHeight: 600,
      worldWidth: 1000,
      worldHeight: 1000,
    });

    // Target near top-left corner
    camera.update([{ x: 10, y: 10 }]);
    expect(camera.x).toBe(0);
    expect(camera.y).toBe(0);

    // Target near bottom-right corner
    camera.update([{ x: 990, y: 990 }]);
    expect(camera.x).toBe(200); // 1000 - 800
    expect(camera.y).toBe(400); // 1000 - 600
  });

  it("handles world size smaller than viewport", () => {
    const camera = new Camera({
      viewportWidth: 800,
      viewportHeight: 600,
      worldWidth: 500,
      worldHeight: 400,
    });

    camera.update([{ x: 250, y: 200 }]);
    expect(camera.x).toBe(0);
    expect(camera.y).toBe(0);
  });

  it("applies smoothing easing when updating position", () => {
    const camera = new Camera({
      viewportWidth: 800,
      viewportHeight: 600,
      worldWidth: 2000,
      worldHeight: 2000,
      smoothing: 0.5,
    });

    // Start at (0, 0), target desired is (600, 700)
    camera.update([{ x: 1000, y: 1000 }]);

    // Halfway towards (600, 700)
    expect(camera.x).toBe(300);
    expect(camera.y).toBe(350);

    // Next frame halfway again: 300 + (600 - 300) * 0.5 = 450
    camera.update([{ x: 1000, y: 1000 }]);
    expect(camera.x).toBe(450);
    expect(camera.y).toBe(525);
  });

  it("converts world coordinates to screen space with toScreen", () => {
    const camera = new Camera({
      viewportWidth: 800,
      viewportHeight: 600,
      worldWidth: 2000,
      worldHeight: 2000,
    });
    camera.x = 100;
    camera.y = 200;

    const screenPos = camera.toScreen({ x: 150, y: 250 });
    expect(screenPos).toEqual({ x: 50, y: 50 });
  });

  it("returns viewport rectangle via getViewport", () => {
    const camera = new Camera({
      viewportWidth: 800,
      viewportHeight: 600,
      worldWidth: 2000,
      worldHeight: 2000,
    });
    camera.x = 100;
    camera.y = 200;

    expect(camera.getViewport()).toEqual({
      x: 100,
      y: 200,
      width: 800,
      height: 600,
    });
  });
});
