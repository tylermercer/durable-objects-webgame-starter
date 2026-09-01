import React, { useState, useCallback, useMemo, useEffect } from "react";
import type { ControllerContext } from "./controller";
import { usePeerControlMessage } from "@react/reactBridge";
import { WebHaptics } from "web-haptics";
import { TileGrid } from "@utils/tileGrid";
import { legalMoves } from "./rules";
import type { CellState, OthelloControlMessage, PublicOthelloState } from "./types";

export const OthelloController: React.FC<{ ctx: ControllerContext }> = ({ ctx }) => {
  const haptics = useMemo(() => new WebHaptics(), []);
  const [gameState, setGameState] = useState<PublicOthelloState | null>(null);

  useEffect(() => {
    return () => {
      haptics.destroy();
    };
  }, [haptics]);

  const handleControlMessage = useCallback((msg: unknown) => {
    const m = msg as OthelloControlMessage;
    if (m.type === "gameState") {
      setGameState(m.state);
    }
  }, []);

  usePeerControlMessage(ctx.peerConnection, handleControlMessage);

  const currentName = typeof document !== "undefined"
    ? document.getElementById("player-name")?.textContent || ""
    : "";
  const cleanCurrentName = currentName.replace(/\s*\(Host\)$/, "").trim();

  const role: "black" | "white" | "spectator" = useMemo(() => {
    if (!gameState) return "spectator";
    const matchesName = (name?: string | null) => {
      if (!name) return false;
      const trimmed = name.trim();
      return (
        name === cleanCurrentName ||
        name === currentName ||
        trimmed === cleanCurrentName ||
        trimmed === currentName.trim()
      );
    };

    if (gameState.blackPlayer && matchesName(gameState.blackPlayer.name)) {
      return "black";
    }
    if (gameState.whitePlayer && matchesName(gameState.whitePlayer.name)) {
      return "white";
    }
    return "spectator";
  }, [gameState, cleanCurrentName, currentName]);

  const isTurnByName = useMemo(() => {
    if (!gameState?.turnPlayerName) return false;
    const name = gameState.turnPlayerName;
    const trimmed = name.trim();
    return (
      name === cleanCurrentName ||
      name === currentName ||
      trimmed === cleanCurrentName ||
      trimmed === currentName.trim()
    );
  }, [gameState?.turnPlayerName, cleanCurrentName, currentName]);

  const isTurnByRole = useMemo(() => {
    if (!gameState || role === "spectator") return false;
    if (role === "black") {
      return (
        (gameState.blackPlayer && gameState.turnPlayerId === gameState.blackPlayer.id) ||
        (gameState.blackPlayer && gameState.turnPlayerName === gameState.blackPlayer.name)
      );
    }
    if (role === "white") {
      return (
        (gameState.whitePlayer && gameState.turnPlayerId === gameState.whitePlayer.id) ||
        (gameState.whitePlayer && gameState.turnPlayerName === gameState.whitePlayer.name)
      );
    }
    return false;
  }, [gameState, role]);

  const isMyTurn = gameState?.phase === "playing" && (isTurnByName || isTurnByRole);

  const legalMoveSet = useMemo(() => {
    if (!gameState || !isMyTurn || role === "spectator") return new Set<string>();
    const board = TileGrid.fromJSON<CellState>(gameState.board);
    const moves = legalMoves(board, role);
    return new Set(moves.map(m => `${m.x},${m.y}`));
  }, [gameState, isMyTurn, role]);

  const handleCellClick = (x: number, y: number) => {
    if (!isMyTurn || !ctx.peerConnection) return;
    if (!legalMoveSet.has(`${x},${y}`)) return;

    haptics.trigger("light");
    ctx.peerConnection.sendControl({
      type: "placePiece",
      x,
      y,
    } as OthelloControlMessage);
  };

  const handleStartGame = () => {
    if (!ctx.peerConnection) return;
    haptics.trigger("light");
    ctx.peerConnection.sendControl({ type: "requestStart" } as OthelloControlMessage);
  };

  const handlePlayAgain = () => {
    if (!ctx.peerConnection) return;
    haptics.trigger("light");
    ctx.peerConnection.sendControl({ type: "playAgain" } as OthelloControlMessage);
  };

  if (!gameState) {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh", background: "#0f172a", color: "#94a3b8" }}>
        Connecting to Othello session...
      </div>
    );
  }

  const isWaiting = gameState.phase === "waiting";
  const isOver = gameState.phase === "roundOver";
  const isFirst = ctx.isFirstPlayer ? ctx.isFirstPlayer() : false;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "space-between",
        minHeight: "100vh",
        width: "100%",
        background: "#0f172a",
        color: "#ffffff",
        padding: "1rem",
        boxSizing: "border-box",
        userSelect: "none",
        touchAction: "none",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      {/* Role and Turn Header */}
      <header style={{ textAlign: "center", margin: "0.5rem 0", width: "100%", maxWidth: "360px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "#1e293b",
            padding: "0.75rem",
            borderRadius: "12px",
            border: "1px solid #334155",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <div
              style={{
                width: "16px",
                height: "16px",
                borderRadius: "50%",
                background: role === "black" ? "#020617" : role === "white" ? "#f8fafc" : "#64748b",
                border: "1px solid #475569",
              }}
            />
            <span style={{ fontWeight: "bold", fontSize: "0.9rem", textTransform: "capitalize" }}>
              Role: {role}
            </span>
          </div>

          <div style={{ fontSize: "0.75rem", fontWeight: 600, padding: "0.25rem 0.6rem", borderRadius: "9999px", background: "#334155", color: "#cbd5e1" }}>
            {role === "black" ? `${gameState.blackCount} pts` : role === "white" ? `${gameState.whiteCount} pts` : "Spectating"}
          </div>
        </div>

        <div style={{ marginTop: "0.75rem", fontSize: "0.9rem", fontWeight: 600 }}>
          {isWaiting && "Waiting for game to start..."}
          {gameState.phase === "playing" && (
            isMyTurn ? (
              <span style={{ color: "#34d399", fontWeight: "bold" }}>
                🔥 YOUR TURN! Tap a highlighted cell.
              </span>
            ) : (
              <span style={{ color: "#94a3b8" }}>
                Waiting for {gameState.turnPlayerName ?? "opponent"}...
              </span>
            )
          )}
          {isOver && gameState.winner && (
            <span style={{ color: "#fde047", fontWeight: "bold" }}>
              {gameState.winner.color === "tie"
                ? "Game ended in a Tie!"
                : `${gameState.winner.name} (${gameState.winner.color.toUpperCase()}) Wins!`}
            </span>
          )}
        </div>
      </header>

      {/* Mini Board */}
      <main style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "100%", maxWidth: "340px", margin: "0.5rem 0" }}>
        <div
          style={{
            background: "#064e3b",
            padding: "8px",
            borderRadius: "16px",
            boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.5)",
            border: "2px solid #022c22",
            width: "100%",
            aspectRatio: "1 / 1",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(8, 1fr)",
              gap: "3px",
              background: "#022c22",
              padding: "3px",
              borderRadius: "12px",
              width: "100%",
              height: "100%",
              boxSizing: "border-box",
            }}
          >
            {Array.from({ length: 64 }).map((_, idx) => {
              const x = idx % 8;
              const y = Math.floor(idx / 8);
              const cellKey = `${x},${y}`;
              const cell = gameState.board.cells[y * 8 + x];
              const isLegal = legalMoveSet.has(cellKey);

              return (
                <button
                  key={cellKey}
                  onClick={() => handleCellClick(x, y)}
                  disabled={!isLegal}
                  style={{
                    width: "100%",
                    height: "100%",
                    borderRadius: "4px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    border: "none",
                    padding: 0,
                    background: isLegal ? "#059669" : "#065f46",
                    cursor: isLegal ? "pointer" : "default",
                    outline: isLegal ? "2px solid #6ee7b7" : "none",
                  }}
                >
                  {cell === "black" && (
                    <div style={{ width: "75%", height: "75%", borderRadius: "50%", background: "#020617", border: "1px solid #334155" }} />
                  )}
                  {cell === "white" && (
                    <div style={{ width: "75%", height: "75%", borderRadius: "50%", background: "#f8fafc", border: "1px solid #cbd5e1" }} />
                  )}
                  {cell === null && isLegal && (
                    <div style={{ width: "10px", height: "10px", borderRadius: "50%", background: "#a7f3d0" }} />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer style={{ width: "100%", maxWidth: "340px", marginBottom: "0.5rem" }}>
        {isWaiting && isFirst && (
          <button
            onClick={handleStartGame}
            style={{
              width: "100%",
              padding: "0.85rem",
              background: "#059669",
              fontWeight: "bold",
              borderRadius: "12px",
              color: "#ffffff",
              border: "none",
              cursor: "pointer",
              fontSize: "1rem",
            }}
          >
            Start Game
          </button>
        )}

        {isOver && isFirst && (
          <button
            onClick={handlePlayAgain}
            style={{
              width: "100%",
              padding: "0.85rem",
              background: "#059669",
              fontWeight: "bold",
              borderRadius: "12px",
              color: "#ffffff",
              border: "none",
              cursor: "pointer",
              fontSize: "1rem",
            }}
          >
            Play Again
          </button>
        )}
      </footer>
    </div>
  );
};
