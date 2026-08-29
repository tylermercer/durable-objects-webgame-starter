import type { GameTransport } from "@transport/transport";

export class InputStateSync<T> {
  private timer: number | null = null;

  constructor(
    private transportGetter: () => GameTransport | { readyState: string; send: (msg: string) => void } | null,
    private getState: () => T,
    private hz = 20
  ) {}

  start() {
    this.timer = setInterval(() => {
      const target = this.transportGetter();
      if (!target) return;
      if ("sendInput" in target && typeof target.sendInput === "function") {
        target.sendInput({ type: "state", state: this.getState() });
      } else if ("readyState" in target && target.readyState === "open") {
        target.send(JSON.stringify({ type: "state", state: this.getState() }));
      }
    }, 1000 / this.hz) as unknown as number;
  }

  stop() {
    if (this.timer !== null) clearInterval(this.timer);
  }
}
