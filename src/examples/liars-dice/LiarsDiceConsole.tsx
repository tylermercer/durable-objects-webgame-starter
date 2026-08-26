import { useSyncExternalStore } from "react";
import type { createStore } from "@react/reactStore";
import type { PublicGameState } from "./types";
import type { ConsoleContext } from "./console";

const diceIcons = ["🎲", "⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];

export function LiarsDiceConsole({
  store,
  ctx,
  onStartRound,
  onNewGame,
}: {
  store: ReturnType<typeof createStore<PublicGameState>>;
  ctx: ConsoleContext;
  onStartRound: (keepRoundNumber?: boolean) => void;
  onNewGame: () => void;
}) {
  const state = useSyncExternalStore(store.subscribe, store.get);

  return (
    <div
      className="ld-card l-box l-stack l-space-s"
      style={{
        background: "#1e1e24",
        color: "#fff",
        padding: "1.5rem",
        borderRadius: "12px",
        boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          borderBottom: "1px solid #333",
          paddingBottom: "0.75rem",
        }}
      >
        <h2 style={{ margin: 0, fontSize: "1.5rem" }}>🎲 Liar's Dice</h2>
        <div style={{ fontSize: "0.9rem", color: "#aaa" }}>
          Round {state.roundNumber} &bull; Total Dice in Play:{" "}
          <strong>{state.totalDiceInPlay}</strong>
        </div>
      </div>

      {state.phase === "waiting" && (
        <div style={{ textAlign: "center", padding: "2rem 1rem" }}>
          <h3 style={{ marginBottom: "0.5rem" }}>Waiting for Players...</h3>
          <p style={{ color: "#aaa" }}>
            Need at least 2 players connected via QR code to play.
          </p>
          <p style={{ fontWeight: "bold", color: "#0070f3" }}>
            Connected Players: {ctx.peers.size}
          </p>
          {ctx.peers.size >= 2 && (
            <button
              id="ld-start-btn"
              onClick={() => onStartRound(true)}
              style={{
                padding: "0.75rem 2rem",
                fontSize: "1.2rem",
                fontWeight: "bold",
                background: "#2ecc40",
                color: "#fff",
                border: "none",
                borderRadius: "8px",
                cursor: "pointer",
              }}
            >
              Start Game
            </button>
          )}
        </div>
      )}

      {state.phase === "bidding" && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "1rem",
            marginTop: "0.5rem",
          }}
        >
          <div
            style={{
              background: "#2b2b36",
              padding: "1rem",
              borderRadius: "8px",
              textAlign: "center",
            }}
          >
            <div
              style={{
                fontSize: "0.85rem",
                color: "#aaa",
                textTransform: "uppercase",
              }}
            >
              Current Bid
            </div>
            <div
              style={{
                fontSize: "1.8rem",
                fontWeight: "bold",
                color: "#ffdc00",
                margin: "0.5rem 0",
              }}
            >
              {state.currentBid
                ? `${state.currentBid.count} × ${
                    diceIcons[state.currentBid.face] || state.currentBid.face
                  }`
                : "No bids yet"}
            </div>
            <div style={{ fontSize: "0.9rem", color: "#bbb" }}>
              {state.currentBid
                ? `by ${state.currentBid.bidderName}`
                : "Waiting for first bid"}
            </div>
          </div>

          <div
            style={{
              background: "#2b2b36",
              padding: "1rem",
              borderRadius: "8px",
              textAlign: "center",
            }}
          >
            <div
              style={{
                fontSize: "0.85rem",
                color: "#aaa",
                textTransform: "uppercase",
              }}
            >
              Turn
            </div>
            <div
              style={{
                fontSize: "1.4rem",
                fontWeight: "bold",
                color: "#7fdbff",
                margin: "0.5rem 0",
              }}
            >
              {state.turnPlayerName || "—"}
            </div>
          </div>
        </div>
      )}

      {state.phase === "revealing" && state.lastChallengeResult && (
        <div
          style={{
            background: "#2b2b36",
            padding: "1.25rem",
            borderRadius: "8px",
            textAlign: "center",
            marginTop: "0.5rem",
          }}
        >
          <h3 style={{ margin: "0 0 0.5rem 0", color: "#ff4136" }}>
            ⚡ Challenge Revealed!
          </h3>
          <p style={{ fontSize: "1.1rem", margin: "0.25rem 0" }}>
            <strong>{state.lastChallengeResult.challengerName}</strong> called
            Liar on <strong>{state.lastChallengeResult.bidderName}</strong>'s bid of{" "}
            <strong>
              {state.lastChallengeResult.bid.count} ×{" "}
              {diceIcons[state.lastChallengeResult.bid.face]}
            </strong>
            .
          </p>
          <div
            style={{
              fontSize: "1.4rem",
              fontWeight: "bold",
              color: "#ffdc00",
              margin: "0.75rem 0",
            }}
          >
            Actual count of {diceIcons[state.lastChallengeResult.bid.face]}s:{" "}
            {state.lastChallengeResult.actualCount}
          </div>
          <p
            style={{
              fontSize: "1.1rem",
              fontWeight: "bold",
              color: state.lastChallengeResult.challengeSuccess
                ? "#2ecc40"
                : "#ff4136",
            }}
          >
            {state.lastChallengeResult.challengeSuccess
              ? `Challenge Success! ${state.lastChallengeResult.bidderName} lied!`
              : `Challenge Failed! ${state.lastChallengeResult.bidderName} told the truth!`}
          </p>
          <p style={{ fontSize: "0.95rem", color: "#aaa" }}>
            <strong>{state.lastChallengeResult.loserName}</strong> loses 1 die!
          </p>
        </div>
      )}

      {state.phase === "gameOver" && state.winner && (
        <div style={{ textAlign: "center", padding: "2rem 1rem" }}>
          <h2
            style={{
              fontSize: "2rem",
              color: "#ffdc00",
              marginBottom: "0.5rem",
            }}
          >
            🏆 Game Over!
          </h2>
          <h3 style={{ fontSize: "1.5rem", color: "#fff" }}>
            Winner: {state.winner.name}
          </h3>
          <button
            id="ld-newgame-btn"
            onClick={onNewGame}
            style={{
              marginTop: "1.5rem",
              padding: "0.75rem 2rem",
              fontSize: "1.1rem",
              fontWeight: "bold",
              background: "#0070f3",
              color: "#fff",
              border: "none",
              borderRadius: "8px",
              cursor: "pointer",
            }}
          >
            Play Again
          </button>
        </div>
      )}

      <div style={{ marginTop: "1rem" }}>
        <h4
          style={{
            marginBottom: "0.5rem",
            color: "#aaa",
            fontSize: "0.9rem",
            textTransform: "uppercase",
          }}
        >
          Players & Dice
        </h4>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {state.players.map((p) => {
            const isTurn = p.id === state.turnPlayerId && state.phase === "bidding";
            const isRevealing =
              state.phase === "revealing" || state.phase === "gameOver";

            return (
              <div
                key={p.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  background: isTurn ? "#3a3a4c" : "#272733",
                  borderLeft: `4px solid ${p.color}`,
                  padding: "0.6rem 1rem",
                  borderRadius: "6px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <span style={{ fontWeight: "bold" }}>{p.name}</span>
                  {p.id === state.firstPlayerId && (
                    <span
                      style={{
                        fontSize: "0.75rem",
                        background: "#ffdc00",
                        color: "#000",
                        padding: "2px 6px",
                        borderRadius: "4px",
                        fontWeight: "bold",
                      }}
                    >
                      HOST
                    </span>
                  )}
                  {isTurn && (
                    <span
                      style={{
                        fontSize: "0.75rem",
                        background: "#7fdbff",
                        color: "#000",
                        padding: "2px 6px",
                        borderRadius: "4px",
                        fontWeight: "bold",
                      }}
                    >
                      TURN
                    </span>
                  )}
                  {!p.connected && (
                    <span
                      style={{
                        fontSize: "0.75rem",
                        background: "#ff4136",
                        color: "#fff",
                        padding: "2px 6px",
                        borderRadius: "4px",
                      }}
                    >
                      OFFLINE
                    </span>
                  )}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                  <span style={{ fontSize: "1.1rem" }}>
                    {isRevealing && p.dice ? (
                      p.dice.map((d, i) => (
                        <span
                          key={i}
                          style={{
                            margin: "0 1px",
                            color:
                              state.lastChallengeResult &&
                              d === state.lastChallengeResult.bid.face
                                ? "#ffdc00"
                                : "#ccc",
                            fontWeight:
                              state.lastChallengeResult &&
                              d === state.lastChallengeResult.bid.face
                                ? "bold"
                                : "normal",
                          }}
                        >
                          {diceIcons[d] || d}
                        </span>
                      ))
                    ) : (
                      Array(p.diceCount).fill("🎲").join(" ")
                    )}
                  </span>
                  <span style={{ fontWeight: "bold", color: "#aaa" }}>
                    ({p.diceCount})
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
