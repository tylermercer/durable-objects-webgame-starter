import { describe, expect, it, vi } from "vitest";
import { createPeerNotifier } from "./peerDeparture";

describe("createPeerNotifier", () => {
  it("emits events on notifyJoined, notifyReady, and notifyLeft", () => {
    const notifier = createPeerNotifier();
    const joinedSpy = vi.fn();
    const readySpy = vi.fn();
    const leftSpy = vi.fn();

    const unsubJoined = notifier.onPeerJoined(joinedSpy);
    const unsubReady = notifier.onPeerReady(readySpy);
    const unsubLeft = notifier.onPeerLeft(leftSpy);

    const peer1 = { id: "p1" };
    notifier.notifyJoined(peer1);
    expect(joinedSpy).toHaveBeenCalledWith(peer1);

    notifier.notifyReady(peer1);
    expect(readySpy).toHaveBeenCalledWith(peer1);

    notifier.notifyLeft("p1");
    expect(leftSpy).toHaveBeenCalledWith("p1");

    unsubJoined();
    unsubReady();
    unsubLeft();

    notifier.notifyJoined({ id: "p2" });
    notifier.notifyReady({ id: "p2" });
    notifier.notifyLeft("p2");
    expect(joinedSpy).toHaveBeenCalledTimes(1);
    expect(readySpy).toHaveBeenCalledTimes(1);
    expect(leftSpy).toHaveBeenCalledTimes(1);
  });
});
