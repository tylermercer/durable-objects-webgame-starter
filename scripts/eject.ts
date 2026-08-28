import { $ } from "bun";
import { readFileSync, writeFileSync, rmSync } from "node:fs";

async function main() {
  console.log("\n🎮 Ejecting to a single-game project...\n");
  console.log("This will:");
  console.log("  - Delete src/pages/play/ (the per-example route)");
  console.log("  - Delete src/examples/ (all four demo games + registry)");
  console.log("  - Replace src/pages/index.astro with the single-game shell");
  console.log("  - Point src/contract/gameSource.ts at src/logic/ instead of the example registry\n");

  if (prompt("Type 'eject' to continue:") !== "eject") {
    console.log("Aborted.");
    return;
  }

  console.log("\x1b[34m[1/4]\x1b[0m Removing example route, demo games, and eject CI workflow...");
  rmSync("./src/pages/play", { recursive: true, force: true });
  rmSync("./src/examples", { recursive: true, force: true });
  rmSync("./.github/workflows/test-eject.yml", { force: true });

  console.log("\x1b[34m[2/4]\x1b[0m Rewriting src/pages/index.astro...");
  writeFileSync(
    "./src/pages/index.astro",
    readFileSync("./src/pages/_index.astro", "utf-8")
  );
  rmSync("./src/pages/_index.astro", { force: true });

  console.log("\x1b[34m[3/4]\x1b[0m Switching gameSource.ts to src/logic/...");
  writeFileSync(
    "./src/contract/gameSource.ts",
    readFileSync("./src/contract/gameSource.state2.ts", "utf-8")
  );
  rmSync("./src/contract/gameSource.state2.ts");

  console.log("\x1b[34m[4/4]\x1b[0m Verifying build...");
  try {
    await $`pnpm astro check`;
    await $`pnpm build`;
  } catch (err) {
    console.error("\n\x1b[31m[Error]\x1b[0m Ejection verification failed during astro check or build.");
    console.error("Please inspect your game logic in src/logic/console.ts and src/logic/controller.ts.");
    throw err;
  }

  console.log("\x1b[34m[5/5]\x1b[0m Cleaning up ejection script...");
  rmSync("./scripts/eject.ts", { force: true });

  console.log("\n\x1b[32m[Success]\x1b[0m Ejected into a single-game project.");
  console.log("Next steps:");
  console.log("  1. Commit your ejection changes: git commit -am 'eject from example starter'");
  console.log("  2. Implement your game in src/logic/console.ts and src/logic/controller.ts — build away!\n");
}

main().catch((err) => {
  console.error(`\n\x1b[31m[Error]\x1b[0m ${err.message}`);
  process.exit(1);
});
