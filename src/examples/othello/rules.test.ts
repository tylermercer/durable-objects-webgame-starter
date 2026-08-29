import { describe, expect, it } from "vitest";
import { TileGrid } from "@utils/tileGrid";
import {
  createInitialBoard,
  getFlipsForMove,
  legalMoves,
  hasAnyLegalMove,
  applyMove,
  countPieces,
} from "./rules";
import type { CellState } from "./types";

describe("Othello rules", () => {
  it("creates initial 8x8 board with standard center pieces", () => {
    const board = createInitialBoard();
    expect(board.width).toBe(8);
    expect(board.height).toBe(8);

    expect(board.get({ x: 3, y: 3 })).toBe("white");
    expect(board.get({ x: 4, y: 4 })).toBe("white");
    expect(board.get({ x: 3, y: 4 })).toBe("black");
    expect(board.get({ x: 4, y: 3 })).toBe("black");

    const counts = countPieces(board);
    expect(counts).toEqual({ black: 2, white: 2 });
  });

  it("calculates initial legal moves for black player", () => {
    const board = createInitialBoard();
    const moves = legalMoves(board, "black");
    expect(moves).toHaveLength(4);
    expect(moves).toContainEqual({ x: 2, y: 3 });
    expect(moves).toContainEqual({ x: 3, y: 2 });
    expect(moves).toContainEqual({ x: 4, y: 5 });
    expect(moves).toContainEqual({ x: 5, y: 4 });
  });

  it("applies move and flips bracketed opponent pieces", () => {
    const board = createInitialBoard();
    const flips = getFlipsForMove(board, "black", { x: 2, y: 3 });
    expect(flips).toEqual([{ x: 3, y: 3 }]);

    applyMove(board, "black", { x: 2, y: 3 });
    expect(board.get({ x: 2, y: 3 })).toBe("black");
    expect(board.get({ x: 3, y: 3 })).toBe("black");

    const counts = countPieces(board);
    expect(counts).toEqual({ black: 4, white: 1 });
  });

  it("flips in multiple directions simultaneously", () => {
    const board = new TileGrid<CellState>(8, 8, () => null);
    board.set({ x: 3, y: 3 }, "white");
    board.set({ x: 3, y: 4 }, "white");
    board.set({ x: 3, y: 5 }, "black");

    board.set({ x: 4, y: 2 }, "white");
    board.set({ x: 5, y: 2 }, "black");

    board.set({ x: 4, y: 3 }, "white");
    board.set({ x: 5, y: 4 }, "black");

    const flips = getFlipsForMove(board, "black", { x: 3, y: 2 });
    expect(flips).toContainEqual({ x: 3, y: 3 });
    expect(flips).toContainEqual({ x: 3, y: 4 });
    expect(flips).toContainEqual({ x: 4, y: 2 });
    expect(flips).toContainEqual({ x: 4, y: 3 });
    expect(flips).toHaveLength(4);

    applyMove(board, "black", { x: 3, y: 2 });
    expect(board.get({ x: 3, y: 2 })).toBe("black");
    expect(board.get({ x: 3, y: 3 })).toBe("black");
    expect(board.get({ x: 3, y: 4 })).toBe("black");
    expect(board.get({ x: 4, y: 2 })).toBe("black");
    expect(board.get({ x: 4, y: 3 })).toBe("black");
  });

  it("correctly identifies when a player has no legal moves", () => {
    const board = new TileGrid<CellState>(8, 8, () => "black");
    expect(hasAnyLegalMove(board, "white")).toBe(false);
    expect(hasAnyLegalMove(board, "black")).toBe(false);
  });
});
