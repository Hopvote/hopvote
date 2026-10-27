// Local check of the newer kinds of questions: slide, link, rating scale, number (poll and game) and ranking in the right order.
// Saving (what is kept, what is refused), answers from phones, points, results hidden until shown, results page, reset,
// and that quizzes still behave as before. Dev server only (npx vite --port 5180). Run: node scripts/types-test.mjs
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

const email = `types-${crypto.randomUUID().slice(0, 8)}@hopvote.test`;
const deck = (questions, extra = {}) => ({ title: "New types", questions, ...extra });
try {
  const pending = await call("/api/auth/signup", { method: "POST", body: { name: "Types", email, password: crypto.randomUUID() } });
  await call("/api/auth/verify", { method: "POST", body: { token: pending.data?.devToken } });
  const userId = sql(`SELECT id FROM users WHERE email = '${email}'`)[0]?.id;
  ok(!!userId, "test account created");
  sql(`UPDATE users SET plan = 'pro' WHERE id = '${userId}'`);

  // What saving refuses.
  const refused = async (q, label) => ok((await call("/api/rooms", { method: "POST", body: deck([q]) })).status === 400, label);
  await refused({ type: "link", question: "My site" }, "a link without an address is refused");
  await refused({ type: "link", question: "My site", url: "javascript:alert(1)" }, "a link to a script is refused");
  await refused({ type: "link", question: "My site", url: "not a link" }, "a link with no domain is refused");
  await refused({ type: "scales", question: "Feedback", options: ["Only one", ""] }, "a rating scale needs 2 statements");
  await refused({ type: "number", question: "Year?", answer: "abc" }, "a number game needs a number as its answer");

  // What saving keeps.
  const questions = [
    { type: "slide", question: "Break", text: "Coffee at the back.\nBack at 10:45." },
    { type: "link", question: "Find me", url: "linkedin.com/in/test" },
    { type: "scales", question: "Feedback", options: ["Clear", "Useful", "Length"], max: 5, labels: ["Bad", "Great"] },
    { type: "number", question: "How many people here?" },
    { type: "number", question: "Eiffel Tower year?", answer: "1889", timer: 45 },
    { type: "rank", question: "Oldest first", options: ["Romanesque", "Renaissance", "Art Deco"], ordered: true },
    { type: "choice", question: "Largest planet?", options: ["Saturn", "Jupiter"], correct: 1, timer: 3 },
    { type: "rank", question: "Priorities", options: ["A", "B", "C"] },
  ];
  const made = await call("/api/rooms", { method: "POST", body: deck(questions, { names: true }) });
  ok(made.status === 200 && !!made.data.code, "a presentation with every new kind is created");
  const { code, hostKey } = made.data;
  const saved = (await call(`/api/polls/${code}`)).data.questions;
  ok(saved[0].type === "slide" && saved[0].text === "Coffee at the back.\nBack at 10:45.", "the slide keeps its text");
  ok(saved[1].url === "https://linkedin.com/in/test", "a link written without https gets it");
  ok(saved[2].options.length === 3 && saved[2].max === 5 && saved[2].labels?.[1] === "Great" && saved[2].style === undefined, "the rating scale keeps its statements, scale and labels");
  ok(saved[3].answer === undefined && saved[3].timer === undefined, "a number without an answer is a poll, without a timer");
  ok(saved[4].answer === 1889 && saved[4].timer === 45, "a number game keeps its answer and a time of its own (45 s)");
  ok(saved[5].ordered === true && saved[5].options[0] === "Romanesque", "a ranking in the right order keeps it");
  ok(saved[6].timer === undefined, "a timer under 5 seconds is dropped");
  ok(saved[7].ordered === undefined, "a usual ranking stays a usual ranking");

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

  // Slide: nothing to answer.
  await go(0);
  ok(a.state.kind === "slide" && a.state.text.startsWith("Coffee"), "phones get the slide and its text");
  ok((await a.send({ type: "vote", voter: "phone-a", option: 0, ...at(0) })) === false, "a slide takes no answer");

  // Link: each person counted once.
  await go(1);
  ok(a.state.url === "https://linkedin.com/in/test", "phones get the link");
  ok((await a.send({ type: "opened", voter: "phone-a", ...at(1) })) === true, "opening the link is counted");
  await a.send({ type: "opened", voter: "phone-a", ...at(1) });
  await b.send({ type: "opened", voter: "phone-b", ...at(1) });
  ok(await host.until((s) => s.answered === 2), "two people opened it, once each");

  // Rating scale.
  await go(2);
  ok((await a.send({ type: "scales", voter: "phone-a", values: [4, 3], ...at(2) })) === false, "every statement needs a rating");
  ok((await a.send({ type: "scales", voter: "phone-a", values: [4, 3, 5], ...at(2) })) === false, "a rating past the scale is refused");
  ok((await a.send({ type: "scales", voter: "phone-a", values: [4, 3, 1], ...at(2) })) === true, "a full set of ratings is counted");
  await b.send({ type: "scales", voter: "phone-b", values: [2, 3, 0], ...at(2) });
  await host.until((s) => s.answered === 2);
  const c = host.state.counts;
  ok(c.length === 15 && c[4] === 1 && c[2] === 1 && c[5 + 3] === 2 && c[10 + 1] === 1 && c[10 + 0] === 1, "ratings counted per statement");
  await a.send({ type: "scales", voter: "phone-a", values: [0, 3, 1], ...at(2) });
  await host.until((s) => s.counts[0] === 1);
  ok(host.state.counts[4] === 0 && host.state.counts[0] === 1 && host.state.answered === 2, "changing one's ratings moves them, same number of people");

  // Number as a poll: every phone sees the spread.
  await go(3);
  ok((await a.send({ type: "number", voter: "phone-a", value: "twelve", ...at(3) })) === false, "a number must be a number");
  await a.send({ type: "number", voter: "phone-a", value: 10, ...at(3) });
  await b.send({ type: "number", voter: "phone-b", value: 20.5, ...at(3) });
  ok(await a.until((s) => s.numbers.length === 2), "a number poll shows every answer to phones");
  ok(a.state.quiz === false && a.state.answer === null, "a number poll is no game");

  // Number game: hidden until shown, the closest wins.
  await go(4);
  ok(a.state.quiz === true && a.state.timer === 45, "a number game follows the quiz rules, with its timer");
  ok((await a.send({ type: "number", voter: "phone-a", value: 1887, ...at(4) })) === false, "a timed game takes no answer before the timer starts");
  // The big screen starts it with a count-in (3, 2, 1, here we go): the clock runs after it, the same for everyone.
  host.send({ type: "start", lead: 1500 });
  await a.until((s) => !!s.startedAt);
  const first = a.state.startedAt;
  ok(first - a.state.now > 1000, "the clock starts once the count-in is over");
  ok((await a.send({ type: "number", voter: "phone-a", value: 1887, ...at(4) })) === false, "no answer during the count-in");
  host.send({ type: "start", lead: 1500 });
  await wait(400);
  ok(a.state.startedAt === first, "a second screen starting it again does not restart the count-in");
  await wait(1400);
  ok((await a.send({ type: "number", voter: "phone-a", value: 1887, ...at(4) })) === true, "an answer while the clock runs is counted");
  await b.send({ type: "number", voter: "phone-b", value: 2000, ...at(4) });
  await host.until((s) => s.answered === 2);
  ok(a.state.numbers.length === 0 && host.state.numbers.length === 0 && a.state.answer === null, "answers and the right one stay hidden from every screen until shown");
  host.send({ type: "reveal", show: true });
  ok(await a.until((s) => s.revealed && s.answer === 1889 && s.numbers.length === 2), "once shown, phones get the answer and the spread");
  ok(a.state.closest?.value === 1887 && a.state.closest?.name === "Lea", "the closest answer is named");
  ok((await b.send({ type: "number", voter: "phone-b", value: 1889, ...at(4) })) === false, "no answers once the answer is shown");

  // Ranking in the right order.
  await go(5);
  ok(a.state.ordered === true && a.state.quiz === true, "phones know it's a ranking with a right order");
  const written = ["Romanesque", "Renaissance", "Art Deco"];
  ok(host.state.options.join() === written.join(), "the presenter's screen gets the items in their written order");
  ok(a.state.options.length === 3 && written.every((w) => a.state.options.includes(w)) && a.state.mix === null, "phones get the same items, mixed by the room, without the mix");
  ok(b.state.options.join() === a.state.options.join(), "every phone gets the same mixed order");
  // Phones answer with places in the order they got: tap the items by name.
  const places = (names) => names.map((w) => a.state.options.indexOf(w));
  await a.send({ type: "rank", voter: "phone-a", order: places(written), ...at(5) });
  await b.send({ type: "rank", voter: "phone-b", order: places([written[1], written[0], written[2]]), ...at(5) });
  await host.until((s) => s.answered === 2);
  ok(a.state.counts.every((n) => n === 0) && a.state.orderResults === null, "the ranking stays hidden until the order is shown");
  const mixedBefore = a.state.options.slice();
  host.send({ type: "reveal", show: true });
  ok(await a.until((s) => s.revealed && s.orderResults?.right === 1), "once shown: one person found the whole order");
  ok(a.state.orderResults.placed.join() === "1,1,2", "and how many put each item at its place");
  ok(a.state.options.join() === written.join() && a.state.mix?.every((i, j) => written[i] === mixedBefore[j]), "once shown, phones get the written order and the mix to read their answer");
  // A phone that asks for the question again after it is shown (it reloads, joins late, changes language) mixes the items
  // as before: the room answers in that same mixed order, not the written one.
  const again = await call(`/api/rooms/${code}/translate?lang=${a.state.lang}&i=5`);
  ok(again.status === 200 && again.data.options?.join() === mixedBefore.join(), `once shown, the question asked again comes in the order phones show (${again.data.options?.join()})`);

  // Quizzes behave as before: bars live on every screen, before the answer shows.
  await go(6);
  await a.send({ type: "vote", voter: "phone-a", option: 1, ...at(6) });
  ok(await b.until((s) => s.counts[1] === 1), "a quiz still shows its bars live, as before");
  ok(b.state.correct === null, "and keeps its right answer hidden until shown");

  // Points: the right order (1000) and the closest number count in the leaderboard.
  const results = (await call(`/api/polls/${code}`)).data;
  const lea = results.leaderboard.find((e) => e.name === "Lea");
  const tom = results.leaderboard.find((e) => e.name === "Tom");
  ok(!!lea && (!tom || lea.score > tom.score), "the closest number and the right order earn points");
  ok(results.questions[4].numbers?.length === 2 && results.questions[5].order?.right === 1, "the results page gets the numbers and the order results");
  ok(results.questions[1].answered === 2 && results.questions[0].answered === 0, "the results page counts link openings, nothing for a slide");

  // Same questions saved again: answers stay. Then a reset clears every new kind of answer.
  ok((await call(`/api/polls/${code}`, { method: "PUT", body: deck(saved, { names: true }) })).status === 200, "saving the same questions again works");
  ok((await call(`/api/polls/${code}`)).data.questions[4].numbers?.length === 2, "and keeps the answers");
  await call(`/api/polls/${code}/reset`, { method: "POST" });
  const cleared = (await call(`/api/polls/${code}`)).data.questions;
  ok(cleared[4].numbers.length === 0 && cleared[5].order.right === 0 && cleared[2].counts.every((n) => n === 0) && cleared[1].answered === 0, "a reset clears numbers, orders, ratings and openings");

  // The list of presentations names the new kinds.
  const listed = (await call("/api/polls")).data.polls.find((p) => p.code === code);
  ok(["slide", "link", "scales", "number", "order", "quiz", "rank"].every((k) => listed?.kinds?.includes(k)), "the presentations list knows every kind");

  // The answer never reaches a phone: eight items in their right order come mixed, and a phone sending them
  // in the order it got them scores only what that order really puts right.
  const steps = ["One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight"];
  const long = await call("/api/rooms", { method: "POST", body: deck([{ type: "rank", question: "In order", options: steps, ordered: true }], { names: true }) });
  const host2 = await socket(long.data.code, `?key=${long.data.hostKey}`);
  const c2 = await socket(long.data.code, "?voter=phone-c");
  const view2 = await socket(long.data.code, "?view=1");
  await c2.until((s) => s.options.length === 8);
  await view2.until((s) => s.options.length === 8);
  ok(c2.state.options.join() !== steps.join() && view2.state.options.join() === c2.state.options.join(), "phones and watching screens never get the items in their right order");
  const at2 = { index: 0, round: host2.state.round };
  const got = c2.state.options.slice();
  await c2.send({ type: "rank", voter: "phone-c", order: [0, 1, 2, 3, 4, 5, 6, 7], ...at2 });
  host2.send({ type: "reveal", show: true });
  await host2.until((s) => s.revealed && !!s.orderResults);
  const placedRight = got.filter((w, pos) => steps[pos] === w).length;
  ok(host2.state.orderResults.right === 0 && host2.state.orderResults.placed.reduce((n, x) => n + x, 0) === placedRight, "sending the order as received earns only its real places");
  for (const s of [host2, c2, view2]) s.ws.close();

  for (const s of [host, a, b]) s.ws.close();
} catch (err) {
  ok(false, `crashed: ${err?.stack ?? err}`);
} finally {
  if (cookie) await call("/api/account", { method: "DELETE", body: { confirm: "DELETE" } });
}
console.log(failures ? `\n${failures} check(s) failed` : "\nAll new-type checks passed");
process.exit(failures ? 1 : 0);
