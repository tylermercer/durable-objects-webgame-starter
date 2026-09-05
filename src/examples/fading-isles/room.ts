import { TileGrid, type GridPos } from "@utils/tileGrid";
import { EntityRegistry } from "@utils/entityRegistry";
import { moveCircleAgainstGrid } from "@utils/circleMovement";
import type { PlayerConnectionStatus } from "@host/console";
import type { Cell, JoystickState, PlayerEntity } from "./types";

export const PLAYER_SPEED = 3.5; // Tiles per second
export const PLAYER_RADIUS = 0.35; // Tile units

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
  startPos: GridPos,
  grid?: TileGrid<Cell | null>
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
    } else {
      registry.add({
        id: peer.id,
        kind: "player",
        name: peer.name,
        color: peer.color,
        x: startPos.x + 0.5,
        y: startPos.y + 0.5,
      });

      // Initial spawn counts as an arrival/occupancy on startPos
      if (grid) {
        const startCell = grid.get(startPos);
        if (startCell) {
          startCell.remaining = Math.max(0, startCell.remaining - 1);
        }
      }
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
      Math.floor(p.x) === pos.x &&
      Math.floor(p.y) === pos.y
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
    const input = joystickInputs.get(player.id) ?? { x: 0, y: 0 };
    if (input.x === 0 && input.y === 0) continue;

    const oldTile: GridPos = {
      x: Math.floor(player.x),
      y: Math.floor(player.y),
    };

    const dx = input.x * PLAYER_SPEED * dt;
    const dy = input.y * PLAYER_SPEED * dt;

    const result = moveCircleAgainstGrid(
      player,
      PLAYER_RADIUS,
      dx,
      dy,
      grid,
      (pos, cell) => {
        if (cell === null || cell === undefined) return false;
        return !isTileOccupiedByOtherPlayer(pos, player.id, players);
      }
    );

    player.x = result.x;
    player.y = result.y;

    const newTile: GridPos = {
      x: Math.floor(player.x),
      y: Math.floor(player.y),
    };

    // Check tile transition (arrival & departure)
    if (newTile.x !== oldTile.x || newTile.y !== oldTile.y) {
      // 1. Arrival on new tile
      const targetCell = grid.get(newTile);
      if (targetCell) {
        targetCell.remaining = Math.max(0, targetCell.remaining - 1);
      }

      // 2. Departure from old tile
      const oldCell = grid.get(oldTile);
      if (oldCell && oldCell.remaining === 0) {
        const stillOccupied = players.some(
          (p) => Math.floor(p.x) === oldTile.x && Math.floor(p.y) === oldTile.y
        );
        if (!stillOccupied) {
          grid.set(oldTile, null);
        }
      }
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
            (p) => Math.floor(p.x) === x && Math.floor(p.y) === y
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
