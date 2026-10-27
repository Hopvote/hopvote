// Local load test of one room: N phones join with a first name, then all vote within a second; measures how long the
// presenter's screen takes to show every vote, and how long a phone waits for each update. Dev server only.
// Run: npx vite --port 5180, then node scripts/load-test.mjs [phones=500] (makes a local test account).
import { randomUUID } from "node:crypto";

const N = Number(process.argv[2] ?? 500);
const BASE = "http://localhost:5180";
const WS = BASE.replace(/^http/, "ws");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let cookie = "";
async function call(path, { method = "GET", body } = {}) {
  const res = await fetch(BASE + path, { method, headers: { "content-type": "application/json", origin: BASE, ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  return { status: res.status, data: await res.json().catch(() => null) };
}

const email = `load-${randomUUID().slice(0, 8)}@hopvote.test`;
const pending = await call("/api/auth/signup", { method: "POST", body: { name: "Load", email, password: randomUUID() } });
await call("/api/auth/verify", { method: "POST", body: { token: pending.data?.devToken } });
const created = await call("/api/rooms", { method: "POST", body: { title: "Load", lang: "en", names: true, questions: [{ type: "choice", question: "Pick", options: ["A", "B", "C", "D"] }] } });
const code = created.data.code;
const { data: host } = await call(`/api/polls/${code}/host`);

function socket(query, onState) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS}/api/rooms/${code}/ws${query}`);
    ws.onmessage = (e) => {
      if (e.data === "pong") return;
      const data = JSON.parse(e.data);
      if (data.type === "state") onState?.(data);
    };
    ws.onopen = () => resolve(ws);
    ws.onerror = reject;
  });
}

let screen = null;
const presenter = await socket(`?key=${host.hostKey}`, (s) => (screen = s));
let updates = 0;
const phones = [];
const t0 = Date.now();
for (let i = 0; i < N; i += 50) {
  const batch = await Promise.all(Array.from({ length: Math.min(50, N - i) }, (_, j) => socket(`?voter=lt${i + j}`, () => updates++)));
  phones.push(...batch);
}
console.log(`${N} phones connected in ${Date.now() - t0} ms`);
phones.forEach((ws, i) => ws.send(JSON.stringify({ type: "name", voter: `lt${i}`, name: `Person ${i}`, avatar: "🦊" })));
await wait(2000);
console.log(`waiting screen lists ${screen?.people?.length} names, online ${screen?.online}`);

updates = 0;
const voteStart = Date.now();
phones.forEach((ws, i) => setTimeout(() => ws.send(JSON.stringify({ type: "vote", voter: `lt${i}`, option: i % 4 })), Math.random() * 1000));
let shownAt = 0;
while (Date.now() - voteStart < 30_000) {
  const total = (screen?.counts ?? []).reduce((a, b) => a + b, 0);
  if (total >= N) {
    shownAt = Date.now();
    break;
  }
  await wait(20);
}
const total = (screen?.counts ?? []).reduce((a, b) => a + b, 0);
console.log(shownAt ? `all ${N} votes on screen ${shownAt - voteStart} ms after the first (votes spread over 1 s)` : `only ${total}/${N} votes after 30 s`);
await wait(1500);
console.log(`phones received ${updates} updates in total (${(updates / N).toFixed(1)} each)`);
const done = (screen?.people ?? []).filter((p) => p.done).length;
console.log(`presenter sees ${done} of ${screen?.people?.length} listed people as answered`);

phones.forEach((ws) => ws.close());
presenter.close();
await call("/api/account", { method: "DELETE", body: { confirm: "DELETE" } });
process.exit(shownAt ? 0 : 1);
