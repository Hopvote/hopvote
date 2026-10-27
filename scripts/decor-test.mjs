// Local check of the seasonal decor (src/decor.ts): an account saves a presentation with the Halloween decor, reads it
// back, the screens get it, saves without the field (older builders) keep it, an unknown value is
// dropped, changing it keeps the answers, and a presentation without it stays as before. Also the end date: from
// 2026-11-01 12:00 UTC (October 31 over in every time zone), screens draw the normal decor.
// Dev server only (npx vite --port 5180). Run: node scripts/decor-test.mjs
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";

const BASE = "http://localhost:5180";
const WS = BASE.replace(/^http/, "ws");
let failures = 0;
const ok = (cond, label) => {
  console.log(`${cond ? "✓" : "✗"} ${label}`);
  if (!cond) failures++;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const sql = (command) => JSON.parse(execFileSync("npx", ["wrangler", "d1", "execute", "hopvote-db", "--local", "--json", "--command", command], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }))[0]?.results ?? [];

let cookie = "";
async function call(path, { method = "GET", body, bearer } = {}, attempt = 0) {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(body ? { "content-type": "application/json" } : {}), ...(cookie && !bearer ? { cookie } : {}), ...(bearer ? { authorization: `Bearer ${bearer}` } : {}), origin: BASE, connection: "close" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const set = res.headers.get("set-cookie");
  if (set && !bearer) cookie = set.split(";")[0];
  const data = await res.json().catch(() => ({}));
  // Other local tests share the per-address limits (community-test fills them on purpose): a 429 waits and tries again.
  if (res.status === 429 && method !== "GET" && attempt < 8) {
    await new Promise((r) => setTimeout(r, 15000));
    return call(path, { method, body, bearer }, attempt + 1);
  }
  return { status: res.status, data };
}

