import type { PeerConnection, TouchMessage } from "../../scripts/peer-connection";
import type { RpcStub } from "capnweb";
import type { ConsoleApi } from "../../lib/signaling-api";
import { createFixedTickLoop } from "../../utils/gameLoop";
import {
  createInitialRoundState,
  stepRound,
  WORLD_WIDTH,
  WORLD_HEIGHT,
  GROUND_Y,
  CEILING_Y,
  BIRD_RADIUS,
} from "./sim";
import type {
  BirdState,
  FlapMessage,
  FlappyControlMessage,
  PersistedFlappyState,
  RoundState,
  RoundStateSnapshot,
} from "./types";

export interface ControllerPeer {
  id: string;
  name: string;
  color: string;
  pc: PeerConnection | null;
  state: string;
  lastTouch?: TouchMessage;
}

export interface ConsoleContext {
  session: RpcStub<ConsoleApi> | null;
  peers: Map<string, ControllerPeer>;
}

export function createGame(ctx: ConsoleContext) {
  const canvas = document.getElementById("touch-canvas") as HTMLCanvasElement | null;
  const ctx2d = canvas?.getContext("2d") || null;

  // Make sure canvas container is visible in demo view
  const demoView = document.getElementById("demo-view");
  if (demoView) {
    demoView.classList.remove("u-hidden");
    const heading = demoView.querySelector("h2");
    if (heading && heading.textContent === "Live Touch Visualization") {
      heading.textContent = "Flappy Royale";
    }
    const canvasContainer = demoView.querySelector(".canvas-container");
    if (canvasContainer) {
      (canvasContainer as HTMLElement).style.display = "block";
    }
  }

  function resizeCanvas() {
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      canvas.width = rect.width * window.devicePixelRatio;
      canvas.height = rect.height * window.devicePixelRatio;
    }
  }

  if (typeof window !== "undefined" && canvas) {
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
  }

  let roundSeed = Math.floor(Math.random() * 2147483647);
  let currentState: RoundState = {
    phase: "waiting",
    seed: roundSeed,
    tickIndex: 0,
    birds: {},
    pipes: [],
    totalPlayersAtStart: 0,
    winner: null,
  };
  let prevState: RoundState = currentState;

  const pendingFlaps = new Set<string>();
  const attachedListeners = new Set<string>();

  // Load persisted game state if available
  if (ctx.session) {
    ctx.session
      .loadGameState()
      .then((saved) => {
        if (saved && typeof saved === "object") {
          const state = saved as PersistedFlappyState;
          if (state.seed && state.phase) {
            roundSeed = state.seed;
            // Fast forward initial simulation to current tick index
            const players = Object.values(state.birds).map((b) => ({
              id: b.id,
              name: b.name,
              color: b.color,
            }));
            let simState = createInitialRoundState(roundSeed, players);

            // Reapply bird states (alive/place/y/vy)
            simState.birds = { ...state.birds };
            simState.phase = state.phase;
            simState.tickIndex = state.tickIndex;
            simState.winner = state.winner;

            currentState = simState;
            prevState = simState;
            broadcastSnapshot();
          }
        }
      })
      .catch((err) => {
        console.error("Failed to load persisted Flappy Royale state:", err);
      });
  }

  function startNewRound() {
    roundSeed = Math.floor(Math.random() * 2147483647);
    const activePlayers: Array<{ id: string; name: string; color: string }> = [];

    for (const [id, peer] of ctx.peers) {
      activePlayers.push({
        id,
        name: peer.name,
        color: peer.color,
      });
    }

    currentState = createInitialRoundState(roundSeed, activePlayers);
    prevState = currentState;
    pendingFlaps.clear();

    persistState();
    broadcastSnapshot();
  }

  function persistState() {
    if (!ctx.session) return;
    const stateToSave: PersistedFlappyState = {
      seed: currentState.seed,
      tickIndex: currentState.tickIndex,
      phase: currentState.phase,
      birds: currentState.birds,
      winner: currentState.winner,
    };
    ctx.session.saveGameState(stateToSave).catch((err) => {
      console.error("Failed to persist Flappy Royale state:", err);
    });
  }

  function getSnapshot(): RoundStateSnapshot {
    return {
      phase: currentState.phase,
      tickIndex: currentState.tickIndex,
      birds: Object.values(currentState.birds).map((b) => ({
        id: b.id,
        name: b.name,
        color: b.color,
        x: b.x,
        y: b.y,
        vy: b.vy,
        alive: b.alive,
        place: b.place,
      })),
      pipes: currentState.pipes.map((p) => ({
        id: p.id,
        x: p.x,
        topHeight: p.topHeight,
        bottomY: p.bottomY,
        width: p.width,
      })),
      winner: currentState.winner,
    };
  }

  function broadcastSnapshot() {
    const snapshot = getSnapshot();
    for (const peer of ctx.peers.values()) {
      if (peer.pc) {
        peer.pc.sendControlCoalesced("roundState", {
          type: "roundState",
          snapshot,
        });
      }
    }
  }

  function handleFlapInput(fromId: string) {
    if (currentState.phase === "active") {
      pendingFlaps.add(fromId);
    } else if (currentState.phase === "waiting" || currentState.phase === "roundOver") {
      // Flapping in lobby / results screen can trigger start game
      startNewRound();
    }
  }

  function syncPeers() {
    for (const [id, peer] of ctx.peers) {
      if (peer.pc) {
        if (!attachedListeners.has(id)) {
          attachedListeners.add(id);
          peer.pc.addControlListener((msg) => {
            const fMsg = msg as unknown as FlappyControlMessage;
            if (fMsg.type === "flap") {
              handleFlapInput(id);
            }
          });
        }

        // If player joined mid-game and has no bird yet, register as spectator/bird if waiting
        if (currentState.phase === "waiting" && !currentState.birds[id]) {
          startNewRound();
        }
      }
    }
  }

  const loop = createFixedTickLoop({
    tickRate: 60,
    onTick: (dt) => {
      syncPeers();

      if (currentState.phase === "waiting") {
        if (ctx.peers.size > 0 && Object.keys(currentState.birds).length === 0) {
          startNewRound();
        }
        return;
      }

      if (currentState.phase === "active") {
        prevState = currentState;

        const flaps = new Set(pendingFlaps);
        pendingFlaps.clear();

        const stepRes = stepRound(currentState, flaps, dt);
        currentState = stepRes.nextState;

        // Dispatch one-shot died events
        for (const diedEvent of stepRes.events.died) {
          const peer = ctx.peers.get(diedEvent.id);
          if (peer && peer.pc) {
            peer.pc.sendControl({
              type: "died",
              place: diedEvent.place,
            });
          }
        }

        // Dispatch one-shot round over event
        if (stepRes.events.roundOver) {
          for (const peer of ctx.peers.values()) {
            if (peer.pc) {
              peer.pc.sendControl(stepRes.events.roundOver);
            }
          }
        }

        persistState();
        broadcastSnapshot();
      }
    },
  });

  // Canvas click listener to start game / play again from host screen
  const handleCanvasClick = () => {
    if (currentState.phase === "waiting" || currentState.phase === "roundOver") {
      startNewRound();
    }
  };

  if (canvas) {
    canvas.addEventListener("click", handleCanvasClick);
  }

  return {
    tick: (_dt: number) => {
      // Tick handling done via createFixedTickLoop above
    },

    render: (alpha: number) => {
      if (!ctx2d || !canvas) return;

      const w = canvas.width;
      const h = canvas.height;
      const scaleX = w / WORLD_WIDTH;
      const scaleY = h / WORLD_HEIGHT;

      // Clear screen
      ctx2d.fillStyle = "#70c5ce"; // Sky blue
      ctx2d.fillRect(0, 0, w, h);

      // Interpolate pipe positions
      const tickSpeed = 200; // PIPE_SPEED
      const pipeInterpolatedDx = ((alpha * (1 / 60)) * tickSpeed) * scaleX;

      // Render Pipes
      ctx2d.fillStyle = "#73bf2e"; // Pipe green
      ctx2d.strokeStyle = "#538021";
      ctx2d.lineWidth = 3 * scaleX;

      for (const pipe of currentState.pipes) {
        const px = (pipe.x * scaleX) - pipeInterpolatedDx;
        const pw = pipe.width * scaleX;
        const topH = pipe.topHeight * scaleY;
        const botY = pipe.bottomY * scaleY;
        const groundY = GROUND_Y * scaleY;

        // Top Pipe
        ctx2d.fillRect(px, 0, pw, topH);
        ctx2d.strokeRect(px, 0, pw, topH);

        // Top Pipe Cap
        ctx2d.fillRect(px - 4 * scaleX, topH - 20 * scaleY, pw + 8 * scaleX, 20 * scaleY);
        ctx2d.strokeRect(px - 4 * scaleX, topH - 20 * scaleY, pw + 8 * scaleX, 20 * scaleY);

        // Bottom Pipe
        ctx2d.fillRect(px, botY, pw, groundY - botY);
        ctx2d.strokeRect(px, botY, pw, groundY - botY);

        // Bottom Pipe Cap
        ctx2d.fillRect(px - 4 * scaleX, botY, pw + 8 * scaleX, 20 * scaleY);
        ctx2d.strokeRect(px - 4 * scaleX, botY, pw + 8 * scaleX, 20 * scaleY);
      }

      // Render Ground
      const groundY = GROUND_Y * scaleY;
      ctx2d.fillStyle = "#ddd894"; // Sand ground
      ctx2d.fillRect(0, groundY, w, h - groundY);
      ctx2d.fillStyle = "#73bf2e"; // Grass top layer
      ctx2d.fillRect(0, groundY, w, 15 * scaleY);
      ctx2d.strokeStyle = "#538021";
      ctx2d.lineWidth = 2 * scaleX;
      ctx2d.strokeRect(0, groundY, w, 15 * scaleY);

      // Render Birds
      for (const id in currentState.birds) {
        const currBird = currentState.birds[id];
        const prevBird = prevState.birds[id] || currBird;

        // Interpolate y position
        const interpY = prevBird.y + (currBird.y - prevBird.y) * alpha;

        const bx = currBird.x * scaleX;
        const by = interpY * scaleY;
        const radius = BIRD_RADIUS * scaleX;

        ctx2d.save();
        ctx2d.translate(bx, by);

        // Bird body
        ctx2d.beginPath();
        ctx2d.arc(0, 0, radius, 0, Math.PI * 2);
        ctx2d.fillStyle = currBird.alive ? currBird.color : "#666666";
        ctx2d.globalAlpha = currBird.alive ? 1.0 : 0.6;
        ctx2d.fill();
        ctx2d.strokeStyle = "#000000";
        ctx2d.lineWidth = 2 * scaleX;
        ctx2d.stroke();

        // Eye
        ctx2d.beginPath();
        ctx2d.arc(radius * 0.4, -radius * 0.3, radius * 0.3, 0, Math.PI * 2);
        ctx2d.fillStyle = "#ffffff";
        ctx2d.fill();
        ctx2d.beginPath();
        ctx2d.arc(radius * 0.5, -radius * 0.3, radius * 0.12, 0, Math.PI * 2);
        ctx2d.fillStyle = "#000000";
        ctx2d.fill();

        // Beak
        ctx2d.beginPath();
        ctx2d.moveTo(radius * 0.6, 0);
        ctx2d.lineTo(radius * 1.3, radius * 0.2);
        ctx2d.lineTo(radius * 0.6, radius * 0.4);
        ctx2d.closePath();
        ctx2d.fillStyle = "#f7a100";
        ctx2d.fill();
        ctx2d.stroke();

        // Elimination indicator
        if (!currBird.alive && currBird.place) {
          ctx2d.fillStyle = "#ff4136";
          ctx2d.font = `bold ${12 * scaleX}px sans-serif`;
          ctx2d.textAlign = "center";
          ctx2d.fillText(`💀 #${currBird.place}`, 0, -radius - 18 * scaleY);
        }

        // Player Name Tag
        ctx2d.fillStyle = "#ffffff";
        ctx2d.font = `bold ${13 * scaleX}px sans-serif`;
        ctx2d.textAlign = "center";
        ctx2d.shadowColor = "rgba(0,0,0,0.8)";
        ctx2d.shadowBlur = 4;
        ctx2d.fillText(currBird.name, 0, -radius - 4 * scaleY);
        ctx2d.shadowBlur = 0;

        ctx2d.restore();
      }

      // UI Overlay
      if (currentState.phase === "waiting") {
        ctx2d.fillStyle = "rgba(0, 0, 0, 0.5)";
        ctx2d.fillRect(0, 0, w, h);

        ctx2d.fillStyle = "#ffffff";
        ctx2d.font = `bold ${32 * scaleX}px sans-serif`;
        ctx2d.textAlign = "center";
        ctx2d.fillText("Flappy Royale 🐤", w / 2, h / 2 - 40 * scaleY);

        ctx2d.font = `${18 * scaleX}px sans-serif`;
        ctx2d.fillText("Tap phone screen or click here to start round!", w / 2, h / 2 + 10 * scaleY);

        ctx2d.font = `${14 * scaleX}px sans-serif`;
        ctx2d.fillStyle = "#ffdc00";
        ctx2d.fillText(`Connected Players: ${ctx.peers.size}`, w / 2, h / 2 + 50 * scaleY);
      } else if (currentState.phase === "roundOver") {
        ctx2d.fillStyle = "rgba(0, 0, 0, 0.6)";
        ctx2d.fillRect(0, 0, w, h);

        ctx2d.fillStyle = "#ffdc00";
        ctx2d.font = `bold ${36 * scaleX}px sans-serif`;
        ctx2d.textAlign = "center";
        ctx2d.fillText("🏆 ROUND OVER! 🏆", w / 2, h / 2 - 60 * scaleY);

        if (currentState.winner) {
          ctx2d.fillStyle = "#ffffff";
          ctx2d.font = `bold ${24 * scaleX}px sans-serif`;
          ctx2d.fillText(`Winner: ${currentState.winner.name}!`, w / 2, h / 2 - 10 * scaleY);
        } else {
          ctx2d.fillStyle = "#ffffff";
          ctx2d.font = `bold ${24 * scaleX}px sans-serif`;
          ctx2d.fillText("No Winner!", w / 2, h / 2 - 10 * scaleY);
        }

        ctx2d.fillStyle = "#2ecc40";
        ctx2d.font = `bold ${20 * scaleX}px sans-serif`;
        ctx2d.fillText("Tap phone screen or click here to Play Again!", w / 2, h / 2 + 50 * scaleY);
      } else if (currentState.phase === "active") {
        // HUD / Alive count
        const aliveCount = Object.values(currentState.birds).filter((b) => b.alive).length;
        ctx2d.fillStyle = "#ffffff";
        ctx2d.font = `bold ${20 * scaleX}px sans-serif`;
        ctx2d.textAlign = "left";
        ctx2d.shadowColor = "rgba(0,0,0,0.8)";
        ctx2d.shadowBlur = 4;
        ctx2d.fillText(`🐤 Alive: ${aliveCount} / ${currentState.totalPlayersAtStart}`, 20 * scaleX, 40 * scaleY);
        ctx2d.shadowBlur = 0;
      }
    },

    destroy: () => {
      loop.stop();
      if (canvas) {
        canvas.removeEventListener("click", handleCanvasClick);
      }
    },
  };
}
