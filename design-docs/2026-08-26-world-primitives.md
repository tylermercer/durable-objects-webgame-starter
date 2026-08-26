# World Primitives Addendum

## Scope

This is an addendum to `design-docs/2026-08-24-additional-primitives.md` and
`design-docs/2026-08-24-core-architecture.md`. It adds three more generic,
game-agnostic primitives: a tile grid, a camera/viewport helper, and an
entity registry. Each earns its place the same way the existing primitives
did — not because any one game needs it, but because enough games built on
this template will.

As with the existing primitives, everything here is additive and opt-in: no
existing file changes behavior, a game either imports these or doesn't.

**Explicitly out of scope**, considered and rejected as genre-specific rather
than webgame-shape-specific: a turn/phase coordinator (real-time vs.
turn-based is a design decision per game, not something the template should
bake in), a party/roster abstraction (multi-character-per-controller is rare
outside a handful of RPG-likes), and procedural dungeon generation (this is
genuinely reusable, but it's existing code being ported into a specific game
rather than a gap in the template — no reason to design it twice).

## 1. Tile grid (`src/utils/tileGrid.ts`)

Any 2D game with a world — top-down, platformer, puzzle — ends up needing
the same handful of grid operations: bounds-checked cell access, walkability
queries, neighbor iteration, and pathfinding. Right now every game would
write its own array-of-arrays and its own A*. This is data-only — no
rendering opinion — so it works whether a game draws with `CanvasRenderingContext2D`
(`touch-demo`, `logic/` stubs) or Pixi (`flappy-royale`).

```ts
// src/utils/tileGrid.ts
export interface GridPos {
  x: number;
  y: number;
}

export class TileGrid<T> {
  private cells: T[];

  constructor(
    public readonly width: number,
    public readonly height: number,
    fill: (pos: GridPos) => T
  ) {
    this.cells = new Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        this.cells[y * width + x] = fill({ x, y });
      }
    }
  }

  inBounds(pos: GridPos): boolean {
    return pos.x >= 0 && pos.y >= 0 && pos.x < this.width && pos.y < this.height;
  }

  get(pos: GridPos): T | undefined {
    return this.inBounds(pos) ? this.cells[pos.y * this.width + pos.x] : undefined;
  }

  set(pos: GridPos, value: T): void {
    if (this.inBounds(pos)) this.cells[pos.y * this.width + pos.x] = value;
  }

  *neighbors(pos: GridPos, diagonals = false): Generator<GridPos> {
    const deltas = diagonals
      ? [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]
      : [[1,0],[-1,0],[0,1],[0,-1]];
    for (const [dx, dy] of deltas) {
      const n = { x: pos.x + dx, y: pos.y + dy };
      if (this.inBounds(n)) yield n;
    }
  }

  /** A* over the grid. `cost` returns Infinity (or any non-finite value) for impassable cells. */
  findPath(start: GridPos, goal: GridPos, cost: (pos: GridPos, cell: T) => number): GridPos[] | null {
    const key = (p: GridPos) => `${p.x},${p.y}`;
    const goalKey = key(goal);
    const heuristic = (a: GridPos, b: GridPos) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

    const gScore = new Map<string, number>([[key(start), 0]]);
    const parent = new Map<string, string>();
    const open = new Map<string, { pos: GridPos; f: number }>();
    open.set(key(start), { pos: start, f: heuristic(start, goal) });
    const closed = new Set<string>();

    while (open.size > 0) {
      const [curKey, cur] = [...open.entries()].reduce((a, b) => (a[1].f <= b[1].f ? a : b));
      if (curKey === goalKey) return this.reconstructPath(start, goal, parent);

      open.delete(curKey);
      closed.add(curKey);

      for (const n of this.neighbors(cur.pos, false)) {
        const nKey = key(n);
        if (closed.has(nKey)) continue;
        const cellCost = cost(n, this.get(n)!);
        if (!Number.isFinite(cellCost)) continue;

        const g = gScore.get(curKey)! + cellCost;
        if (g < (gScore.get(nKey) ?? Infinity)) {
          parent.set(nKey, curKey);
          gScore.set(nKey, g);
          open.set(nKey, { pos: n, f: g + heuristic(n, goal) });
        }
      }
    }
    return null;
  }

  private reconstructPath(start: GridPos, goal: GridPos, parents: Map<string, string>): GridPos[] {
    const key = (p: GridPos) => `${p.x},${p.y}`;
    const path: GridPos[] = [goal];
    let cur = key(goal);
    while (cur !== key(start)) {
      const prev = parents.get(cur);
      if (!prev) break;
      const [px, py] = prev.split(",").map(Number);
      path.unshift({ x: px, y: py });
      cur = prev;
    }
    return path;
  }
}
```

Standard A* with a Manhattan-distance heuristic — not optimized (linear scan
for the lowest-`f` open node rather than a binary heap), which is fine at the
grid sizes a single dungeon floor or overworld screen implies. Worth
revisiting if a game needs pathfinding over hundreds of cells per tick.

