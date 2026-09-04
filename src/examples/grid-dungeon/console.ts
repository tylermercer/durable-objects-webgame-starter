import type { ConsoleContext, ConsoleGameInstance, ControllerPeer } from "@contract/gameTypes";
import type { PlayerConnectionStatus } from "@host/console";
import { createFixedTickLoop } from "../../utils/gameLoop";
import { Camera } from "../../utils/camera";
import { EntityRegistry } from "../../utils/entityRegistry";
import { createRng } from "../../utils/rng";
import { saveLocalGameState, loadLocalGameState } from "@utils/localGameState";
import {
  createLobbyGrid,
  createDungeonGrid,
  createDungeonNpcs,
  createInitialEntities,
  syncPlayers,
  stepRoom,
  movePlayer,
  stepLobbyCountdown,
  ROOM_WIDTH,
  ROOM_HEIGHT,
  TILE_SIZE,
  LOBBY_LAYOUT,
  DUNGEON_LAYOUT,
  START_ZONE,
} from "./room";
import type { DungeonEntity, GamePhase, JoystickState, NpcEntity, PlayerEntity, RoomStateSnapshot } from "./types";

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

  let phase: GamePhase = "lobby";
  let countdown: number | null = null;

  const lobbyGrid = createLobbyGrid();
  const dungeonGrid = createDungeonGrid();
  let activeGrid = lobbyGrid;

  let registry = createInitialEntities(phase);
  const joystickInputs = new Map<string, JoystickState>();
  const rng = createRng(Math.floor(Math.random() * 2147483647));

  function handlePeerReady(peer: ControllerPeer) {
    if (!registry.get(peer.id)) {
      const spawnX = phase === "lobby" ? 3.5 : 1.5;
      const spawnY = phase === "lobby" ? 3.5 : 1.5;
      const player: PlayerEntity = {
        id: peer.id,
        kind: "player",
        name: peer.name,
        color: peer.color,
        x: spawnX,
        y: spawnY,
      };
      registry.add(player);
    }

    if (peer.pc) {
      peer.pc.addInputListener((msg: unknown) => {
        const input = msg as { type?: string; state?: JoystickState };
        if (input && input.type === "state" && input.state) {
          joystickInputs.set(peer.id, input.state);
        }
      });
    }
  }

  const unsubscribePeerReady = ctx.onPeerReady((peer) => {
    handlePeerReady(peer);
  });

  const unsubscribePeerLeft = ctx.onPeerLeft((id) => {
    registry.remove(id);
    joystickInputs.delete(id);
  });

  // Attach to peers that are already ready
  for (const peer of ctx.peers.values()) {
    if (peer.pc) {
      handlePeerReady(peer);
    }
  }

  const camera = new Camera({
    viewportWidth: ROOM_WIDTH * TILE_SIZE,
    viewportHeight: ROOM_HEIGHT * TILE_SIZE,
    worldWidth: ROOM_WIDTH * TILE_SIZE,
    worldHeight: ROOM_HEIGHT * TILE_SIZE,
    smoothing: 0.1,
  });

  // Load saved state if available
  interface SavedState {
    phase?: GamePhase;
    entities?: DungeonEntity[];
  }
  const saved = loadLocalGameState<SavedState | DungeonEntity[]>(ctx.roomCode);
  if (saved) {
    if (Array.isArray(saved)) {
      registry = EntityRegistry.fromJSON<DungeonEntity>(saved);
    } else if (saved.entities) {
      if (saved.phase) phase = saved.phase;
      registry = EntityRegistry.fromJSON<DungeonEntity>(saved.entities);
    }
  }
  activeGrid = phase === "lobby" ? lobbyGrid : dungeonGrid;

  function persistState() {
    saveLocalGameState(ctx.roomCode, {
      phase,
      entities: registry.toJSON(),
    });
  }

  function getSnapshot(): RoomStateSnapshot {
    return {
      phase,
      countdown,
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
      const status = (peer.status ?? peer.state) as PlayerConnectionStatus | string;
      if (status === "live" || status === "reconnecting" || status === "connected") {
        activePeers.push({ id, name: peer.name, color: peer.color, status: peer.status as PlayerConnectionStatus, state: peer.state });
      } else if (status === "grace-period") {
        joystickInputs.delete(id);
      }
    }
    syncPlayers(registry, activePeers);
  }

  const loop = createFixedTickLoop({
    tickRate: 60,
    onTick: (dt) => {
      syncPeers();

      if (phase === "lobby") {
        const players = registry.query((e) => e.kind === "player") as PlayerEntity[];
        for (const player of players) {
          const input = joystickInputs.get(player.id) ?? { x: 0, y: 0 };
          movePlayer(player, activeGrid, input, dt);
        }

        const result = stepLobbyCountdown(players, countdown, dt);
        countdown = result.nextCountdown;

        if (result.shouldTransition) {
          phase = "dungeon";
          countdown = null;
          activeGrid = dungeonGrid;

          // Teleport players to dungeon spawn points
          let idx = 0;
          for (const player of players) {
            player.x = 1.5 + (idx % 3) * 0.5;
            player.y = 1.5 + Math.floor(idx / 3) * 0.5;
            idx++;
          }

          // Spawn dungeon NPCs if needed
          if (!registry.get("npc-goblin") && !registry.get("npc-skeleton")) {
            const npcs = createDungeonNpcs();
            for (const npc of npcs) {
              registry.add(npc);
            }
          }
        }
      } else {
        stepRoom(activeGrid, registry, joystickInputs, dt, rng);
      }

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

    const currentLayout = phase === "lobby" ? LOBBY_LAYOUT : DUNGEON_LAYOUT;

    // Render floor & wall tiles
    for (let y = 0; y < ROOM_HEIGHT; y++) {
      for (let x = 0; x < ROOM_WIDTH; x++) {
        const isWall = currentLayout[y][x] === 1;
        const screenX = x * TILE_SIZE;
        const screenY = y * TILE_SIZE;

        if (isWall) {
          canvasCtx.fillStyle = "#2b2b36";
          canvasCtx.fillRect(screenX, screenY, TILE_SIZE, TILE_SIZE);
          canvasCtx.strokeStyle = "#1a1a22";
          canvasCtx.lineWidth = 2;
          canvasCtx.strokeRect(screenX, screenY, TILE_SIZE, TILE_SIZE);
        } else {
          const isStartZoneTile =
            phase === "lobby" &&
            x >= START_ZONE.minX &&
            x <= START_ZONE.maxX &&
            y >= START_ZONE.minY &&
            y <= START_ZONE.maxY;

          if (isStartZoneTile) {
            canvasCtx.fillStyle = "#5a4d20";
            canvasCtx.fillRect(screenX, screenY, TILE_SIZE, TILE_SIZE);
          } else {
            canvasCtx.fillStyle = (x + y) % 2 === 0 ? "#3a3a48" : "#424252";
            canvasCtx.fillRect(screenX, screenY, TILE_SIZE, TILE_SIZE);
          }
        }
      }
    }

    // Render Start Zone floor outline and text label in Lobby
    if (phase === "lobby") {
      const szX = START_ZONE.minX * TILE_SIZE;
      const szY = START_ZONE.minY * TILE_SIZE;
      const szW = (START_ZONE.maxX - START_ZONE.minX + 1) * TILE_SIZE;
      const szH = (START_ZONE.maxY - START_ZONE.minY + 1) * TILE_SIZE;

      canvasCtx.strokeStyle = "#ffdc00";
      canvasCtx.lineWidth = 3;
      canvasCtx.strokeRect(szX + 2, szY + 2, szW - 4, szH - 4);

      const labelW = szW - 20;
      const labelH = 28;
      const labelX = szX + 10;
      const labelY = szY + (szH - labelH) / 2;

      canvasCtx.fillStyle = "rgba(0, 0, 0, 0.7)";
      canvasCtx.fillRect(labelX, labelY, labelW, labelH);
      canvasCtx.strokeStyle = "#ffdc00";
      canvasCtx.lineWidth = 1.5;
      canvasCtx.strokeRect(labelX, labelY, labelW, labelH);

      canvasCtx.fillStyle = "#ffffff";
      canvasCtx.font = "bold 13px sans-serif";
      canvasCtx.textAlign = "center";
      canvasCtx.textBaseline = "middle";
      canvasCtx.fillText("STAND HERE TO START", szX + szW / 2, labelY + labelH / 2);
      canvasCtx.textBaseline = "alphabetic";
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

    // Render HUD overlay
    const hudScale = Math.max(1, dpr);
    canvasCtx.save();
    canvasCtx.scale(hudScale, hudScale);
    canvasCtx.fillStyle = "#000000";
    canvasCtx.globalAlpha = 0.6;
    canvasCtx.fillRect(10, 10, 240, 36);
    canvasCtx.globalAlpha = 1.0;
    canvasCtx.fillStyle = "#ffdc00";
    canvasCtx.font = "bold 14px sans-serif";
    canvasCtx.textAlign = "left";
    const modeLabel = phase === "lobby" ? "Lobby" : "Dungeon";
    canvasCtx.fillText(`${modeLabel} | Players: ${players.length}`, 20, 33);

    // Render Countdown Overlay if counting down in lobby
    if (phase === "lobby" && countdown !== null) {
      const secondsLeft = Math.ceil(countdown);
      const boxW = 280;
      const boxH = 64;
      const boxX = (currentViewportSize.width - boxW) / 2;
      const boxY = 20;

      canvasCtx.fillStyle = "rgba(0, 0, 0, 0.85)";
      canvasCtx.fillRect(boxX, boxY, boxW, boxH);
      canvasCtx.strokeStyle = "#ffdc00";
      canvasCtx.lineWidth = 3;
      canvasCtx.strokeRect(boxX, boxY, boxW, boxH);

      canvasCtx.fillStyle = "#ffdc00";
      canvasCtx.font = "bold 16px sans-serif";
      canvasCtx.textAlign = "center";
      canvasCtx.fillText("GAME STARTING IN", currentViewportSize.width / 2, boxY + 26);

      canvasCtx.fillStyle = "#ffffff";
      canvasCtx.font = "bold 26px sans-serif";
      canvasCtx.fillText(`${secondsLeft}`, currentViewportSize.width / 2, boxY + 54);
    }

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
      unsubscribePeerReady();
      unsubscribePeerLeft();
      canvas.remove();
    },
  };
}
