export function createFixedTickLoop(opts: {
  tickRate: number; // Hz
  onTick: (dt: number) => void;
  onRender?: (alpha: number) => void; // alpha = interpolation factor into the next tick
}) {
  const tickMs = 1000 / opts.tickRate;
  let last = performance.now();
  let acc = 0;
  let running = true;

  function frame(now: number) {
    if (!running) return;
    acc += now - last;
    last = now;
    while (acc >= tickMs) {
      opts.onTick(tickMs / 1000);
      acc -= tickMs;
    }
    opts.onRender?.(acc / tickMs);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return {
    stop: () => {
      running = false;
    }
  };
}