function socket(code, query) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS}/api/rooms/${code}/ws${query}`);
    const client = { ws, state: null, acks: new Map(), ref: 1 };
    ws.onmessage = (e) => {
      if (e.data === "pong") return;
      const data = JSON.parse(e.data);
      if (data.type === "state") client.state = data;
      if (data.type === "ack") client.acks.get(data.ref)?.(data.ok);
    };
    client.send = (m) =>
      new Promise((done) => {
        const ref = client.ref++;
        client.acks.set(ref, done);
        ws.send(JSON.stringify({ ...m, ref }));
        setTimeout(() => done(null), 3000);
      });
    client.until = async (pred, ms = 3000) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        if (client.state && pred(client.state)) return true;
        await wait(50);
      }
      return false;
    };
    ws.onopen = () => resolve(client);
    ws.onerror = reject;
  });
}

// The end date, read from the shared constant (Node strips the file's types).
const { HALLOWEEN_END, shownDecor, decorOffered, decorBrand, parseDecor } = await import("../src/decor.ts");
ok(HALLOWEEN_END === Date.parse("2026-11-01T12:00:00Z"), "the decor ends once October 31 is over everywhere (2026-11-01 12:00 UTC)");
ok(shownDecor("halloween", Date.parse("2026-11-01T04:59:00Z")) === "halloween", "still drawn on the evening of October 31 in Los Angeles (21:59 PDT)");
ok(shownDecor("halloween", HALLOWEEN_END - 1) === "halloween" && decorOffered("halloween", HALLOWEEN_END - 1), "one millisecond before: offered and drawn");
ok(shownDecor("halloween", HALLOWEEN_END) === null && !decorOffered("halloween", HALLOWEEN_END), "from the end date: not offered, every screen in the normal decor");
ok(shownDecor(undefined) === null && shownDecor("zombie") === null, "no decor or an unknown one: the normal decor");
ok(parseDecor("halloween") === "halloween" && parseDecor(null) === null && parseDecor("normal") === null && parseDecor("zombie") === undefined && parseDecor(undefined) === undefined, "what a builder may send");
const merged = decorBrand({ logo: "/api/images/" + "a".repeat(32), font: "lora", color: "#123456", bg: { kind: "color", value: "#ffffff" } }, "halloween");
ok(merged.logo && merged.font === "lora" && merged.color === "#ff8a3d" && merged.bg.kind === "gradient", "the brand keeps its logo and font, the decor sets the ground and the accent");
ok(decorBrand(null, null) === null, "no decor, no brand: Hopvote's own look");

// While the decor is on offer the screens draw it; after the end date they get null.
const live = Date.now() < HALLOWEEN_END ? "halloween" : null;
const email = `decor-${crypto.randomUUID().slice(0, 8)}@hopvote.test`;
const deck = (extra = {}) => ({ title: "Decor", names: true, questions: [{ type: "choice", question: "Best treat?", options: ["Candy", "Chocolate"] }, { type: "words", question: "One word for tonight" }], ...extra });
try {
  const pending = await call("/api/auth/signup", { method: "POST", body: { name: "Decor", email, password: crypto.randomUUID() } });
  await call("/api/auth/verify", { method: "POST", body: { token: pending.data?.devToken } });
  const userId = sql(`SELECT id FROM users WHERE email = '${email}'`)[0]?.id;
  ok(!!userId, "test account created");

  // Saved with the decor.
  const made = await call("/api/rooms", { method: "POST", body: deck({ decor: "halloween" }) });
  ok(made.status === 200 && !!made.data.code, "an account saves a presentation with the Halloween decor");
  const { code, hostKey } = made.data;
  ok((await call(`/api/polls/${code}`)).data.decor === "halloween", "read back: the decor is stored");
  const host = await socket(code, `?key=${hostKey}`);
  const phone = await socket(code, "?voter=phone-a");
  ok(await phone.until((s) => s.decor === live), `the screens and phones get it (${live ?? "normal, past the end date"})`);

  // An answer, then saves that change only the decor: the answer stays.
  await phone.send({ type: "name", voter: "phone-a", name: "Lea" });
  await host.send({ type: "lobby", on: false });
  const round = host.state.round;
  await phone.send({ type: "vote", voter: "phone-a", option: 1, index: 0, round });
  ok(await host.until((s) => s.counts[1] === 1), "an answer is counted");

  const put = (extra) => call(`/api/polls/${code}`, { method: "PUT", body: deck(extra) });
  ok((await put({})).status === 200 && (await call(`/api/polls/${code}`)).data.decor === "halloween", "a save without the field keeps the decor");
  ok((await put({ decor: "zombie" })).status === 200 && (await call(`/api/polls/${code}`)).data.decor === "halloween", "an unknown value is dropped (the stored decor stays)");
  ok((await put({ decor: null })).status === 200 && (await call(`/api/polls/${code}`)).data.decor === null, "null goes back to the normal decor");
  ok(await host.until((s) => s.decor === null), "the screens switch to the normal decor right away");
  ok((await put({ decor: "halloween" })).status === 200 && (await host.until((s) => s.decor === live)), "and back to Halloween");
  ok(host.state.counts[1] === 1 && host.state.round === round, "changing the decor never resets the answers");
  ok((await put({ decor: "normal" })).status === 200 && (await call(`/api/polls/${code}`)).data.decor === null, "\"normal\" is the normal decor too");
  await put({ decor: "halloween" });

  // A presentation without the field: exactly as before.
  const plain = await call("/api/rooms", { method: "POST", body: deck() });
  ok(plain.status === 200 && (await call(`/api/polls/${plain.data.code}`)).data.decor === null, "a presentation without a decor stores none");
  const watcher = await socket(plain.data.code, "?voter=phone-b");
  ok(await watcher.until((s) => "decor" in s && s.decor === null), "its screens get the normal decor");
  ok((await call(`/api/polls/${plain.data.code}`, { method: "PUT", body: deck() })).status === 200 && (await call(`/api/polls/${plain.data.code}`)).data.decor === null, "and saving it again changes nothing");
  const odd = await call("/api/rooms", { method: "POST", body: deck({ decor: "zombie" }) });
  ok(odd.status === 200 && (await call(`/api/polls/${odd.data.code}`)).data.decor === null, "a new presentation with an unknown decor gets the normal one");

  for (const s of [host, phone, watcher]) s.ws.close();
} catch (err) {
  ok(false, `crashed: ${err?.stack ?? err}`);
} finally {
  if (cookie) await call("/api/account", { method: "DELETE", body: { confirm: "DELETE" } });
}
console.log(failures ? `\n${failures} check(s) failed` : "\nAll decor checks passed");
process.exit(failures ? 1 : 0);
