import React, { useState, useCallback } from "react";
import type { ControllerContext } from "./controller";
import { usePeerControlMessage } from "@react/reactBridge";
import { isPlayable, isWild } from "./rules";
import { COLOR_HEX, cardBackground, cardLabel } from "./cardVisuals";
import type { CardColor, PublicUnoState, UnoCard, UnoControlMessage } from "./types";

const startBtnStyle: React.CSSProperties = {
  padding: "0.75rem 1.5rem",
  fontSize: "1.1rem",
  fontWeight: "bold",
  background: "#2ecc40",
  color: "#fff",
  border: "none",
  borderRadius: "8px",
  cursor: "pointer",
};

function MiniCard({ card, activeColor }: { card: UnoCard; activeColor: CardColor | null }) {
  return (
    <div
      style={{
        width: "40px",
        height: "56px",
        borderRadius: "6px",
        background: cardBackground(card, activeColor),
        color: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "1rem",
        fontWeight: "bold",
      }}
    >
      {cardLabel(card)}
    </div>
  );
}

export function UnoController({ ctx }: { ctx: ControllerContext }) {
  const [myHand, setMyHand] = useState<UnoCard[]>([]);
  const [gameState, setGameState] = useState<PublicUnoState | null>(null);
  const [pendingWildCardId, setPendingWildCardId] = useState<string | null>(null);

  const handleControlMessage = useCallback((msg: unknown) => {
    const m = msg as UnoControlMessage;
    if (m.type === "yourHand") setMyHand(m.hand);
    else if (m.type === "gameState") setGameState(m.state);
  }, []);

  usePeerControlMessage(ctx.peerConnection, handleControlMessage);

  if (!gameState) {
    return (
      <div style={{ padding: "2rem", textAlign: "center", color: "#888" }}>
        Connecting to console...
      </div>
    );
  }

  const isFirst = ctx.isFirstPlayer ? ctx.isFirstPlayer() : false;
  const currentName = typeof document !== "undefined"
    ? document.getElementById("player-name")?.textContent || ""
    : "";
  const cleanCurrentName = currentName.replace(/\s*\(Host\)$/, "");
  const me = gameState.players.find(p => p.name === cleanCurrentName || p.name === currentName);
  const isMyTurn = me ? me.isTurn : false;

  const connectedPlayersCount = gameState.players.filter(p => p.connected).length;
  const firstPlayerName = gameState.firstPlayerId
    ? gameState.players.find(p => p.id === gameState.firstPlayerId)?.name || "host"
    : "host";

  const sendStartRequest = () => {
    ctx.peerConnection?.sendControl({ type: "requestStart" } as unknown as UnoControlMessage);
  };
  const sendPlayAgain = () => {
    ctx.peerConnection?.sendControl({ type: "playAgain" } as unknown as UnoControlMessage);
  };
  const sendDraw = () => {
    ctx.peerConnection?.sendControl({ type: "drawCard" } as unknown as UnoControlMessage);
  };
  const playCard = (card: UnoCard, chosenColor?: CardColor) => {
    ctx.peerConnection?.sendControl({
      type: "playCard",
      cardId: card.id,
      chosenColor,
    } as unknown as UnoControlMessage);
    setPendingWildCardId(null);
  };

  const topCard = gameState.topCard;
  const activeColor = gameState.activeColor;
  const canPlay = (card: UnoCard) =>
    isMyTurn && gameState.phase === "playing" && !!topCard && !!activeColor &&
    isPlayable(card, topCard, activeColor);
  const anyPlayable = myHand.some(canPlay);

  const onTapCard = (card: UnoCard) => {
    if (!canPlay(card)) return;
    if (isWild(card)) {
      setPendingWildCardId(card.id);
    } else {
      playCard(card);
    }
  };

  return (
    <div
      className="controller-uno l-stack l-space-s"
      style={{ padding: "1rem", maxWidth: "420px", margin: "0 auto", width: "100%", boxSizing: "border-box" }}
    >
      <div
        style={{
          background: isMyTurn && gameState.phase === "playing" ? "#1b3b22" : "#2b2b36",
          border: `1px solid ${isMyTurn && gameState.phase === "playing" ? "#2ecc40" : "#444"}`,
          borderRadius: "8px",
          padding: "0.75rem",
          textAlign: "center",
        }}
      >
        {gameState.phase === "waiting" && (
          isFirst ? (
            connectedPlayersCount >= 2 ? (
              <>
                <div style={{ fontSize: "0.95rem", color: "#2ecc40", fontWeight: "bold", marginBottom: "0.5rem" }}>
                  You are the host! Ready to start.
                </div>
                <button id="uno-btn-request-start" onClick={sendStartRequest} style={startBtnStyle}>
                  Start Game 🚀
                </button>
              </>
            ) : (
              <div style={{ fontSize: "0.95rem", color: "#aaa" }}>
                Waiting for at least 2 players to connect...
              </div>
            )
          ) : (
            <div style={{ fontSize: "0.95rem", color: "#aaa" }}>
              Waiting for <strong>{firstPlayerName}</strong> to start…
            </div>
          )
        )}

        {gameState.phase === "playing" && (
          isMyTurn ? (
            <div style={{ fontSize: "1.1rem", fontWeight: "bold", color: "#2ecc40" }}>🔥 YOUR TURN!</div>
          ) : (
            <div style={{ fontSize: "0.95rem", color: "#aaa" }}>
              Waiting for <strong>{gameState.turnPlayerName || "player"}</strong>...
            </div>
          )
        )}

        {gameState.phase === "roundOver" && (
          isFirst ? (
            <>
              <div style={{ fontSize: "1rem", fontWeight: "bold", color: "#ffdc00", marginBottom: "0.5rem" }}>
                🏆 {gameState.winner ? `${gameState.winner.name} wins!` : "Round over"}
              </div>
              <button id="uno-btn-play-again" onClick={sendPlayAgain} style={startBtnStyle}>
                Play Again 🔁
              </button>
            </>
          ) : (
            <div style={{ fontSize: "1rem", fontWeight: "bold", color: "#ffdc00" }}>
              🏆 {gameState.winner ? `${gameState.winner.name} wins!` : "Round over"}
            </div>
          )
        )}
      </div>

      {gameState.phase === "playing" && topCard && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "#1a1a24",
            borderRadius: "8px",
            padding: "0.6rem 0.9rem",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
            <MiniCard card={topCard} activeColor={activeColor} />
            <span style={{ fontSize: "0.8rem", color: "#888" }}>Current</span>
          </div>
          {isMyTurn && !anyPlayable && (
            <button
              id="uno-btn-draw"
              onClick={sendDraw}
              style={{ ...startBtnStyle, padding: "0.5rem 1rem", fontSize: "0.9rem" }}
            >
              Draw 🂠
            </button>
          )}
        </div>
      )}

      {pendingWildCardId && (
        <div style={{ background: "#222", borderRadius: "10px", padding: "0.75rem", textAlign: "center" }}>
          <div style={{ fontSize: "0.85rem", color: "#aaa", marginBottom: "0.5rem" }}>Choose a color:</div>
          <div style={{ display: "flex", gap: "0.5rem", justifyContent: "center" }}>
            {(["red", "yellow", "green", "blue"] as CardColor[]).map(color => (
              <button
                key={color}
                onClick={() => {
                  const card = myHand.find(c => c.id === pendingWildCardId);
                  if (card) playCard(card, color);
                }}
                style={{
                  width: "48px",
                  height: "48px",
                  borderRadius: "50%",
                  background: COLOR_HEX[color],
                  border: "2px solid #fff",
                  cursor: "pointer",
                }}
              />
            ))}
          </div>
          <button
            onClick={() => setPendingWildCardId(null)}
            style={{ marginTop: "0.5rem", background: "none", border: "none", color: "#888", cursor: "pointer", fontSize: "0.8rem" }}
          >
            Cancel
          </button>
        </div>
      )}

      <div>
        <div style={{ fontSize: "0.75rem", textTransform: "uppercase", color: "#888", marginBottom: "0.4rem", textAlign: "center" }}>
          Your Hand ({myHand.length})
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", justifyContent: "center" }}>
          {myHand.map(card => {
            const playable = canPlay(card);
            return (
              <button
                key={card.id}
                className="uno-hand-card"
                data-card-id={card.id}
                onClick={() => onTapCard(card)}
                disabled={!playable}
                style={{
                  width: "56px",
                  height: "80px",
                  borderRadius: "8px",
                  background: cardBackground(card, activeColor),
                  color: "#fff",
                  fontSize: "1.3rem",
                  fontWeight: "bold",
                  border: card.color === "wild" ? "2px dashed #fff" : "2px solid rgba(255,255,255,0.4)",
                  opacity: playable ? 1 : 0.45,
                  cursor: playable ? "pointer" : "not-allowed",
                  transform: playable ? "translateY(-4px)" : "none",
                  transition: "transform 0.1s",
                }}
              >
                {cardLabel(card)}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
