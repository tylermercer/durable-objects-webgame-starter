import { describe, it, expect } from "vitest";
import {
  createInitialRoundState,
  generatePipeForIndex,
  generatePipesForTick,
  checkBirdCollision,
  stepRound,
  GROUND_Y,
  CEILING_Y,
  BIRD_RADIUS,
} from "./sim";
import type { BirdState } from "./types";

describe("Flappy Royale sim.ts pure logic", () => {
  it("initializes round state correctly", () => {
    const players = [
      { id: "p1", name: "Alice", color: "#ff0000" },
      { id: "p2", name: "Bob", color: "#00ff00" },
    ];
    const state = createInitialRoundState(12345, players);

    expect(state.phase).toBe("active");
    expect(state.seed).toBe(12345);
    expect(state.tickIndex).toBe(0);
    expect(Object.keys(state.birds)).toHaveLength(2);
    expect(state.birds["p1"].alive).toBe(true);
    expect(state.birds["p2"].alive).toBe(true);
    expect(state.totalPlayersAtStart).toBe(2);
    expect(state.winner).toBeNull();
  });

  it("generates deterministic pipes from seed", () => {
    const pipeA = generatePipeForIndex(12345, 0);
    const pipeB = generatePipeForIndex(12345, 0);
    const pipeC = generatePipeForIndex(99999, 0);

    expect(pipeA.topHeight).toBe(pipeB.topHeight);
    expect(pipeA.topHeight).not.toBe(pipeC.topHeight);

    const pipes1 = generatePipesForTick(12345, 100);
    const pipes2 = generatePipesForTick(12345, 100);
    expect(pipes1).toEqual(pipes2);
  });

  it("applies gravity and flap impulses correctly", () => {
    const players = [{ id: "p1", name: "Alice", color: "#ff0000" }];
    const initial = createInitialRoundState(100, players);

    // Step 1 tick without flap -> vy increases due to gravity
    const dt = 1 / 60;
    const step1 = stepRound(initial, new Set(), dt);
    const bird1 = step1.nextState.birds["p1"];
    expect(bird1.vy).toBeGreaterThan(0);
    expect(bird1.y).toBeGreaterThan(initial.birds["p1"].y);

    // Step 2 with flap -> vy set to upward impulse
    const step2 = stepRound(step1.nextState, new Set(["p1"]), dt);
    const bird2 = step2.nextState.birds["p1"];
    expect(bird2.vy).toBeLessThan(0);
  });

  it("detects ground and ceiling collisions", () => {
    const pipes = generatePipesForTick(100, 0);

    const groundBird: BirdState = {
      id: "p1",
      name: "Alice",
      color: "#ff0000",
      x: 150,
      y: GROUND_Y,
      vy: 0,
      alive: true,
      place: null,
    };
    expect(checkBirdCollision(groundBird, pipes)).toBe(true);

    const ceilingBird: BirdState = {
      id: "p1",
      name: "Alice",
      color: "#ff0000",
      x: 150,
      y: CEILING_Y,
      vy: 0,
      alive: true,
      place: null,
    };
    expect(checkBirdCollision(ceilingBird, pipes)).toBe(true);
  });

  it("eliminates colliding birds and determines winner", () => {
    const players = [
      { id: "p1", name: "Alice", color: "#ff0000" },
      { id: "p2", name: "Bob", color: "#00ff00" },
    ];
    let state = createInitialRoundState(100, players);
    const dt = 1 / 60;

    // Move p1 to ground to cause collision
    state = {
      ...state,
      birds: {
        ...state.birds,
        p1: { ...state.birds["p1"], y: GROUND_Y + 10 },
      },
    };

    const res = stepRound(state, new Set(), dt);
    expect(res.events.died).toHaveLength(1);
    expect(res.events.died[0].id).toBe("p1");
    expect(res.events.died[0].place).toBe(2);

    expect(res.nextState.phase).toBe("roundOver");
    expect(res.nextState.winner).toEqual({ id: "p2", name: "Bob" });
    expect(res.nextState.birds["p2"].place).toBe(1);
  });
});
