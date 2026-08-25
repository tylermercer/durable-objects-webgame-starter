import { createRng } from "../../utils/rng";
import type { BirdState, PipeState, RoundState, RoundOverMessage } from "./types";

export const WORLD_WIDTH = 800;
export const WORLD_HEIGHT = 600;
export const GROUND_Y = 550;
export const CEILING_Y = 0;
export const BIRD_RADIUS = 15;
export const BIRD_X = 150;

export const GRAVITY = 1200; // pixels / sec^2
export const FLAP_IMPULSE = -380; // pixels / sec
export const PIPE_SPEED = 200; // pixels / sec
export const PIPE_WIDTH = 60;
export const PIPE_GAP = 150;
export const PIPE_SPAWN_INTERVAL_TICKS = 100; // ~1.67s at 60Hz
export const MIN_PIPE_HEIGHT = 50;

export function createInitialRoundState(
  seed: number,
  players: Array<{ id: string; name: string; color: string }>
): RoundState {
  const birds: Record<string, BirdState> = {};
  for (const p of players) {
    birds[p.id] = {
      id: p.id,
      name: p.name,
      color: p.color,
      x: BIRD_X,
      y: WORLD_HEIGHT / 2,
      vy: 0,
      alive: true,
      place: null,
    };
  }

  return {
    phase: players.length > 0 ? "active" : "waiting",
    seed,
    tickIndex: 0,
    birds,
    pipes: generatePipesForTick(seed, 0),
    totalPlayersAtStart: players.length,
    winner: null,
  };
}

export function generatePipeForIndex(seed: number, pipeIndex: number): PipeState {
  const rng = createRng((seed + pipeIndex * 1013) >>> 0);
  const maxTopHeight = GROUND_Y - PIPE_GAP - MIN_PIPE_HEIGHT;
  const topHeight = MIN_PIPE_HEIGHT + rng() * (maxTopHeight - MIN_PIPE_HEIGHT);
  const spawnTick = pipeIndex * PIPE_SPAWN_INTERVAL_TICKS;
  const initialX = WORLD_WIDTH + (spawnTick * PIPE_SPEED) / 60;

  return {
    id: pipeIndex,
    x: initialX,
    topHeight,
    bottomY: topHeight + PIPE_GAP,
    gap: PIPE_GAP,
    width: PIPE_WIDTH,
  };
}

export function generatePipesForTick(seed: number, tickIndex: number): PipeState[] {
  const pipes: PipeState[] = [];
  const currentDx = (tickIndex * PIPE_SPEED) / 60;

  // Calculate range of pipe indices visible around current tickIndex
  const maxPipesAhead = 10;
  const startPipeIndex = Math.max(0, Math.floor((currentDx - WORLD_WIDTH) / ((PIPE_SPAWN_INTERVAL_TICKS * PIPE_SPEED) / 60)));
  const endPipeIndex = Math.floor(tickIndex / PIPE_SPAWN_INTERVAL_TICKS) + maxPipesAhead;

  for (let i = startPipeIndex; i <= endPipeIndex; i++) {
    const pipe = generatePipeForIndex(seed, i);
    const x = pipe.x - currentDx;
    if (x + pipe.width >= -50 && x <= WORLD_WIDTH + 100) {
      pipes.push({
        ...pipe,
        x,
      });
    }
  }

  return pipes;
}

export function circleRectIntersect(
  cx: number,
  cy: number,
  r: number,
  rx: number,
  ry: number,
  rw: number,
  rh: number
): boolean {
  const closestX = Math.max(rx, Math.min(cx, rx + rw));
  const closestY = Math.max(ry, Math.min(cy, ry + rh));
  const dx = cx - closestX;
  const dy = cy - closestY;
  return dx * dx + dy * dy <= r * r;
}

