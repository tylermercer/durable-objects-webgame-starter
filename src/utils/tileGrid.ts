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
    cost: (pos: GridPos, cell: T) => number
  ): GridPos[] | null {
    if (!this.inBounds(start) || !this.inBounds(goal)) return null;

    const key = (p: GridPos) => `${p.x},${p.y}`;
    const goalKey = key(goal);
    const heuristic = (a: GridPos, b: GridPos) =>
      Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

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

      for (const n of this.neighbors(cur.pos, false)) {
        const nKey = key(n);
        if (closed.has(nKey)) continue;
        const cell = this.get(n);
        if (cell === undefined) continue;
        const cellCost = cost(n, cell);
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