A game constructs one `TileGrid<CellType>` on the console (or loads it from
`loadGameState`, see §3), queries `findPath`/`neighbors` inside `onTick`, and
never touches rendering through it — that stays the game's own concern.

## 2. Camera / viewport helper (`src/utils/camera.ts`)

This one is closer to the console/controller shape of the template than to
any particular genre: one shared screen, N players each contributing input
from a phone, is exactly the setup where "what should the camera follow"
comes up for *any* game with a world bigger than one screen — not just
Zelda-likes. Right now nothing in the template answers that question.

```ts
// src/utils/camera.ts
export interface CameraTarget {
  x: number;
  y: number;
}

export interface CameraOptions {
  viewportWidth: number;
  viewportHeight: number;
  worldWidth: number;
  worldHeight: number;
  /** How quickly the camera eases toward its target position, 0-1 per call to update(). Default: 1 (snap). */
  smoothing?: number;
}

export class Camera {
  x = 0;
  y = 0;

  constructor(private opts: CameraOptions) {}

  /** Centers on the bounding box of all targets (single target = follow that point). */
  update(targets: CameraTarget[]): void {
    if (targets.length === 0) return;
    const minX = Math.min(...targets.map(t => t.x));
    const maxX = Math.max(...targets.map(t => t.x));
    const minY = Math.min(...targets.map(t => t.y));
    const maxY = Math.max(...targets.map(t => t.y));

    const desiredX = clamp(
      (minX + maxX) / 2 - this.opts.viewportWidth / 2,
      0, Math.max(0, this.opts.worldWidth - this.opts.viewportWidth)
    );
    const desiredY = clamp(
      (minY + maxY) / 2 - this.opts.viewportHeight / 2,
      0, Math.max(0, this.opts.worldHeight - this.opts.viewportHeight)
    );

    const s = this.opts.smoothing ?? 1;
    this.x += (desiredX - this.x) * s;
    this.y += (desiredY - this.y) * s;
  }

  toScreen(worldPos: CameraTarget): CameraTarget {
    return { x: worldPos.x - this.x, y: worldPos.y - this.y };
  }

  getViewport() {
    return { x: this.x, y: this.y, width: this.opts.viewportWidth, height: this.opts.viewportHeight };
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
```

`update()` taking an array of targets rather than a single point is the
detail worth keeping even for single-player-camera games: a co-op game that
wants "camera fits all visible players" gets that for free by passing every
player's position, while a game that wants strict single-follow just passes
a one-element array. `toScreen()` is deliberately just arithmetic — it
returns world-to-screen-space coordinates, not a canvas transform, so it
works identically under `CanvasRenderingContext2D`, Pixi's container
positioning, or a DOM-based renderer.

## 3. Entity/actor registry (`src/utils/entityRegistry.ts`)

Every game so far has hand-rolled its own way of tracking "the things in the
world" — `flappy-royale`'s `Record<string, BirdState>`, `liars-dice`'s
player list. That's fine at that scale, but it also means every game
reinvents add/remove/query and, more importantly, its own serialization
shape for `saveGameState`. A minimal generic registry gives games a
consistent shape and wires directly into the persistence primitive from
`2026-08-24-additional-primitives.md` §6:

```ts
// src/utils/entityRegistry.ts
export interface Entity {
  id: string;
}

export class EntityRegistry<T extends Entity> {
  private entities = new Map<string, T>();

  add(entity: T): void {
    this.entities.set(entity.id, entity);
  }

  remove(id: string): void {
    this.entities.delete(id);
  }

  get(id: string): T | undefined {
    return this.entities.get(id);
  }

  all(): T[] {
    return [...this.entities.values()];
  }

  query(predicate: (entity: T) => boolean): T[] {
    return this.all().filter(predicate);
  }

  /** Plugs directly into ConsoleApi.saveGameState from the resilience-primitives addendum. */
  toJSON(): T[] {
    return this.all();
  }

  static fromJSON<T extends Entity>(data: T[]): EntityRegistry<T> {
    const registry = new EntityRegistry<T>();
    for (const e of data) registry.add(e);
    return registry;
  }
}
```

Deliberately not a full ECS (no separate component tables, no systems
runner) — that's a bigger design commitment than a starter template should
make on a game's behalf. This is closer to "a `Map` with a shape the rest of
the primitives agree on" than a framework. A game that outgrows it can
still swap in a real ECS library later without the template having steered
it wrong.

## Summary: what's new where

| File | Addition |
|---|---|
| `src/utils/tileGrid.ts` (+ test) | new — `TileGrid<T>`: bounds-checked access, neighbor iteration, A* pathfinding (§1) |
| `src/utils/camera.ts` (+ test) | new — `Camera`: multi-target follow, world-bounds clamping, world-to-screen conversion (§2) |
| `src/utils/entityRegistry.ts` (+ test) | new — `EntityRegistry<T>`: add/remove/query plus `toJSON`/`fromJSON` for `saveGameState` (§3) |

All three are pure additions under `@utils` — no existing export changes
shape, and none of the three depend on each other or on any specific
rendering framework, so a game can adopt any subset.
