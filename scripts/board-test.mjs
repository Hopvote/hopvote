// Local check of the quiz leaderboard setting (boardMode: after each question, at the end, off; missing: the button only).
// Saving and reading it back, tools that save without it, the room's ranking (shared ranks, rank before the question,
// points won), each phone's own place, the final leaderboard, and that answers stay when the setting changes.
// Dev server only (npx vite --port 5180). Run: node scripts/board-test.mjs
import { execFileSync } from "node:child_process";

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
async function call(path, { method = "GET", body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}), origin: BASE, connection: "close" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

const sockets = [];
function socket(code, query) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS}/api/rooms/${code}/ws${query}`);
    const client = { ws, state: null, raw: "", acks: new Map(), ref: 1 };
    sockets.push(client);
    ws.onmessage = (e) => {
      if (e.data === "pong") return;
      const data = JSON.parse(e.data);
      if (data.type === "state") (client.state = data), (client.raw = e.data);
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

const quiz = (question, correct = 0, extra = {}) => ({ type: "choice", question, options: ["Right", "Wrong"], correct, ...extra });
const deck = (questions, extra = {}) => ({ title: "Board test", questions, names: true, ...extra });
const create = async (body) => (await call("/api/rooms", { method: "POST", body })).data;
const read = async (code) => (await call(`/api/polls/${code}`)).data;
const email = `board-${crypto.randomUUID().slice(0, 8)}@hopvote.test`;

try {
  const pending = await call("/api/auth/signup", { method: "POST", body: { name: "Board", email, password: crypto.randomUUID() } });
  await call("/api/auth/verify", { method: "POST", body: { token: pending.data?.devToken } });
  const userId = sql(`SELECT id FROM users WHERE email = '${email}'`)[0]?.id;
  ok(!!userId, "test account created");
  sql(`UPDATE users SET plan = 'pro' WHERE id = '${userId}'`);

  // Saving the setting and reading it back.
  const questions = [quiz("Q1"), quiz("Q2"), { type: "scale", question: "How was it?", options: [] }];
  const made = {};
  for (const mode of ["each", "end", "off"]) {
    made[mode] = await create(deck(questions, { boardMode: mode }));
    ok((await read(made[mode].code)).boardMode === mode, `a presentation saved with "${mode}" reads it back`);
  }
  const legacy = await create(deck(questions));
  ok((await read(legacy.code)).boardMode === null, "a presentation saved without the setting has none (the button only)");
  const odd = await create(deck(questions, { boardMode: "sometimes" }));
  ok((await read(odd.code)).boardMode === null, "an unknown value is not stored");

  // A save without the setting keeps it; an unknown value changes nothing.
  const each = made.each.code;
  const saved = (await read(each)).questions;
  ok((await call(`/api/polls/${each}`, { method: "PUT", body: deck(saved) })).status === 200, "saving without the setting works");
  ok((await read(each)).boardMode === "each", "and keeps the stored setting");
  await call(`/api/polls/${each}`, { method: "PUT", body: deck(saved, { boardMode: 42 }) });
  ok((await read(each)).boardMode === "each", "an invalid value keeps the stored setting");

  // A presentation saved without the setting and with the language left to detection still round-trips.
  const auto = await create(deck([quiz("Which planet is the largest?")], { lang: "auto" }));
  const autoRead = await read(auto.code);
  ok(autoRead.boardMode === null && autoRead.lang === autoRead.detected, "without the setting and with 'Detect', it saves as before");
  ok((await call(`/api/polls/${auto.code}`, { method: "PUT", body: deck(autoRead.questions, { lang: "auto" }) })).status === 200, "and saves again unchanged");
  const autoAgain = await read(auto.code);
  ok(autoAgain.boardMode === null && autoAgain.lang === autoRead.lang, "keeping no setting and the detected language");

  // A presentation without the setting behaves as before: the button opens a plain list.
  {
    const host = await socket(legacy.code, `?key=${legacy.hostKey}`);
    const a = await socket(legacy.code, "?voter=legacy-a");
    await a.send({ type: "name", voter: "legacy-a", name: "Lea" });
    await host.until((s) => s.index === 0);
    ok(host.state.boardMode === "manual" && host.state.hasBoard === true, "without the setting: the Leaderboard button, as before");
    host.send({ type: "goto", index: 0 });
    await a.send({ type: "vote", voter: "legacy-a", option: 0, index: 0, round: host.state.round });
    host.send({ type: "reveal", show: true });
    await a.until((s) => s.revealed);
    ok(!("me" in a.state), "phones get no place of their own without the setting");
    host.send({ type: "board", show: true });
    ok(await a.until((s) => Array.isArray(s.board) && s.board.length === 1), "the button opens the leaderboard on phones");
    ok(a.state.board[0].name === "Lea" && a.state.board[0].score === 1000, "with the names and points as before");
    ok(!("me" in a.state), "still no place of its own on the phone");
  }

  // Off: no leaderboard, even when asked.
  {
    const host = await socket(made.off.code, `?key=${made.off.hostKey}`);
    const a = await socket(made.off.code, "?voter=off-a");
    await a.send({ type: "name", voter: "off-a", name: "Lea" });
    await host.until((s) => s.index === 0);
    ok(host.state.boardMode === "off" && host.state.hasBoard === false, "off: no Leaderboard button");
    await a.send({ type: "vote", voter: "off-a", option: 0, index: 0, round: host.state.round });
    host.send({ type: "board", show: true });
    await wait(500);
    ok(host.state.board === null && a.state.board === null, "off: the room refuses to show a leaderboard");
    host.send({ type: "reveal", show: true });
    await a.until((s) => s.revealed);
    ok(!("me" in a.state), "off: phones get no place");
  }

  // After each question: points, ranks, rank before the question, each phone's own place.
  const host = await socket(each, `?key=${made.each.hostKey}`);
  const viewer = await socket(each, "?view=1");
  const phones = [];
  for (let i = 0; i < 11; i++) {
    const p = await socket(each, `?voter=phone-${i}`);
    await p.send({ type: "name", voter: `phone-${i}`, name: `P${String(i).padStart(2, "0")}` });
    phones.push(p);
  }
  await host.until((s) => s.online === 11);
  const round = host.state.round;
  ok(host.state.boardMode === "each" && host.state.hasBoard === true && host.state.boardFinal === false, "each: the first question is not the last scored one");

  // Question 1: phones 0 to 4 right, the others wrong (phone 10 does not answer).
  for (let i = 0; i < 10; i++) await phones[i].send({ type: "vote", voter: `phone-${i}`, option: i < 5 ? 0 : 1, index: 0, round });
  await host.until((s) => s.answered === 10);
  ok(!("me" in phones[0].state), "no place on phones before the answer shows");
  host.send({ type: "reveal", show: true });
  ok(await phones[0].until((s) => s.revealed && s.me), "each: once the answer shows, every phone learns its place");
  ok(phones[0].state.me.rank === 1 && phones[0].state.me.score === 1000 && phones[0].state.me.gained === 1000 && phones[0].state.me.of === 10, "equal scores share the first place (1 of 10)");
  await phones[7].until((s) => s.revealed && "me" in s);
  ok(phones[7].state.me === null, "a wrong answer gets no place (no points yet), never a rank or a medal");
  await phones[10].until((s) => "me" in s);
  ok(phones[10].state.me === null, "a phone that never answered has no place");
  ok(!("me" in host.state) && !("me" in viewer.state), "the screens never get a phone's place");
  ok(!phones[0].raw.includes("phone-"), "a phone's state never names another phone's id");

  host.send({ type: "board", show: true });
  ok(await host.until((s) => Array.isArray(s.board)), "the leaderboard opens");
  ok(typeof host.state.boardAt === "number" && Math.abs(host.state.boardAt - host.state.now) < 3000, "with the time it opened, for its animation");
  ok(host.state.board.length === 5 && host.state.board.every((e) => e.rank === 1 && e.prev === 0 && e.gained === 1000), "five players share the first place, new on the board");
  ok(host.state.board.map((e) => e.name).join() === "P00,P01,P02,P03,P04", "equal scores are listed by name");
  ok(host.state.board.every((e) => typeof e.tag === "string" && e.tag.length > 0 && !("voter" in e)), "entries carry a tag, never an id");

  // Question 2: phones 5 to 10 right (fastest first), phones 0 to 3 wrong, phone 4 right.
  host.send({ type: "goto", index: 1 });
  ok(await host.until((s) => s.index === 1 && s.board === null && s.boardAt === null), "moving on closes the leaderboard");
  ok(host.state.boardFinal === true, "the last scored question knows it is the final one");
  await phones[0].until((s) => s.index === 1 && !("me" in s));
  ok(!("me" in phones[0].state), "phones lose their place on the next question until its answer shows");
  for (let i = 0; i < 11; i++) await phones[i].send({ type: "vote", voter: `phone-${i}`, option: i < 4 ? 1 : 0, index: 1, round });
  await host.until((s) => s.answered === 11);
  host.send({ type: "reveal", show: true });
  host.send({ type: "board", show: true });
  ok(await host.until((s) => Array.isArray(s.board)), "the final leaderboard opens");
  const top = host.state.board;
  ok(top.length === 10, "the board lists the top 10");
  ok(top[0].name === "P04" && top[0].rank === 1 && top[0].score === 2000 && top[0].prev === 1 && top[0].gained === 1000, "the only player right twice leads, from a shared first place");
  ok(top[1].rank === 2 && top[1].score === 1000 && top.slice(1).every((e) => e.rank === 2), "the others with 1000 points share the second place");
  const newcomer = top.find((e) => e.name === "P10");
  ok(!newcomer || (newcomer.prev === 0 && newcomer.gained === 1000), "a player new on the board has no rank before");
  await phones[10].until((s) => s.me);
  ok(phones[10].state.me.rank === 2 && phones[10].state.me.of === 11, "the phone out of the top 10 still gets its own place");
  await phones[0].until((s) => s.me?.of === 11);
  ok(phones[0].state.me.rank === 2 && phones[0].state.me.score === 1000 && phones[0].state.me.gained === 0, "a phone wrong this time keeps its points, nothing won");

  // Changing the setting keeps the answers and the points.
  ok((await call(`/api/polls/${each}`, { method: "PUT", body: deck(saved, { boardMode: "end" }) })).status === 200, "changing the setting saves");
  const after = await read(each);
  ok(after.boardMode === "end" && after.questions[0].answered === 10 && after.leaderboard[0]?.score === 2000, "and keeps every answer and point");
  ok(after.leaderboard[0].rank === 1 && after.leaderboard.slice(1).every((e) => e.rank === 2), "the results page shares ranks as the live screens do");
  ok(after.leaderboard.slice(1).map((e) => e.name).join() === after.leaderboard.slice(1).map((e) => e.name).sort().join(), "with equal scores listed by name");
  ok(await host.until((s) => s.boardMode === "end"), "screens follow the new setting");
  await call(`/api/polls/${each}`, { method: "PUT", body: deck(saved, { boardMode: "each" }) });

  // A reset clears the leaderboard and its time.
  await call(`/api/polls/${each}/reset`, { method: "POST" });
  ok(await host.until((s) => s.index === 0 && s.board === null && s.boardAt === null), "a reset closes the leaderboard");
  ok((await read(each)).leaderboard.length === 0, "and clears the points");

  // At the end: phones learn their place on the leaderboard only, and points never pass 1000 during the count-in.
  {
    const end = await create(deck([quiz("Timed", 0, { timer: 5 })], { boardMode: "end" }));
    const h = await socket(end.code, `?key=${end.hostKey}`);
    const a = await socket(end.code, "?voter=end-a");
    await a.send({ type: "name", voter: "end-a", name: "Lea" });
    const b = await socket(end.code, "?voter=end-b");
    await b.send({ type: "name", voter: "end-b", name: "Max" });
    await h.until((s) => s.index === 0);
    ok(h.state.boardFinal === true, "end: a single scored question is the final one");
    h.send({ type: "start", lead: 1200 });
    await a.until((s) => !!s.startedAt);
    const skew = Date.now() - a.state.now;
    await wait(Math.max(0, a.state.startedAt + skew - Date.now() - 150));
    const early = await a.send({ type: "vote", voter: "end-a", option: 0, index: 0, round: h.state.round });
    await b.send({ type: "vote", voter: "end-b", option: 1, index: 0, round: h.state.round });
    h.send({ type: "reveal", show: true });
    await a.until((s) => s.revealed);
    await wait(300);
    ok(!("me" in a.state), "end: no place on phones after an answer");
    h.send({ type: "board", show: true });
    ok(await a.until((s) => s.me), "end: the leaderboard gives each phone its place");
    ok(await b.until((s) => Array.isArray(s.board) && "me" in s) && b.state.me === null, "end: a phone with no points gets no place on the podium");
    ok(!early || a.state.me.of === 2, "and still counts among the players (1st of 2)");
    ok(!early || (a.state.me.score <= 1000 && a.state.me.score >= 990), `an answer just before the clock gets 1000 points at most (${early ? a.state.me.score : "not counted"})`);
  }
} catch (err) {
  ok(false, `crashed: ${err?.stack ?? err}`);
} finally {
  for (const s of sockets) s.ws.close();
  if (cookie) await call("/api/account", { method: "DELETE", body: { confirm: "DELETE" } });
}
console.log(failures ? `\n${failures} check(s) failed` : "\nAll leaderboard checks passed");
process.exit(failures ? 1 : 0);
