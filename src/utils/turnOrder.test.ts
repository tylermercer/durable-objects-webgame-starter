import { describe, it, expect } from "vitest";
import { TurnOrder } from "./turnOrder";

describe("TurnOrder", () => {
  it("starts at the first player", () => {
    const t = new TurnOrder(["a", "b", "c"]);
    expect(t.current()).toBe("a");
  });

  it("advances forward and wraps", () => {
    const t = new TurnOrder(["a", "b", "c"]);
    expect(t.advance()).toBe("b");
    expect(t.advance()).toBe("c");
    expect(t.advance()).toBe("a");
  });

  it("reverse flips direction and persists across advances", () => {
    const t = new TurnOrder(["a", "b", "c"]);
    t.advance(); // b
    t.reverse();
    expect(t.advance()).toBe("a");
    expect(t.advance()).toBe("c");
  });

  it("jumpTo moves the pointer directly", () => {
    const t = new TurnOrder(["a", "b", "c"]);
    t.jumpTo("c");
    expect(t.current()).toBe("c");
  });

  it("addPlayer at end appends to the back", () => {
    const t = new TurnOrder(["a", "b"]);
    t.addPlayer("c");
    expect(t.all()).toEqual(["a", "b", "c"]);
  });

  it("addPlayer next inserts right after the current player", () => {
    const t = new TurnOrder(["a", "b"]);
    t.addPlayer("c", "next");
    expect(t.all()).toEqual(["a", "c", "b"]);
  });

  it("removePlayer before the current index shifts the pointer to keep the same current player", () => {
    const t = new TurnOrder(["a", "b", "c"]);
    t.jumpTo("c");
    t.removePlayer("a");
    expect(t.current()).toBe("c");
    expect(t.all()).toEqual(["b", "c"]);
  });

  it("removePlayer on the current player advances to the next one", () => {
    const t = new TurnOrder(["a", "b", "c"]);
    t.removePlayer("a");
    expect(t.current()).toBe("b");
  });

  it("removePlayer down to zero players makes current() null", () => {
    const t = new TurnOrder(["a"]);
    t.removePlayer("a");
    expect(t.current()).toBeNull();
    expect(t.advance()).toBeNull();
  });

  it("removePlayer on an unknown id is a no-op", () => {
    const t = new TurnOrder(["a", "b"]);
    t.removePlayer("z");
    expect(t.all()).toEqual(["a", "b"]);
  });

  it("round-trips through toJSON/constructor", () => {
    const t = new TurnOrder(["a", "b", "c"]);
    t.advance();
    t.reverse();
    const restored = new TurnOrder([], t.toJSON());
    expect(restored.current()).toBe(t.current());
    expect(restored.all()).toEqual(t.all());
  });
});
