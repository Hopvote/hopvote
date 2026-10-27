// Local check of the second set of newer kinds: prioritize, fill in the blanks, match pairs, find on the image,
// the wheel, the timer, video or audio. Saving (what is kept, what is refused), answers from phones, points,
// results hidden until shown, the wheel's spins, the timer's controls, results page and reset.
// Dev server only (npx vite --port 5180). Run: node scripts/games-test.mjs
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
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
async function call(path, { method = "GET", body, raw, type, bearer } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(body ? { "content-type": "application/json" } : {}), ...(type ? { "content-type": type } : {}), ...(cookie && !bearer ? { cookie } : {}), ...(bearer ? { authorization: `Bearer ${bearer}` } : {}), origin: BASE, connection: "close" },
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  });
  const set = res.headers.get("set-cookie");
  if (set && !bearer) cookie = set.split(";")[0];
  const data = await res.json().catch(() => ({}));
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

// The phone's own mark, as the wheel tags its winner (same as src/wheel.ts).
const tagOf = (voter) => {
  let h = 2166136261;
  for (const c of voter) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return (h >>> 0).toString(36);
};

const email = `games-${crypto.randomUUID().slice(0, 8)}@hopvote.test`;
const deck = (questions, extra = {}) => ({ title: "Games", questions, ...extra });
try {
  const pending = await call("/api/auth/signup", { method: "POST", body: { name: "Lot2", email, password: crypto.randomUUID() } });
  await call("/api/auth/verify", { method: "POST", body: { token: pending.data?.devToken } });
  const userId = sql(`SELECT id FROM users WHERE email = '${email}'`)[0]?.id;
  ok(!!userId, "test account created");
  sql(`UPDATE users SET plan = 'pro' WHERE id = '${userId}'`);
  const image = (await call("/api/images", { method: "POST", raw: readFileSync("public/icon-192.png"), type: "image/png" })).data.url;
  ok(/^\/api\/images\/[a-f0-9]{32}$/.test(image ?? ""), "an image to tap is uploaded");

  // What saving refuses.
  const refused = async (q, label, extra) => ok((await call("/api/rooms", { method: "POST", body: deck([q], extra) })).status === 400, label);
  await refused({ type: "points", question: "Priorities", options: ["Only one"] }, "prioritize needs 2 items");
  await refused({ type: "fill", question: "Capital", fill: "No blanks here" }, "fill in the blanks needs a blank");
  await refused({ type: "fill", question: "Capital", fill: "An empty [] blank" }, "each blank needs its answer");
  await refused({ type: "fill", question: "Capital", fill: "[a] [b] [c] [d] [e] [f] [g]" }, "up to 6 blanks");
  await refused({ type: "match", question: "Capitals", options: ["France", "Italy", "Paris", ""] }, "each pair needs both sides");
  await refused({ type: "match", question: "Capitals", options: ["France", "Paris"] }, "matching needs 2 pairs");
  await refused({ type: "spot", question: "Where?" }, "find on the image needs its image");
  await refused({ type: "wheel", question: "Who?", options: ["Only me"] }, "a wheel with one entry is refused");
  await refused({ type: "wheel", question: "Who?" }, "a wheel without entries needs first names", { names: false });
  await refused({ type: "media", question: "Watch", url: "https://example.com/page" }, "a page that is not a video or audio is refused");
  await refused({ type: "media", question: "Watch", url: "javascript:alert(1)" }, "a script link is refused as a video");

  // What saving keeps.
  const questions = [
    { type: "points", question: "Priorities", options: ["Training", "Remote work", "Pay"] },
    { type: "fill", question: "Capitals", fill: "The capital of Australia is [Canberra] and of Canada [Ottawa/ottawa city].", timer: 45 },
    { type: "match", question: "Capitals", options: ["France", "Italy", "Spain", "Paris", "Rome", "Madrid"] },
    { type: "spot", question: "Where is the dot?", image, zone: [400, 400, 200, 200] },
    { type: "spot", question: "Your favourite spot?", image },
    { type: "wheel", question: "Who answers?", options: ["Ana", "Ben", "Cleo"] },
    { type: "wheel", question: "Who answers next?" },
    { type: "countdown", question: "Group work", duration: 90 },
    { type: "media", question: "Trailer", url: "https://youtu.be/dQw4w9WgXcQ?t=42" },
    { type: "spot", question: "Bad zone", image, zone: [990, 990, 50, 50], timer: 30 },
    { type: "fill", question: "Place the words", fill: "The capital of Australia is [Canberra] and of Canada [Ottawa].", fillMode: "words", decoys: [" Sydney ", "Toronto", "sydney", "canberra", "", "Perth", "Quebec", "Vancouver", "Montreal", "Darwin"] },
  ];
  const made = await call("/api/rooms", { method: "POST", body: deck(questions, { names: true }) });
  ok(made.status === 200 && !!made.data.code, "a presentation with every new kind is created");
  const { code, hostKey } = made.data;
  const saved = (await call(`/api/polls/${code}`)).data.questions;
  ok(saved[0].type === "points" && saved[0].options.length === 3, "prioritize keeps its items");
  ok(saved[1].fill?.startsWith("The capital of Australia is [Canberra]") && saved[1].timer === 45, "fill in the blanks keeps its text and timer");
  ok(saved[2].options.join() === "France,Italy,Spain,Paris,Rome,Madrid", "match pairs keeps its pairs");
  ok(saved[3].zone?.join() === "400,400,200,200" && saved[3].image === image, "find on the image keeps its image and zone");
  ok(saved[4].zone === undefined, "without a zone, it's a poll");
  ok(saved[6].options.length === 0, "a wheel can spin among first names");
  ok(saved[7].duration === 90, "the timer keeps its length");
  ok(saved[8].url === "https://youtu.be/dQw4w9WgXcQ?t=42", "the video keeps its link");
  ok(saved[9].zone === undefined && saved[9].timer === undefined, "a zone past the image is dropped, with its timer");
  ok(saved[1].fillMode === undefined && saved[1].decoys === undefined, "blanks saved without a way to answer are typed, as before");
  ok(saved[10].fillMode === "words" && saved[10].decoys?.join() === "Sydney,Toronto,Perth,Quebec,Vancouver,Montreal", "words to place keep up to 6 extra words, once each, never an answer");

  const host = await socket(code, `?key=${hostKey}`);
  const a = await socket(code, "?voter=phone-a");
  const b = await socket(code, "?voter=phone-b");
  await a.send({ type: "name", voter: "phone-a", name: "Lea" });
  await b.send({ type: "name", voter: "phone-b", name: "Tom" });
  const round = host.state.round;
  const at = (index) => ({ index, round });
  const go = async (index) => {
    host.send({ type: "goto", index });
    await a.until((s) => s.index === index);
    await b.until((s) => s.index === index);
  };

  // Prioritize: 100 points to share.
  await go(0);
  ok((await a.send({ type: "points", voter: "phone-a", values: [50, 40], ...at(0) })) === false, "every item needs its share");
  ok((await a.send({ type: "points", voter: "phone-a", values: [50, 40, 20], ...at(0) })) === false, "the shares must add up to 100");
  ok((await a.send({ type: "points", voter: "phone-a", values: [60, -10, 50], ...at(0) })) === false, "no share below zero");
  ok((await a.send({ type: "points", voter: "phone-a", values: [60, 30, 10], ...at(0) })) === true, "100 points shared are counted");
  await b.send({ type: "points", voter: "phone-b", values: [20, 0, 80], ...at(0) });
  ok(await host.until((s) => s.answered === 2 && s.counts.join() === "80,30,90"), "points add up per item");
  await a.send({ type: "points", voter: "phone-a", values: [0, 100, 0], ...at(0) });
  ok(await host.until((s) => s.counts.join() === "20,100,80" && s.answered === 2), "changing one's shares moves them, same number of people");

  // Fill in the blanks: hidden until shown, partial points.
  await go(1);
  ok(a.state.gaps?.length === 3 && a.state.gaps[0] === "The capital of Australia is " && !JSON.stringify(a.state).includes("Canberra"), "phones get the text around the blanks, never the answers");
  ok((await a.send({ type: "fill", voter: "phone-a", values: ["Canberra", "Ottawa"], ...at(1) })) === false, "a timed game takes no answer before the timer starts");
  host.send({ type: "start" });
  await a.until((s) => !!s.startedAt);
  ok((await a.send({ type: "fill", voter: "phone-a", values: ["Canberra"], ...at(1) })) === false, "every blank is sent");
  ok((await a.send({ type: "fill", voter: "phone-a", values: [" canberra. ", "OTTAWA"], ...at(1) })) === true, "an answer is counted");
  await b.send({ type: "fill", voter: "phone-b", values: ["Sydney", "Ottawa City"], ...at(1) });
  await host.until((s) => s.answered === 2);
  ok(host.state.orderResults === null && host.state.fillTop.length === 0 && host.state.blanks.length === 0, "answers stay hidden from every screen until shown");
  host.send({ type: "reveal", show: true });
  ok(await a.until((s) => s.revealed && s.blanks?.[0]?.[0] === "Canberra"), "once shown, phones get the accepted answers");
  ok(a.state.orderResults.right === 1 && a.state.orderResults.placed.join() === "1,2", "case, accents and a final full stop are forgiven; alternatives count");
  ok(a.state.fillTop[0].some(([w, n]) => w === "sydney" && n === 1), "the screen lists what the room typed");
  ok((await b.send({ type: "fill", voter: "phone-b", values: ["Canberra", "Ottawa"], ...at(1) })) === false, "no answers once the answer is shown");
  ok(a.state.bank.length === 0, "typed blanks offer no words");

  // Words to place: the answers and the extra words, mixed, then counted like typed ones.
  await go(10);
  const bank = a.state.bank ?? [];
  ok(bank.length === 8 && ["Canberra", "Ottawa", "Sydney", "Toronto", "Perth", "Quebec", "Vancouver", "Montreal"].every((w) => bank.includes(w)), "phones get the answers and the extra words to place");
  ok(bank.slice(0, 2).join() !== "Canberra,Ottawa" && JSON.stringify(b.state.bank) === JSON.stringify(bank), "in a mixed order, the same on every phone");
  ok(!a.state.blanks.length && a.state.fillTop.length === 0, "which words are right stays hidden");
  ok((await a.send({ type: "fill", voter: "phone-a", values: ["Canberra", "Ottawa"], ...at(10) })) === true, "placed words are counted");
  await b.send({ type: "fill", voter: "phone-b", values: ["Sydney", "Ottawa"], ...at(10) });
  await host.until((s) => s.answered === 2);
  host.send({ type: "reveal", show: true });
  ok(await a.until((s) => s.revealed && s.orderResults?.right === 1 && s.orderResults.placed.join() === "1,2"), "placed words are right or wrong per blank");
  ok(a.state.fillTop[0].some(([w, n]) => w === "sydney" && n === 1) && a.state.bank.length === 8, "the screen gets what was placed, with the words to place");

  // Match pairs: hidden until shown, partial points.
  await go(2);
  ok((await a.send({ type: "match", voter: "phone-a", order: [0, 0, 1], ...at(2) })) === false, "each right item is used once");
  // The right-hand items reach phones mixed by the room (the presenter keeps the written pairs): phones answer with
  // the places they got, here picked by name.
  const capitals = ["Paris", "Rome", "Madrid"];
  ok(host.state.options.slice(3).join() === capitals.join(), "the presenter gets the pairs as written");
  ok(a.state.options.slice(0, 3).join() === "France,Italy,Spain" && capitals.every((c) => a.state.options.slice(3).includes(c)) && a.state.mix === null, "phones get the left items as written, the right ones mixed, without the mix");
  const pairs = (names) => names.map((n) => a.state.options.slice(3).indexOf(n));
  ok((await a.send({ type: "match", voter: "phone-a", order: pairs(capitals), ...at(2) })) === true, "a full matching is counted");
  await b.send({ type: "match", voter: "phone-b", order: pairs([capitals[1], capitals[0], capitals[2]]), ...at(2) });
  await host.until((s) => s.answered === 2);
  ok(host.state.orderResults === null, "the matching stays hidden until shown");
  const mixedRights = a.state.options.slice(3);
  host.send({ type: "reveal", show: true });
  ok(await a.until((s) => s.revealed && s.orderResults?.right === 1 && s.orderResults.placed.join() === "1,1,2"), "once shown: who matched everything, and each pair");
  ok(a.state.options.slice(3).join() === capitals.join() && a.state.mix?.every((i, j) => capitals[i] === mixedRights[j]), "once shown, phones get the written pairs and the mix");

  // Find on the image, as a game.
  await go(3);
  ok(a.state.zone === null && a.state.quiz === true, "the zone stays hidden");
  ok((await a.send({ type: "spot", voter: "phone-a", x: 1200, y: 10, ...at(3) })) === false, "a spot off the image is refused");
  ok((await a.send({ type: "spot", voter: "phone-a", x: 500, y: 520, ...at(3) })) === true, "a spot is counted");
  await b.send({ type: "spot", voter: "phone-b", x: 50, y: 60, ...at(3) });
  await host.until((s) => s.answered === 2);
  ok(host.state.spots.length === 0, "the spots stay hidden until shown");
  host.send({ type: "reveal", show: true });
  ok(await a.until((s) => s.revealed && s.zone?.join() === "400,400,200,200" && s.found === 1 && s.spots.length === 6), "once shown: the zone, the spots and how many found it");

  // Find on the image, as a poll: spots show live.
  await go(4);
  await a.send({ type: "spot", voter: "phone-a", x: 101, y: 102, ...at(4) });
  await b.send({ type: "spot", voter: "phone-b", x: 104, y: 107, ...at(4) });
  ok(await host.until((s) => s.answered === 2 && s.spots.join() === "105,105,2"), "a poll shows the spots live, grouped by 1% of the image");

  // The wheel among its entries.
  await go(5);
  ok(a.state.wheel?.list.join() === "Ana,Ben,Cleo" && a.state.wheel.spin === null, "phones see the wheel's entries");
  ok((await a.send({ type: "spin" })) === false, "a phone cannot spin the wheel");
  host.send({ type: "spin" });
  ok(await a.until((s) => !!s.wheel?.spin), "the presenter spins it");
  const first = a.state.wheel;
  ok(first.spin.to > first.spin.from + 360 * 4 && first.list[first.spin.win] === first.picked[0], "it lands on the winner after a few turns");
  host.send({ type: "spin" });
  await wait(500);
  ok(a.state.wheel.spin.n === 1, "a second spin waits for the first to end");
  await wait(6200);
  host.send({ type: "spin" });
  ok(await a.until((s) => s.wheel.spin?.n === 2), "the next spin runs once the first is over");
  ok(!a.state.wheel.list.includes(first.picked[0]) && a.state.wheel.picked.length === 2 && new Set(a.state.wheel.picked).size === 2, "whoever was picked leaves the wheel");
  host.send({ type: "unspin" });
  ok(await a.until((s) => s.wheel.spin === null && s.wheel.picked.length === 0 && s.wheel.list.length === 3), "start over puts everyone back");

  // The wheel among the first names of the people connected: the winner's phone knows.
  await go(6);
  ok(await a.until((s) => s.wheel?.list.length === 2 && s.wheel.list.includes("Lea")), "an empty wheel holds the first names connected");
  host.send({ type: "spin" });
  await a.until((s) => !!s.wheel?.spin);
  const won = a.state.wheel.list[a.state.wheel.spin.win];
  ok([tagOf("phone-a"), tagOf("phone-b")].includes(a.state.wheel.spin.tag) && a.state.wheel.spin.tag === tagOf(won === "Lea" ? "phone-a" : "phone-b"), "the winner's phone recognizes itself");
  ok(!JSON.stringify(a.state).includes("phone-b") && !JSON.stringify(a.state).includes("phone-a"), "nobody's id is sent");

  // The timer.
  await go(7);
  ok(a.state.clock?.run === false && a.state.clock.left === 90000, "the timer waits, full");
  ok((await a.send({ type: "clock", act: "start" })) === false, "a phone cannot start it");
  host.send({ type: "clock", act: "start" });
  ok(await a.until((s) => s.clock.run && s.clock.end > s.now + 85000), "the presenter starts it");
  await wait(300);
  host.send({ type: "clock", act: "pause" });
  ok(await a.until((s) => !s.clock.run && s.clock.left < 90000 && s.clock.left > 85000), "paused, it keeps the time left");
  host.send({ type: "clock", act: "add", by: 60 });
  ok(await a.until((s) => s.clock.left > 145000), "a minute more");
  host.send({ type: "clock", act: "reset" });
  ok(await a.until((s) => s.clock.left === 90000 && !s.clock.run), "reset puts it back to its length");
  ok((await a.send({ type: "vote", voter: "phone-a", option: 0, ...at(7) })) === false, "a timer takes no answer");

  // Video or audio.
  await go(8);
  ok(a.state.url === "https://youtu.be/dQw4w9WgXcQ?t=42", "phones get the video's link");
  ok((await a.send({ type: "opened", voter: "phone-a", ...at(8) })) === false, "a video takes no answer");

  // Results page, then reset.
  const results = (await call(`/api/polls/${code}`)).data;
  ok(results.questions[0].counts.join() === "20,100,80" && results.questions[1].order.right === 1 && results.questions[1].fillTop[0].length === 2, "the results page gets points and blanks");
  ok(results.questions[3].spots.length === 2 && results.questions[5].picked.length === 0 && results.questions[6].picked.length === 1, "the results page gets spots and who the wheel picked");
  const lea = results.leaderboard.find((e) => e.name === "Lea");
  const tom = results.leaderboard.find((e) => e.name === "Tom");
  ok(!!lea && !!tom && lea.score > tom.score, "blanks, pairs and the spot earn points");
  const listed = (await call("/api/polls")).data.polls.find((p) => p.code === code);
  ok(["points", "fill", "match", "spot", "wheel", "countdown", "media"].every((k) => listed?.kinds?.includes(k)), "the presentations list knows every new kind");
  await call(`/api/polls/${code}/reset`, { method: "POST" });
  const cleared = (await call(`/api/polls/${code}`)).data.questions;
  ok(cleared[0].counts.every((n) => n === 0) && cleared[1].order.right === 0 && cleared[3].spots.length === 0 && cleared[6].picked.length === 0, "a reset clears points, blanks, spots and the wheel");

  for (const s of [host, a, b]) s.ws.close();
} catch (err) {
  ok(false, `crashed: ${err?.stack ?? err}`);
} finally {
  if (cookie) await call("/api/account", { method: "DELETE", body: { confirm: "DELETE" } });
}
console.log(failures ? `\n${failures} check(s) failed` : "\nAll lot 2 checks passed");
process.exit(failures ? 1 : 0);
