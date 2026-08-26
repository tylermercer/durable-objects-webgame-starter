import { Application, Container, Graphics, Text, TextStyle } from "pixi.js";
import type { PeerConnection, TouchMessage } from "@transport/peer-connection";
import type { ConsoleGameInstance } from "@contract/gameTypes";
import type { RpcStub } from "capnweb";
import type { ConsoleApi } from "../../lib/signaling-api";
import { createFixedTickLoop } from "../../utils/gameLoop";
import {
  createInitialRoundState,
  stepRound,
  WORLD_WIDTH,
  WORLD_HEIGHT,
  GROUND_Y,
  BIRD_RADIUS,
  PIPE_SPEED,
} from "./sim";
import type {
  FlappyControlMessage,
  PersistedFlappyState,
  RoundState,
  RoundStateSnapshot,
} from "./types";

export interface ControllerPeer {
  id: string;
  name: string;
  color: string;
  isFirstPlayer?: boolean;
  pc: PeerConnection | null;
  state: string;
  lastTouch?: TouchMessage;
}

export interface ConsoleContext {
  session: RpcStub<ConsoleApi> | null;
  peers: Map<string, ControllerPeer>;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

interface BirdDisplayObject {
  container: Container;
  body: Graphics;
  eye: Graphics;
  beak: Graphics;
  nameTag: Text;
  elimTag: Text;
}

export function createGame(ctx: ConsoleContext): ConsoleGameInstance {
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

  // Hide existing static touch canvas if present to avoid dual canvas rendering
  const touchCanvas = document.getElementById("touch-canvas") as HTMLCanvasElement | null;
  const originalTouchCanvasDisplay = touchCanvas ? touchCanvas.style.display : "";
  if (touchCanvas) {
    touchCanvas.style.display = "none";
  }

  // Create dedicated canvas element for Pixi WebGL context
  const canvas = document.createElement("canvas");
  canvas.style.display = "block";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  const canvasContainer = document.querySelector(".canvas-container");
  if (canvasContainer) {
    canvasContainer.appendChild(canvas);
  }

  let app: Application | null = null;
  let ready = false;

  // Root containers
  const world = new Container();
  const backgroundGraphics = new Graphics();
  const groundGraphics = new Graphics();
  const pipesContainer = new Container();
  const birdsContainer = new Container();
  const uiContainer = new Container();

  // Pipe display objects map
  const pipeSprites = new Map<number, Graphics>();
  // Bird display objects map
  const birdSprites = new Map<string, BirdDisplayObject>();

  // UI Display objects
  const overlayGraphics = new Graphics();
  const titleText = new Text({
    text: "",
    style: new TextStyle({
      fontFamily: "sans-serif",
      fontSize: 32,
      fontWeight: "bold",
      fill: 0xffffff,
      align: "center",
    }),
  });
  titleText.anchor.set(0.5);

  const subtitleText = new Text({
    text: "",
    style: new TextStyle({
      fontFamily: "sans-serif",
      fontSize: 18,
      fill: 0xffffff,
      align: "center",
    }),
  });
  subtitleText.anchor.set(0.5);

  const infoText = new Text({
    text: "",
    style: new TextStyle({
      fontFamily: "sans-serif",
      fontSize: 14,
      fill: 0xffdc00,
      align: "center",
    }),
  });
  infoText.anchor.set(0.5);

  const hudText = new Text({
    text: "",
    style: new TextStyle({
      fontFamily: "sans-serif",
      fontSize: 20,
      fontWeight: "bold",
      fill: 0xffffff,
      stroke: { color: 0x000000, width: 4 },
    }),
  });

  function applyWorldScale() {
    if (!app) return;
    const scaleX = app.screen.width / WORLD_WIDTH;
    const scaleY = app.screen.height / WORLD_HEIGHT;
    world.scale.set(scaleX, scaleY);
  }

  const appInstance = new Application();
  const init = appInstance
    .init({
      canvas,
      resizeTo: canvas.parentElement ?? undefined,
      autoStart: false,
      backgroundAlpha: 0,
    })
    .then(() => {
      app = appInstance;

      // Build scene graph
      app.stage.addChild(world);
      world.addChild(backgroundGraphics);
      world.addChild(pipesContainer);
      world.addChild(groundGraphics);
      world.addChild(birdsContainer);
      world.addChild(uiContainer);

      uiContainer.addChild(overlayGraphics);
      uiContainer.addChild(titleText);
      uiContainer.addChild(subtitleText);
      uiContainer.addChild(infoText);
      uiContainer.addChild(hudText);

      // Render static background & ground in world space (800x600)
      backgroundGraphics
        .rect(0, 0, WORLD_WIDTH, WORLD_HEIGHT)
        .fill(0x70c5ce);

      groundGraphics
        .rect(0, GROUND_Y, WORLD_WIDTH, WORLD_HEIGHT - GROUND_Y)
        .fill(0xddd894)
        .rect(0, GROUND_Y, WORLD_WIDTH, 15)
        .fill(0x73bf2e)
        .stroke({ width: 2, color: 0x538021 });

      applyWorldScale();
      app.renderer.on("resize", applyWorldScale);

      ready = true;
    });

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

  function getFirstPlayerId(): string | null {
    for (const peer of ctx.peers.values()) {
      if (peer.isFirstPlayer && peer.state === "connected") {
        return peer.id;
      }
    }
    for (const peer of ctx.peers.values()) {
      if (peer.state === "connected") return peer.id;
    }
    return null;
  }

  // Load persisted game state if available
  if (ctx.session) {
    ctx.session
      .loadGameState()
      .then((saved) => {
        if (saved && typeof saved === "object") {
          const state = saved as PersistedFlappyState;
          if (state.seed && state.phase) {
            roundSeed = state.seed;
            const players = Object.values(state.birds).map((b) => ({
              id: b.id,
              name: b.name,
              color: b.color,
            }));
            let simState = createInitialRoundState(roundSeed, players);

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
      firstPlayerId: getFirstPlayerId(),
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
      const firstPlayerId = getFirstPlayerId();
      if (fromId === firstPlayerId) {
        startNewRound();
      }
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

        if (currentState.phase === "waiting" && !currentState.birds[id]) {
          const firstPlayerId = getFirstPlayerId();
          if (id === firstPlayerId) {
            startNewRound();
          }
        }
      }
    }
  }

  const loop = createFixedTickLoop({
    tickRate: 60,
    onTick: (dt) => {
      syncPeers();

      if (currentState.phase === "waiting") {
        return;
      }

      if (currentState.phase === "active") {
        prevState = currentState;

        const flaps = new Set(pendingFlaps);
        pendingFlaps.clear();

        const stepRes = stepRound(currentState, flaps, dt);
        currentState = stepRes.nextState;

        for (const diedEvent of stepRes.events.died) {
          const peer = ctx.peers.get(diedEvent.id);
          if (peer && peer.pc) {
            peer.pc.sendControl({
              type: "died",
              place: diedEvent.place,
            });
          }
        }

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

  const handleCanvasClick = () => {
    if (currentState.phase === "waiting" || currentState.phase === "roundOver") {
      startNewRound();
    }
  };

  canvas.addEventListener("click", handleCanvasClick);

  function syncPipes(alpha: number) {
    const pipeInterpolatedDx = (alpha * (1 / 60)) * PIPE_SPEED;
    const activePipeIds = new Set<number>();

    for (const pipe of currentState.pipes) {
      activePipeIds.add(pipe.id);
      let g = pipeSprites.get(pipe.id);

      if (!g) {
        g = new Graphics();
        pipesContainer.addChild(g);
        pipeSprites.set(pipe.id, g);
      }

      const interpolatedX = pipe.x - pipeInterpolatedDx;
      const pw = pipe.width;
      const topH = pipe.topHeight;
      const botY = pipe.bottomY;
      const groundY = GROUND_Y;

      g.clear();
      // Top Pipe body & cap
      g.rect(interpolatedX, 0, pw, topH)
        .fill(0x73bf2e)
        .stroke({ width: 3, color: 0x538021 })
        .rect(interpolatedX - 4, topH - 20, pw + 8, 20)
        .fill(0x73bf2e)
        .stroke({ width: 3, color: 0x538021 });

      // Bottom Pipe body & cap
      g.rect(interpolatedX, botY, pw, groundY - botY)
        .fill(0x73bf2e)
        .stroke({ width: 3, color: 0x538021 })
        .rect(interpolatedX - 4, botY, pw + 8, 20)
        .fill(0x73bf2e)
        .stroke({ width: 3, color: 0x538021 });
    }

    for (const [id, g] of pipeSprites) {
      if (!activePipeIds.has(id)) {
        g.destroy();
        pipeSprites.delete(id);
      }
    }
  }

  function createBirdDisplayObject(name: string): BirdDisplayObject {
    const container = new Container();

    const body = new Graphics();
    const eye = new Graphics();
    const beak = new Graphics();

    const nameTag = new Text({
      text: name,
      style: new TextStyle({
        fontFamily: "sans-serif",
        fontSize: 13,
        fontWeight: "bold",
        fill: 0xffffff,
        stroke: { color: 0x000000, width: 3 },
      }),
    });
    nameTag.anchor.set(0.5, 1);
    nameTag.position.set(0, -BIRD_RADIUS - 4);

    const elimTag = new Text({
      text: "",
      style: new TextStyle({
        fontFamily: "sans-serif",
        fontSize: 12,
        fontWeight: "bold",
        fill: 0xff4136,
        stroke: { color: 0x000000, width: 3 },
      }),
    });
    elimTag.anchor.set(0.5, 1);
    elimTag.position.set(0, -BIRD_RADIUS - 18);
    elimTag.visible = false;

    // Build eye & beak shapes relative to bird center (0,0)
    eye
      .circle(BIRD_RADIUS * 0.4, -BIRD_RADIUS * 0.3, BIRD_RADIUS * 0.3)
      .fill(0xffffff)
      .circle(BIRD_RADIUS * 0.5, -BIRD_RADIUS * 0.3, BIRD_RADIUS * 0.12)
      .fill(0x000000);

    beak
      .moveTo(BIRD_RADIUS * 0.6, 0)
      .lineTo(BIRD_RADIUS * 1.3, BIRD_RADIUS * 0.2)
      .lineTo(BIRD_RADIUS * 0.6, BIRD_RADIUS * 0.4)
      .closePath()
      .fill(0xf7a100)
      .stroke({ width: 2, color: 0x000000 });

    container.addChild(body);
    container.addChild(eye);
    container.addChild(beak);
    container.addChild(nameTag);
    container.addChild(elimTag);

    birdsContainer.addChild(container);

    return { container, body, eye, beak, nameTag, elimTag };
  }

  function syncBirds(alpha: number) {
    const activeBirdIds = new Set<string>();

    for (const id in currentState.birds) {
      activeBirdIds.add(id);
      const currBird = currentState.birds[id];
      const prevBird = prevState.birds[id] || currBird;

      let bObj = birdSprites.get(id);
      if (!bObj) {
        bObj = createBirdDisplayObject(currBird.name);
        birdSprites.set(id, bObj);
      }

      // Update position (interpolated Y)
      const interpY = lerp(prevBird.y, currBird.y, alpha);
      bObj.container.position.set(currBird.x, interpY);

      // Render body fill/stroke based on alive state & color
      bObj.body.clear();
      bObj.body
        .circle(0, 0, BIRD_RADIUS)
        .fill(currBird.alive ? currBird.color : 0x666666)
        .stroke({ width: 2, color: 0x000000 });

      bObj.container.alpha = currBird.alive ? 1.0 : 0.35;

      if (!currBird.alive && currBird.place) {
        bObj.elimTag.text = `💀 #${currBird.place}`;
        bObj.elimTag.visible = true;
      } else {
        bObj.elimTag.visible = false;
      }
    }

    for (const [id, bObj] of birdSprites) {
      if (!activeBirdIds.has(id)) {
        bObj.container.destroy({ children: true });
        birdSprites.delete(id);
      }
    }
  }

  function syncUI() {
    overlayGraphics.clear();

    if (currentState.phase === "waiting") {
      overlayGraphics
        .rect(0, 0, WORLD_WIDTH, WORLD_HEIGHT)
        .fill({ color: 0x000000, alpha: 0.5 });

      titleText.text = "Flappy Royale 🐤";
      titleText.style.fill = 0xffffff;
      titleText.style.fontSize = 32;
      titleText.position.set(WORLD_WIDTH / 2, WORLD_HEIGHT / 2 - 40);
      titleText.visible = true;

      subtitleText.text = "First player tap screen or click here to start round!";
      subtitleText.style.fill = 0xffffff;
      subtitleText.style.fontSize = 18;
      subtitleText.position.set(WORLD_WIDTH / 2, WORLD_HEIGHT / 2 + 10);
      subtitleText.visible = true;

      infoText.text = `Connected Players: ${ctx.peers.size}`;
      infoText.style.fill = 0xffdc00;
      infoText.style.fontSize = 14;
      infoText.position.set(WORLD_WIDTH / 2, WORLD_HEIGHT / 2 + 50);
      infoText.visible = true;

      hudText.visible = false;
    } else if (currentState.phase === "roundOver") {
      overlayGraphics
        .rect(0, 0, WORLD_WIDTH, WORLD_HEIGHT)
        .fill({ color: 0x000000, alpha: 0.6 });

      titleText.text = "🏆 ROUND OVER! 🏆";
      titleText.style.fill = 0xffdc00;
      titleText.style.fontSize = 36;
      titleText.position.set(WORLD_WIDTH / 2, WORLD_HEIGHT / 2 - 60);
      titleText.visible = true;

      if (currentState.winner) {
        subtitleText.text = `Winner: ${currentState.winner.name}!`;
      } else {
        subtitleText.text = "No Winner!";
      }
      subtitleText.style.fill = 0xffffff;
      subtitleText.style.fontSize = 24;
      subtitleText.position.set(WORLD_WIDTH / 2, WORLD_HEIGHT / 2 - 10);
      subtitleText.visible = true;

      infoText.text = "First player tap screen or click here to Play Again!";
      infoText.style.fill = 0x2ecc40;
      infoText.style.fontSize = 20;
      infoText.position.set(WORLD_WIDTH / 2, WORLD_HEIGHT / 2 + 50);
      infoText.visible = true;

      hudText.visible = false;
    } else if (currentState.phase === "active") {
      overlayGraphics.clear();
      titleText.visible = false;
      subtitleText.visible = false;
      infoText.visible = false;

      const aliveCount = Object.values(currentState.birds).filter((b) => b.alive).length;
      hudText.text = `🐤 Alive: ${aliveCount} / ${currentState.totalPlayersAtStart}`;
      hudText.position.set(20, 20);
      hudText.visible = true;
    }
  }

  return {
    tick: (_dt: number) => {
      // Simulation loop driven by createFixedTickLoop above
    },

    render: (alpha: number) => {
      if (!ready || !app) return;

      syncPipes(alpha);
      syncBirds(alpha);
      syncUI();

      app.render();
    },

    destroy: () => {
      loop.stop();
      canvas.removeEventListener("click", handleCanvasClick);
      if (touchCanvas) {
        touchCanvas.style.display = originalTouchCanvasDisplay;
      }
      init.then(() => {
        app?.destroy(true, { children: true, texture: true });
        canvas.remove();
      });
    },
  };
}
