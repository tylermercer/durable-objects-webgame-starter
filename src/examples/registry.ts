import type { ConsoleGameModule, ControllerGameModule } from "../contract/gameTypes";

export interface GameEntry {
  label: string;
  maxPlayers?: number;
  console: () => Promise<ConsoleGameModule | any>;
  controller: () => Promise<ControllerGameModule | any>;
}

export const EXAMPLES: Record<string, GameEntry> = {
  "touch-demo": {
    label: "Touch Demo",
    console: () => import("@examples/touch-demo/console"),
    controller: () => import("@examples/touch-demo/controller"),
  },
  "liars-dice": {
    label: "Liar's Dice",
    maxPlayers: 6,
    console: () => import("@examples/liars-dice/console"),
    controller: () => import("@examples/liars-dice/controller"),
  },
  "flappy-royale": {
    label: "Flappy Royale",
    console: () => import("@examples/flappy-royale/console"),
    controller: () => import("@examples/flappy-royale/controller"),
  },
  "grid-dungeon": {
    label: "Grid Dungeon",
    console: () => import("@examples/grid-dungeon/console"),
    controller: () => import("@examples/grid-dungeon/controller"),
  },
  "uno": {
    label: "Uno",
    maxPlayers: 6,
    console: () => import("@examples/uno/console"),
    controller: () => import("@examples/uno/controller"),
  },
  "othello": {
    label: "Othello",
    maxPlayers: 2,
    console: () => import("@examples/othello/console"),
    controller: () => import("@examples/othello/controller"),
  },
} as const;

export type ExampleId = keyof typeof EXAMPLES;
export const DEFAULT_EXAMPLE: ExampleId = "touch-demo";
