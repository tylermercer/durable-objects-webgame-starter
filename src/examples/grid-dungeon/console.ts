import type { PeerConnection } from "@transport/peer-connection";
import type { ConsoleGameInstance } from "@contract/gameTypes";
import type { RpcStub } from "capnweb";
import type { PlayerConnectionStatus } from "@host/console";
import type { ConsoleApi } from "../../lib/signaling-api";
import { createFixedTickLoop } from "../../utils/gameLoop";
import { Camera } from "../../utils/camera";
import { EntityRegistry } from "../../utils/entityRegistry";
import { createRng } from "../../utils/rng";
import {
  createRoomGrid,
  createInitialEntities,
  syncPlayers,
  stepRoom,
  ROOM_WIDTH,
  ROOM_HEIGHT,
  TILE_SIZE,
  RAW_LAYOUT,
} from "./room";
import type { DungeonEntity, JoystickState, NpcEntity, PlayerEntity, RoomStateSnapshot } from "./types";

export interface ControllerPeer {
  id: string;
  name: string;
  color: string;
  isFirstPlayer?: boolean;
  pc: PeerConnection | null;
  state: string;
  status?: PlayerConnectionStatus;
}

export interface ConsoleContext {
  session: RpcStub<ConsoleApi> | null;
  peers: Map<string, ControllerPeer>;
}

