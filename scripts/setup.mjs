// One-command setup of your copy of Hopvote.
//   npm run setup    makes wrangler.jsonc, .dev.vars and .env from their examples (a file you already have is kept),
//                    then creates or updates the tables of the database on this machine. Run it again after each update.
//   npm run deploy   runs it with --deploy first: it only checks that wrangler.jsonc is ready for your Cloudflare account.
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

process.chdir(fileURLToPath(new URL("..", import.meta.url)));

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (process.argv.includes("--deploy")) {
  const config = existsSync("wrangler.jsonc") ? readFileSync("wrangler.jsonc", "utf8") : "";
  if (!config) fail("No wrangler.jsonc yet: run npm run setup first.");
  if (config.includes("YOUR_D1_DATABASE_ID")) fail('Set "database_id" in wrangler.jsonc first: npx wrangler d1 create hopvote-db --binding DB writes it.');
  if (/"PUBLIC_URL":\s*""/.test(config)) console.warn('Note: "PUBLIC_URL" is empty in wrangler.jsonc, so links in emails will not work.');
  process.exit(0);
}

for (const [example, file] of [
  ["wrangler.example.jsonc", "wrangler.jsonc"],
  [".dev.vars.example", ".dev.vars"],
  [".env.example", ".env"],
]) {
  if (existsSync(file)) console.log(`${file}: kept`);
  else {
    copyFileSync(example, file);
    console.log(`${file}: made from ${example}`);
  }
}

// The tables, in the database on this machine (.wrangler/state). CI=1 lets wrangler skip its "continue?" question.
console.log("Local database:");
const run = spawnSync("npx", ["wrangler", "d1", "migrations", "apply", "hopvote-db", "--local"], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, CI: "1" },
});
if (run.status !== 0) fail("The local database could not be set up (see above).");
console.log("\nReady. Start it with npm run dev, then open http://localhost:5180");
