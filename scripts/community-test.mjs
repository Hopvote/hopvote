// Local check of Community's demo content and Hopvote templates. Dev server only (npx vite --port 5180), LOCAL D1 only.
// Seeds the demo, reads it back through /api/templates (authors, buddies, bios, languages), saves every demo deck and
// every Hopvote template through POST /api/rooms (the builder's real validation) on a throwaway account, checks
// what was stored, removes the seed, checks nothing else moved, then seeds again so the local demo stays visible.
// Run: node scripts/community-test.mjs
import { execFileSync } from "node:child_process";
import { DECKS, DEMO_AUTHORS, demoAuthorEmail, needsNames, problems, templateId } from "./community-demo.mjs";
import { OFFICIAL } from "../src/official-templates.ts";

const BASE = "http://localhost:5180";
const ROOT = new URL("..", import.meta.url).pathname;
let failures = 0;
const ok = (cond, label) => {
  console.log(`${cond ? "✓" : "✗"} ${label}`);
  if (!cond) failures++;
};
const sql = (command) => JSON.parse(execFileSync("npx", ["wrangler", "d1", "execute", "hopvote-db", "--local", "--json", "--command", command], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }))[0]?.results ?? [];
const seed = (...args) => execFileSync("node", ["scripts/seed-community.mjs", ...args], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

let cookie = "";
async function call(path, { method = "GET", body, keep = true } = {}) {
  // The dev server restarts when worker files change: a refused connection is tried again a few times.
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(BASE + path, {
        method,
        headers: { ...(body ? { "content-type": "application/json" } : {}), ...(cookie && keep ? { cookie } : {}), origin: BASE, connection: "close" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const set = res.headers.get("set-cookie");
      if (set && keep) cookie = set.split(";")[0];
      const data = await res.json().catch(() => ({}));
      // Other local tests share the per-address limits: a 429 on a room call (save or delete) waits and tries again.
      if (res.status === 429 && (path.startsWith("/api/rooms") || path.startsWith("/api/polls/")) && attempt < 8) {
        await new Promise((r) => setTimeout(r, 15000));
        continue;
      }
      return { status: res.status, data };
    } catch (err) {
      if (attempt >= 5) throw err;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

// What the builder sends and the room keeps, to compare a deck with its saved copy.
const shape = (q) => JSON.stringify([q.type ?? "choice", q.question, q.options, q.correct ?? null, q.ordered ?? false, q.answer ?? null, q.fill ?? null, q.decoys ?? [], q.duration ?? null, q.text ?? null, q.url ?? null, q.max ?? null, q.fields ?? null, q.multi ?? false]);
const KINDS = (q) => (q.type === "choice" || !q.type ? (typeof q.correct === "number" ? "quiz" : "choice") : q.type === "rank" && q.ordered ? "order" : q.type);

const email = `community-${crypto.randomUUID().slice(0, 8)}@hopvote.test`;
// Two look-alikes that are not demo rows (a demo-like id, a demo email domain): --remove must keep both. Counting every
// user would not do: other local tests create and delete accounts at the same time.
const tag = crypto.randomUUID().slice(0, 8);
const DECOYS = [
  [`demo-decoy-${tag}`, `decoy-${tag}@hopvote.test`],
  [`decoy-${tag}`, `decoy-${tag}@demo.hopvote.invalid`],
];
const dropDecoys = () => sql(`DELETE FROM users WHERE id IN (${DECOYS.map(([id]) => `'${id}'`).join(", ")})`);
try {
  // The content itself.
  const bad = [...DECKS, ...OFFICIAL].flatMap((d) => problems(d).map((p) => `${d.slug ?? d.id}: ${p}`));
  ok(!bad.length, `every deck and template keeps the rules (title under 60, 5 questions at most, no dashes)${bad.length ? `: ${bad.join("; ")}` : ""}`);
  const used = {};
  for (const q of DECKS.flatMap((d) => d.questions)) used[KINDS(q)] = (used[KINDS(q)] ?? 0) + 1;
  const kinds = ["choice", "quiz", "words", "open", "scale", "scales", "rank", "order", "points", "qa", "wheel", "number", "fill", "match", "slide", "link", "countdown", "contact"];
  ok(kinds.every((k) => used[k] >= 2), `every kind but image and video is used at least twice in the demo (${kinds.map((k) => `${k} ${used[k] ?? 0}`).join(", ")})`);
  ok(DECKS.length >= 28 && DEMO_AUTHORS.length >= 12, `${DECKS.length} demo decks by ${DEMO_AUTHORS.length} authors`);
  ok(new Set(OFFICIAL.map((t) => t.id)).size === OFFICIAL.length && OFFICIAL.every((t) => OFFICIAL.some((o) => o.use === t.use && o.lang !== t.lang)), `${OFFICIAL.length} Hopvote templates, each in English and French`);

  seed();
  const pending = await call("/api/auth/signup", { method: "POST", body: { name: "Community", email, password: crypto.randomUUID() } });
  await call("/api/auth/verify", { method: "POST", body: { token: pending.data?.devToken } });
  ok(!!sql(`SELECT id FROM users WHERE email = '${email}'`)[0]?.id, "throwaway local account created");

  // Listed with their authors and languages.
  const listed = (await call("/api/templates")).data.templates ?? [];
  const byId = new Map(listed.map((t) => [t.id, t]));
  const missing = DECKS.filter((d) => !byId.has(templateId(d.slug)));
  ok(!missing.length, `GET /api/templates lists the ${DECKS.length} demo decks${missing.length ? ` (missing ${missing.map((d) => d.slug)})` : ""}`);
  const wrong = DECKS.filter((d) => {
    const t = byId.get(templateId(d.slug));
    const a = DEMO_AUTHORS.find((x) => x.slug === d.author);
    return !t || !t.demo || t.profile?.name !== a.name || t.profile?.bio !== a.bio || t.avatar !== a.avatar || t.lang !== a.lang || t.author !== a.name.split(" ")[0] || t.mine;
  });
  ok(!wrong.length, `each demo deck comes with its author's name, buddy, bio, the demo mark and its language${wrong.length ? ` (wrong: ${wrong.map((d) => d.slug)})` : ""}`);
  ok(listed.every((t) => !("email" in t) && !("user_id" in t)), "no author email or id leaves the server");
  ok(listed.filter((t) => !t.demo).every((t) => !t.profile), "real authors get no profile");

  // Every deck and template through the builder's save.
  // Demo decks are saved with "Detect", as a builder opened from Community does; Hopvote templates with their language.
  const saveAll = async (items, label, detect) => {
    const failed = [];
    for (const item of items) {
      const lang = item.lang ?? DEMO_AUTHORS.find((a) => a.slug === item.author).lang;
      const out = await call("/api/rooms", { method: "POST", body: { title: item.title, questions: item.questions, names: needsNames(item.questions), ...(detect ? {} : { lang }) } });
      if (out.status !== 200 || !out.data.code) {
        failed.push(`${item.slug ?? item.id}: ${out.status} ${out.data.error ?? ""}`);
        continue;
      }
      const saved = (await call(`/api/polls/${out.data.code}`)).data;
      const same = saved.questions?.length === item.questions.length && saved.questions.every((q, i) => shape(q) === shape(item.questions[i]));
      if (!same) failed.push(`${item.slug ?? item.id}: saved questions differ`);
      if (saved.lang !== lang) failed.push(`${item.slug ?? item.id}: saved in ${saved.lang}, written in ${lang}`);
      const gone = await call(`/api/polls/${out.data.code}`, { method: "DELETE" });
      if (gone.status !== 200) failed.push(`${item.slug ?? item.id}: delete ${gone.status}`);
    }
    ok(!failed.length, `${label}: all ${items.length} save with 200, keep every question and their language, then delete${failed.length ? `\n    ${failed.join("\n    ")}` : ""}`);
  };
  await saveAll(DECKS, "demo decks", true);
  await saveAll(OFFICIAL, "Hopvote templates", false);

  // Opening a demo deck in the builder counts one use, like any shared presentation.
  const first = templateId(DECKS[0].slug);
  const used0 = byId.get(first)?.uses;
  const opened = await call(`/api/templates/${first}/use`, { method: "POST" });
  ok(opened.status === 200 && opened.data.template?.uses === used0 && sql(`SELECT uses FROM shared_templates WHERE id = '${first}'`)[0]?.uses === used0 + 1, "opening a demo deck counts one use");
  await call(`/api/templates/${first}/use`, { method: "POST" });
  await call(`/api/templates/${first}/use`, { method: "POST" });
  ok(sql(`SELECT uses FROM shared_templates WHERE id = '${first}'`)[0]?.uses === used0 + 1, "opening it again from the same account counts nothing more");

  // Nobody signs in as a demo author.
  const login = await call("/api/auth/login", { method: "POST", body: { email: demoAuthorEmail(DEMO_AUTHORS[0].slug), password: "anything-at-all" }, keep: false });
  ok(login.status >= 400 && login.status < 500, `a demo author's email cannot sign in (${login.status})`);

  // Removal touches the demo rows only.
  for (const [id, mail] of DECOYS) sql(`INSERT INTO users (id, email, name, pass_hash, pass_salt, plan, created_at) VALUES ('${id}', '${mail}', 'Decoy', 'x', 'x', 'pro', ${Date.now()})`);
  seed("--remove");
  const after = (await call("/api/templates")).data.templates ?? [];
  ok(!after.some((t) => DECKS.some((d) => templateId(d.slug) === t.id)), "after --remove, no demo deck is listed");
  ok(sql("SELECT COUNT(*) AS n FROM users WHERE id LIKE 'demo-%' AND email LIKE '%@demo.hopvote.invalid'")[0].n === 0, "after --remove, no demo user is left");
  const kept = sql(`SELECT COUNT(*) AS n FROM users WHERE id IN (${DECOYS.map(([id]) => `'${id}'`).join(", ")}) OR email = '${email}'`)[0].n;
  ok(kept === 3, "--remove keeps every other user: the throwaway account and two look-alikes (demo id only, demo email only)");
  dropDecoys();

  // A refusal when pointed elsewhere.
  let refused = false;
  try {
    execFileSync("node", ["scripts/seed-community.mjs", "--remote"], { cwd: ROOT, stdio: "ignore" });
  } catch {
    refused = true;
  }
  ok(refused, "the seed refuses --remote");

  // Seeded again: the local demo stays visible.
  seed();
  ok(sql("SELECT COUNT(*) AS n FROM shared_templates WHERE user_id LIKE 'demo-%'")[0].n === DECKS.length, `seeded again: ${DECKS.length} demo decks in the local database`);
} catch (err) {
  ok(false, `crashed: ${err?.stack ?? err}`);
} finally {
  dropDecoys();
  if (cookie) await call("/api/account", { method: "DELETE", body: { confirm: "DELETE" } });
  ok(!sql(`SELECT id FROM users WHERE email = '${email}'`).length, "throwaway account deleted");
}
console.log(failures ? `\n${failures} check(s) failed` : "\nAll Community checks passed");
process.exit(failures ? 1 : 0);
