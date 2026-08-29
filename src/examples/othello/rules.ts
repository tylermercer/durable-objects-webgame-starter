import { TileGrid, DIRECTIONS_8, type GridPos } from "@utils/tileGrid";
import type { CellState } from "./types";

export function createInitialBoard(): TileGrid<CellState> {
  const board = new TileGrid<CellState>(8, 8, () => null);
  board.set({ x: 3, y: 3 }, "white");
  board.set({ x: 4, y: 4 }, "white");
  board.set({ x: 3, y: 4 }, "black");
  board.set({ x: 4, y: 3 }, "black");
  return board;
}

export function getFlipsForMove(
  board: TileGrid<CellState>,
  player: "black" | "white",
  pos: GridPos
): GridPos[] {
  if (board.get(pos) !== null) return [];

  const opponent: "black" | "white" = player === "black" ? "white" : "black";
  const flips: GridPos[] = [];

  for (const [dx, dy] of DIRECTIONS_8) {
    const rayFlips: GridPos[] = [];
    let bracketed = false;

    for (const step of board.ray(pos, dx, dy)) {
      if (step.value === opponent) {
        rayFlips.push(step.pos);
      } else if (step.value === player) {
        if (rayFlips.length > 0) bracketed = true;
        break;
      } else {
        break;
      }
    }

    if (bracketed) {
      flips.push(...rayFlips);
    }
  }

  return flips;
}

export function isValidMove(
  board: TileGrid<CellState>,
  player: "black" | "white",
  pos: GridPos
): boolean {
  return getFlipsForMove(board, player, pos).length > 0;
}

export function legalMoves(
  board: TileGrid<CellState>,
  player: "black" | "white"
): GridPos[] {
  const valid: GridPos[] = [];
  for (let y = 0; y < board.height; y++) {
    for (let x = 0; x < board.width; x++) {
      const pos = { x, y };
      if (isValidMove(board, player, pos)) {
        valid.push(pos);
      }
    }
  }
  return valid;
}

export function hasAnyLegalMove(
  board: TileGrid<CellState>,
  player: "black" | "white"
): boolean {
  for (let y = 0; y < board.height; y++) {
    for (let x = 0; x < board.width; x++) {
      if (isValidMove(board, player, { x, y })) return true;
    }
  }
  return false;
}

export function applyMove(
  board: TileGrid<CellState>,
  player: "black" | "white",
  pos: GridPos
): void {
  const flips = getFlipsForMove(board, player, pos);
  if (flips.length === 0) return;

  board.set(pos, player);
  for (const flipPos of flips) {
    board.set(flipPos, player);
  }
}

export function countPieces(board: TileGrid<CellState>): { black: number; white: number } {
  let black = 0;
  let white = 0;
  for (let y = 0; y < board.height; y++) {
    for (let x = 0; x < board.width; x++) {
      const cell = board.get({ x, y });
      if (cell === "black") black++;
      else if (cell === "white") white++;
    }
  }
  return { black, white };
}
