import { describe, it, expect, vi } from "vitest";
import { createStore } from "./reactStore";

describe("createStore", () => {
  it("initializes state and returns via get()", () => {
    const store = createStore(42);
    expect(store.get()).toBe(42);
  });

  it("updates state with value and notifies subscribers", () => {
    const store = createStore("hello");
    const listener = vi.fn();

    const unsubscribe = store.subscribe(listener);
    store.set("world");

    expect(store.get()).toBe("world");
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
  });

  it("updates state with functional updater", () => {
    const store = createStore(10);
    const listener = vi.fn();

    store.subscribe(listener);
    store.set((prev) => prev + 5);

    expect(store.get()).toBe(15);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("unsubscribes listeners correctly", () => {
    const store = createStore(0);
    const listener = vi.fn();

    const unsubscribe = store.subscribe(listener);
    store.set(1);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    store.set(2);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
