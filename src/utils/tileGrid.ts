export interface GridPos {
  x: number;
  y: number;
}

export interface TileGridState<T> {
  width: number;
  height: number;
  cells: T[];
}

/** The 8 directions `ray()` takes a single step in — reused as-is by any game walking every line from a cell. */
export const DIRECTIONS_8: Array<[-1 | 0 | 1, -1 | 0 | 1]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

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

  toJSON(): TileGridState<T> {
    return { width: this.width, height: this.height, cells: [...this.cells] };
  }

  static fromJSON<T>(state: TileGridState<T>): TileGrid<T> {
    const grid = new TileGrid<T>(state.width, state.height, () => undefined as unknown as T);
    grid.cells = [...state.cells];
    return grid;
  }

  /**
   * Cells walking outward from `start` in a straight line — NOT including
   * `start` itself — stopping at the grid edge. `dx`/`dy` are a single
   * step's direction (-1, 0, or 1 per axis; both 0 is a no-op that yields
   * nothing). For flanking checks (Othello), line-of-sight, or any sliding
   * search along a row/column/diagonal.
   */
  *ray(start: GridPos, dx: -1 | 0 | 1, dy: -1 | 0 | 1): Generator<{ pos: GridPos; value: T }> {
    if (dx === 0 && dy === 0) return;
    let pos: GridPos = { x: start.x + dx, y: start.y + dy };
    while (this.inBounds(pos)) {
      yield { pos, value: this.get(pos) as T };
      pos = { x: pos.x + dx, y: pos.y + dy };
    }
  }

  *neighbors(pos: GridPos, diagonals = false): Generator<GridPos> {
    const deltas = diagonals
      ? [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
          [1, 1],
          [1, -1],
          [-1, 1],
          [-1, -1],
        ]
      : [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ];
    for (const [dx, dy] of deltas) {
      const n = { x: pos.x + dx, y: pos.y + dy };
      if (this.inBounds(n)) yield n;
    }
  }

  /** A* over the grid. `cost` returns Infinity (or any non-finite value) for impassable cells. */
  findPath(
    start: GridPos,
    goal: GridPos,
    cost: (pos: GridPos, cell: T) => number,
    options?: { diagonals?: boolean }
  ): GridPos[] | null {
    if (!this.inBounds(start) || !this.inBounds(goal)) return null;

    const diagonals = options?.diagonals ?? false;

    const key = (p: GridPos) => `${p.x},${p.y}`;
    const goalKey = key(goal);
    const heuristic = diagonals
      ? (a: GridPos, b: GridPos) => {
          const dx = Math.abs(a.x - b.x);
          const dy = Math.abs(a.y - b.y);
          return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
        }
      : (a: GridPos, b: GridPos) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

    const gScore = new Map<string, number>([[key(start), 0]]);
    const parent = new Map<string, string>();
    const open = new Map<string, { pos: GridPos; f: number }>();
    open.set(key(start), { pos: start, f: heuristic(start, goal) });
    const closed = new Set<string>();

    while (open.size > 0) {
      const [curKey, cur] = [...open.entries()].reduce((a, b) =>
        a[1].f <= b[1].f ? a : b
      );
      if (curKey === goalKey) return this.reconstructPath(start, goal, parent);

      open.delete(curKey);
      closed.add(curKey);

      for (const n of this.neighbors(cur.pos, diagonals)) {
        const nKey = key(n);
        if (closed.has(nKey)) continue;
        const cell = this.get(n);
        if (cell === undefined) continue;
        const cellCost = cost(n, cell);
        if (!Number.isFinite(cellCost)) continue;

        const dx = n.x - cur.pos.x;
        const dy = n.y - cur.pos.y;
        const isDiagonal = dx !== 0 && dy !== 0;

        if (isDiagonal) {
          // Disallow cutting through the corner where two orthogonal
          // neighbors meet — both must be open, not just the diagonal cell.
          const cornerA = { x: cur.pos.x + dx, y: cur.pos.y };
          const cornerB = { x: cur.pos.x, y: cur.pos.y + dy };
          const cellA = this.get(cornerA);
          const cellB = this.get(cornerB);
          const openA = cellA !== undefined && Number.isFinite(cost(cornerA, cellA));
          const openB = cellB !== undefined && Number.isFinite(cost(cornerB, cellB));
          if (!openA || !openB) continue;
        }

        const stepCost = cellCost * (isDiagonal ? Math.SQRT2 : 1);
        const g = gScore.get(curKey)! + stepCost;
        if (g < (gScore.get(nKey) ?? Infinity)) {
          parent.set(nKey, curKey);
          gScore.set(nKey, g);
          open.set(nKey, { pos: n, f: g + heuristic(n, goal) });
        }
      }
    }
    return null;
  }

  private reconstructPath(
    start: GridPos,
    goal: GridPos,
    parents: Map<string, string>
  ): GridPos[] {
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
