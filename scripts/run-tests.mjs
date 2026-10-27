// Runs the local tests one after another against the dev server, then says which failed.
// Before: npm run setup, MAIL_DEV=1 in .dev.vars (sign-up links come back in the answer), then npm run dev in another
// terminal. Usage: npm test, or npm test -- rounds-test e2e to run some of them.
// Some tests fill the sign-in rate limits on purpose: the test after them waits a minute first.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

process.chdir(fileURLToPath(new URL("..", import.meta.url)));
const BASE = "http://localhost:5180";
// [script in scripts/, wait a minute before it]
const TESTS = [
  ["types-test", false],
  ["games-test", false],
  ["rounds-test", false],
  ["board-test", false],
  ["decor-test", false],
  ["team-test", false],
  ["ai-kinds-test", false],
  ["community-test", false],
  ["answers-test", true],
  ["e2e", true],
];

const wanted = process.argv.slice(2);
const list = wanted.length ? TESTS.filter(([name]) => wanted.includes(name)) : TESTS;
if (!list.length) {
  console.error(`Unknown test. Pick from: ${TESTS.map(([name]) => name).join(", ")}`);
  process.exit(2);
}
const vars = existsSync(".dev.vars") ? readFileSync(".dev.vars", "utf8") : "";
if (!existsSync("wrangler.jsonc") || !/^MAIL_DEV\s*=\s*"?1"?\s*$/m.test(vars)) {
  console.error("Run npm run setup, set MAIL_DEV=1 in .dev.vars, then restart npm run dev.");
  process.exit(2);
}
const up = await fetch(`${BASE}/api/health`).then((r) => r.ok, () => false);
if (!up) {
  console.error(`No dev server at ${BASE}: start it with npm run dev in another terminal.`);
  process.exit(2);
}

const failed = [];
for (const [i, [name, pause]] of list.entries()) {
  if (pause && i > 0) {
    console.log("\nWaiting a minute for the rate limits...");
    await new Promise((r) => setTimeout(r, 65_000));
  }
  console.log(`\n# ${name}`);
  const run = spawnSync(process.execPath, [`scripts/${name}.mjs`], { stdio: "inherit" });
  if (run.status !== 0) failed.push(name);
}
console.log(failed.length ? `\nFailed: ${failed.join(", ")}` : `\nAll ${list.length} tests passed`);
process.exit(failed.length ? 1 : 0);
