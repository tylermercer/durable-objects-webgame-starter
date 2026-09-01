import { $ } from "bun";
import { readdirSync, readFileSync, writeFileSync, rmSync, cpSync, existsSync } from "node:fs";

function getAvailableExamples(): string[] {
  const examplesDir = "./src/examples";
  if (!existsSync(examplesDir)) return [];
  return readdirSync(examplesDir, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => dirent.name)
    .sort();
}

function parseExampleArg(): { hasExampleFlag: boolean; exampleName?: string } {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--example") {
      const nextArg = args[i + 1];
      if (!nextArg || nextArg.startsWith("-")) {
        return { hasExampleFlag: true, exampleName: undefined };
      }
      return { hasExampleFlag: true, exampleName: nextArg };
    } else if (arg.startsWith("--example=")) {
      const value = arg.slice("--example=".length);
      return { hasExampleFlag: true, exampleName: value || undefined };
    }
  }
  return { hasExampleFlag: false };
}

async function main() {
  const availableExamples = getAvailableExamples();
  const { hasExampleFlag, exampleName } = parseExampleArg();

  if (hasExampleFlag) {
    if (!exampleName || !availableExamples.includes(exampleName)) {
      console.error("\n\x1b[31m[Error]\x1b[0m Please specify a valid example name with --example.");
      console.error("Available examples:");
      for (const ex of availableExamples) {
        console.error(`  - ${ex}`);
      }
      console.error("\nUsage:");
      console.error("  bun scripts/eject.ts --example <example-name>\n");
      process.exit(1);
    }
  }

  console.log("\n🎮 Ejecting to a single-game project...\n");
  console.log("This will:");
  if (exampleName) {
    console.log(`  - Copy the "${exampleName}" example into src/logic/`);
  }
  console.log("  - Delete src/pages/play/ (the per-example route)");
  console.log("  - Delete src/examples/ (all demo games + registry)");
  console.log("  - Replace src/pages/index.astro with the single-game shell");
  console.log("  - Point src/contract/gameSource.ts at src/logic/ instead of the example registry\n");

  if (prompt("Type 'eject' to continue:") !== "eject") {
    console.log("Aborted.");
    return;
  }

  if (exampleName) {
    console.log(`\x1b[34m[1/5]\x1b[0m Copying "${exampleName}" example files to src/logic/...`);
    cpSync(`./src/examples/${exampleName}`, "./src/logic", { recursive: true, force: true });
  }

  const stepPrefix = exampleName ? "[2/5]" : "[1/4]";
  console.log(`\x1b[34m${stepPrefix}\x1b[0m Removing example route, demo games, and eject CI workflow...`);
  rmSync("./src/pages/play", { recursive: true, force: true });
  rmSync("./src/pages/dev", { recursive: true, force: true });
  rmSync("./src/examples", { recursive: true, force: true });
  rmSync("./.github/workflows/test-eject.yml", { force: true });

  const stepPrefix2 = exampleName ? "[3/5]" : "[2/4]";
  console.log(`\x1b[34m${stepPrefix2}\x1b[0m Rewriting src/pages/index.astro...`);
  writeFileSync(
    "./src/pages/index.astro",
    readFileSync("./src/pages/_index.astro", "utf-8")
  );
  rmSync("./src/pages/_index.astro", { force: true });

  const stepPrefix3 = exampleName ? "[4/5]" : "[3/4]";
  console.log(`\x1b[34m${stepPrefix3}\x1b[0m Switching gameSource.ts to src/logic/...`);
  writeFileSync(
    "./src/contract/gameSource.ts",
    readFileSync("./src/contract/gameSource.state2.ts", "utf-8")
  );
  rmSync("./src/contract/gameSource.state2.ts");

  const stepPrefix4 = exampleName ? "[5/5]" : "[4/4]";
  console.log(`\x1b[34m${stepPrefix4}\x1b[0m Verifying build...`);
  try {
    await $`pnpm astro check`;
    await $`pnpm build`;
  } catch (err) {
    console.error("\n\x1b[31m[Error]\x1b[0m Ejection verification failed during astro check or build.");
    console.error("Please inspect your game logic in src/logic/console.ts and src/logic/controller.ts.");
    throw err;
  }

  console.log("\n\x1b[32m[Success]\x1b[0m Ejected into a single-game project.");
  console.log("Next steps:");
  console.log("  1. Commit your ejection changes: git commit -am 'eject from example starter'");
  console.log("  2. Implement your game in src/logic/console.ts and src/logic/controller.ts — build away!\n");

  console.log("🤖 \x1b[1mCoding Agent Prompt:\x1b[0m");
  console.log("--------------------------------------------------------------------------------");
  if (exampleName) {
    console.log(`This repository has been ejected into a single-game project using the "${exampleName}" example as a starting point.

Your task is to replace or modify the "${exampleName}" code in \`src/logic/\` to build the new game.

Key guidelines:
1. Console entrypoint: \`src/logic/console.ts\` exports \`createGame(ctx: ConsoleContext)\` which returns a \`ConsoleGameInstance\` ({ tick, render, destroy }).
2. Controller entrypoint: \`src/logic/controller.ts\` exports \`createGame(ctx: ControllerContext)\` which returns a \`ControllerGameInstance\` ({ destroy }).
3. Clean up or replace any remaining example-specific state, assets, or types in \`src/logic/\`.
4. Run \`pnpm astro check\` and \`pnpm build\` to verify the game compiles without errors.`);
  } else {
    console.log(`This repository has been ejected into a single-game project.

Your task is to implement the game logic in \`src/logic/console.ts\` and \`src/logic/controller.ts\`.

Key guidelines:
1. Console entrypoint: \`src/logic/console.ts\` exports \`createGame(ctx: ConsoleContext)\` which returns a \`ConsoleGameInstance\` ({ tick, render, destroy }).
2. Controller entrypoint: \`src/logic/controller.ts\` exports \`createGame(ctx: ControllerContext)\` which returns a \`ControllerGameInstance\` ({ destroy }).
3. Run \`pnpm astro check\` and \`pnpm build\` to verify the game compiles without errors.`);
  }
  console.log("--------------------------------------------------------------------------------\n");

  console.log("\x1b[34m[Clean up]\x1b[0m Removing ejection script...");
  rmSync("./scripts/eject.ts", { force: true });
}

main().catch((err) => {
  console.error(`\n\x1b[31m[Error]\x1b[0m ${err.message}`);
  process.exit(1);
});
