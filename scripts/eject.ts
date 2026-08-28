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

  console.log("\x1b[34m[1/4]\x1b[0m Removing example route and demo games...");
  rmSync("./src/pages/play", { recursive: true, force: true });
  rmSync("./src/examples", { recursive: true, force: true });

  console.log("\x1b[34m[2/4]\x1b[0m Rewriting src/pages/index.astro...");
  writeFileSync(
    "./src/pages/index.astro",
    `---\nimport Layout from '@layouts/Base.astro';\nimport GameShell from '@components/GameShell.astro';\n\nexport const prerender = true;\n---\n<Layout>\n  <GameShell />\n</Layout>\n`
  );

  console.log("\x1b[34m[3/4]\x1b[0m Switching gameSource.ts to src/logic/...");
  writeFileSync(
    "./src/contract/gameSource.ts",
    readFileSync("./src/contract/gameSource.state2.ts", "utf-8")
  );
  rmSync("./src/contract/gameSource.state2.ts");

  console.log("\x1b[34m[4/4]\x1b[0m Verifying build...");
  await $`pnpm astro check`;
  await $`pnpm build`;

  console.log("\n\x1b[32m[Success]\x1b[0m Ejected. src/logic/console.ts and");
  console.log("src/logic/controller.ts are your game now — build away.\n");
}

main().catch((err) => {
  console.error(`\n\x1b[31m[Error]\x1b[0m ${err.message}`);
  process.exit(1);
});