export function createGame(ctx: ConsoleContext): ConsoleGameInstance {
  // Reveal demo view canvas container
  const demoView = document.getElementById("demo-view");
  if (demoView) {
    demoView.classList.remove("u-hidden");
    const heading = demoView.querySelector("h2");
    if (heading && heading.textContent === "Live Touch Visualization") {
      heading.textContent = "Grid Dungeon";
    }
    const canvasContainer = demoView.querySelector(".canvas-container");
    if (canvasContainer) {
      (canvasContainer as HTMLElement).style.display = "block";
    }
  }

  // Hide static touch canvas if present
  const touchCanvas = document.getElementById("touch-canvas") as HTMLCanvasElement | null;
  const originalTouchCanvasDisplay = touchCanvas ? touchCanvas.style.display : "";
  if (touchCanvas) {
    touchCanvas.style.display = "none";
  }

  // Create dedicated canvas
  const canvas = document.createElement("canvas");
  canvas.width = 800;
  canvas.height = 600;
  canvas.style.display = "block";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  const canvasContainer = document.querySelector(".canvas-container");
  if (canvasContainer) {
    canvasContainer.appendChild(canvas);
  }

  const canvasCtx = canvas.getContext("2d");

  const grid = createRoomGrid();
  let registry = createInitialEntities();
  const joystickInputs = new Map<string, JoystickState>();
  const attachedListeners = new Set<string>();
  const rng = createRng(Math.floor(Math.random() * 2147483647));

  const camera = new Camera({
    viewportWidth: 800,
    viewportHeight: 600,
    worldWidth: ROOM_WIDTH * TILE_SIZE,
    worldHeight: ROOM_HEIGHT * TILE_SIZE,
    smoothing: 0.1, // Smooth camera easing toward targets
  });

  // Load saved state if available
  if (ctx.session) {
    ctx.session
      .loadGameState()
      .then((saved) => {
        if (saved && Array.isArray(saved)) {
          registry = EntityRegistry.fromJSON<DungeonEntity>(saved as DungeonEntity[]);
        }
      })
      .catch((err) => {
        console.error("Failed to load persisted Grid Dungeon state:", err);
      });
  }

  function persistState() {
    if (!ctx.session) return;
    ctx.session.saveGameState(registry.toJSON()).catch((err) => {
      console.error("Failed to persist Grid Dungeon state:", err);
    });
  }

  function getSnapshot(): RoomStateSnapshot {
    return {
      players: registry.query((e) => e.kind === "player") as PlayerEntity[],
      npcs: registry.query((e) => e.kind === "npc") as NpcEntity[],
      gridWidth: ROOM_WIDTH,
      gridHeight: ROOM_HEIGHT,
      tileSize: TILE_SIZE,
    };
  }

  function broadcastSnapshot() {
    const snapshot = getSnapshot();
    for (const peer of ctx.peers.values()) {
      const isConnected = peer.status ? peer.status === "live" : (peer.state === "live" || peer.state === "connected");
      if (peer.pc && isConnected) {
        peer.pc.sendControlCoalesced("roomState", {
          type: "roomState",
          snapshot,
        });
      }
    }
  }

  function syncPeers() {
    const activePeers: Array<{ id: string; name: string; color: string; status?: PlayerConnectionStatus; state?: string }> = [];
    for (const [id, peer] of ctx.peers) {
      const status = peer.status ?? peer.state;
      if (status === "live" || status === "reconnecting" || status === "connected") {
        activePeers.push({ id, name: peer.name, color: peer.color, status: peer.status, state: peer.state });
      }
      if (peer.pc && !attachedListeners.has(id)) {
        attachedListeners.add(id);
        peer.pc.addControlListener((msg) => {
          if (msg.type === "state" && (msg as unknown as { state?: JoystickState }).state) {
            joystickInputs.set(
              id,
              (msg as unknown as { state: JoystickState }).state
            );
          }
        });
      }
    }
    syncPlayers(registry, activePeers);
  }

  const loop = createFixedTickLoop({
    tickRate: 60,
    onTick: (dt) => {
      syncPeers();
      stepRoom(grid, registry, joystickInputs, dt, rng);

      // Camera follow target: average position of all active players
      const players = registry.query((e) => e.kind === "player") as PlayerEntity[];
      const targets = players.map((p) => ({
        x: p.x * TILE_SIZE,
        y: p.y * TILE_SIZE,
      }));
      camera.update(targets);

      persistState();
      broadcastSnapshot();
    },
  });

  function draw() {
    if (!canvasCtx) return;

    canvasCtx.fillStyle = "#111116";
    canvasCtx.fillRect(0, 0, canvas.width, canvas.height);

    canvasCtx.save();
    canvasCtx.translate(-camera.x, -camera.y);

    // Render floor & wall tiles
    for (let y = 0; y < ROOM_HEIGHT; y++) {
      for (let x = 0; x < ROOM_WIDTH; x++) {
        const isWall = RAW_LAYOUT[y][x] === 1;
        const screenX = x * TILE_SIZE;
        const screenY = y * TILE_SIZE;

        if (isWall) {
          canvasCtx.fillStyle = "#2b2b36";
          canvasCtx.fillRect(screenX, screenY, TILE_SIZE, TILE_SIZE);
          canvasCtx.strokeStyle = "#1a1a22";
          canvasCtx.lineWidth = 2;
          canvasCtx.strokeRect(screenX, screenY, TILE_SIZE, TILE_SIZE);
        } else {
          canvasCtx.fillStyle = (x + y) % 2 === 0 ? "#3a3a48" : "#424252";
          canvasCtx.fillRect(screenX, screenY, TILE_SIZE, TILE_SIZE);
        }
      }
    }

    const viewport = camera.getViewport();

    // Render NPCs (only if inside viewport)
    const npcs = registry.query((e) => e.kind === "npc") as NpcEntity[];
    for (const npc of npcs) {
      const npcWorldX = npc.x * TILE_SIZE;
      const npcWorldY = npc.y * TILE_SIZE;
      const radius = TILE_SIZE * 0.35;

      if (
        npcWorldX + radius >= viewport.x &&
        npcWorldX - radius <= viewport.x + viewport.width &&
        npcWorldY + radius >= viewport.y &&
        npcWorldY - radius <= viewport.y + viewport.height
      ) {
        // Draw path line preview if pathing
        if (npc.currentPath.length > 0) {
          canvasCtx.beginPath();
          canvasCtx.moveTo(npcWorldX, npcWorldY);
          for (const step of npc.currentPath) {
            canvasCtx.lineTo((step.x + 0.5) * TILE_SIZE, (step.y + 0.5) * TILE_SIZE);
          }
          canvasCtx.strokeStyle = "rgba(255, 255, 255, 0.2)";
          canvasCtx.setLineDash([4, 4]);
          canvasCtx.lineWidth = 2;
          canvasCtx.stroke();
          canvasCtx.setLineDash([]);
        }

        canvasCtx.fillStyle = npc.color;
        canvasCtx.beginPath();
        canvasCtx.arc(npcWorldX, npcWorldY, radius, 0, Math.PI * 2);
        canvasCtx.fill();
        canvasCtx.strokeStyle = "#000000";
        canvasCtx.lineWidth = 2;
        canvasCtx.stroke();

        canvasCtx.fillStyle = "#ffffff";
        canvasCtx.font = "bold 12px sans-serif";
        canvasCtx.textAlign = "center";
        canvasCtx.fillText(npc.name, npcWorldX, npcWorldY - radius - 4);
      }
    }

    // Render Players
    const players = registry.query((e) => e.kind === "player") as PlayerEntity[];
    for (const player of players) {
      const pWorldX = player.x * TILE_SIZE;
      const pWorldY = player.y * TILE_SIZE;
      const radius = TILE_SIZE * 0.35;

      canvasCtx.fillStyle = player.color;
      canvasCtx.beginPath();
      canvasCtx.arc(pWorldX, pWorldY, radius, 0, Math.PI * 2);
      canvasCtx.fill();
      canvasCtx.strokeStyle = "#ffffff";
      canvasCtx.lineWidth = 3;
      canvasCtx.stroke();

      canvasCtx.fillStyle = "#ffffff";
      canvasCtx.font = "bold 14px sans-serif";
      canvasCtx.textAlign = "center";
      canvasCtx.fillText(player.name, pWorldX, pWorldY - radius - 6);
    }

    canvasCtx.restore();

    // Render HUD overlay (connected players count)
    canvasCtx.fillStyle = "#000000";
    canvasCtx.globalAlpha = 0.5;
    canvasCtx.fillRect(10, 10, 220, 36);
    canvasCtx.globalAlpha = 1.0;
    canvasCtx.fillStyle = "#ffdc00";
    canvasCtx.font = "bold 14px sans-serif";
    canvasCtx.textAlign = "left";
    canvasCtx.fillText(`Players: ${players.length}`, 20, 33);
  }

  return {
    tick: (_dt: number) => {},
    render: (_alpha: number) => {
      draw();
    },
    destroy: () => {
      loop.stop();
      if (touchCanvas) {
        touchCanvas.style.display = originalTouchCanvasDisplay;
      }
      canvas.remove();
    },
  };
}
