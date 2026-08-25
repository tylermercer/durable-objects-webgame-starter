export const EXAMPLES = {
  "touch-demo": {
    label: "Touch Demo",
    console: () => import("@examples/touch-demo/console"),
    controller: () => import("@examples/touch-demo/controller"),
  },
  "liars-dice": {
    label: "Liar's Dice",
    console: () => import("@examples/liars-dice/console"),
    controller: () => import("@examples/liars-dice/controller"),
  },
} as const;

export type ExampleId = keyof typeof EXAMPLES;
export const DEFAULT_EXAMPLE: ExampleId = "touch-demo";
