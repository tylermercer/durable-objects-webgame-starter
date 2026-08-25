import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createFixedTickLoop } from "./gameLoop";

describe("createFixedTickLoop", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("calls onTick fixed number of times according to elapsed time", () => {
    const onTick = vi.fn();
    const onRender = vi.fn();

    const rafFn = vi.fn((cb: FrameRequestCallback) => {
      return setTimeout(() => cb(performance.now()), 16) as unknown as number;
    });
    vi.stubGlobal("requestAnimationFrame", rafFn);

    const perfSpy = vi.spyOn(performance, "now").mockReturnValue(1000);

    const loop = createFixedTickLoop({
      tickRate: 20, // 50ms per tick
      onTick,
      onRender
    });

    expect(rafFn).toHaveBeenCalledTimes(1);

    // Advance performance.now and timers
    perfSpy.mockReturnValue(1050);
    vi.advanceTimersByTime(16);

    expect(onTick).toHaveBeenCalledTimes(1);
    expect(onTick).toHaveBeenLastCalledWith(0.05);
    expect(onRender).toHaveBeenLastCalledWith(0);

    perfSpy.mockReturnValue(1175);
    vi.advanceTimersByTime(16);

    expect(onTick).toHaveBeenCalledTimes(3);
    expect(onRender).toHaveBeenLastCalledWith(0.5);

    loop.stop();
    perfSpy.mockReturnValue(1250);
    vi.advanceTimersByTime(16);
    expect(onTick).toHaveBeenCalledTimes(3);
  });
});
