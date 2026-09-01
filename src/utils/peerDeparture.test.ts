import { describe, expect, it, vi } from "vitest";
import { createPeerNotifier, diffDepartedPeers } from "./peerDeparture";

describe("createPeerNotifier", () => {
  it("emits events on notifyJoined and notifyLeft", () => {
    const notifier = createPeerNotifier();
    const joinedSpy = vi.fn();
    const leftSpy = vi.fn();

    const unsubJoined = notifier.onPeerJoined(joinedSpy);
    const unsubLeft = notifier.onPeerLeft(leftSpy);

    const peer1 = { id: "p1", name: "Alice" };
    notifier.notifyJoined(peer1);
    expect(joinedSpy).toHaveBeenCalledWith(peer1);

    notifier.notifyLeft("p1");
    expect(leftSpy).toHaveBeenCalledWith("p1");

    unsubJoined();
    unsubLeft();

    notifier.notifyJoined({ id: "p2" });
    notifier.notifyLeft("p2");
    expect(joinedSpy).toHaveBeenCalledTimes(1);
    expect(leftSpy).toHaveBeenCalledTimes(1);
  });

  it("checks diff and fires appropriate callbacks for untracked changes", () => {
    const peers = new Map<string, { id: string }>();
    const notifier = createPeerNotifier(peers);

    const joinedSpy = vi.fn();
    const leftSpy = vi.fn();

    notifier.onPeerJoined(joinedSpy);
    notifier.onPeerLeft(leftSpy);

    peers.set("p1", { id: "p1" });
    const res = notifier.checkDiff(peers);
    expect(joinedSpy).toHaveBeenCalledWith({ id: "p1" });
    expect(res.departed).toEqual([]);

    peers.delete("p1");
    const res2 = notifier.checkDiff(peers);
    expect(leftSpy).toHaveBeenCalledWith("p1");
    expect(res2.departed).toEqual(["p1"]);
  });
});

describe("diffDepartedPeers", () => {
  it("tracks added peers and detects departed peers across ticks", () => {
    const knownIds = new Set<string>();
    const peers = new Map<string, { id: string }>();

    // Tick 1: peer-1 joins
    peers.set("peer-1", { id: "peer-1" });
    let res = diffDepartedPeers(knownIds, peers);
    expect(res.departed).toEqual([]);
    expect(Array.from(knownIds)).toEqual(["peer-1"]);

    // Tick 2: peer-2 joins
    peers.set("peer-2", { id: "peer-2" });
    res = diffDepartedPeers(knownIds, peers);
    expect(res.departed).toEqual([]);
    expect(Array.from(knownIds).sort()).toEqual(["peer-1", "peer-2"]);

    // Tick 3: peer-1 leaves (removed from map)
    peers.delete("peer-1");
    res = diffDepartedPeers(knownIds, peers);
    expect(res.departed).toEqual(["peer-1"]);
    expect(Array.from(knownIds)).toEqual(["peer-2"]);

    // Tick 4: no changes
    res = diffDepartedPeers(knownIds, peers);
    expect(res.departed).toEqual([]);
    expect(Array.from(knownIds)).toEqual(["peer-2"]);
  });
});