export function checkBirdCollision(bird: BirdState, pipes: PipeState[]): boolean {
  // Ground or ceiling
  if (bird.y + BIRD_RADIUS >= GROUND_Y || bird.y - BIRD_RADIUS <= CEILING_Y) {
    return true;
  }

  // Pipe check
  for (const pipe of pipes) {
    // Top pipe rect: (pipe.x, 0, pipe.width, pipe.topHeight)
    if (circleRectIntersect(bird.x, bird.y, BIRD_RADIUS, pipe.x, 0, pipe.width, pipe.topHeight)) {
      return true;
    }
    // Bottom pipe rect: (pipe.x, pipe.bottomY, pipe.width, GROUND_Y - pipe.bottomY)
    if (
      circleRectIntersect(
        bird.x,
        bird.y,
        BIRD_RADIUS,
        pipe.x,
        pipe.bottomY,
        pipe.width,
        GROUND_Y - pipe.bottomY
      )
    ) {
      return true;
    }
  }

  return false;
}

export interface StepResult {
  nextState: RoundState;
  events: {
    died: Array<{ id: string; place: number }>;
    roundOver: RoundOverMessage | null;
  };
}

export function stepRound(
  state: RoundState,
  pendingFlaps: Set<string> | string[],
  dt: number
): StepResult {
  if (state.phase !== "active") {
    return {
      nextState: state,
      events: { died: [], roundOver: null },
    };
  }

  const flapSet = pendingFlaps instanceof Set ? pendingFlaps : new Set(pendingFlaps);
  const nextTickIndex = state.tickIndex + 1;
  const pipes = generatePipesForTick(state.seed, nextTickIndex);

  const nextBirds: Record<string, BirdState> = {};
  let aliveCount = 0;
  for (const id in state.birds) {
    if (state.birds[id].alive) {
      aliveCount++;
    }
  }

  const diedEvents: Array<{ id: string; place: number }> = [];
  const newlyDiedIds: string[] = [];

  for (const id in state.birds) {
    const bird = state.birds[id];
    if (!bird.alive) {
      nextBirds[id] = bird;
      continue;
    }

    let vy = bird.vy + GRAVITY * dt;
    if (flapSet.has(id)) {
      vy = FLAP_IMPULSE;
    }

    let y = bird.y + vy * dt;
    // Clamp y position to ground for rendering death frame
    if (y + BIRD_RADIUS > GROUND_Y) {
      y = GROUND_Y - BIRD_RADIUS;
    }

    const updatedBird: BirdState = {
      ...bird,
      y,
      vy,
    };

    if (checkBirdCollision(updatedBird, pipes)) {
      newlyDiedIds.push(id);
    } else {
      nextBirds[id] = updatedBird;
    }
  }

  if (newlyDiedIds.length > 0) {
    const place = aliveCount; // e.g., if 4 alive and 1 dies, place is 4
    for (const id of newlyDiedIds) {
      nextBirds[id] = {
        ...state.birds[id],
        y: Math.min(GROUND_Y - BIRD_RADIUS, state.birds[id].y + (state.birds[id].vy + GRAVITY * dt) * dt),
        alive: false,
        place,
      };
      diedEvents.push({ id, place });
    }
  }

  const remainingAlive = Object.values(nextBirds).filter((b) => b.alive);
  let phase: RoundState["phase"] = "active";
  let winner: { id: string; name: string } | null = null;
  let roundOverEvent: RoundOverMessage | null = null;

  // Round ends if <= 1 bird remains (and there were at least 2 players initially, or 0 alive if 1 player)
  const shouldEnd =
    state.totalPlayersAtStart >= 2
      ? remainingAlive.length <= 1
      : remainingAlive.length === 0;

  if (shouldEnd) {
    phase = "roundOver";
    if (remainingAlive.length === 1) {
      winner = { id: remainingAlive[0].id, name: remainingAlive[0].name };
      // Give the winner place 1
      nextBirds[winner.id] = {
        ...nextBirds[winner.id],
        place: 1,
      };
    }

    roundOverEvent = {
      type: "roundOver",
      place: null, // individual places delivered in died event / state snapshot
      winnerId: winner ? winner.id : null,
      winnerName: winner ? winner.name : null,
    };
  }

  const nextState: RoundState = {
    ...state,
    phase,
    tickIndex: nextTickIndex,
    birds: nextBirds,
    pipes,
    winner,
  };

  return {
    nextState,
    events: {
      died: diedEvents,
      roundOver: roundOverEvent,
    },
  };
}
