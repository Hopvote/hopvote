// Local check of the AI budget: calls are counted, writing help pauses first, translations last, and nothing
// runs once the budget is spent. Dev server only (it calls the real Workers AI once or twice, a few hundred neurons).
// Run: npx vite --port 5180, then node scripts/ai-budget-test.mjs
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const BASE = "http://localhost:5180";
let cookie = "";
let failures = 0;
const ok = (cond, label) => {
  console.log(`${cond ? "✓" : "✗"} ${label}`);
  if (!cond) failures++;
};
async function call(path, { method = "GET", body } = {}) {
  const res = await fetch(BASE + path, { method, headers: { "content-type": "application/json", origin: BASE, connection: "close", ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  return { status: res.status, data: await res.json().catch(() => null) };
}
// The local database, through wrangler (never --remote).
function sql(command) {
  const out = execFileSync("npx", ["wrangler", "d1", "execute", "hopvote-db", "--local", "--json", "--command", command], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  return JSON.parse(out)[0]?.results ?? [];
}
const today = new Date().toISOString().slice(0, 10);
const day = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const spent = () => sql(`SELECT neurons FROM ai_budget WHERE day = '${today}'`)[0]?.neurons ?? 0;

const email = `ai-${randomUUID().slice(0, 8)}@hopvote.test`;
const password = randomUUID();
const before = sql("SELECT day, neurons FROM ai_budget");
try {
  sql("DELETE FROM ai_budget");
  const pending = await call("/api/auth/signup", { method: "POST", body: { name: "AI", email, password } });
  await call("/api/auth/verify", { method: "POST", body: { token: pending.data?.devToken } });

  const rewrite = { question: "What did you think of today's session?", kind: "choice", options: ["Great", "Good", "Meh"], lang: "en", mode: "options" };
  const first = await call("/api/ai/rewrite", { method: "POST", body: rewrite });
  ok(first.status === 200, `writing help answers (${first.status})`);
  const counted = spent();
  ok(counted > 0 && counted < 2000, `the call is counted (${counted} neurons)`);

  sql(`INSERT OR REPLACE INTO ai_budget (day, neurons) VALUES ('${today}', 6000)`);
  const paused = await call("/api/ai/rewrite", { method: "POST", body: rewrite });
  ok(paused.status === 429, `writing help pauses past 6,000 neurons today (${paused.status})`);

  const created = await call("/api/rooms", { method: "POST", body: { title: "Budget check", lang: "en", questions: [{ type: "choice", question: `Which colour do you prefer ${randomUUID().slice(0, 4)}?`, options: ["Red", "Blue"] }] } });
  const code = created.data?.code;
  const translated = await call(`/api/rooms/${code}/translate?lang=fr&i=0`);
  ok(translated.status === 200 && translated.data?.question && !translated.data.question.startsWith("Which colour"), `translations keep working at 6,000 (${translated.data?.question})`);

  // Daily part spent today and the 30-day reserve used up: nothing runs, phones get the original text.
  sql(`INSERT OR REPLACE INTO ai_budget (day, neurons) VALUES ('${today}', 9000), ('${day(3)}', 49000), ('${day(10)}', 49000)`);
  const before2 = spent();
  const edited = await call(`/api/polls/${code}`, { method: "PUT", body: { title: "Budget check", lang: "en", questions: [{ type: "choice", question: "Which season do you like best?", options: ["Summer", "Winter"] }] } });
  ok(edited.status === 200, "question changed to a text never translated");
  const blocked = await call(`/api/rooms/${code}/translate?lang=de&i=0`);
  ok(blocked.status === 200 && blocked.data?.question === "Which season do you like best?", `past the budget, phones get the original text (${blocked.data?.question})`);
  ok(spent() === before2, "no AI call was made past the budget");

  // Reserve left (one busy day only): translations may use it.
  sql("DELETE FROM ai_budget");
  sql(`INSERT INTO ai_budget (day, neurons) VALUES ('${today}', 9500)`);
  const reserve = await call(`/api/rooms/${code}/translate?lang=es&i=0`);
  ok(reserve.status === 200 && reserve.data?.question !== "Which season do you like best?", `with reserve left, translations still run (${reserve.data?.question})`);

  // Calls made at the same moment: each holds the most it could cost before running, so they cannot all pass a budget
  // only one of them fits in. Reserve used up, 8,600 of 9,000 spent today: one poll translation fits, not five.
  sql("DELETE FROM ai_budget");
  sql(`INSERT INTO ai_budget (day, neurons) VALUES ('${today}', 8600), ('${day(3)}', 49000), ('${day(10)}', 49000)`);
  const fresh = `Which fruit do you like best ${randomUUID().slice(0, 4)}?`;
  await call(`/api/polls/${code}`, { method: "PUT", body: { title: "Budget check", lang: "en", questions: [{ type: "choice", question: fresh, options: ["Apples", "Pears"] }] } });
  const burst = await Promise.all(["fr", "de", "es", "it", "pt"].map((lang) => call(`/api/rooms/${code}/translate?lang=${lang}&i=0`)));
  const ran = burst.filter((r) => r.data?.question && r.data.question !== fresh).length;
  ok(burst.every((r) => r.status === 200) && ran <= 1, `five translations at once near the end of the budget: ${ran} ran, the others got the original text`);
  ok(spent() <= 9000, `the day's count never passes the budget (${spent()})`);

  // One account's part of the day's translations (20,000 neurons for an account with every feature): past it, its rooms
  // get the original text, the budget stays for others.
  sql("DELETE FROM ai_budget");
  const userId = sql(`SELECT id FROM users WHERE email = '${email}'`)[0]?.id;
  sql(`INSERT OR REPLACE INTO ai_usage (user_id, day, n) VALUES ('${userId}', '${today}:tr', 20000)`);
  const share = await call(`/api/rooms/${code}/translate?lang=nl&i=0`);
  ok(share.status === 200 && share.data?.question === fresh && spent() === 0, `past its part of the day, an account's room gets the original text (${share.data?.question})`);
  sql(`DELETE FROM ai_usage WHERE user_id = '${userId}'`);

  // Shares hold what a call usually costs, not the most: a room asking several languages at once, near the end of its
  // owner's part, still gets them all (holding the most, about 300 neurons a call, only one would fit in the 300 left).
  sql(`INSERT OR REPLACE INTO ai_usage (user_id, day, n) VALUES ('${userId}', '${today}:tr', 19700)`);
  const together = `Which drink do you like best ${randomUUID().slice(0, 4)}?`;
  await call(`/api/polls/${code}`, { method: "PUT", body: { title: "Budget check", lang: "en", questions: [{ type: "choice", question: together, options: ["Tea", "Coffee"] }] } });
  const three = await Promise.all(["sv", "da", "fi"].map((lang) => call(`/api/rooms/${code}/translate?lang=${lang}&i=0`)));
  ok(three.every((r) => r.status === 200 && r.data?.question && r.data.question !== together), `three languages at once near the end of an account's part all get translated (${three.map((r) => r.data?.question).join(" | ")})`);
  sql(`DELETE FROM ai_usage WHERE user_id = '${userId}'`);

  // Phones read only the question on screen and the next one: never a quiz question further on.
  await call(`/api/polls/${code}`, { method: "PUT", body: { title: "Budget check", lang: "en", questions: ["One", "Two", "Three"].map((n) => ({ type: "choice", question: `Question ${n}?`, options: ["A", "B"] })) } });
  const near = await call(`/api/rooms/${code}/translate?lang=en&i=1`);
  const far = await call(`/api/rooms/${code}/translate?lang=en&i=2`);
  ok(near.status === 200 && near.data?.question === "Question Two?" && far.status === 404, `the next question is given, the one after is not (${near.status}, ${far.status})`);
} catch (err) {
  ok(false, `crashed: ${err instanceof Error ? `${err.message} ${err.cause ?? ""}` : err}`);
} finally {
  if (cookie) await call("/api/account", { method: "DELETE", body: { confirm: "DELETE" } });
  sql("DELETE FROM ai_budget");
  for (const r of before) sql(`INSERT INTO ai_budget (day, neurons) VALUES ('${r.day}', ${Number(r.neurons)})`);
}
console.log(failures ? `\n${failures} check(s) failed` : "\nAll AI budget checks passed");
process.exit(failures ? 1 : 0);
