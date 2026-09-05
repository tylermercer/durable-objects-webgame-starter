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
  createInitialEntities,
  syncPlayers,
  stepRoom,
  movePlayer,
  handlePlayerFiring,
  stepProjectiles,
  stepShockwaves,
  stepLobbyCountdown,
  findWalkableSpawnPos,
  spawnPlayersInBottom,
  spawnWaveMonsters,
  ROOM_WIDTH,
  ROOM_HEIGHT,
  TILE_SIZE,
  LOBBY_LAYOUT,
  DUNGEON_LAYOUT,
  START_ZONE,
  RANGED_TILE,
  MELEE_TILE,
} from "./room";
import type {
  DungeonEntity,
  GamePhase,
  JoystickState,
  NpcEntity,
  PlayerEntity,
  ProjectileEntity,
  RoomStateSnapshot,
} from "./types";

export const controllerTypes = {
  phone: {},
  gamepad: {},
};

export function gamepadStateToJoystick(msg: { buttons: number[]; axes: number[] }): JoystickState {
  let x = 0;
  let y = 0;

  const rawX = msg.axes[0] ?? 0;
  const rawY = msg.axes[1] ?? 0;
  const deadzone = 0.15;
  if (Math.abs(rawX) > deadzone) x += rawX;
  if (Math.abs(rawY) > deadzone) y += rawY;

  const buttons = msg.buttons ?? [];
  if ((buttons[12] ?? 0) > 0.5) y -= 1;
  if ((buttons[13] ?? 0) > 0.5) y += 1;
  if ((buttons[14] ?? 0) > 0.5) x -= 1;
  if ((buttons[15] ?? 0) > 0.5) x += 1;

  const mag = Math.sqrt(x * x + y * y);
  if (mag > 1.0) {
    x /= mag;
    y /= mag;
  }

  // Fire button: face buttons (0, 1, 2, 3) or bumpers/triggers (4, 5, 6, 7)
  const firing = buttons.slice(0, 8).some((b) => (b ?? 0) > 0.5);

  return { x, y, firing };
}

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
  let wave = 1;
  let lives = 3;
  let gameOverSurvivedWaves: number | null = null;

  const lobbyGrid = createLobbyGrid();
  const dungeonGrid = createDungeonGrid();
  let activeGrid = lobbyGrid;

  let registry = createInitialEntities(phase);
  const joystickInputs = new Map<string, JoystickState>();
  const rng = createRng(Math.floor(Math.random() * 2147483647));

  function handlePeerReady(peer: ControllerPeer) {
    if (!registry.get(peer.id)) {
      const preferredX = phase === "lobby" ? 2.5 : 10.0;
      const preferredY = phase === "lobby" ? 2.5 : 13.5;
      const spawnPos = findWalkableSpawnPos(activeGrid, preferredX, preferredY);
      const player: PlayerEntity = {
        id: peer.id,
        kind: "player",
        name: peer.name,
        color: peer.color,
        x: spawnPos.x,
        y: spawnPos.y,
        damageCooldown: 0,
      };
      registry.add(player);
    }

    if (peer.pc) {
      peer.pc.addInputListener((msg: unknown) => {
        const input = msg as { type?: string; state?: JoystickState; buttons?: number[]; axes?: number[] };
        if (input) {
          if (input.type === "state" && input.state) {
            joystickInputs.set(peer.id, input.state);
          } else if (input.type === "gamepad-state" && Array.isArray(input.buttons) && Array.isArray(input.axes)) {
            joystickInputs.set(peer.id, gamepadStateToJoystick(input as { buttons: number[]; axes: number[] }));
          }
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
    wave?: number;
    lives?: number;
    gameOverSurvivedWaves?: number | null;
    entities?: DungeonEntity[];
  }
  const saved = loadLocalGameState<SavedState | DungeonEntity[]>(ctx.roomCode);
  if (saved) {
    if (Array.isArray(saved)) {
      registry = EntityRegistry.fromJSON<DungeonEntity>(saved);
    } else if (saved.entities) {
      if (saved.phase) phase = saved.phase;
      if (saved.wave) wave = saved.wave;
      if (saved.lives) lives = saved.lives;
      if (saved.gameOverSurvivedWaves !== undefined) gameOverSurvivedWaves = saved.gameOverSurvivedWaves;
      registry = EntityRegistry.fromJSON<DungeonEntity>(saved.entities);
    }
  }
  activeGrid = phase === "lobby" ? lobbyGrid : dungeonGrid;

  function persistState() {
    saveLocalGameState(ctx.roomCode, {
      phase,
      wave,
      lives,
      gameOverSurvivedWaves,
      entities: registry.toJSON(),
    });
  }

  function getSnapshot(): RoomStateSnapshot {
    return {
      phase,
      countdown,
      players: registry.query((e) => e.kind === "player") as PlayerEntity[],
      npcs: registry.query((e) => e.kind === "npc") as NpcEntity[],
      projectiles: registry.query((e) => e.kind === "projectile") as ProjectileEntity[],
      shockwaves: registry.query((e) => e.kind === "shockwave") as any[],
      gridWidth: ROOM_WIDTH,
      gridHeight: ROOM_HEIGHT,
      tileSize: TILE_SIZE,
      wave,
      lives,
      gameOverSurvivedWaves,
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
        const npcs = registry.query((e) => e.kind === "npc") as NpcEntity[];
        for (const player of players) {
          const input = joystickInputs.get(player.id) ?? { x: 0, y: 0 };
          movePlayer(player, activeGrid, input, dt);
          handlePlayerFiring(player, !!input.firing, registry, npcs, dt, activeGrid, input);

          // Reset blinking invulnerability if present in lobby
          if (player.damageCooldown) {
            player.damageCooldown = 0;
          }

          // Standing on choice tiles in lobby selects attack type
          const tileX = Math.floor(player.x);
          const tileY = Math.floor(player.y);
          if (tileX === RANGED_TILE.x && tileY === RANGED_TILE.y) {
            player.attackType = "ranged";
          } else if (tileX === MELEE_TILE.x && tileY === MELEE_TILE.y) {
            player.attackType = "melee";
          }
        }

        stepProjectiles(registry, activeGrid, dt);
        stepShockwaves(registry, dt);

        const result = stepLobbyCountdown(players, countdown, dt);
        countdown = result.nextCountdown;

        if (result.shouldTransition) {
          phase = "dungeon";
          countdown = null;
          activeGrid = dungeonGrid;
          wave = 1;
          lives = 3;
          gameOverSurvivedWaves = null;

          // Teleport players along bottom of screen
          spawnPlayersInBottom(players, dungeonGrid);

          // Clear old npcs & projectiles, then spawn wave 1 monsters in top half
          const toRemove = registry.query((e) => e.kind === "npc" || e.kind === "projectile");
          for (const entity of toRemove) {
            registry.remove(entity.id);
          }
          spawnWaveMonsters(1, dungeonGrid, registry, rng);
        }
      } else {
        const newState = stepRoom(activeGrid, registry, joystickInputs, dt, rng, {
          phase,
          wave,
          lives,
          gameOverSurvivedWaves,
        });

        if (phase === "dungeon" && newState.phase === "lobby") {
          // Game Over return to lobby
          activeGrid = lobbyGrid;
          const dungeonPlayers = registry.query((e) => e.kind === "player") as PlayerEntity[];
          let idx = 0;
          for (const player of dungeonPlayers) {
            const targetX = 2.5 + (idx % 3) * 0.5;
            const targetY = 2.5 + Math.floor(idx / 3) * 0.5;
            const spawnPos = findWalkableSpawnPos(lobbyGrid, targetX, targetY);
            player.x = spawnPos.x;
            player.y = spawnPos.y;
            player.damageCooldown = 0; // Clear blinking!
            idx++;
          }
        }

        phase = newState.phase;
        wave = newState.wave;
        lives = newState.lives;
        gameOverSurvivedWaves = newState.gameOverSurvivedWaves;
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
        const cell = activeGrid.get({ x, y });
        const isDestructible = cell?.destructible;
        const screenX = x * TILE_SIZE;
        const screenY = y * TILE_SIZE;

        if (isDestructible) {
          canvasCtx.fillStyle = "#8b5a2b";
          canvasCtx.fillRect(screenX, screenY, TILE_SIZE, TILE_SIZE);
          canvasCtx.strokeStyle = "#5c3a21";
          canvasCtx.lineWidth = 2;
          canvasCtx.strokeRect(screenX, screenY, TILE_SIZE, TILE_SIZE);
        } else if (isWall) {
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

    // Render Attack Choice Tiles & Start Zone floor outline in Lobby
    if (phase === "lobby") {
      // Ranged Choice Tile
      const rx = RANGED_TILE.x * TILE_SIZE;
      const ry = RANGED_TILE.y * TILE_SIZE;
      canvasCtx.fillStyle = "#0074d9";
      canvasCtx.fillRect(rx, ry, TILE_SIZE, TILE_SIZE);
      canvasCtx.strokeStyle = "#7fdbff";
      canvasCtx.lineWidth = 2;
      canvasCtx.strokeRect(rx, ry, TILE_SIZE, TILE_SIZE);

      canvasCtx.fillStyle = "#ffffff";
      canvasCtx.font = "bold 9px sans-serif";
      canvasCtx.textAlign = "center";
      canvasCtx.textBaseline = "middle";
      canvasCtx.fillText("RANGED", rx + TILE_SIZE / 2, ry + TILE_SIZE / 2);

      // Melee Choice Tile
      const mx = MELEE_TILE.x * TILE_SIZE;
      const my = MELEE_TILE.y * TILE_SIZE;
      canvasCtx.fillStyle = "#ff4136";
      canvasCtx.fillRect(mx, my, TILE_SIZE, TILE_SIZE);
      canvasCtx.strokeStyle = "#ff851b";
      canvasCtx.lineWidth = 2;
      canvasCtx.strokeRect(mx, my, TILE_SIZE, TILE_SIZE);

      canvasCtx.fillStyle = "#ffffff";
      canvasCtx.font = "bold 9px sans-serif";
      canvasCtx.textAlign = "center";
      canvasCtx.textBaseline = "middle";
      canvasCtx.fillText("MELEE", mx + TILE_SIZE / 2, my + TILE_SIZE / 2);

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

    // Render Shockwaves
    const shockwaves = registry.query((e) => e.kind === "shockwave") as any[];
    for (const sw of shockwaves) {
      const swX = sw.x * TILE_SIZE;
      const swY = sw.y * TILE_SIZE;
      const swR = sw.radius * TILE_SIZE;
      const alpha = Math.max(0, sw.duration / sw.maxDuration);

      canvasCtx.save();
      canvasCtx.globalAlpha = alpha;
      canvasCtx.strokeStyle = sw.color || "#ffdc00";
      canvasCtx.lineWidth = 4;
      canvasCtx.beginPath();
      canvasCtx.arc(swX, swY, swR, 0, Math.PI * 2);
      canvasCtx.stroke();
      canvasCtx.fillStyle = "rgba(255, 255, 255, 0.2)";
      canvasCtx.fill();
      canvasCtx.restore();
    }

    // Render Projectiles
    const projectiles = registry.query((e) => e.kind === "projectile") as ProjectileEntity[];
    for (const proj of projectiles) {
      const projWorldX = proj.x * TILE_SIZE;
      const projWorldY = proj.y * TILE_SIZE;

      if (
        projWorldX >= viewport.x - 10 &&
        projWorldX <= viewport.x + viewport.width + 10 &&
        projWorldY >= viewport.y - 10 &&
        projWorldY <= viewport.y + viewport.height + 10
      ) {
        canvasCtx.fillStyle = "#ffdc00";
        canvasCtx.beginPath();
        canvasCtx.arc(projWorldX, projWorldY, 5, 0, Math.PI * 2);
        canvasCtx.fill();
        canvasCtx.strokeStyle = "#ffffff";
        canvasCtx.lineWidth = 1.5;
        canvasCtx.stroke();
      }
    }

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

        // Render HP Bar
        const barW = TILE_SIZE * 0.8;
        const barH = 5;
        const barX = npcWorldX - barW / 2;
        const barY = npcWorldY - radius - 16;

        canvasCtx.fillStyle = "rgba(0, 0, 0, 0.6)";
        canvasCtx.fillRect(barX, barY, barW, barH);

        const hpRatio = Math.max(0, npc.hp / npc.maxHp);
        canvasCtx.fillStyle = hpRatio > 0.4 ? "#2ecc40" : "#ff4136";
        canvasCtx.fillRect(barX, barY, barW * hpRatio, barH);

        canvasCtx.strokeStyle = "#000000";
        canvasCtx.lineWidth = 1;
        canvasCtx.strokeRect(barX, barY, barW, barH);

        canvasCtx.fillStyle = "#ffffff";
        canvasCtx.font = "bold 12px sans-serif";
        canvasCtx.textAlign = "center";
        canvasCtx.fillText(npc.name, npcWorldX, barY - 4);
      }
    }

    // Render Players
    const players = registry.query((e) => e.kind === "player") as PlayerEntity[];
    for (const player of players) {
      const pWorldX = player.x * TILE_SIZE;
      const pWorldY = player.y * TILE_SIZE;
      const radius = TILE_SIZE * 0.35;

      const isInvulnerable = player.damageCooldown && player.damageCooldown > 0;
      if (!isInvulnerable || Math.floor(Date.now() / 100) % 2 === 0) {
        canvasCtx.fillStyle = player.color;
        canvasCtx.beginPath();
        canvasCtx.arc(pWorldX, pWorldY, radius, 0, Math.PI * 2);
        canvasCtx.fill();
        canvasCtx.strokeStyle = isInvulnerable ? "#ffdc00" : "#ffffff";
        canvasCtx.lineWidth = 3;
        canvasCtx.stroke();
      }

      canvasCtx.fillStyle = "#ffffff";
      canvasCtx.font = "bold 14px sans-serif";
      canvasCtx.textAlign = "center";
      const attackLabel = player.attackType === "melee" ? " [MELEE]" : "";
      canvasCtx.fillText(`${player.name}${attackLabel}`, pWorldX, pWorldY - radius - 6);
    }

    canvasCtx.restore();

    // Render HUD overlay
    const hudScale = Math.max(1, dpr);
    canvasCtx.save();
    canvasCtx.scale(hudScale, hudScale);
    canvasCtx.fillStyle = "#000000";
    canvasCtx.globalAlpha = 0.65;
    canvasCtx.fillRect(10, 10, 300, 36);
    canvasCtx.globalAlpha = 1.0;
    canvasCtx.fillStyle = "#ffdc00";
    canvasCtx.font = "bold 14px sans-serif";
    canvasCtx.textAlign = "left";

    if (phase === "dungeon") {
      canvasCtx.fillText(`Wave ${wave} | Lives: ${lives} | Players: ${players.length}`, 20, 33);
    } else {
      canvasCtx.fillText(`Lobby | Players: ${players.length}`, 20, 33);
    }

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

    // Render Game Over Banner in Lobby
    if (phase === "lobby" && gameOverSurvivedWaves !== null && countdown === null) {
      const boxW = 380;
      const boxH = 54;
      const boxX = (currentViewportSize.width - boxW) / 2;
      const boxY = 20;

      canvasCtx.fillStyle = "rgba(200, 30, 30, 0.9)";
      canvasCtx.fillRect(boxX, boxY, boxW, boxH);
      canvasCtx.strokeStyle = "#ffdc00";
      canvasCtx.lineWidth = 3;
      canvasCtx.strokeRect(boxX, boxY, boxW, boxH);

      canvasCtx.fillStyle = "#ffffff";
      canvasCtx.font = "bold 18px sans-serif";
      canvasCtx.textAlign = "center";
      canvasCtx.fillText(
        `GAME OVER - SURVIVED ${gameOverSurvivedWaves} WAVE${gameOverSurvivedWaves === 1 ? "" : "S"}`,
        currentViewportSize.width / 2,
        boxY + 33
      );
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
