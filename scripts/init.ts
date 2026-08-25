import { $ } from "bun";
import { writeFileSync, readFileSync } from "node:fs";

const TEMPLATE_NAME = "astroflare";
const TEMPLATE_SUBDOMAIN = "tmercer";
const CF_TOKEN_URL = "https://dash.cloudflare.com/profile/api-tokens";

async function checkDependencies() {
  try {
    await $`pnpm --version`.quiet();
  } catch (e) {
    throw new Error("pnpm is not installed. Please install it with 'npm install -g pnpm' or visit https://pnpm.io/installation");
  }

  try {
    await $`gh --version`.quiet();
    const authStatus = await $`gh auth status`.quiet();
  } catch (e) {
    throw new Error("GitHub CLI (gh) is not installed or not authenticated. Please run 'brew install gh' and 'gh auth login'.");
  }
}

async function main() {
  console.log("\n🚀 Starting Astroflare Project Setup...\n");

  await checkDependencies();

  console.log(`\x1b[34m[0/5]\x1b[0m Installing dependencies...`);
  await $`pnpm install`;

  // 1. Get Repo Info for the Failure Link
  const repoPath = (await $`gh repo view --json nameWithOwner -q .nameWithOwner`.text()).trim();
  const actionsUrl = `https://github.com/${repoPath}/actions/runs/2`;

  // 2. Project Customization
  const newProjectName = prompt("Enter your new project name (kebab-case):");
  if (!newProjectName) throw new Error("Project name is required.");

  const cfSubdomain = prompt("Enter your Cloudflare Workers subdomain:", "tmercer");
  if (!cfSubdomain) throw new Error("Cloudflare subdomain is required.");

  const themeColor = prompt("Enter a theme color Hex code (e.g. #CC5500, you can change this later):", "#CC5500");
  if (!themeColor) throw new Error("Theme color is required.");

  console.log(`\x1b[34m[1/5]\x1b[0m Customizing project...`);
  
  const filesToUpdate = [
    "./wrangler.jsonc", 
    "./.github/workflows/main.yml",
    "./package.json",
    "./astro.config.mjs"
  ];

  for (const path of filesToUpdate) {
    try {
      let content = readFileSync(path, "utf-8");
      content = content.replaceAll(TEMPLATE_NAME, newProjectName);
      content = content.replaceAll(TEMPLATE_SUBDOMAIN, cfSubdomain);
      if (path === "./.github/workflows/main.yml") {
        content = content.replace(/\n\s*if: github\.repository == 'tylermercer\/astro-cloudflare-starter' # prevents failure before init; removed via init\.ts/, "");
      }
      writeFileSync(path, content);
    } catch (e) {
      console.warn(`Could not update ${path}, skipping...`);
    }
  }

  // Update theme color
  try {
    const themePath = "./src/styles/theme.scss";
    const themeContent = readFileSync(themePath, "utf-8");
    writeFileSync(themePath, themeContent.replace(/\$themeColor:\s*#[0-9a-fA-F]{3,6};/, `$themeColor: ${themeColor};`));
  } catch (e) {
    console.warn(`Could not update theme color in src/styles/theme.scss, skipping...`);
  }

  // 3. Cloudflare Credentials
  console.log(`\x1b[34m[2/5]\x1b[0m Please create a Cloudflare API Token.`);
  console.log(`      Template: "Edit Cloudflare Workers"`);
  console.log(`      Suggested Name: "Deploy ${newProjectName}"`);
  
  if (prompt("Press Enter to open the Cloudflare Dashboard (or 's' to skip):") !== 's') {
    await $`open ${CF_TOKEN_URL}`.quiet();
  }

  const cfToken = prompt("Paste your Cloudflare API Token:");
  const cfAccountId = prompt("Paste your Cloudflare Account ID:");

  if (!cfToken || !cfAccountId) throw new Error("Credentials are required.");

  // 4. Set Secrets & Push (Amend Initial Commit)
  console.log(`\x1b[34m[3/5]\x1b[0m Setting GitHub Secrets...`);
  await $`gh secret set CLOUDFLARE_API_TOKEN --body ${cfToken}`;
  await $`gh secret set CLOUDFLARE_ACCOUNT_ID --body ${cfAccountId}`;

  console.log(`\x1b[34m[4/5]\x1b[0m Amending initial commit and force pushing...`);
  await $`git add .`;
  await $`git commit --amend --no-edit`;
  // Use force-with-lease for safer force pushing
  await $`git push --force-with-lease`;

  // 5. Polling with 5-minute Timeout
  const deployUrl = `https://${newProjectName}.${cfSubdomain}.workers.dev`;
  console.log(`\x1b[34m[5/5]\x1b[0m Waiting for deployment at ${deployUrl}...`);

  const startTime = Date.now();
  const timeout = 5 * 60 * 1000; 
  let isLive = false;

  while (Date.now() - startTime < timeout) {
    process.stdout.write(".");
    try {
      // Using a no-cache fetch to ensure we see the live site immediately
      const res = await fetch(deployUrl, { cache: "no-store" });
      if (res.status === 200) {
        isLive = true;
        break;
      }
    } catch (e) {
      // Worker not live or DNS not propagated
    }
    await new Promise(r => setTimeout(r, 5000));
  }

  console.log("\n");

  if (isLive) {
    console.log(`\x1b[32m[Success]\x1b[0m Setup Complete!`);
    console.log(`🎉 Your project is live at: \x1b[4m${deployUrl}\x1b[0m\n`);
  } else {
    console.log(`\x1b[31m[Timeout]\x1b[0m Deployment is taking longer than expected.`);
    console.log(`Please check the build logs for \x1b[1mRun #2\x1b[0m here:`);
    console.log(`\x1b[34m${actionsUrl}\x1b[0m\n`);
  }
}

main().catch((err) => {
  console.error(`\n\x1b[31m[Error]\x1b[0m ${err.message}`);
  process.exit(1);
});
