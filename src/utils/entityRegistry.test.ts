import { describe, expect, it } from "vitest";
import type { Entity } from "./entityRegistry";
import { EntityRegistry } from "./entityRegistry";

interface PlayerEntity extends Entity {
  id: string;
  name: string;
  hp: number;
}

describe("EntityRegistry", () => {
  it("adds and gets entities by id", () => {
    const registry = new EntityRegistry<PlayerEntity>();
    const p1: PlayerEntity = { id: "p1", name: "Alice", hp: 100 };
    registry.add(p1);

    expect(registry.get("p1")).toEqual(p1);
    expect(registry.get("nonexistent")).toBeUndefined();
  });

  it("removes entities by id", () => {
    const registry = new EntityRegistry<PlayerEntity>();
    const p1: PlayerEntity = { id: "p1", name: "Alice", hp: 100 };
    registry.add(p1);
    registry.remove("p1");

    expect(registry.get("p1")).toBeUndefined();
    expect(registry.all()).toEqual([]);
  });

  it("returns all entities", () => {
    const registry = new EntityRegistry<PlayerEntity>();
    const p1: PlayerEntity = { id: "p1", name: "Alice", hp: 100 };
    const p2: PlayerEntity = { id: "p2", name: "Bob", hp: 80 };

    registry.add(p1);
    registry.add(p2);

    expect(registry.all()).toEqual([p1, p2]);
  });

  it("queries entities using a predicate", () => {
    const registry = new EntityRegistry<PlayerEntity>();
    const p1: PlayerEntity = { id: "p1", name: "Alice", hp: 100 };
    const p2: PlayerEntity = { id: "p2", name: "Bob", hp: 50 };
    const p3: PlayerEntity = { id: "p3", name: "Charlie", hp: 0 };

    registry.add(p1);
    registry.add(p2);
    registry.add(p3);

    const alive = registry.query((p) => p.hp > 0);
    expect(alive).toEqual([p1, p2]);
  });

  it("serializes to JSON array and deserializes with fromJSON", () => {
    const registry = new EntityRegistry<PlayerEntity>();
    const p1: PlayerEntity = { id: "p1", name: "Alice", hp: 100 };
    const p2: PlayerEntity = { id: "p2", name: "Bob", hp: 80 };

    registry.add(p1);
    registry.add(p2);

    const json = registry.toJSON();
    expect(json).toEqual([p1, p2]);

    const restored = EntityRegistry.fromJSON<PlayerEntity>(json);
    expect(restored.all()).toEqual([p1, p2]);
    expect(restored.get("p1")).toEqual(p1);
    expect(restored.get("p2")).toEqual(p2);
  });
});
