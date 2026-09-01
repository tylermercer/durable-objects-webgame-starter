import { describe, expect, it } from "vitest";
import { diffDepartedPeers } from "./peerDeparture";

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

  it("does not count grace-period peers as departed if they remain in peers map", () => {
    const knownIds = new Set<string>();
    const peers = new Map<string, { id: string; status?: string }>();

    peers.set("p1", { id: "p1", status: "live" });
    diffDepartedPeers(knownIds, peers as any);

    // p1 transitions to grace-period status but is still in peers
    peers.set("p1", { id: "p1", status: "grace-period" });
    const res = diffDepartedPeers(knownIds, peers as any);
    expect(res.departed).toEqual([]);
    expect(knownIds.has("p1")).toBe(true);
  });
});
