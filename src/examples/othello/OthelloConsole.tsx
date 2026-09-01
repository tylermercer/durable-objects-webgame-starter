import React, { useSyncExternalStore } from "react";
import type { ConsoleContext } from "@contract/gameTypes";
import type { createStore } from "@react/reactStore";
import type { PublicOthelloState } from "./types";

interface Props {
  store: ReturnType<typeof createStore<PublicOthelloState>>;
  ctx: ConsoleContext;
  onStartGame: () => void;
}

export const OthelloConsole: React.FC<Props> = ({ store, ctx, onStartGame }) => {
  const state = useSyncExternalStore(store.subscribe, store.get);

  const blackPlayer = state.blackPlayer;
  const whitePlayer = state.whitePlayer;
  const blackInfo = state.players.find(p => p.id === blackPlayer?.id);
  const whiteInfo = state.players.find(p => p.id === whitePlayer?.id);
  const isBlackConnected = blackInfo ? blackInfo.connected : true;
  const isWhiteConnected = whiteInfo ? whiteInfo.connected : true;

  const isWaiting = state.phase === "waiting";
  const isPlaying = state.phase === "playing";
  const isOver = state.phase === "roundOver";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "space-between",
        minHeight: "100%",
        width: "100%",
        padding: "1rem",
        background: "#0f172a",
        color: "#ffffff",
        fontFamily: "system-ui, sans-serif",
        boxSizing: "border-box",
      }}
    >
      {/* Header */}
      <header style={{ textAlign: "center", margin: "0.5rem 0" }}>
        <h1 style={{ fontSize: "2.25rem", fontWeight: 800, color: "#34d399", margin: 0 }}>
          Othello
        </h1>
        <p style={{ color: "#94a3b8", fontSize: "0.9rem", marginTop: "0.25rem" }}>
          {isWaiting && "Connect 2 controllers to start"}
          {isPlaying && (
            <span>
              Turn: <strong style={{ color: "#6ee7b7" }}>{state.turnPlayerName ?? "Unknown"}</strong>
            </span>
          )}
          {isOver && state.winner && (
            <span style={{ color: "#fde047", fontWeight: "bold", fontSize: "1.1rem" }}>
              {state.winner.color === "tie"
                ? "It's a Tie!"
                : `Winner: ${state.winner.name} (${state.winner.color.toUpperCase()})`}
            </span>
          )}
        </p>
      </header>

      {/* Board */}
      <main style={{ display: "flex", justifyContent: "center", alignItems: "center", margin: "1rem 0" }}>
        <div
          style={{
            background: "#064e3b",
            padding: "12px",
            borderRadius: "16px",
            boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.5)",
            border: "4px solid #022c22",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(8, 1fr)",
              gap: "4px",
              background: "#022c22",
              padding: "4px",
              borderRadius: "12px",
            }}
          >
            {Array.from({ length: 64 }).map((_, idx) => {
              const x = idx % 8;
              const y = Math.floor(idx / 8);
              const cell = state.board.cells[y * 8 + x];

              return (
                <div
                  key={`${x}-${y}`}
                  style={{
                    width: "44px",
                    height: "44px",
                    background: "#047857",
                    borderRadius: "6px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    position: "relative",
                  }}
                >
                  {cell === "black" && (
                    <div
                      style={{
                        width: "36px",
                        height: "36px",
                        borderRadius: "50%",
                        background: "#020617",
                        border: "2px solid #334155",
                        boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.5)",
                      }}
                    />
                  )}
                  {cell === "white" && (
                    <div
                      style={{
                        width: "36px",
                        height: "36px",
                        borderRadius: "50%",
                        background: "#f8fafc",
                        border: "2px solid #cbd5e1",
                        boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.3)",
                      }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </main>

      {/* Footer & Controls */}
      <footer style={{ width: "100%", maxWidth: "480px", display: "flex", flexDirection: "column", gap: "1rem" }}>
        <div style={{ display: "flex", gap: "1rem", width: "100%" }}>
          {/* Black Player Card */}
          <div
            style={{
              flex: 1,
              padding: "0.75rem",
              borderRadius: "12px",
              background: "#1e293b",
              border: `2px solid ${state.turnPlayerId === blackPlayer?.id ? "#34d399" : "#334155"}`,
              display: "flex",
              alignItems: "center",
              gap: "0.75rem",
              opacity: isBlackConnected ? 1 : 0.5,
            }}
          >
            <div
              style={{
                width: "32px",
                height: "32px",
                borderRadius: "50%",
                background: "#020617",
                border: "1px solid #475569",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: "bold",
                fontSize: "0.85rem",
                color: "#ffffff",
              }}
            >
              {state.blackCount}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: "0.7rem", color: "#94a3b8", textTransform: "uppercase", fontWeight: 600 }}>
                Black
              </div>
              <div style={{ fontSize: "0.9rem", fontWeight: "bold", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {blackPlayer ? blackPlayer.name : "Waiting..."} {!isBlackConnected && "(Reconnecting...)"}
              </div>
            </div>
          </div>

          {/* White Player Card */}
          <div
            style={{
              flex: 1,
              padding: "0.75rem",
              borderRadius: "12px",
              background: "#1e293b",
              border: `2px solid ${state.turnPlayerId === whitePlayer?.id ? "#34d399" : "#334155"}`,
              display: "flex",
              alignItems: "center",
              gap: "0.75rem",
              opacity: isWhiteConnected ? 1 : 0.5,
            }}
          >
            <div
              style={{
                width: "32px",
                height: "32px",
                borderRadius: "50%",
                background: "#f8fafc",
                border: "1px solid #cbd5e1",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: "bold",
                fontSize: "0.85rem",
                color: "#0f172a",
              }}
            >
              {state.whiteCount}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: "0.7rem", color: "#94a3b8", textTransform: "uppercase", fontWeight: 600 }}>
                White
              </div>
              <div style={{ fontSize: "0.9rem", fontWeight: "bold", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {whitePlayer ? whitePlayer.name : "Waiting..."} {!isWhiteConnected && "(Reconnecting...)"}
              </div>
            </div>
          </div>
        </div>

        {isWaiting && (
          <button
            onClick={onStartGame}
            disabled={ctx.peers.size < 2}
            style={{
              width: "100%",
              padding: "0.85rem",
              fontSize: "1.1rem",
              fontWeight: "bold",
              borderRadius: "12px",
              background: ctx.peers.size < 2 ? "#334155" : "#059669",
              color: "#ffffff",
              border: "none",
              cursor: ctx.peers.size < 2 ? "not-allowed" : "pointer",
              opacity: ctx.peers.size < 2 ? 0.6 : 1,
            }}
          >
            {ctx.peers.size < 2 ? "Waiting for 2 Players..." : "Start Othello"}
          </button>
        )}

        {isOver && (
          <button
            onClick={onStartGame}
            style={{
              width: "100%",
              padding: "0.85rem",
              fontSize: "1.1rem",
              fontWeight: "bold",
              borderRadius: "12px",
              background: "#059669",
              color: "#ffffff",
              border: "none",
              cursor: "pointer",
            }}
          >
            Play Again
          </button>
        )}
      </footer>
    </div>
  );
};
