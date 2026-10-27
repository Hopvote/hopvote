// Local check of topic rounds (src/rounds.ts): the shared rules, then the room with host and phone sockets.
// An older presentation unchanged, an evening with the wheel (3 topics, 2 rounds), an evening with the room's vote (vote, tie,
// no vote, a vote from an earlier pass refused), choosing again before and after a topic is locked, going back, the reset,
// the round leaderboard and the podium at the right time (3 rounds of 5 with a final question; a last round without
// points), two screens sending the same step, saves that keep or clear the answers, back through two rounds, a screen
// behind, and the room's votes in the results.
// Dev server only (npx vite --port 5180). Run: node scripts/rounds-test.mjs
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { decisionOf, finalOnPath, nextStep, prevStep, roundsOf, validRounds } from "../src/rounds.ts";
import { boardStep, boardView } from "../src/board.ts";

const BASE = "http://localhost:5180";
const WS = BASE.replace(/^http/, "ws");
const SPIN_MS = 6000;
let failures = 0;
const ok = (cond, label) => {
  console.log(`${cond ? "✓" : "✗"} ${label}`);
  if (!cond) failures++;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const sql = (command) => JSON.parse(execFileSync("npx", ["wrangler", "d1", "execute", "hopvote-db", "--local", "--json", "--command", command], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }))[0]?.results ?? [];

