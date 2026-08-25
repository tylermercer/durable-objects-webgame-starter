import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { InputStateSync } from "./InputStateSync";

describe("InputStateSync", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends continuous state updates periodically when channel is open", () => {
    const sendMock = vi.fn();
    const mockChannel = {
      readyState: "open",
      send: sendMock
    } as unknown as RTCDataChannel;

    let currentState = { x: 0, y: 0 };
    const sync = new InputStateSync(
      () => mockChannel,
      () => currentState,
      20
    );

    sync.start();

    vi.advanceTimersByTime(50); // 1 tick at 20Hz (50ms)
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenLastCalledWith(JSON.stringify({ type: "state", state: { x: 0, y: 0 } }));

    currentState = { x: 10, y: 20 };
    vi.advanceTimersByTime(50);
    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(sendMock).toHaveBeenLastCalledWith(JSON.stringify({ type: "state", state: { x: 10, y: 20 } }));

    sync.stop();
    vi.advanceTimersByTime(50);
    expect(sendMock).toHaveBeenCalledTimes(2);
  });

  it("does not send state when channel is null or not open", () => {
    const sendMock = vi.fn();
    let readyState = "connecting";
    const mockChannel = {
      get readyState() { return readyState; },
      send: sendMock
    } as unknown as RTCDataChannel;

    let chProvider: (() => RTCDataChannel | null) = () => null;

    const sync = new InputStateSync(
      () => chProvider(),
      () => ({ button: "A" }),
      10
    );

    sync.start();
    vi.advanceTimersByTime(100);
    expect(sendMock).not.toHaveBeenCalled();

    chProvider = () => mockChannel;
    vi.advanceTimersByTime(100);
    expect(sendMock).not.toHaveBeenCalled();

    readyState = "open";
    vi.advanceTimersByTime(100);
    expect(sendMock).toHaveBeenCalledTimes(1);

    sync.stop();
  });
});
