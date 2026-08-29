import { describe, it, expect } from "vitest";
import { RoundFlow } from "./roundFlow";

type Phase = "waiting" | "playing" | "roundOver";

describe("RoundFlow", () => {
  it("starts in the initial phase with no timer", () => {
    const rf = new RoundFlow<Phase>("waiting");
    expect(rf.current()).toBe("waiting");
    expect(rf.is("waiting")).toBe(true);
    expect(rf.remaining()).toBeNull();
  });

  it("transition changes phase and clears any timer by default", () => {
    const rf = new RoundFlow<Phase>("waiting");
    rf.transition("playing");
    expect(rf.current()).toBe("playing");
    expect(rf.remaining()).toBeNull();
  });

  it("transition with a duration starts a countdown", () => {
    const rf = new RoundFlow<Phase>("waiting");
    rf.transition("roundOver", 5);
    expect(rf.remaining()).toBe(5);
  });

  it("tickTimer returns false every tick until expiry, then true exactly once", () => {
    const rf = new RoundFlow<Phase>("roundOver", { phase: "roundOver", timeRemaining: 3 });
    expect(rf.tickTimer(1)).toBe(false);
    expect(rf.remaining()).toBe(2);
    expect(rf.tickTimer(1)).toBe(false);
    expect(rf.tickTimer(1)).toBe(true); // crosses zero
    expect(rf.remaining()).toBeNull();
    expect(rf.tickTimer(1)).toBe(false); // no timer running anymore
  });

  it("tickTimer is a no-op when no timer is running", () => {
    const rf = new RoundFlow<Phase>("waiting");
    expect(rf.tickTimer(100)).toBe(false);
  });

  it("round-trips through toJSON/constructor", () => {
    const rf = new RoundFlow<Phase>("playing");
    rf.transition("roundOver", 6);
    const restored = new RoundFlow<Phase>("waiting", rf.toJSON());
    expect(restored.current()).toBe("roundOver");
    expect(restored.remaining()).toBe(6);
  });
});
