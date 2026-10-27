// Seeds the demo Community content (scripts/community-demo.mjs) into the LOCAL D1 database only.
//   node scripts/seed-community.mjs            adds or updates the demo authors and decks (safe to run again)
//   node scripts/seed-community.mjs --remove   deletes exactly the demo rows, nothing else
// Demo rows: users with the id "demo-<slug>" and the email "<slug>@demo.hopvote.invalid" (no password),
// and their decks in shared_templates. No migration: the demo mark is the id and the email together.
// It refuses to run with --remote, or with any CLOUDFLARE_* variable set, so it can never reach production.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DECKS, DEMO_AUTHORS, demoAuthorEmail, demoAuthorId, problems, templateId } from "./community-demo.mjs";
import { DEMO_DOMAIN } from "../worker/demo-authors.ts";

const args = process.argv.slice(2);
if (args.some((a) => a.includes("remote")) || Object.keys(process.env).some((k) => k.startsWith("CLOUDFLARE_"))) {
  console.error("seed-community: local database only. Remove --remote and every CLOUDFLARE_* variable.");
  process.exit(1);
}
const remove = args.includes("--remove");

const ROOT = new URL("..", import.meta.url).pathname;
// Always --local: the same SQLite file the dev server reads.
function d1(args) {
  return execFileSync("npx", ["wrangler", "d1", "execute", "hopvote-db", "--local", ...args], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}
const query = (sql) => JSON.parse(d1(["--json", "--command", sql]))[0].results;
function run(statements) {
  const dir = mkdtempSync(join(tmpdir(), "hopvote-seed-"));
  try {
    writeFileSync(join(dir, "seed.sql"), statements.join("\n"));
    d1(["--file", join(dir, "seed.sql")]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const str = (s) => `'${String(s).replace(/'/g, "''")}'`;

// Only rows carrying both demo marks.
const DEMO_USERS = `SELECT id FROM users WHERE id LIKE 'demo-%' AND email LIKE '%@${DEMO_DOMAIN}'`;
const counts = () => query(`SELECT (SELECT COUNT(*) FROM users WHERE id LIKE 'demo-%' AND email LIKE '%@${DEMO_DOMAIN}') AS users, (SELECT COUNT(*) FROM shared_templates WHERE user_id IN (${DEMO_USERS})) AS decks, (SELECT COUNT(*) FROM users) AS allUsers`)[0];

if (remove) {
  run([
    `DELETE FROM template_reports WHERE template_id IN (SELECT id FROM shared_templates WHERE user_id IN (${DEMO_USERS}));`,
    `DELETE FROM shared_templates WHERE user_id IN (${DEMO_USERS});`,
    `DELETE FROM users WHERE id LIKE 'demo-%' AND email LIKE '%@${DEMO_DOMAIN}';`,
  ]);
  const left = counts();
  console.log(`Demo content removed: ${left.users} demo users and ${left.decks} demo decks left, ${left.allUsers} users in the database.`);
  process.exit(left.users || left.decks ? 1 : 0);
}

const bad = DECKS.flatMap((deck) => problems(deck).map((p) => `${deck.slug}: ${p}`));
const authors = new Set(DEMO_AUTHORS.map((a) => a.slug));
for (const deck of DECKS) if (!authors.has(deck.author)) bad.push(`${deck.slug}: unknown author ${deck.author}`);
if (new Set(DECKS.map((d) => d.slug)).size !== DECKS.length) bad.push("two decks share a slug");
if (bad.length) {
  console.error(`seed-community: fix the demo content first:\n  ${bad.join("\n  ")}`);
  process.exit(1);
}

// Fixed dates, so a second run changes nothing and "Newest" keeps its order.
const BASE = Date.UTC(2026, 9, 24, 9, 0, 0);
const DAY = 86_400_000;
const statements = [];
for (const [i, a] of DEMO_AUTHORS.entries()) {
  const id = demoAuthorId(a.slug);
  statements.push(
    `INSERT INTO users (id, email, name, pass_hash, pass_salt, plan, created_at) VALUES (${str(id)}, ${str(demoAuthorEmail(a.slug))}, ${str(a.name)}, '', '', 'pro', ${BASE - (150 + i) * DAY}) ` +
      `ON CONFLICT(id) DO UPDATE SET email = excluded.email, name = excluded.name, pass_hash = '', pass_salt = '', plan = 'pro';`,
  );
}
for (const deck of DECKS) {
  // Uses and reports already counted locally are kept on a second run.
  statements.push(
    `INSERT INTO shared_templates (id, user_id, code, title, category, description, questions, uses, reports, created_at) VALUES (${str(templateId(deck.slug))}, ${str(demoAuthorId(deck.author))}, NULL, ${str(deck.title)}, ${str(deck.category)}, ${str(deck.description)}, ${str(JSON.stringify(deck.questions))}, ${deck.uses}, 0, ${BASE - deck.daysAgo * DAY}) ` +
      `ON CONFLICT(id) DO UPDATE SET user_id = excluded.user_id, title = excluded.title, category = excluded.category, description = excluded.description, questions = excluded.questions, created_at = excluded.created_at;`,
  );
}
// Decks dropped from the catalog, and authors no longer listed, leave the demo.
const ids = DECKS.map((deck) => str(templateId(deck.slug))).join(", ");
statements.push(`DELETE FROM template_reports WHERE template_id IN (SELECT id FROM shared_templates WHERE user_id IN (${DEMO_USERS}) AND id NOT IN (${ids}));`);
statements.push(`DELETE FROM shared_templates WHERE user_id IN (${DEMO_USERS}) AND id NOT IN (${ids});`);
statements.push(`DELETE FROM users WHERE id LIKE 'demo-%' AND email LIKE '%@${DEMO_DOMAIN}' AND id NOT IN (${DEMO_AUTHORS.map((a) => str(demoAuthorId(a.slug))).join(", ")});`);
run(statements);

const now = counts();
console.log(`Demo content seeded locally: ${now.users} authors, ${now.decks} decks (${DECKS.filter((d) => DEMO_AUTHORS.find((a) => a.slug === d.author)?.lang === "fr").length} in French).`);
console.log("Remove it with: node scripts/seed-community.mjs --remove");
