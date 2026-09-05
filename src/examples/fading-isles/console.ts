import type { ConsoleContext, ConsoleGameInstance, ControllerPeer } from "@contract/gameTypes";
import type { PlayerConnectionStatus } from "@host/console";
import { TileGrid, type TileGridState } from "@utils/tileGrid";
import { EntityRegistry } from "@utils/entityRegistry";
import { createFixedTickLoop } from "@utils/gameLoop";
import { saveLocalGameState, loadLocalGameState } from "@utils/localGameState";
import { generateLevel, getLevelSpec } from "./level";
import { capacityColor, stepRoom, syncPlayers } from "./room";
import type {
  Cell,
  FadingIslesControlMessage,
  FadingIslesSnapshot,
  JoystickState,
  PlayerEntity,
} from "./types";

const TILE_SIZE = 60; // Pixels per tile in Canvas world space

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

  return { x, y };
}

interface SavedFadingIslesState {
  grid: TileGridState<Cell | null>;
  players: PlayerEntity[];
  sessionSeed: string;
  levelNumber: number;
  won: boolean;
}

export function createGame(ctx: ConsoleContext): ConsoleGameInstance {
  // Create dedicated canvas
  const canvas = document.createElement("canvas");
  canvas.style.display = "block";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  ctx.viewport.container.appendChild(canvas);

  const canvasCtx = canvas.getContext("2d");

  let currentViewportSize = {
    width: ctx.viewport.initialSize.width,
    height: ctx.viewport.initialSize.height,
  };

  function resizeCanvas(size: { width: number; height: number }) {
    currentViewportSize = size;
    if (size.width > 0 && size.height > 0) {
      canvas.width = size.width * window.devicePixelRatio;
      canvas.height = size.height * window.devicePixelRatio;
    }
  }

  resizeCanvas(ctx.viewport.initialSize);
  const unsubscribeResize = ctx.viewport.onResize(resizeCanvas);

  let sessionSeed = Math.random().toString(36).slice(2);
  let levelNumber = 1;
  let won = false;

  let registry = new EntityRegistry<PlayerEntity>();
  let grid: TileGrid<Cell | null>;
  let startPos = { x: 0, y: 0 };
  let endPos = { x: 0, y: 0 };

  // Attempt to restore saved state or initialize level 1
  const savedState = loadLocalGameState<SavedFadingIslesState>(ctx.session.roomCode);
  if (savedState) {
    grid = TileGrid.fromJSON<Cell | null>(savedState.grid);
    if (Array.isArray(savedState.players)) {
      registry = EntityRegistry.fromJSON<PlayerEntity>(savedState.players);
    }
    sessionSeed = savedState.sessionSeed ?? sessionSeed;
    levelNumber = savedState.levelNumber ?? levelNumber;
    won = savedState.won ?? false;
    const spec = getLevelSpec(levelNumber);
    startPos = spec.startPos;
    endPos = spec.endPos;
  } else {
    const levelData = generateLevel(sessionSeed, levelNumber);
    grid = levelData.grid;
    startPos = levelData.startPos;
    endPos = levelData.endPos;
    // Initial spawn on S tile decrements remaining once
    const startCell = grid.get(startPos);
    if (startCell) {
      startCell.remaining = Math.max(0, startCell.remaining - 1);
    }
  }

  function startOrRestartLevel(sameSeed: boolean) {
    if (!sameSeed) {
      levelNumber++;
    }
    won = false;
    const levelData = generateLevel(sessionSeed, levelNumber);
    grid = levelData.grid;
    startPos = levelData.startPos;
    endPos = levelData.endPos;

    // Reset player positions to startPos
    const players = registry.query((e) => e.kind === "player") as PlayerEntity[];
    for (const p of players) {
      p.x = startPos.x + 0.5;
      p.y = startPos.y + 0.5;
    }
    const startCell = grid.get(startPos);
    if (startCell) {
      startCell.remaining = Math.max(0, startCell.remaining - 1);
    }
  }

  const joystickInputs = new Map<string, JoystickState>();

  function handlePeerReady(peer: ControllerPeer) {
    if (!registry.get(peer.id)) {
      registry.add({
        id: peer.id,
        kind: "player",
        name: peer.name,
        color: peer.color,
        x: startPos.x + 0.5,
        y: startPos.y + 0.5,
      });
    }

    if (peer.pc) {
      peer.pc.addInputListener((msg: unknown) => {
        const input = msg as { type?: string; state?: JoystickState; buttons?: number[]; axes?: number[] };
        if (input) {
          if ((input.type === "input" || input.type === "state") && input.state) {
            joystickInputs.set(peer.id, input.state);
          } else if (input.type === "gamepad-state" && Array.isArray(input.buttons) && Array.isArray(input.axes)) {
            joystickInputs.set(peer.id, gamepadStateToJoystick(input as { buttons: number[]; axes: number[] }));
          } else if (typeof (input as JoystickState)?.x === "number" && typeof (input as JoystickState)?.y === "number") {
            joystickInputs.set(peer.id, input as unknown as JoystickState);
          }
        }
      });

      peer.pc.addControlListener((msg: unknown) => {
        const cMsg = msg as unknown as FadingIslesControlMessage;
        if (cMsg.type === "restartLevel") {
          startOrRestartLevel(true);
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

  for (const peer of ctx.peers.values()) {
    if (peer.pc) {
      handlePeerReady(peer);
    }
  }

  function draw() {
    if (!canvasCtx) return;

    const dpr = window.devicePixelRatio || 1;
    const viewWidth = currentViewportSize.width * dpr;
    const viewHeight = currentViewportSize.height * dpr;

    canvasCtx.clearRect(0, 0, canvas.width, canvas.height);

    if (viewWidth <= 0 || viewHeight <= 0) return;

    canvasCtx.save();
    canvasCtx.scale(dpr, dpr);

    // Board rendering offset to center
    const boardPixelWidth = grid.width * TILE_SIZE;
    const boardPixelHeight = grid.height * TILE_SIZE;
    const offsetX = Math.floor((currentViewportSize.width - boardPixelWidth) / 2);
    const offsetY = Math.floor((currentViewportSize.height - boardPixelHeight) / 2);

    // Draw Header Text
    canvasCtx.fillStyle = "#ffffff";
    canvasCtx.font = "bold 22px sans-serif";
    canvasCtx.textAlign = "left";
    canvasCtx.textBaseline = "top";
    canvasCtx.fillText(
      won
        ? `Level ${levelNumber} Complete!`
        : `Level ${levelNumber} - Deplete all tiles`,
      20,
      20
    );

    // Draw Grid
    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        const cell = grid.get({ x, y });
        if (!cell) continue; // Crumbled hole - skip drawing

        const tileX = offsetX + x * TILE_SIZE;
        const tileY = offsetY + y * TILE_SIZE;
        const padding = 3;
        const radius = 8;

        canvasCtx.fillStyle = capacityColor(cell.remaining);

        // Rounded tile rect
        canvasCtx.beginPath();
        canvasCtx.roundRect(
          tileX + padding,
          tileY + padding,
          TILE_SIZE - padding * 2,
          TILE_SIZE - padding * 2,
          radius
        );
        canvasCtx.fill();

        // Stroke end or start tile
        if (cell.kind === "end") {
          canvasCtx.strokeStyle = "#f59e0b"; // gold/amber
          canvasCtx.lineWidth = 3;
          canvasCtx.stroke();
        } else if (cell.kind === "start") {
          canvasCtx.strokeStyle = "#10b981"; // green
          canvasCtx.lineWidth = 2;
          canvasCtx.stroke();
        }

        // Draw remaining uses text
        canvasCtx.fillStyle = "#ffffff";
        canvasCtx.font = "bold 20px sans-serif";
        canvasCtx.textAlign = "center";
        canvasCtx.textBaseline = "middle";
        canvasCtx.fillText(
          cell.kind === "end" ? `E (${cell.remaining})` : `${cell.remaining}`,
          tileX + TILE_SIZE / 2,
          tileY + TILE_SIZE / 2
        );
      }
    }

    // Draw Players
    const players = registry.query((e) => e.kind === "player") as PlayerEntity[];
    for (const p of players) {
      const px = offsetX + p.x * TILE_SIZE;
      const py = offsetY + p.y * TILE_SIZE;
      const radius = TILE_SIZE * 0.35;

      // Shadow
      canvasCtx.beginPath();
      canvasCtx.arc(px, py + 3, radius, 0, Math.PI * 2);
      canvasCtx.fillStyle = "rgba(0, 0, 0, 0.4)";
      canvasCtx.fill();

      // Circle
      canvasCtx.beginPath();
      canvasCtx.arc(px, py, radius, 0, Math.PI * 2);
      canvasCtx.fillStyle = p.color || "#ffffff";
      canvasCtx.fill();
      canvasCtx.lineWidth = 2;
      canvasCtx.strokeStyle = "#ffffff";
      canvasCtx.stroke();

      // Name label above player
      canvasCtx.fillStyle = "#ffffff";
      canvasCtx.font = "bold 13px sans-serif";
      canvasCtx.textAlign = "center";
      canvasCtx.textBaseline = "bottom";
      canvasCtx.fillText(p.name, px, py - radius - 4);
    }

    canvasCtx.restore();
  }

  const loop = createFixedTickLoop({
    tickRate: 60,
    onTick: (dt) => {
      const activePeers: Array<{
        id: string;
        name: string;
        color: string;
        status?: PlayerConnectionStatus;
        state?: string;
      }> = [];

      for (const [id, peer] of ctx.peers) {
        const status = (peer.status ?? peer.state) as PlayerConnectionStatus | string;
        if (status === "live" || status === "reconnecting" || status === "connected") {
          activePeers.push({
            id,
            name: peer.name,
            color: peer.color,
            status: peer.status as PlayerConnectionStatus,
            state: peer.state,
          });
        } else if (status === "grace-period") {
          joystickInputs.delete(id);
        }
      }

      syncPlayers(registry, activePeers, startPos);

      if (!won) {
        const stepRes = stepRoom(grid, registry, joystickInputs, dt);
        if (stepRes.won) {
          won = true;
          setTimeout(() => {
            startOrRestartLevel(false); // Advance to next level
          }, 2000);
        }
      }

      // Persist game state
      saveLocalGameState(ctx.session.roomCode, {
        grid: grid.toJSON(),
        players: registry.toJSON(),
        sessionSeed,
        levelNumber,
        won,
      });

      // Broadcast snapshot to controllers
      const snapshotGrid: (Cell | null)[] = [];
      for (let y = 0; y < grid.height; y++) {
        for (let x = 0; x < grid.width; x++) {
          snapshotGrid.push(grid.get({ x, y }) ?? null);
        }
      }

      const players = registry.query((e) => e.kind === "player") as PlayerEntity[];
      const snapshot: FadingIslesSnapshot = {
        players,
        grid: snapshotGrid,
        gridWidth: grid.width,
        gridHeight: grid.height,
        tileSize: TILE_SIZE,
        levelNumber,
        won,
      };

      for (const peer of ctx.peers.values()) {
        const isConnected = peer.status
          ? peer.status === "live"
          : peer.state === "live" || peer.state === "connected";
        if (peer.pc && isConnected) {
          peer.pc.sendControlCoalesced("roomState", {
            type: "roomState",
            snapshot,
          });
        }
      }
    },
  });

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
