import type { ConsoleContext, ConsoleGameInstance } from "@contract/gameTypes";
import type { PlayerConnectionStatus } from "@host/console";
import { createFixedTickLoop } from "../../utils/gameLoop";
import { Camera } from "../../utils/camera";
import { EntityRegistry } from "../../utils/entityRegistry";
import { createRng } from "../../utils/rng";
import { diffDepartedPeers } from "../../utils/peerDeparture";
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

export function createGame(ctx: ConsoleContext): ConsoleGameInstance {
  // Create dedicated canvas
  const canvas = document.createElement("canvas");
  canvas.style.display = "block";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  ctx.viewport.container.appendChild(canvas);

  const canvasCtx = canvas.getContext("2d");

  let currentViewportSize = { width: ctx.viewport.initialSize.width, height: ctx.viewport.initialSize.height };

  function resizeCanvas(size: { width: number; height: number }) {
    currentViewportSize = size;
    if (size.width > 0 && size.height > 0) {
      canvas.width = size.width * window.devicePixelRatio;
      canvas.height = size.height * window.devicePixelRatio;
    }
  }

  resizeCanvas(ctx.viewport.initialSize);
  const unsubscribeResize = ctx.viewport.onResize(resizeCanvas);

  const grid = createRoomGrid();
  let registry = createInitialEntities();
  const joystickInputs = new Map<string, JoystickState>();
  const attachedListeners = new Set<string>();
  const knownPlayerIds = new Set<string>();
  const rng = createRng(Math.floor(Math.random() * 2147483647));

  const camera = new Camera({
    viewportWidth: ROOM_WIDTH * TILE_SIZE,
    viewportHeight: ROOM_HEIGHT * TILE_SIZE,
    worldWidth: ROOM_WIDTH * TILE_SIZE,
    worldHeight: ROOM_HEIGHT * TILE_SIZE,
    smoothing: 0.1,
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
    const { departed } = diffDepartedPeers(knownPlayerIds, ctx.peers);
    for (const id of departed) {
      registry.remove(id);
      joystickInputs.delete(id);
      attachedListeners.delete(id);
    }

    const activePeers: Array<{ id: string; name: string; color: string; status?: PlayerConnectionStatus; state?: string }> = [];
    for (const [id, peer] of ctx.peers) {
      const status = (peer.status ?? peer.state) as PlayerConnectionStatus | string;
      if (status === "live" || status === "reconnecting" || status === "connected") {
        activePeers.push({ id, name: peer.name, color: peer.color, status: peer.status as PlayerConnectionStatus, state: peer.state });
      } else if (status === "grace-period") {
        joystickInputs.delete(id);
      }
      if (peer.pc && !attachedListeners.has(id)) {
        attachedListeners.add(id);
        peer.pc.addInputListener((msg) => {
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

    const dpr = window.devicePixelRatio || 1;
    const viewWidth = currentViewportSize.width * dpr;
    const viewHeight = currentViewportSize.height * dpr;

    canvasCtx.fillStyle = "#111116";
    canvasCtx.fillRect(0, 0, canvas.width, canvas.height);

    if (viewWidth <= 0 || viewHeight <= 0) return;

    const worldW = ROOM_WIDTH * TILE_SIZE;
    const worldH = ROOM_HEIGHT * TILE_SIZE;

    const scale = Math.min(viewWidth / worldW, viewHeight / worldH);
    const offsetX = (viewWidth - worldW * scale) / 2;
    const offsetY = (viewHeight - worldH * scale) / 2;

    canvasCtx.save();
    canvasCtx.translate(offsetX, offsetY);
    canvasCtx.scale(scale, scale);
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
    const hudScale = Math.max(1, dpr);
    canvasCtx.save();
    canvasCtx.scale(hudScale, hudScale);
    canvasCtx.fillStyle = "#000000";
    canvasCtx.globalAlpha = 0.5;
    canvasCtx.fillRect(10, 10, 220, 36);
    canvasCtx.globalAlpha = 1.0;
    canvasCtx.fillStyle = "#ffdc00";
    canvasCtx.font = "bold 14px sans-serif";
    canvasCtx.textAlign = "left";
    canvasCtx.fillText(`Players: ${players.length}`, 20, 33);
    canvasCtx.restore();
  }

  return {
    tick: (_dt: number) => {},
    render: (_alpha: number) => {
      draw();
    },
    destroy: () => {
      loop.stop();
      unsubscribeResize();
      canvas.remove();
    },
  };
}