let cookie = "";
async function call(path, { method = "GET", body, bearer } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(BASE + path, {
        method,
        headers: { ...(body ? { "content-type": "application/json" } : {}), ...(cookie && !bearer ? { cookie } : {}), ...(bearer ? { authorization: `Bearer ${bearer}` } : {}), origin: BASE, connection: "close" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const set = res.headers.get("set-cookie");
      if (set && !bearer) cookie = set.split(";")[0];
      const data = await res.json().catch(() => ({}));
      return { status: res.status, data };
    } catch (err) {
      // The dev server restarts when the worker changes: try again.
      if (attempt >= 5) throw err;
      await wait(1000);
    }
  }
}

const sockets = [];
function socket(code, query) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS}/api/rooms/${code}/ws${query}`);
    const client = { ws, state: null, acks: new Map(), ref: 1 };
    sockets.push(client);
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
        await wait(40);
      }
      return false;
    };
    ws.onopen = () => resolve(client);
    ws.onerror = reject;
  });
}

const quiz = (question, topic, extra = {}) => ({ type: "choice", question, options: ["Right", "Wrong"], correct: 0, ...(topic === undefined ? {} : { topic }), ...extra });
const create = async (body) => call("/api/rooms", { method: "POST", body });
const stored = (code) => sql(`SELECT questions FROM polls WHERE code = '${code}'`)[0]?.questions;
const read = async (code) => (await call(`/api/polls/${code}`)).data;
// The state as the screen reads it (receivedAt as useRoom adds it), for the shared helpers.
const view = (s) => ({ ...s, receivedAt: Date.now() });

// ---------------------------------------------------------------------------------------------------------------------
// The shared rules, without the room.
{
  const picker = { type: "wheel", question: "Next?", options: ["A", "B", "C"], topics: true };
  const qs = [{ type: "slide", question: "Hi", options: [] }, picker, quiz("a1", 0), quiz("a2", 0), quiz("b1", 1), { type: "slide", question: "c1", options: [], topic: 2 }, quiz("Final")];
  ok(validRounds(qs) === null && validRounds([quiz("x")]) === null, "rules: a well-built list passes, a list without a picker too");
  ok(validRounds([picker, { ...picker, question: "Again" }, quiz("a", 0), quiz("b", 1), quiz("c", 2)])?.startsWith("Only one"), "rules: one picker per presentation");
  ok(validRounds([quiz("a", 0), picker, quiz("b", 1), quiz("c", 2)])?.includes("after"), "rules: a topic's question before the picker is refused");
  ok(validRounds([picker, quiz("a", 0), quiz("b", 1)]) === 'Add a question to "C"', "rules: every topic needs a question");
  ok(validRounds([picker, quiz("a", 0), quiz("b", 1), quiz("a2", 0), quiz("c", 2)])?.startsWith("Keep the questions"), "rules: a topic's questions stay together, in order");
  ok(validRounds([picker, quiz("a", 0), quiz("b", 1), quiz("c", 2), quiz("end"), quiz("late", 2)])?.startsWith("Keep the questions"), "rules: no topic question after the questions at the end");
  ok(validRounds([picker, quiz("a", 0), quiz("b", 1), quiz("c", 2), quiz("x", 3)])?.includes("no topic"), "rules: a topic index past the topics is refused");
  const r = roundsOf(qs);
  ok(r.picker === 1 && r.how === "wheel" && r.topics[0].indices.join() === "2,3" && r.after.join() === "6" && r.rounds === 3, "rules: roundsOf reads the picker, the topics, the questions before and after");
  ok(roundsOf([quiz("x")]) === null && roundsOf([picker, quiz("a", 0)]) === null, "rules: no rounds without a picker or when they do not hold together");
  const play = { order: [], chosen: null };
  ok(nextStep(r, play, 0, qs.length).to === 1 && "need" in nextStep(r, play, 1, qs.length), "rules: → reaches the picker, then waits for a topic");
  ok(nextStep(r, { order: [], chosen: 1 }, 1, qs.length).enter === 1 && nextStep(r, { order: [], chosen: 1 }, 1, qs.length).to === 4, "rules: a chosen topic starts with its first question");
  ok(nextStep(r, { order: [1], chosen: null }, 4, qs.length).to === 1, "rules: after a round, back to the picker");
  ok(prevStep(r, { order: [1], chosen: null }, 4).back === true && prevStep(r, { order: [1], chosen: null }, 4).to === 1, "rules: ← on a round's first question goes back to the picker");
  ok(decisionOf(r, { order: [1, 0], chosen: null })?.last === true && decisionOf(r, { order: [1, 0], chosen: null }).topic === 2, "rules: the only topic left needs no wheel");
  ok(nextStep(r, { order: [1, 0, 2], chosen: null }, 5, qs.length).to === 6 && nextStep(r, { order: [1, 0, 2], chosen: null }, 6, qs.length) === null, "rules: after the last round, the questions at the end, then nothing");
  const two = roundsOf([{ ...picker, rounds: 2 }, ...qs.slice(2)].map((q, i) => (i === 0 ? q : q)));
  ok(nextStep(two, { order: [0, 1], chosen: null }, 3, 6).to === 5, "rules: with 2 rounds of 3, the last round leads to the end");
  const scored = (i) => qs[i]?.type === "choice" && qs[i]?.correct !== undefined;
  ok(!finalOnPath(r, play, 1, scored) && !finalOnPath(r, { order: [1, 0, 2], chosen: null }, 5, scored) && finalOnPath(r, { order: [1, 0, 2], chosen: null }, 6, scored), "rules: the podium waits for the last scored question on the way the game goes");

  // Older states (no topic rounds): the → helper answers exactly as before, for every mode.
  const before = (s) => {
    if (!s || s.lobby || s.board || !s.quiz || !s.hasBoard) return null;
    const mode = s.boardMode ?? "manual";
    if (mode !== "each" && !(mode === "end" && s.boardFinal)) return null;
    return s.revealed ? "board" : "reveal";
  };
  let same = true;
  for (const boardMode of [undefined, "manual", "each", "end", "off"])
    for (let bits = 0; bits < 64; bits++) {
      const [lobby, board, q, hasBoard, revealed, boardFinal] = [0, 1, 2, 3, 4, 5].map((b) => !!(bits & (1 << b)));
      const s = { lobby, board: board ? [] : null, quiz: q, hasBoard, revealed, boardFinal, boardMode };
      if (boardStep(s) !== before(s)) same = false;
    }
  ok(same, "rules: without topic rounds, → does exactly what it did before, in every leaderboard mode");

  // ← back through two rounds: with the next topic chosen at the picker, the round before stays played.
  ok(prevStep(r, { order: [1], chosen: 0 }, 4).to === 1 && !prevStep(r, { order: [1], chosen: 0 }, 4).back, "rules: ← to the picker holding the next topic keeps the round before played");

  // The leaderboard after each round: the podium after the last round, even one without points.
  const mixed = [{ type: "wheel", question: "Next?", options: ["A", "B", "C"], topics: true }, { type: "slide", question: "a1", options: [], topic: 0 }, quiz("b1", 1), { type: "slide", question: "c1", options: [], topic: 2 }];
  const m = roundsOf(mixed);
  const mScored = (i) => mixed[i]?.correct !== undefined;
  ok(finalOnPath(m, { order: [1], chosen: null }, 2, mScored) && !finalOnPath(m, { order: [1], chosen: null }, 2, mScored, true), "rules: by round, the podium waits for the last round, even when the rounds left have no points");
  ok(finalOnPath(m, { order: [1, 0, 2], chosen: null }, 3, mScored, true), "rules: by round, the last round ends on the podium");
  const roundEnd = (scored, boardFinal, quiz = false) => ({ hasBoard: true, boardMode: "round", quiz, revealed: false, boardFinal, board: null, topics: { at: "topic", topic: 0, pos: 1, size: 1, list: [{ label: "A", n: 1, done: true, scored }], how: "wheel", chosen: null, left: false } });
  ok(boardStep(roundEnd(false, true)) === "board" && boardView(roundEnd(false, true)) === "podium", "rules: a last round without points ends on the podium");
  ok(boardStep(roundEnd(false, false)) === null && boardStep(roundEnd(true, false, true)) === "reveal", "rules: a round without points has no standings, one with points its answer first");
  const midRound = { ...roundEnd(true, true, true), topics: { ...roundEnd(true, true, true).topics, pos: 1, size: 2 } };
  ok(boardStep(midRound) === null, "rules: no podium in the middle of the last round");
}

const email = `rounds-${crypto.randomUUID().slice(0, 8)}@hopvote.test`;
let userId = "";
try {
  const pending = await call("/api/auth/signup", { method: "POST", body: { name: "Rounds", email, password: crypto.randomUUID() } });
  await call("/api/auth/verify", { method: "POST", body: { token: pending.data?.devToken } });
  userId = sql(`SELECT id FROM users WHERE email = '${email}'`)[0]?.id;
  ok(!!userId, "test account created");

  sql(`UPDATE users SET plan = 'pro' WHERE id = '${userId}'`);

  // ---------------------------------------------------------------------------------------------------------------------
  // What saving refuses, keeps and drops.
  const refused = async (questions, label) => ok((await create({ title: "Bad", questions })).status === 400, label);
  const wheel = (options, extra = {}) => ({ type: "wheel", question: "Next topic?", options, topics: true, ...extra });
  await refused([wheel(["Only"]), quiz("a", 0)], "save: one topic is not enough");
  await refused([wheel(["1", "2", "3", "4", "5", "6", "7", "8", "9"]), ...Array.from({ length: 9 }, (_, i) => quiz(`q${i}`, i))], "save: 9 topics are too many");
  await refused([wheel(["Sport", "sport"]), quiz("a", 0), quiz("b", 1)], "save: the same topic twice is refused");
  await refused([wheel(["A", "B"]), quiz("a", 0)], "save: a topic without a question is refused");
  await refused([wheel(["A", "B"]), wheel(["C", "D"]), quiz("a", 0), quiz("b", 1)], "save: two pickers are refused");
  await refused([wheel(["A", "B"]), quiz("b", 1), quiz("a", 0)], "save: topics out of order are refused");
  await refused([quiz("a", 0), wheel(["A", "B"]), quiz("b", 1)], "save: a topic's question before the picker is refused");
  const kept = await create({ title: "Kept", questions: [{ type: "choice", question: "Vote?", options: ["  Long topic name that goes well past forty characters  ", "B"], topics: true, correct: 0, multi: true, timer: 30, rounds: 9 }, quiz("a", 0), quiz("b", 1)] });
  const keptQs = JSON.parse(stored(kept.data.code));
  ok(kept.status === 200 && keptQs[0].topics === true && keptQs[0].correct === undefined && keptQs[0].multi === undefined && keptQs[0].timer === undefined, "save: a vote picker has no right answer, no multiple choice, no timer");
  ok(keptQs[0].options[0].length === 40 && keptQs[0].rounds === undefined && keptQs[1].topic === 0 && keptQs[2].topic === 1, "save: topics cut at 40 characters, rounds past the topics dropped, each question keeps its topic");
  const loose = await create({ title: "Loose", questions: [quiz("a", 1), quiz("b")] });
  ok(loose.status === 200 && JSON.parse(stored(loose.data.code))[0].topic === undefined, "save: a topic without a picker is dropped");

  // ---------------------------------------------------------------------------------------------------------------------
  // An older presentation: stored, sent and played exactly as before.
  const oldQuestions = [quiz("Q1", undefined, { timer: 10 }), { type: "wheel", question: "Who?", options: ["Ann", "Bob"] }, { type: "choice", question: "Poll", options: ["X", "Y"], multi: true }];
  const old = await create({ title: "Old", questions: oldQuestions, names: true, boardMode: "each" });
  ok(
    stored(old.data.code) ===
      JSON.stringify([
        { type: "choice", question: "Q1", options: ["Right", "Wrong"], correct: 0, timer: 10 },
        { type: "wheel", question: "Who?", options: ["Ann", "Bob"] },
        { type: "choice", question: "Poll", options: ["X", "Y"], multi: true },
      ]),
    "older deck: stored byte for byte as before",
  );
  const oldHost = await socket(old.data.code, `?key=${old.data.hostKey}`);
  await oldHost.until((s) => s.type === "state");
  ok(!("topics" in oldHost.state) && oldHost.state.boardFinal === true && oldHost.state.boardMode === "each", "older deck: the screens' state has no topic rounds");
  oldHost.send({ type: "goto", index: 1 });
  ok(await oldHost.until((s) => s.index === 1 && s.wheel?.list.length === 2), "older deck: goto moves as before");
  oldHost.send({ type: "spin" });
  ok(await oldHost.until((s) => s.wheel?.spin?.n === 1), "older deck: its wheel spins as before");
  oldHost.send({ type: "step", dir: 1, from: 1 });
  ok(await oldHost.until((s) => s.index === 2) && oldHost.state.boardFinal === true, "older deck: a step moves one question, the last quiz is behind");
  const oldResults = await read(old.data.code);
  ok(!("rounds" in oldResults) && oldResults.questions.every((q) => q.topic === undefined && q.topics === undefined), "older deck: its results have no topic rounds");
  ok((await call(`/api/polls/${old.data.code}`, { method: "PUT", body: { title: "Old", questions: oldQuestions, names: true, boardMode: "each" } })).status === 200 && stored(old.data.code) === JSON.stringify(JSON.parse(stored(old.data.code))), "older deck: saved again, unchanged");

  // ---------------------------------------------------------------------------------------------------------------------
  // An evening with the wheel: 3 topics, 2 rounds, a welcome slide and a final question.
  const labels = ["History", "Geography", "Sport"];
  const wheelDeck = [
    { type: "slide", question: "Welcome" },
    { type: "wheel", question: "Next topic?", options: labels, topics: true, rounds: 2 },
    quiz("H1", 0),
    quiz("H2", 0),
    quiz("G1", 1),
    quiz("G2", 1),
    quiz("S1", 2),
    quiz("Final"),
  ];
  const w = await create({ title: "Quiz night", questions: wheelDeck, names: true, boardMode: "round" });
  ok(w.status === 200, "wheel evening: saved with the round leaderboard");
  ok((await read(w.data.code)).boardMode === "round", "the round leaderboard reads back");
  const host = await socket(w.data.code, `?key=${w.data.hostKey}`);
  const a = await socket(w.data.code, "?voter=phone-a");
  const b = await socket(w.data.code, "?voter=phone-b");
  await a.send({ type: "name", voter: "phone-a", name: "Lea" });
  await b.send({ type: "name", voter: "phone-b", name: "Tom" });
  await host.until((s) => s.people.length === 2);
  const round = host.state.round;
  const t = () => host.state.topics;
  ok(t()?.at === "before" && t().roundNo === 0 && t().of === 2 && t().hasPrev === false && t().list.map((x) => x.label).join() === labels.join(), "wheel: the screens know the rounds from the first slide");
  host.send({ type: "step", dir: 1, from: 0 });
  ok(await host.until((s) => s.index === 1 && s.topics.at === "picker"), "wheel: → reaches the picker");
  ok(t().roundNo === 1 && t().chosen === null && host.state.wheel.list.length === 3 && host.state.wheel.spin === null && boardStep(view(host.state)) === "spin", "wheel: round 1 of 2, the wheel holds the 3 topics, → asks for a spin");
  await host.send({ type: "step", dir: 1, from: 1 });
  await host.send({ type: "unspin" });
  await wait(250);
  ok(host.state.index === 1, "wheel: → waits for the wheel, unspin does nothing");
  ok((await a.send({ type: "vote", voter: "phone-a", option: 0, index: 1, round })) === false, "wheel: phones have nothing to answer on the wheel");
  host.send({ type: "spin" });
  ok(await host.until((s) => s.wheel.spin?.n === 1 && s.topics.chosen !== null), "wheel: the wheel turns and chooses a topic");
  ok(host.state.wheel.list[host.state.wheel.spin.win] === labels[t().chosen] && t().chosenHow === "wheel", "wheel: the wheel stops on the chosen topic");
  ok(await a.until((s) => s.wheel?.spin?.n === 1), "wheel: phones get the same spin");
  await host.send({ type: "spin" });
  await host.send({ type: "step", dir: 1, from: 1 });
  await wait(250);
  ok(host.state.wheel.spin.n === 1 && host.state.index === 1, "wheel: no second spin and no start while it turns");
  await wait(Math.max(0, host.state.wheel.spin.at + SPIN_MS - host.state.now) + 300);
  host.send({ type: "repick" });
  ok(await host.until((s) => s.topics.chosen === null && s.wheel.spin === null && s.wheel.list.length === 3), "wheel: choosing again before the round starts");
  host.send({ type: "spin" });
  ok(await host.until((s) => s.wheel.spin?.n === 2 && s.topics.chosen !== null), "wheel: the wheel turns again");
  const first = t().chosen;
  await wait(SPIN_MS + 300);
  await host.send({ type: "spin" });
  await wait(250);
  ok(host.state.wheel.spin.n === 2 && t().chosen === first, "wheel: once a topic is chosen, only Choose again reopens the wheel");
  // Phones read the question the game goes to next, never a question of a topic not chosen, even the next one in the list.
  const readable = async (i) => (await call(`/api/rooms/${w.data.code}/translate?lang=en&i=${i}&ahead=0`)).status;
  const chosenFirst = wheelDeck.findIndex((q) => q.topic === first);
  const otherFirst = wheelDeck.findIndex((q) => q.topic !== undefined && q.topic !== first);
  ok((await readable(chosenFirst)) === 200 && (await readable(otherFirst)) === 404 && (await readable(2)) === (first === 0 ? 200 : 404), "wheel: at the picker, phones read the chosen topic's first question, not another topic's");
  host.send({ type: "step", dir: 1, from: 1 });
  const firstIdx = wheelDeck.findIndex((q) => q.topic === first);
  const firstSize = wheelDeck.filter((q) => q.topic === first).length;
  ok(await host.until((s) => s.index === firstIdx && s.topics.at === "topic"), "wheel: → starts the chosen topic");
  ok(t().topic === first && t().pos === 1 && t().size === firstSize && t().roundNo === 1 && t().order.join() === String(first) && t().list[first].done, "wheel: the screens read the topic, 1 of its questions, round 1");
  host.send({ type: "step", dir: -1, from: firstIdx });
  ok(await host.until((s) => s.index === 1 && s.topics.chosen === first), "back: ← on the first question returns to the picker with the same topic");
  ok(t().order.length === 0 && t().chosenHow === "wheel" && host.state.wheel.spin.n === 2 && t().locked === false, "back: no new draw, nothing played yet, not locked");
  host.send({ type: "step", dir: 1, from: 1 });
  ok(await host.until((s) => s.index === firstIdx), "back: → starts it again");
  // The round: Lea right, Tom wrong; the leaderboard waits for the round's last question.
  for (let i = 0; i < firstSize; i++) {
    const index = firstIdx + i;
    if (i) {
      host.send({ type: "step", dir: 1, from: index - 1 });
      await host.until((s) => s.index === index);
    }
    await a.send({ type: "vote", voter: "phone-a", option: 0, index, round });
    await b.send({ type: "vote", voter: "phone-b", option: 1, index, round });
    await host.until((s) => s.answered === 2);
    if (i < firstSize - 1) ok(boardStep(view(host.state)) === null, "round leaderboard: none in the middle of a round");
  }
  ok(boardStep(view(host.state)) === "reveal" && host.state.boardFinal === false, "round leaderboard: the round's last question shows its answer first");
  host.send({ type: "reveal", show: true });
  await host.until((s) => s.revealed);
  ok(boardStep(view(host.state)) === "board", "round leaderboard: then the standings");
  host.send({ type: "board", show: true });
  ok(await host.until((s) => !!s.board), "round leaderboard: the standings open");
  ok(boardView(view(host.state)) === "standings", "round leaderboard: standings, not the podium");
  const lea = host.state.board.find((e) => e.name === "Lea");
  ok(lea?.gained === 1000 * firstSize && lea.score === 1000 * firstSize, "round leaderboard: what the round brought, all its questions together");
  ok(await a.until((s) => s.me?.gained === 1000 * firstSize && s.me.rank === 1), "round leaderboard: each phone gets its place");
  host.send({ type: "step", dir: 1, from: firstIdx + firstSize - 1 });
  ok(await host.until((s) => s.index === 1 && !s.board), "wheel: after the round, back to the picker");
  ok(t().roundNo === 2 && host.state.wheel.list.length === 2 && !host.state.wheel.list.includes(labels[first]) && t().chosen === null, "wheel: round 2 spins among the 2 topics left");
  host.send({ type: "step", dir: -1, from: 1 });
  ok(await host.until((s) => s.index === firstIdx + firstSize - 1), "back: ← on the picker returns to the last question played");
  host.send({ type: "step", dir: 1, from: firstIdx + firstSize - 1 });
  await host.until((s) => s.index === 1);
  const second = [0, 1, 2].find((x) => x !== first);
  await host.send({ type: "pick", topic: first });
  await wait(200);
  ok(t().chosen === null, "wheel: a topic played cannot be chosen again");
  host.send({ type: "pick", topic: second });
  ok(await host.until((s) => s.topics.chosen === second && s.topics.chosenHow === "host"), "wheel: the presenter can choose by hand");
  host.send({ type: "step", dir: 1, from: 1 });
  const secondIdx = wheelDeck.findIndex((q) => q.topic === second);
  const secondLast = secondIdx + wheelDeck.filter((q) => q.topic === second).length - 1;
  ok(await host.until((s) => s.index === secondIdx && s.topics.roundNo === 2), "wheel: round 2 starts");
  if (secondLast !== secondIdx) {
    host.send({ type: "goto", index: secondLast });
    await host.until((s) => s.index === secondLast);
  }
  ok(host.state.boardFinal === false && t().hasNext, "wheel: the final question is still ahead");
  host.send({ type: "step", dir: 1, from: secondLast });
  ok(await host.until((s) => s.index === 7 && s.topics.at === "after"), "wheel: after 2 rounds of 3, the final question (no third round)");
  ok(host.state.boardFinal === true && t().hasNext === false && t().roundNo === 2, "wheel: the final question is the last one");
  host.send({ type: "step", dir: -1, from: 7 });
  ok(await host.until((s) => s.index === secondLast), "back: ← on the final question returns to the last round");
  const wResults = await read(w.data.code);
  ok(
    wResults.rounds?.played.map((p) => `${p.topic}:${p.how}`).join() === `${first}:wheel,${second}:host` && wResults.rounds.notPlayed.length === 1 && wResults.questions[2].topic === 0,
    "wheel: the results list the rounds played, how, and the topic not played",
  );
  await call(`/api/polls/${w.data.code}/reset`, { method: "POST" });
  ok(await host.until((s) => s.index === 0 && s.topics.order.length === 0 && s.topics.pass === 1 && s.topics.chosen === null), "reset: back to the start, no round played");
  host.send({ type: "goto", index: 1 });
  ok(await host.until((s) => s.index === 1 && s.wheel.list.length === 3 && s.wheel.spin === null), "reset: the wheel holds every topic again");
  ok(!(await read(w.data.code)).rounds.played.length, "reset: the results have no round played");

  // ---------------------------------------------------------------------------------------------------------------------
  // An evening with the room's vote: 3 topics, all played.
  const voteDeck = [{ type: "choice", question: "Which topic?", options: ["Art", "Music", "Space"], topics: true }, quiz("A1", 0), quiz("M1", 1), quiz("S1", 2)];
  const v = await create({ title: "Vote night", questions: voteDeck, names: true, boardMode: "round" });
  const vh = await socket(v.data.code, `?key=${v.data.hostKey}`);
  const phones = await Promise.all(["v1", "v2", "v3", "v4"].map((id) => socket(v.data.code, `?voter=${id}`)));
  await Promise.all(phones.map((p, i) => p.send({ type: "name", voter: `v${i + 1}`, name: `P${i + 1}` })));
  const vr = vh.state.round;
  const vote = (i, option, pass, index = 0) => phones[i].send({ type: "vote", voter: `v${i + 1}`, option, index, round: vr, ...(pass === undefined ? {} : { pass }) });
  const vt = () => vh.state.topics;
  ok(vt().at === "picker" && vt().how === "vote" && vt().pass === 1 && boardStep(view(vh.state)) === "pick", "vote: the picker opens the vote, → closes it");
  ok((await vote(0, 0, 1)) === true && (await vote(1, 1)) === true && (await vote(2, 1, 1)) === true, "vote: phones vote (with the pass, or without it)");
  ok((await vote(3, 1, 2)) === false, "vote: a vote for a pass not open yet is refused");
  ok((await vote(3, 5, 1)) === false && (await vote(3, [0, 1], 1)) === false, "vote: one topic of the list only");
  ok(await vh.until((s) => s.counts.join() === "1,2,0" && s.answered === 3), "vote: the bars show live");
  vh.send({ type: "pick" });
  ok(await vh.until((s) => s.topics.chosen === 1 && s.topics.chosenHow === "vote" && !s.topics.tie), "vote: closing it chooses the most voted topic");
  ok((await vote(3, 0, 1)) === false, "vote: no vote once closed");
  vh.send({ type: "repick" });
  ok(await vh.until((s) => s.topics.chosen === null && s.topics.pass === 2 && s.counts.join() === "0,0,0" && s.answered === 0), "repick: the vote opens again from zero, pass 2");
  ok((await vote(0, 0, 1)) === false, "repick: a vote from the earlier pass is refused");
  await vote(0, 0, 2);
  await vote(1, 1, 2);
  await vh.until((s) => s.answered === 2);
  vh.send({ type: "pick" });
  ok(await vh.until((s) => s.topics.chosen !== null && s.topics.tie === true && [0, 1].includes(s.topics.chosen)), "tie: drawn among the tied topics, and said so");
  vh.send({ type: "pick", topic: 2 });
  ok(await vh.until((s) => s.topics.chosen === 2 && s.topics.chosenHow === "host" && !s.topics.tie), "tie: the presenter can choose another one");
  vh.send({ type: "step", dir: 1, from: 0 });
  ok(await vh.until((s) => s.index === 3 && s.topics.pass === 3), "vote: → starts the chosen topic, the next vote will be pass 3");
  await phones[0].send({ type: "vote", voter: "v1", option: 0, index: 3, round: vr });
  vh.send({ type: "step", dir: -1, from: 3 });
  ok(await vh.until((s) => s.index === 0 && s.topics.chosen === 2 && s.topics.locked === true), "locked: back at the picker, the topic answered is locked");
  ok(vh.state.counts.join() === "1,1,0" && vh.state.answered === 2, "locked: the vote that chose it still shows");
  await vh.send({ type: "repick" });
  await vh.send({ type: "pick", topic: 0 });
  await vh.send({ type: "goto", index: 1 });
  await wait(250);
  ok(vh.state.topics.chosen === 2 && vh.state.index === 0, "locked: no choosing again, no other topic, not even from the dots");
  vh.send({ type: "step", dir: 1, from: 0 });
  ok(await vh.until((s) => s.index === 3 && s.topics.order.join() === "2"), "locked: → goes on with the same topic, played once");
  vh.send({ type: "step", dir: 1, from: 3 });
  ok(await vh.until((s) => s.index === 0 && s.topics.roundNo === 2 && s.topics.list[2].done), "vote: round 2, the topic played is marked");
  ok((await vote(1, 2, 3)) === false, "vote: a topic played cannot get votes");
  ok((await vote(1, 0, 2)) === false, "vote: a vote from the previous round's pass is refused");
  vh.send({ type: "pick" });
  ok(await vh.until((s) => s.topics.chosen !== null && s.topics.empty === true && [0, 1].includes(s.topics.chosen)), "no vote: drawn among the topics left");
  const round2 = vt().chosen;
  vh.send({ type: "step", dir: 1, from: 0 });
  await vh.until((s) => s.index === round2 + 1);
  vh.send({ type: "step", dir: 1, from: round2 + 1 });
  ok(await vh.until((s) => s.index === 0 && s.topics.roundNo === 3), "vote: round 3");
  const lastTopic = [0, 1].find((x) => x !== round2);
  ok(vt().chosen === lastTopic && vt().chosenHow === "last" && boardStep(view(vh.state)) === null, "last round: the only topic left, no vote");
  ok((await vote(2, lastTopic, vt().pass)) === false, "last round: phones have nothing to vote");
  await vh.send({ type: "pick" });
  vh.send({ type: "step", dir: 1, from: 0 });
  ok(await vh.until((s) => s.index === lastTopic + 1 && s.topics.order.length === 3), "last round: → starts it");
  ok(vt().hasNext === false && vh.state.boardFinal === true, "last round: nothing after, the podium comes now");
  const vResults = await read(v.data.code);
  ok(vResults.questions[0].answered === 2 && vResults.questions[0].counts.join() === "1,1,0", "vote: the results count the room's votes of every round at the picker");
  const played = vResults.rounds?.played ?? [];
  ok(played.map((p) => p.how).join() === "host,vote,last" && played[0].votes?.tie === true && played[0].votes.counts.join() === "1,1,0" && played[1].votes?.empty === true, "vote: the results keep each vote and how each topic was chosen");

  // Same questions, another number of rounds: the answers stay. A topic renamed: the answers go.
  const vStored = JSON.parse(stored(v.data.code));
  vStored[0].rounds = 2;
  ok((await call(`/api/polls/${v.data.code}`, { method: "PUT", body: { title: "Vote night", questions: vStored, names: true, boardMode: "round" } })).status === 200, "save: changing the number of rounds is accepted");
  const afterRounds = await read(v.data.code);
  ok(afterRounds.rounds.played.length === 3 && afterRounds.questions[3].answered === 1 && afterRounds.rounds.rounds === 2, "save: changing the number of rounds keeps the answers and the rounds played");
  vStored[0].options = ["Art", "Music", "Planets"];
  await call(`/api/polls/${v.data.code}`, { method: "PUT", body: { title: "Vote night", questions: vStored, names: true, boardMode: "round" } });
  const renamed = await read(v.data.code);
  ok(renamed.rounds.played.length === 0 && renamed.questions[3].answered === 0, "save: renaming a topic clears the answers, as any change of questions");

  // ---------------------------------------------------------------------------------------------------------------------
  // 3 rounds of 5 topics, then a final question: the standings after each round, the podium only at the very end.
  const five = ["T0", "T1", "T2", "T3", "T4"];
  const boardDeck = [{ type: "wheel", question: "Topic?", options: five, topics: true, rounds: 3 }, quiz("T0a", 0), quiz("T0b", 0), quiz("T1a", 1), quiz("T2a", 2), quiz("T3a", 3), quiz("T4a", 4), quiz("Final")];
  const bd = await create({ title: "Board", questions: boardDeck, names: true, boardMode: "round" });
  const bh = await socket(bd.data.code, `?key=${bd.data.hostKey}`);
  const lea2 = await socket(bd.data.code, "?voter=lea");
  const tom2 = await socket(bd.data.code, "?voter=tom");
  await lea2.send({ type: "name", voter: "lea", name: "Lea" });
  await tom2.send({ type: "name", voter: "tom", name: "Tom" });
  const br = bh.state.round;
  const answer = async (index, leaRight, tomRight) => {
    await lea2.send({ type: "vote", voter: "lea", option: leaRight ? 0 : 1, index, round: br });
    await tom2.send({ type: "vote", voter: "tom", option: tomRight ? 0 : 1, index, round: br });
    await bh.until((s) => s.index === index && s.answered === 2);
  };
  const showBoard = async () => {
    bh.send({ type: "reveal", show: true });
    await bh.until((s) => s.revealed);
    bh.send({ type: "board", show: true });
    return bh.until((s) => !!s.board);
  };
  ok(bh.state.boardFinal === false, "board: at the picker, the podium is far away");
  // Round 1 from the dots: clicking a topic's question chooses it.
  bh.send({ type: "goto", index: 5 });
  ok(await bh.until((s) => s.index === 5 && s.topics.order.join() === "3" && s.topics.hows.join() === "host"), "goto: a topic's question from the dots chooses that topic");
  await answer(5, true, false);
  ok(bh.state.boardFinal === false && boardStep(view(bh.state)) === "reveal", "board: end of round 1, its answer then the standings");
  await showBoard();
  ok(boardView(view(bh.state)) === "standings" && bh.state.board.find((e) => e.name === "Lea")?.gained === 1000, "board: round 1 standings");
  bh.send({ type: "step", dir: 1, from: 5 });
  await bh.until((s) => s.index === 0);
  bh.send({ type: "pick", topic: 0 });
  await bh.until((s) => s.topics.chosen === 0);
  bh.send({ type: "step", dir: 1, from: 0 });
  await bh.until((s) => s.index === 1);
  await answer(1, false, true);
  ok(boardStep(view(bh.state)) === null, "board: no standings in the middle of round 2");
  bh.send({ type: "step", dir: 1, from: 1 });
  await bh.until((s) => s.index === 2);
  await answer(2, false, true);
  ok(boardStep(view(bh.state)) === "reveal", "board: the standings at the end of round 2");
  await showBoard();
  const tom = bh.state.board.find((e) => e.name === "Tom");
  const leaNow = bh.state.board.find((e) => e.name === "Lea");
  ok(tom?.gained === 2000 && tom.score === 2000 && tom.prev === 0 && leaNow?.prev === 1 && leaNow.gained === 0, "board: what round 2 brought, and the places before it");
  ok(await tom2.until((s) => s.me?.rank === 1 && s.me.gained === 2000), "board: Tom's phone shows his place and his round");
  bh.send({ type: "step", dir: 1, from: 2 });
  await bh.until((s) => s.index === 0 && !s.board);
  bh.send({ type: "pick", topic: 1 });
  await bh.until((s) => s.topics.chosen === 1);
  bh.send({ type: "step", dir: 1, from: 0 });
  await bh.until((s) => s.index === 3);
  await answer(3, true, true);
  ok(bh.state.boardFinal === false && bh.state.topics.roundNo === 3, "board: round 3 of 3, the final question is still ahead");
  await showBoard();
  ok(boardView(view(bh.state)) === "standings", "board: standings after round 3, not the podium");
  bh.send({ type: "step", dir: 1, from: 3 });
  ok(await bh.until((s) => s.index === 7 && !s.board), "board: after round 3 of 5, straight to the final question");
  await answer(7, true, false);
  ok(bh.state.boardFinal === true && boardStep(view(bh.state)) === "reveal", "board: the final question leads to the podium");
  await showBoard();
  ok(boardView(view(bh.state)) === "podium", "board: the podium at the very end");

  // ---------------------------------------------------------------------------------------------------------------------
  // Two screens (two browser tabs) sending the same step: it moves once.
  const twoDeck = [{ type: "slide", question: "Hi" }, { type: "choice", question: "Topic?", options: ["X", "Y"], topics: true }, quiz("X1", 0), quiz("X2", 0), quiz("Y1", 1)];
  const two = await create({ title: "Two", questions: twoDeck, names: true });
  const s1 = await socket(two.data.code, `?key=${two.data.hostKey}`);
  const s2 = await socket(two.data.code, `?key=${two.data.hostKey}`);
  await Promise.all([s1.send({ type: "step", dir: 1, from: 0 }), s2.send({ type: "step", dir: 1, from: 0 })]);
  await wait(300);
  ok(s1.state.index === 1 && s2.state.index === 1, "two screens: the same step from the slide moves once");
  await s1.send({ type: "pick", topic: 0 });
  await Promise.all([s1.send({ type: "step", dir: 1, from: 1 }), s2.send({ type: "step", dir: 1, from: 1 })]);
  await wait(300);
  ok(s1.state.index === 2 && s1.state.topics.order.join() === "0", "two screens: the round starts once");
  await Promise.all([s1.send({ type: "step", dir: 1, from: 2 }), s2.send({ type: "step", dir: 1, from: 2 })]);
  await wait(300);
  ok(s2.state.index === 3, "two screens: then one question at a time");

  // ---------------------------------------------------------------------------------------------------------------------
  // ← back through two rounds: the topic chosen for the next round, already answered, is never dropped.
  // A screen behind (`from` another question) neither closes the vote nor chooses.
  const backDeck = [{ type: "choice", question: "Topic?", options: ["A", "B", "C"], topics: true }, quiz("A1", 0), quiz("A2", 0), quiz("B1", 1), quiz("C1", 2)];
  const bk = await create({ title: "Back", questions: backDeck, names: true, boardMode: "round" });
  const kh = await socket(bk.data.code, `?key=${bk.data.hostKey}`);
  const kp = await socket(bk.data.code, "?voter=k1");
  await kp.send({ type: "name", voter: "k1", name: "Kim" });
  const kr = kh.state.round;
  await kp.send({ type: "vote", voter: "k1", option: 2, index: 0, round: kr, pass: 1 });
  await kh.until((s) => s.answered === 1);
  await kh.send({ type: "pick", from: 3 });
  await kh.send({ type: "pick", topic: 1, from: 2 });
  await wait(200);
  ok(kh.state.topics.chosen === null, "behind: a pick sent from another question does nothing");
  await kh.send({ type: "pick", topic: 0, from: 0 });
  for (const [from, to] of [[0, 1], [1, 2], [2, 0]]) {
    kh.send({ type: "step", dir: 1, from });
    await kh.until((s) => s.index === to);
  }
  await kh.send({ type: "pick", topic: 1, from: 0 });
  kh.send({ type: "step", dir: 1, from: 0 });
  await kh.until((s) => s.index === 3);
  await kp.send({ type: "vote", voter: "k1", option: 0, index: 3, round: kr });
  for (const [from, to] of [[3, 0], [0, 2], [2, 1], [1, 0]]) {
    kh.send({ type: "step", dir: -1, from });
    await kh.until((s) => s.index === to);
  }
  ok(kh.state.index === 0 && kh.state.topics.order.join() === "0" && kh.state.topics.chosen === 1 && kh.state.topics.locked, "back twice: round 1 stays played, B stays chosen and locked");
  await kh.send({ type: "goto", index: 1 });
  await kh.until((s) => s.index === 1);
  await kh.send({ type: "goto", index: 0 });
  await kh.until((s) => s.index === 0);
  await kh.send({ type: "pick", topic: 2, from: 0 });
  await wait(200);
  ok(kh.state.topics.order.join() === "0" && kh.state.topics.chosen === 1, "back twice: the dots keep it too, and no other topic replaces B");
  kh.send({ type: "step", dir: 1, from: 0 });
  ok(await kh.until((s) => s.index === 3 && s.topics.order.join() === "0,1"), "back twice: → goes on with B");
  const bkResults = await read(bk.data.code);
  ok(bkResults.rounds.notPlayed.join() === "2" && bkResults.questions[3].answered === 1, "back twice: the results keep B played with its answer");
  ok(bkResults.questions[0].answered === 1 && bkResults.questions[0].counts.join() === "0,0,1", "results: the picker keeps the room's vote after its round started");

  const listed = (await call("/api/polls")).data.polls?.find((p) => p.code === v.data.code);
  ok(listed?.kinds?.includes("topics") && listed.kinds.includes("quiz"), "the presentations list names the picker");
} catch (err) {
  ok(false, `crashed: ${err?.stack ?? err}`);
} finally {
  for (const s of sockets) s.ws.close();
  if (cookie) await call("/api/account", { method: "DELETE", body: { confirm: "DELETE" } });
  if (userId) ok(!sql(`SELECT id FROM users WHERE id = '${userId}'`).length, "test account deleted");
}
console.log(failures ? `\n${failures} check(s) failed` : "\nAll topic rounds checks passed");
process.exit(failures ? 1 : 0);
