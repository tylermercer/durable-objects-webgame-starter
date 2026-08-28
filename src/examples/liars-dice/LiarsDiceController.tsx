import React, { useState, useEffect, useCallback, useMemo } from "react";
import type { ControllerContext } from "./controller";
import { usePeerControlMessage } from "@react/reactBridge";
import { isValidBid } from "./rules";
import type {
  LiarsDiceControlMessage,
  PublicGameState,
} from "./types";
import { WebHaptics } from "web-haptics";

const diceIcons = ["🎲", "⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];

export function LiarsDiceController({ ctx }: { ctx: ControllerContext }) {
  const haptics = useMemo(() => new WebHaptics(), []);
  const [myDice, setMyDice] = useState<number[]>([]);

  useEffect(() => {
    return () => {
      haptics.destroy();
    };
  }, [haptics]);
  const [gameState, setGameState] = useState<PublicGameState | null>(null);
  const [selectedCount, setSelectedCount] = useState<number>(1);
  const [selectedFace, setSelectedFace] = useState<number>(2);

  const handleControlMessage = useCallback((msg: unknown) => {
    const ldMsg = msg as LiarsDiceControlMessage;
    if (ldMsg.type === "privateDice") {
      setMyDice(ldMsg.dice);
    } else if (ldMsg.type === "gameState") {
      setGameState(ldMsg.state);
    }
  }, []);

  usePeerControlMessage(ctx.peerConnection, handleControlMessage);

  useEffect(() => {
    if (gameState && gameState.currentBid) {
      const cb = gameState.currentBid;
      if (cb.face < 6) {
        setSelectedCount(cb.count);
        setSelectedFace(cb.face + 1);
      } else {
        setSelectedCount(cb.count + 1);
        setSelectedFace(1);
      }
    } else {
      setSelectedCount(1);
      setSelectedFace(2);
    }
  }, [gameState?.currentBid]);

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
  const me = gameState.players.find(
    (p) => p.name === cleanCurrentName || p.name === currentName
  );
  const isMyTurn = gameState.turnPlayerName === currentName ||
    gameState.players.some((p) => p.isTurn && p.connected);
  const isActuallyMyTurn = me ? me.isTurn : isMyTurn;

  const totalDice = gameState.totalDiceInPlay;
  const bidValid =
    isActuallyMyTurn &&
    gameState.phase === "bidding" &&
    isValidBid(
      gameState.currentBid,
      { count: selectedCount, face: selectedFace },
      totalDice
    );

  const connectedPlayersCount = gameState.players.filter((p) => p.connected).length;
  const firstPlayerName = gameState.firstPlayerId
    ? gameState.players.find((p) => p.id === gameState?.firstPlayerId)?.name || "host"
    : "host";

  const sendStartRequest = () => {
    if (!ctx.peerConnection) return;
    haptics.trigger("light");
    ctx.peerConnection.sendControl({
      type: "requestStart",
    } as unknown as LiarsDiceControlMessage);
  };

  const sendBid = () => {
    if (!ctx.peerConnection || !gameState) return;
    if (
      isValidBid(
        gameState.currentBid,
        { count: selectedCount, face: selectedFace },
        totalDice
      )
    ) {
      haptics.trigger("light");
      ctx.peerConnection.sendControl({
        type: "bid",
        count: selectedCount,
        face: selectedFace,
      } as unknown as LiarsDiceControlMessage);
    }
  };

  const sendChallenge = () => {
    if (!ctx.peerConnection || !gameState || !gameState.currentBid) return;
    haptics.trigger("light");
    ctx.peerConnection.sendControl({
      type: "challenge",
    } as unknown as LiarsDiceControlMessage);
  };

  return (
    <div
      className="controller-liars-dice l-stack l-space-s"
      style={{
        padding: "1rem",
        maxWidth: "400px",
        margin: "0 auto",
        width: "100%",
        boxSizing: "border-box",
      }}
    >
      {/* Private Dice Box */}
      <div
        style={{
          background: "#222",
          border: "1px solid #444",
          borderRadius: "10px",
          padding: "0.75rem 1rem",
          textAlign: "center",
        }}
      >
        <div
          style={{
            fontSize: "0.75rem",
            textTransform: "uppercase",
            color: "#888",
            marginBottom: "0.25rem",
          }}
        >
          Your Dice
        </div>
        <div
          style={{
            fontSize: "1.8rem",
            fontWeight: "bold",
            letterSpacing: "4px",
          }}
        >
          {myDice.length > 0
            ? myDice.map((d) => diceIcons[d] || d).join(" ")
            : "(No dice)"}
        </div>
      </div>

      {/* Status Banner */}
      <div
        style={{
          background:
            isActuallyMyTurn && gameState.phase === "bidding"
              ? "#1b3b22"
              : "#2b2b36",
          border: `1px solid ${
            isActuallyMyTurn && gameState.phase === "bidding"
              ? "#2ecc40"
              : "#444"
          }`,
          borderRadius: "8px",
          padding: "0.75rem",
          textAlign: "center",
        }}
      >
        {gameState.phase === "waiting" && (
          <>
            {isFirst ? (
              connectedPlayersCount >= 2 ? (
                <>
                  <div
                    style={{
                      fontSize: "0.95rem",
                      color: "#2ecc40",
                      fontWeight: "bold",
                      marginBottom: "0.5rem",
                    }}
                  >
                    You are the host! Ready to start game.
                  </div>
                  <button
                    id="btn-request-start"
                    onClick={sendStartRequest}
                    style={{
                      padding: "0.75rem 1.5rem",
                      fontSize: "1.1rem",
                      fontWeight: "bold",
                      background: "#2ecc40",
                      color: "#fff",
                      border: "none",
                      borderRadius: "8px",
                      cursor: "pointer",
                    }}
                  >
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
            )}
          </>
        )}

        {gameState.phase === "bidding" && (
          <>
            {isActuallyMyTurn ? (
              <div
                style={{
                  fontSize: "1.1rem",
                  fontWeight: "bold",
                  color: "#2ecc40",
                }}
              >
                🔥 YOUR TURN!
              </div>
            ) : (
              <div style={{ fontSize: "0.95rem", color: "#aaa" }}>
                Waiting for{" "}
                <strong>{gameState.turnPlayerName || "player"}</strong> to
                bid...
              </div>
            )}
          </>
        )}

        {gameState.phase === "revealing" && (
          <div
            style={{
              fontSize: "1rem",
              fontWeight: "bold",
              color: "#ff4136",
            }}
          >
            ⚡ Challenge Revealed on Console!
          </div>
        )}

        {gameState.phase === "gameOver" && (
          <div
            style={{
              fontSize: "1rem",
              fontWeight: "bold",
              color: "#ffdc00",
            }}
          >
            🏆 Game Over!{" "}
            {gameState.winner ? `${gameState.winner.name} won!` : ""}
          </div>
        )}
      </div>

      {/* Current Bid Display */}
      {gameState.currentBid && (
        <div
          style={{
            background: "#1a1a24",
            borderRadius: "8px",
            padding: "0.5rem 0.75rem",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span style={{ fontSize: "0.8rem", color: "#888" }}>
            Current Bid:
          </span>
          <span
            style={{
              fontSize: "1.1rem",
              fontWeight: "bold",
              color: "#ffdc00",
            }}
          >
            {gameState.currentBid.count} ×{" "}
            {diceIcons[gameState.currentBid.face]} (
            {gameState.currentBid.bidderName})
          </span>
        </div>
      )}

      {/* Bid & Challenge Controls */}
      {gameState.phase === "bidding" && isActuallyMyTurn && (
        <div
          style={{
            background: "#222",
            borderRadius: "10px",
            padding: "0.75rem",
            display: "flex",
            flexDirection: "column",
            gap: "0.75rem",
          }}
        >
          <div
            style={{
              fontSize: "0.85rem",
              fontWeight: "bold",
              color: "#aaa",
              textTransform: "uppercase",
              textAlign: "center",
            }}
          >
            Make a Bid
          </div>

          {/* Quantity Picker */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span style={{ fontSize: "0.9rem", color: "#ccc" }}>
              Quantity:
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <button
                id="qty-minus"
                onClick={() => {
                  haptics.trigger("light");
                  setSelectedCount((c) => Math.max(1, c - 1));
                }}
                style={{
                  width: "36px",
                  height: "36px",
                  fontSize: "1.2rem",
                  fontWeight: "bold",
                  background: "#333",
                  color: "#fff",
                  border: "1px solid #555",
                  borderRadius: "6px",
                  cursor: "pointer",
                }}
              >
                -
              </button>
              <span
                style={{
                  fontSize: "1.3rem",
                  fontWeight: "bold",
                  width: "30px",
                  textAlign: "center",
                }}
              >
                {selectedCount}
              </span>
              <button
                id="qty-plus"
                onClick={() => {
                  haptics.trigger("light");
                  setSelectedCount((c) => Math.min(totalDice, c + 1));
                }}
                style={{
                  width: "36px",
                  height: "36px",
                  fontSize: "1.2rem",
                  fontWeight: "bold",
                  background: "#333",
                  color: "#fff",
                  border: "1px solid #555",
                  borderRadius: "6px",
                  cursor: "pointer",
                }}
              >
                +
              </button>
            </div>
          </div>

          {/* Face Picker */}
          <div>
            <div
              style={{
                fontSize: "0.9rem",
                color: "#ccc",
                marginBottom: "0.4rem",
              }}
            >
              Face Value:
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(6, 1fr)",
                gap: "4px",
              }}
            >
              {[1, 2, 3, 4, 5, 6].map((f) => {
                const isSelected = selectedFace === f;
                return (
                  <button
                    key={f}
                    className="face-btn"
                    data-face={f}
                    onClick={() => {
                      haptics.trigger("light");
                      setSelectedFace(f);
                    }}
                    style={{
                      padding: "6px 0",
                      fontSize: "1.3rem",
                      background: isSelected ? "#0070f3" : "#333",
                      color: "#fff",
                      border: isSelected
                        ? "2px solid #fff"
                        : "1px solid #555",
                      borderRadius: "6px",
                      cursor: "pointer",
                    }}
                  >
                    {diceIcons[f]}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Action Buttons */}
          <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.25rem" }}>
            <button
              id="btn-place-bid"
              disabled={!bidValid}
              onClick={sendBid}
              style={{
                flex: 1,
                padding: "0.75rem",
                fontSize: "1rem",
                fontWeight: "bold",
                background: bidValid ? "#0070f3" : "#444",
                color: bidValid ? "#fff" : "#888",
                border: "none",
                borderRadius: "8px",
                cursor: bidValid ? "pointer" : "not-allowed",
              }}
            >
              Place Bid
            </button>
            {gameState.currentBid && (
              <button
                id="btn-challenge"
                onClick={sendChallenge}
                style={{
                  flex: 1,
                  padding: "0.75rem",
                  fontSize: "1rem",
                  fontWeight: "bold",
                  background: "#ff4136",
                  color: "#fff",
                  border: "none",
                  borderRadius: "8px",
                  cursor: "pointer",
                }}
              >
                Liar! ⚡
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
