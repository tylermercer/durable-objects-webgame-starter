import { TileGrid, type GridPos } from "@utils/tileGrid";
import { EntityRegistry } from "@utils/entityRegistry";
import type { PlayerConnectionStatus } from "@host/console";
import type { Cell, JoystickState, PlayerEntity } from "./types";

export const MOVE_SPEED_TPS = 4.0; // Tiles per second for grid step animation
export const INPUT_THRESHOLD = 0.3; // Minimum joystick displacement to initiate grid move

export function capacityColor(remaining: number, maxCapacity = 5): string {
  if (remaining <= 0) return "#475569"; // slate dark
  if (remaining === 1) return "#3b82f6"; // blue

  const cap = Math.min(remaining, maxCapacity);
  // Interpolate from blue (#3b82f6 = 59, 130, 246) at cap=1 to red (#ef4444 = 239, 68, 68) at cap=5
  const t = (cap - 1) / (maxCapacity - 1);

  const r = Math.round(59 + t * (239 - 59));
  const g = Math.round(130 + t * (68 - 130));
  const b = Math.round(246 + t * (68 - 246));

  return `rgb(${r}, ${g}, ${b})`;
}

export function syncPlayers(
  registry: EntityRegistry<PlayerEntity>,
  activePeers: Array<{
    id: string;
    name: string;
    color: string;
    status?: PlayerConnectionStatus | string;
    state?: string;
  }>,
  startPos: GridPos
): void {
  for (const peer of activePeers) {
    const status = peer.status ?? peer.state;
    if (
      status &&
      status !== "live" &&
      status !== "reconnecting" &&
      status !== "connected"
    ) {
      continue;
    }

    const existing = registry.get(peer.id);
    if (existing) {
      existing.name = peer.name;
      existing.color = peer.color;
      if (existing.tileX === undefined) {
        existing.tileX = Math.floor(existing.x);
        existing.tileY = Math.floor(existing.y);
      }
    } else {
      registry.add({
        id: peer.id,
        kind: "player",
        name: peer.name,
        color: peer.color,
        x: startPos.x + 0.5,
        y: startPos.y + 0.5,
        tileX: startPos.x,
        tileY: startPos.y,
      });
    }
  }
}

export function isTileOccupiedByOtherPlayer(
  pos: GridPos,
  playerId: string,
  players: PlayerEntity[]
): boolean {
  return players.some(
    (p) =>
      p.id !== playerId &&
      ((p.tileX === pos.x && p.tileY === pos.y) ||
        (p.targetTileX === pos.x && p.targetTileY === pos.y))
  );
}

export function stepRoom(
  grid: TileGrid<Cell | null>,
  registry: EntityRegistry<PlayerEntity>,
  joystickInputs: Map<string, JoystickState>,
  dt: number
): { won: boolean } {
  // Sort players by ID for stable, deterministic move resolution
  const players = (
    registry.query((e) => e.kind === "player") as PlayerEntity[]
  ).sort((a, b) => a.id.localeCompare(b.id));

  for (const player of players) {
    // Ensure tileX/tileY are initialized
    if (player.tileX === undefined || player.tileY === undefined) {
      player.tileX = Math.floor(player.x);
      player.tileY = Math.floor(player.y);
    }

    // 1. If player is not currently moving, check joystick input for a new step
    if (player.targetTileX === undefined || player.targetTileY === undefined) {
      const input = joystickInputs.get(player.id) ?? { x: 0, y: 0 };
      const magSq = input.x * input.x + input.y * input.y;

      if (magSq >= INPUT_THRESHOLD * INPUT_THRESHOLD) {
        let dirX = 0;
        let dirY = 0;

        if (Math.abs(input.x) > Math.abs(input.y)) {
          dirX = Math.sign(input.x);
        } else {
          dirY = Math.sign(input.y);
        }

        const targetPos: GridPos = {
          x: player.tileX + dirX,
          y: player.tileY + dirY,
        };

        const targetCell = grid.get(targetPos);
        const walkable =
          targetCell !== null &&
          targetCell !== undefined &&
          !isTileOccupiedByOtherPlayer(targetPos, player.id, players);

        if (walkable) {
          player.targetTileX = targetPos.x;
          player.targetTileY = targetPos.y;
          player.moveProgress = 0;
        }
      }
    }

    // 2. If player is currently moving along a tile transition
    if (player.targetTileX !== undefined && player.targetTileY !== undefined) {
      const currentProgress = player.moveProgress ?? 0;
      const newProgress = currentProgress + MOVE_SPEED_TPS * dt;

      if (newProgress >= 1.0) {
        // Step completed!
        const oldTile: GridPos = { x: player.tileX, y: player.tileY };
        const newTile: GridPos = {
          x: player.targetTileX,
          y: player.targetTileY,
        };

        player.tileX = newTile.x;
        player.tileY = newTile.y;
        player.x = newTile.x + 0.5;
        player.y = newTile.y + 0.5;

        player.targetTileX = undefined;
        player.targetTileY = undefined;
        player.moveProgress = undefined;

        // Arrival logic: decrement remaining uses on new tile
        const targetCell = grid.get(newTile);
        if (targetCell) {
          targetCell.remaining = Math.max(0, targetCell.remaining - 1);
        }

        // Departure logic: crumble old tile if depleted and unoccupied
        const oldCell = grid.get(oldTile);
        if (oldCell && oldCell.remaining === 0) {
          const stillOccupied = players.some(
            (p) => p.tileX === oldTile.x && p.tileY === oldTile.y
          );
          if (!stillOccupied) {
            grid.set(oldTile, null);
          }
        }
      } else {
        // Step in progress: update interpolated x/y position for drawing
        player.moveProgress = newProgress;
        player.x =
          player.tileX +
          0.5 +
          (player.targetTileX - player.tileX) * newProgress;
        player.y =
          player.tileY +
          0.5 +
          (player.targetTileY - player.tileY) * newProgress;
      }
    } else {
      // Stationary: align rendering x/y with tile center
      player.x = player.tileX + 0.5;
      player.y = player.tileY + 0.5;
    }
  }

  // Win condition check:
  // Exactly 1 non-null cell remains in the grid, it is of kind "end" with remaining === 0, and a player is on it.
  let nonNullCount = 0;
  let endCellDepletedAndOccupied = false;

  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const cell = grid.get({ x, y });
      if (cell !== null && cell !== undefined) {
        nonNullCount++;
        if (cell.kind === "end" && cell.remaining === 0) {
          const playerOnEnd = players.some(
            (p) => p.tileX === x && p.tileY === y
          );
          if (playerOnEnd) {
            endCellDepletedAndOccupied = true;
          }
        }
      }
    }
  }

  const won = nonNullCount === 1 && endCellDepletedAndOccupied;
  return { won };
}
