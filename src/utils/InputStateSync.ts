export class InputStateSync<T> {
  private timer: number | null = null;

  constructor(
    private channel: () => RTCDataChannel | null,
    private getState: () => T,
    private hz = 20
  ) {}

  start() {
    this.timer = setInterval(() => {
      const ch = this.channel();
      if (ch?.readyState === "open") {
        ch.send(JSON.stringify({ type: "state", state: this.getState() }));
      }
    }, 1000 / this.hz) as unknown as number;
  }

  stop() {
    if (this.timer !== null) clearInterval(this.timer);
  }
}
