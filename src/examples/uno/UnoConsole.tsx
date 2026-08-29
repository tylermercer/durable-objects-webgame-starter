import { useSyncExternalStore } from "react";
import type { createStore } from "@react/reactStore";
import type { CardColor, PublicUnoState, UnoCard } from "./types";
import type { ConsoleContext } from "@contract/gameTypes";
import { cardBackground, cardLabel } from "./cardVisuals";

function CardFace({ card, activeColor }: { card: UnoCard; activeColor: CardColor | null }) {
  const bg = cardBackground(card, activeColor);
  return (
    <div
      style={{
        width: "70px",
        height: "100px",
        borderRadius: "10px",
        background: bg,
        color: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "1.8rem",
        fontWeight: "bold",
        border: card.color === "wild" ? "3px dashed #fff" : "3px solid rgba(255,255,255,0.4)",
        boxShadow: "0 4px 10px rgba(0,0,0,0.4)",
      }}
    >
      {cardLabel(card)}
    </div>
  );
}

export function UnoConsole({
  store,
  ctx,
  onStartGame,
}: {
  store: ReturnType<typeof createStore<PublicUnoState>>;
  ctx: ConsoleContext;
  onStartGame: () => void;
}) {
  const state = useSyncExternalStore(store.subscribe, store.get);

  return (
    <div
      className="uno-card l-box l-stack l-space-s"
      style={{
        background: "#1e1e24",
        color: "#fff",
        padding: "1.5rem",
        borderRadius: "12px",
        boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
        inlineSize: "min(720px, 100%)",
        marginInline: "auto",
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
        <h2 style={{ margin: 0, fontSize: "1.5rem" }}>🃏 Uno</h2>
        <div style={{ fontSize: "0.9rem", color: "#aaa" }}>
          Draw pile: <strong>{state.drawPileCount}</strong>
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
              id="uno-start-btn"
              onClick={onStartGame}
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

      {(state.phase === "playing" || state.phase === "roundOver") && (
        <>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "1.5rem",
              padding: "1rem 0",
            }}
          >
            {state.topCard && <CardFace card={state.topCard} activeColor={state.activeColor} />}
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: "0.75rem", color: "#888", textTransform: "uppercase" }}>
                Direction
              </div>
              <div style={{ fontSize: "1.8rem" }}>{state.direction === 1 ? "↻" : "↺"}</div>
            </div>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", justifyContent: "center" }}>
            {state.players.map(p => (
              <div
                key={p.id}
                style={{
                  padding: "0.5rem 0.9rem",
                  borderRadius: "8px",
                  background: p.isTurn ? "#1b3b22" : "#2b2b36",
                  border: `2px solid ${p.isTurn ? "#2ecc40" : "#444"}`,
                  opacity: p.connected ? 1 : 0.5,
                  textAlign: "center",
                }}
              >
                <div style={{ fontWeight: "bold", color: p.color }}>{p.name}</div>
                <div style={{ fontSize: "0.85rem", color: "#ccc" }}>{p.cardCount} cards</div>
                {p.isTurn && <div style={{ fontSize: "0.75rem", color: "#2ecc40" }}>Their turn</div>}
              </div>
            ))}
          </div>

          {state.phase === "roundOver" && (
            <div style={{ textAlign: "center", marginTop: "1rem" }}>
              <h3 style={{ color: "#ffdc00" }}>
                🏆 {state.winner ? `${state.winner.name} wins!` : "Round over"}
              </h3>
              <p style={{ color: "#aaa", fontSize: "0.9rem" }}>
                Waiting for the host to start a new game from their phone…
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
