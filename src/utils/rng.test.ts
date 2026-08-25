import { describe, expect, it } from "vitest";
import { createRng } from "./rng";

describe("createRng", () => {
  it("generates numbers in [0, 1)", () => {
    const rng = createRng(12345);
    for (let i = 0; i < 1000; i++) {
      const val = rng();
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThan(1);
    }
  });

  it("produces deterministic sequence for the same seed", () => {
    const seed = 42;
    const rng1 = createRng(seed);
    const rng2 = createRng(seed);

    const seq1 = Array.from({ length: 10 }, () => rng1());
    const seq2 = Array.from({ length: 10 }, () => rng2());

    expect(seq1).toEqual(seq2);
  });

  it("produces different sequences for different seeds", () => {
    const rng1 = createRng(100);
    const rng2 = createRng(200);

    const seq1 = Array.from({ length: 5 }, () => rng1());
    const seq2 = Array.from({ length: 5 }, () => rng2());

    expect(seq1).not.toEqual(seq2);
  });
});
