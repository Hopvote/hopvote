// Local check of answers, uploads and accounts: phones learn whether an answer counted, answers for another question or
// from before a reset are refused, posts sent twice show once, odd phone numbers no longer lose a contact, a quiz timer
// left behind still reveals, blank quiz options keep the right answer, unused images are cleaned, and sign-up
// emails are capped.
// Dev server only (npx vite --port 5180). Run: node scripts/answers-test.mjs
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const BASE = "http://localhost:5180";
const WS = BASE.replace(/^http/, "ws");
let cookie = "";
let failures = 0;
const ok = (cond, label) => {
  console.log(`${cond ? "✓" : "✗"} ${label}`);
  if (!cond) failures++;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const sql = (command) => JSON.parse(execFileSync("npx", ["wrangler", "d1", "execute", "hopvote-db", "--local", "--json", "--command", command], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }))[0]?.results ?? [];

async function call(path, { method = "GET", body, raw, type } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(body ? { "content-type": "application/json" } : {}), ...(type ? { "content-type": type } : {}), ...(cookie ? { cookie } : {}), origin: BASE, connection: "close" },
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  const text = await res.text();
  let data = text;
  try {
    data = JSON.parse(text);
  } catch {}
  return { status: res.status, data };
}

// A socket that keeps the last state and answers each sent message with the room's ack.
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
    // Resolves with the ack (true or false), or null when none comes.
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

const email = `answers-${crypto.randomUUID().slice(0, 8)}@hopvote.test`;
let userId = "";
try {
  const pending = await call("/api/auth/signup", { method: "POST", body: { name: "Answers", email, password: crypto.randomUUID() } });
  await call("/api/auth/verify", { method: "POST", body: { token: pending.data?.devToken } });
  userId = sql(`SELECT id FROM users WHERE email = '${email}'`)[0]?.id;
  ok(!!userId, "test account created");

  // Blank quiz options keep the right answer on the same option.
  const quiz = await call("/api/rooms", {
    method: "POST",
    body: { title: "Blank option", questions: [{ type: "choice", question: "Capital of France?", options: ["London", "", "Paris", "Rome"], correct: 2 }] },
  });
  const quizResults = await call(`/api/polls/${quiz.data.code}`);
  const q0 = quizResults.data.questions?.[0];
  ok(q0?.options?.join() === "London,Paris,Rome" && q0?.correct === 1, "blank option dropped, right answer still Paris");
  const blankRight = await call("/api/rooms", {
    method: "POST",
    body: { title: "Blank right", questions: [{ type: "choice", question: "Pick", options: ["A", "", "C"], correct: 1 }] },
  });
  ok(blankRight.status === 400, "a right answer on an empty option is refused with a message");

  const made = await call("/api/rooms", {
    method: "POST",
    body: {
      title: "Answers test",
      questions: [
        { type: "choice", question: "One?", options: ["A", "B"] },
        { type: "open", question: "Say something", options: [] },
        { type: "contact", question: "Your details", options: [], fields: ["email", "phone"] },
        { type: "choice", question: "Quiz 1", options: ["X", "Y"], correct: 0, timer: 10 },
        { type: "choice", question: "Quiz 2", options: ["X", "Y"], correct: 1, timer: 60 },
      ],
    },
  });
  const code = made.data.code;
  const { data: host } = await call(`/api/polls/${code}/host`);
  const presenter = await socket(code, `?key=${host.hostKey}`);
  const voter = crypto.randomUUID();
  const phone = await socket(code, `?voter=${voter}`);
  await phone.until((s) => s.index === 0);
  const round0 = phone.state.round;

  ok((await phone.send({ type: "vote", voter, option: 1, index: 0, round: round0 })) === true, "a counted vote is acked ok");
  ok((await phone.send({ type: "vote", voter, option: 1, index: 0, round: round0 })) === true, "the same vote again is acked ok, not counted twice");
  ok((await phone.send({ type: "vote", voter, option: 0, index: 1, round: round0 })) === false, "a vote for another question is refused");
  await presenter.send({ type: "lock", on: true });
  ok((await phone.send({ type: "vote", voter, option: 0, index: 0, round: round0 })) === false, "a vote while paused is refused");
  await presenter.send({ type: "lock", on: false });
  ok((await phone.send({ type: "vote", voter, option: 0 })) === true, "a phone on the old code (no index) still votes");
  const r1 = await call(`/api/polls/${code}`);
  ok(r1.data.questions[0].counts.join() === "1,0" && r1.data.questions[0].answered === 1, "one person, one vote");

  // Open text: the same post id twice shows once.
  await presenter.send({ type: "goto", index: 1 });
  await phone.until((s) => s.index === 1);
  const id = "abc123def456";
  ok((await phone.send({ type: "answer", voter, text: "Hello", id, index: 1, round: round0 })) === true, "an open answer is acked");
  ok((await phone.send({ type: "answer", voter, text: "Hello", id, index: 1, round: round0 })) === true, "sent again after a drop: acked");
  await wait(300);
  const r2 = await call(`/api/polls/${code}`);
  ok(r2.data.questions[1].answers.length === 1, "the post shows once");

  // Contact: an odd phone number is left out, the email is kept.
  await presenter.send({ type: "goto", index: 2 });
  await phone.until((s) => s.index === 2);
  ok((await phone.send({ type: "contact", voter, data: { email: "ana@example.com", phone: "call me maybe" }, consent: true, index: 2, round: round0 })) === true, "contact with an odd phone number is accepted");
  const r3 = await call(`/api/polls/${code}`);
  const contact = r3.data.questions[2].contacts?.[0];
  ok(contact?.email === "ana@example.com" && !contact.phone, "email kept, odd phone left out");
  ok((await phone.send({ type: "contact", voter, data: { email: "ana@example.com", phone: "0171/1234567 ext 12" }, consent: true, index: 2, round: round0 })) === true, "German-style phone with extension accepted");
  const r3b = await call(`/api/polls/${code}`);
  ok(r3b.data.questions[2].contacts?.[0]?.phone === "0171/1234567 ext 12", "that phone number is kept");

  // Quiz timer left behind: start quiz 1 (10 s), move on and start quiz 2 (60 s). Quiz 1 still reveals.
  await presenter.send({ type: "goto", index: 3 });
  await phone.until((s) => s.index === 3);
  await presenter.send({ type: "start" });
  await wait(300);
  await presenter.send({ type: "goto", index: 4 });
  await phone.until((s) => s.index === 4);
  await presenter.send({ type: "start" });
  await wait(11_500);
  await presenter.send({ type: "goto", index: 3 });
  ok(await phone.until((s) => s.index === 3 && s.revealed), "quiz 1 revealed even though the presenter had moved on");
  await presenter.send({ type: "goto", index: 4 });
  ok(await phone.until((s) => s.index === 4 && !s.revealed && !!s.startedAt), "quiz 2 still running");

  // Reset: a new round, and answers from before it are refused.
  ok((await call(`/api/polls/${code}/reset`, { method: "POST" })).status === 200, "reset answers");
  ok(await phone.until((s) => s.round !== round0 && s.index === 0), "phones get a new round");
  const round1 = phone.state.round;
  ok((await phone.send({ type: "vote", voter, option: 1, index: 0, round: round0 })) === false, "a vote from before the reset is refused");
  ok((await phone.send({ type: "vote", voter, option: 1, index: 0, round: round1 })) === true, "a vote in the new round counts");

  // Many phones at once: no vote lost.
  const phones = await Promise.all(Array.from({ length: 40 }, async () => {
    const v = crypto.randomUUID();
    return { v, s: await socket(code, `?voter=${v}`) };
  }));
  await Promise.all(phones.map(({ v, s }) => s.until((st) => st.index === 0).then(() => s.send({ type: "vote", voter: v, option: 0, index: 0, round: round1 }))));
  await wait(500);
  const r4 = await call(`/api/polls/${code}`);
  ok(r4.data.questions[0].counts.join() === "40,1" && r4.data.questions[0].answered === 41, `41 votes at once all counted (${r4.data.questions[0].counts.join()})`);
  phones.forEach(({ s }) => s.ws.close());

  // An edit that keeps the questions keeps the answers; a hidden post leaves the count.
  const before = await call(`/api/polls/${code}`);
  const kept = await call(`/api/polls/${code}`, {
    method: "PUT",
    body: { title: "Renamed", questions: before.data.questions.map(({ type, question, options, correct, timer, fields }) => ({ type, question, options, correct, timer, fields })) },
  });
  const afterRename = await call(`/api/polls/${code}`);
  ok(kept.status === 200 && afterRename.data.title === "Renamed" && afterRename.data.questions[0].answered === before.data.questions[0].answered, "a new title keeps the answers");
  await presenter.send({ type: "goto", index: 1 });
  await phone.until((s) => s.index === 1);
  await phone.send({ type: "answer", voter, text: "Spam", id: "spam00000001", index: 1, round: phone.state.round });
  await wait(300);
  const wall = (await call(`/api/polls/${code}`)).data.questions[1];
  const spam = presenter.state.answers.find((a) => a.text === "Spam");
  if (spam) await presenter.send({ type: "hide", id: spam.id });
  await wait(300);
  const hiddenWall = (await call(`/api/polls/${code}`)).data.questions[1];
  ok(!!spam && hiddenWall.answered === wall.answered - 1, "a hidden answer is not counted any more");

  // Screens learn the phones' languages; a name sent again during a quiz, without a language, keeps it.
  await phone.send({ type: "name", voter, name: "", lang: "de" });
  ok(await presenter.until((s) => s.langs?.join() === "de"), "the screen learns the phone reads German");
  await phone.send({ type: "name", voter, name: "Ana" });
  await wait(300);
  ok(presenter.state.langs?.join() === "de", "a name without a language keeps German");

  // Translated answers only for the question on screen: other questions' answers stay with the owner.
  await presenter.send({ type: "goto", index: 0 });
  await phone.until((s) => s.index === 0);
  const offScreen = await call(`/api/rooms/${code}/posts?lang=fr&i=1`);
  ok(offScreen.status === 200 && Object.keys(offScreen.data).length === 0, "answers of a question not on screen are not given out");
  await presenter.send({ type: "goto", index: 1 });
  await phone.until((s) => s.index === 1);
  // Nor into a language no phone here reads (anyone with the code could ask for all 35 and spend the room's AI budget).
  const budgetDay = new Date().toISOString().slice(0, 10);
  const spentBefore = sql(`SELECT neurons FROM ai_budget WHERE day = '${budgetDay}'`)[0]?.neurons ?? 0;
  const unread = await Promise.all(["ja", "ko", "th"].map((lang) => call(`/api/rooms/${code}/posts?lang=${lang}&i=1`)));
  ok(unread.every((r) => r.status === 200 && Object.keys(r.data).length === 0) && (sql(`SELECT neurons FROM ai_budget WHERE day = '${budgetDay}'`)[0]?.neurons ?? 0) === spentBefore, "answers are not translated into languages no phone here reads");

  // A new results style for a rating keeps its answers.
  const rating = await call("/api/rooms", { method: "POST", body: { title: "Rating style", questions: [{ type: "scale", question: "How was it?", options: [], max: 5 }] } });
  const ratingPhone = await socket(rating.data.code, `?voter=${voter}`);
  await ratingPhone.until((s) => s.index === 0);
  await ratingPhone.send({ type: "vote", voter, option: 3, index: 0, round: ratingPhone.state.round });
  const restyled = await call(`/api/polls/${rating.data.code}`, { method: "PUT", body: { title: "Rating style", questions: [{ type: "scale", question: "How was it?", options: [], max: 5, style: "dots" }] } });
  ok(restyled.status === 200 && (await ratingPhone.until((s) => s.style === "dots")), "the rating shows the new style");
  ok((await call(`/api/polls/${rating.data.code}`)).data.questions[0].answered === 1, "a new results style keeps the answers");
  ratingPhone.ws.close();

  // Deleting the presentation tells open screens.
  let closedWith = 0;
  phone.ws.onclose = (e) => (closedWith = e.code);
  await call(`/api/polls/${code}`, { method: "DELETE" });
  await wait(500);
  ok(closedWith === 4404, "phones learn the presentation was deleted");
  presenter.ws.close();

  // Images: unused ones older than a week go in the daily cleanup, used ones stay.
  const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
  const fake = await call("/api/images", { method: "POST", raw: new TextEncoder().encode("<script>alert(1)</script>"), type: "image/png" });
  ok(fake.status === 415, "a text file sent as an image is refused");
  const used = (await call("/api/images", { method: "POST", raw: png, type: "image/png" })).data.url;
  const unused = (await call("/api/images", { method: "POST", raw: png, type: "image/png" })).data.url;
  await call("/api/rooms", { method: "POST", body: { title: "With image", questions: [{ type: "choice", question: "Pic?", options: ["A", "B"], image: used }] } });
  const old = Date.now() - 8 * 86_400_000;
  sql(`UPDATE images SET created_at = ${old} WHERE user_id = '${userId}'`);
  await fetch(`${BASE}/cdn-cgi/handler/scheduled?cron=23+3+*+*+*`, { headers: { connection: "close" } });
  await wait(2000);
  const left = sql(`SELECT id FROM images WHERE user_id = '${userId}'`).map((r) => r.id);
  ok(left.includes(used.split("/").pop()) && !left.includes(unused.split("/").pop()), "daily cleanup removed the unused image and kept the used one");

  // First names on the big screen: no links, no hidden characters, and the presenter can take one off for good.
  for (const p of sql(`SELECT code FROM polls WHERE user_id = '${userId}'`)) await call(`/api/polls/${p.code}`, { method: "DELETE" });
  const named = await call("/api/rooms", { method: "POST", body: { title: "Names", names: true, questions: [{ type: "choice", question: "Ready?", options: ["Yes", "No"] }] } });
  const screen = await socket(named.data.code, `?key=${named.data.hostKey}`);
  const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  const guests = await Promise.all(ids.map((v) => socket(named.data.code, `?voter=${v}`)));
  await guests[0].send({ type: "name", voter: ids[0], name: "go to www.spam.com" });
  await guests[1].send({ type: "name", voter: ids[1], name: "Ana\u202e\u0007" });
  await guests[2].send({ type: "name", voter: ids[2], name: "Troll" });
  ok(await screen.until((s) => s.people.some((p) => p.name === "Ana") && s.people.some((p) => p.name === "Troll")), "plain names show, cleaned of hidden characters");
  ok(!screen.state.people.some((p) => /spam/.test(p.name)), "a name with a link does not show");
  ok(guests[0].state.people.every((p) => !p.tag) && screen.state.people.every((p) => !p.name || p.tag), "only the presenter's screen gets the tags to remove a name");
  await screen.send({ type: "unname", tag: screen.state.people.find((p) => p.name === "Troll").tag });
  ok(await screen.until((s) => !s.people.some((p) => p.name === "Troll")), "the presenter takes a name off the screen");
  await guests[2].send({ type: "name", voter: ids[2], name: "Troll" });
  await wait(400);
  ok(!screen.state.people.some((p) => p.name === "Troll") && screen.state.people.some((p) => p.name === "Ana"), "the name does not come back, the others stay");
  ok((await guests[1].send({ type: "unname", tag: "x" })) === false, "a phone cannot remove names");
  // Names that dress up an insult or a link: plurals, letters spaced out, look-alike letters, other dots and endings.
  const rude = ["fucks", "shitty", "f u c k", "\u0441unt", "niggers", "evil\uff0ecom", "evil.tv", "x.ai", "f*ck", "fu\u200dck", "fu ck", "motherfucker", "bit.ly/x"];
  const rudeIds = rude.map(() => crypto.randomUUID());
  const rudeGuests = await Promise.all(rudeIds.map((v) => socket(named.data.code, `?voter=${v}`)));
  await Promise.all(rudeGuests.map((g, i) => g.send({ type: "name", voter: rudeIds[i], name: rude[i] })));
  await rudeGuests[0].send({ type: "name", voter: rudeIds[0], name: "fucks" });
  // Real names that look like an insult or an address: initials, titles, surnames.
  const real = ["Shital", "J. Smith", "Dr.House", "T.J. Miller", "Niggli", "Slutsky", "Dick", "Couillard", "Jan De Cock", "J.De Vries", "Salopek", "Team.IT"];
  const realIds = real.map(() => crypto.randomUUID());
  const realGuests = await Promise.all(realIds.map((v) => socket(named.data.code, `?voter=${v}`)));
  await Promise.all(realGuests.map((g, i) => g.send({ type: "name", voter: realIds[i], name: real[i] })));
  ok(await screen.until((s) => real.every((n) => s.people.some((p) => p.name === n))), `real first names close to an insult or an address still show (${screen.state.people.map((p) => p.name).filter(Boolean).join(", ")})`);
  ok(!screen.state.people.some((p) => rude.includes(p.name)), `insults and links in disguise do not show (${screen.state.people.map((p) => p.name).filter(Boolean).join(", ")})`);
  [...rudeGuests, ...realGuests].forEach((c) => c.ws.close());

  // Floods: one phone sending far more than a person taps is cut, then answers again a moment later.
  await guests[1].until((s) => s.index === 0);
  const flood = await Promise.all(Array.from({ length: 90 }, (_, i) => guests[1].send({ type: "vote", voter: ids[1], option: i % 2, index: 0, round: guests[1].state.round })));
  ok(flood.filter((a) => a === false).length >= 20 && flood.filter((a) => a === true).length >= 50, `a flood from one socket is cut (${flood.filter((a) => a === false).length} of 90 refused)`);
  await wait(1500);
  ok((await guests[1].send({ type: "vote", voter: ids[1], option: 0, index: 0, round: guests[1].state.round })) === true, "the phone votes again a moment later");
  ok((await screen.send({ type: "lock", on: false })) === true, "the presenter's screen is not slowed by the phones");
  [screen, ...guests].forEach((c) => c.ws.close());

  // Phones read the question on screen, the ones next to it and those already shown, never a question further on.
  const deck = await call("/api/rooms", { method: "POST", body: { title: "Ahead", lang: "en", questions: ["A", "B", "C", "D", "E"].map((n) => ({ type: "choice", question: `Question ${n}?`, options: ["1", "2"] })) } });
  const at = (i) => call(`/api/rooms/${deck.data.code}/translate?lang=en&i=${i}`).then((r) => r.status);
  ok((await at(0)) === 200 && (await at(1)) === 200 && (await at(3)) === 404, "on question 1: questions 1 and 2 readable, question 4 not");
  const driver = await socket(deck.data.code, `?key=${deck.data.hostKey}`);
  await driver.send({ type: "goto", index: 3 });
  ok((await at(3)) === 200 && (await at(4)) === 200 && (await at(0)) === 200, "on question 4: questions 4 and 5 readable, and question 1 already shown");
  ok((await at(1)) === 404, "question 2, skipped, stays private");
  await call(`/api/polls/${deck.data.code}/reset`, { method: "POST" });
  ok((await at(3)) === 404, "after a reset, questions shown before are private again");
  driver.ws.close();

  // An address walking the code space: past a minute's count of unknown codes, its unknown codes stop at the worker,
  // while a room it already reached still answers.
  const walker = { "CF-Connecting-IP": `10.${Math.floor(Math.random() * 250)}.7.7`, connection: "close" };
  await fetch(`${BASE}/api/rooms/${deck.data.code}/info`, { headers: walker });
  const misses = [];
  for (let i = 0; i < 70; i++) misses.push((await fetch(`${BASE}/api/rooms/L${String(i).padStart(4, "0")}/info`, { headers: walker })).status);
  ok(misses.slice(0, 50).every((s) => s === 404) && misses.slice(-5).every((s) => s === 429), `unknown codes from one address are cut after a minute's count (${misses.filter((s) => s === 429).length} cut)`);
  ok((await fetch(`${BASE}/api/rooms/${deck.data.code}/info`, { headers: walker })).status === 200, "a room that address already reached still answers");
  ok((await fetch(`${BASE}/api/rooms/L9999/info`, { headers: { connection: "close" } })).status === 404, "other addresses are not affected");
  // IPv6: every address of one /64 counts as one.
  const prefix = `2001:db8:${Math.floor(Math.random() * 60000).toString(16)}:${Math.floor(Math.random() * 60000).toString(16)}`;
  const v6 = [];
  for (let i = 0; i < 70; i++) v6.push((await fetch(`${BASE}/api/rooms/N${String(i).padStart(4, "0")}/info`, { headers: { "CF-Connecting-IP": `${prefix}::${(i + 1).toString(16)}`, connection: "close" } })).status);
  ok(v6.slice(-5).every((s) => s === 429), `unknown codes from many addresses of one IPv6 /64 are cut (${v6.filter((s) => s === 429).length} cut)`);
  // A hall mistyping the same code again and again is not a walk: the same wrong code counts once a minute.
  const hall = { "CF-Connecting-IP": `10.${Math.floor(Math.random() * 250)}.9.9`, connection: "close" };
  const typos = [];
  for (let i = 0; i < 80; i++) typos.push((await fetch(`${BASE}/api/rooms/TYP0${i % 3}/info`, { headers: hall })).status);
  ok(typos.every((s) => s === 404), "a hall typing the same few wrong codes is never cut");

  // Sign-up emails: at most 3 a day to one address.
  const target = `limit-${crypto.randomUUID().slice(0, 6)}@hopvote.test`;
  const sends = [];
  for (let i = 0; i < 4; i++) sends.push((await call("/api/auth/signup", { method: "POST", body: { name: "Limit", email: target, password: crypto.randomUUID() } })).data);
  ok(sends.slice(0, 3).every((d) => d.devToken) && sends[3].pending && !sends[3].devToken, "a 4th sign-up email to the same address is not sent");
  ok(sql(`SELECT COUNT(*) AS n FROM pending_signups WHERE email = '${target}'`)[0].n === 1, "only the newest sign-up link is kept");
  const firstLink = await call("/api/auth/verify", { method: "POST", body: { token: sends[0].devToken } });
  ok(firstLink.status === 400, "an older sign-up link no longer works");
  sql(`DELETE FROM pending_signups WHERE email = '${target}'`);
  ok(sql(`SELECT pass_salt FROM users WHERE id = '${userId}'`)[0]?.pass_salt.startsWith("v:"), "a password set through the emailed link is marked as proven");

  // The day's emails: sign-ups stop first, password resets and team invitations still go out.
  const day = new Date().toISOString().slice(0, 10);
  const sentToday = sql(`SELECT n FROM ops_daily WHERE day = '${day}' AND key = 'emails'`)[0]?.n;
  sql(`INSERT INTO ops_daily (day, key, n) VALUES ('${day}', 'emails', 60) ON CONFLICT(day, key) DO UPDATE SET n = 60`);
  const drained = await call("/api/auth/signup", { method: "POST", body: { name: "Late", email: `late-${crypto.randomUUID().slice(0, 6)}@hopvote.test`, password: crypto.randomUUID() } });
  ok(drained.status === 400 && /busy/.test(drained.data.error), "60 emails sent today: sign-ups wait for tomorrow");
  const reset = await call("/api/auth/forgot", { method: "POST", body: { email } });
  ok(reset.status === 200 && sql(`SELECT COUNT(*) AS n FROM reset_tokens WHERE user_id = '${userId}'`)[0]?.n === 1, "but a password reset still goes out");
  sql(sentToday === undefined ? `DELETE FROM ops_daily WHERE day = '${day}' AND key = 'emails'` : `UPDATE ops_daily SET n = ${sentToday} WHERE day = '${day}' AND key = 'emails'`);
  // Each email's place is taken before it is sent: forms sent together cannot pass a count that grows only once they
  // are sent. 60 places taken today (none sent yet): sign-ups wait, resets still go out.
  const heldToday = sql(`SELECT n FROM ops_daily WHERE day = '${day}' AND key = 'mail-held'`)[0]?.n;
  sql(`INSERT INTO ops_daily (day, key, n) VALUES ('${day}', 'mail-held', 60) ON CONFLICT(day, key) DO UPDATE SET n = 60`);
  const heldOut = await call("/api/auth/signup", { method: "POST", body: { name: "Late", email: `late-${crypto.randomUUID().slice(0, 6)}@hopvote.test`, password: crypto.randomUUID() } });
  ok(heldOut.status === 400 && /busy/.test(heldOut.data.error), "60 emails on their way today: sign-ups wait for tomorrow");
  sql(`DELETE FROM reset_tokens WHERE user_id = '${userId}'`);
  const heldReset = await call("/api/auth/forgot", { method: "POST", body: { email } });
  ok(heldReset.status === 200 && sql(`SELECT COUNT(*) AS n FROM reset_tokens WHERE user_id = '${userId}'`)[0]?.n === 1, "but a password reset still goes out");
  sql(heldToday === undefined ? `DELETE FROM ops_daily WHERE day = '${day}' AND key = 'mail-held'` : `UPDATE ops_daily SET n = ${heldToday} WHERE day = '${day}' AND key = 'mail-held'`);

  // Password guessing: past 10 wrong tries in the hour, the account takes one try a minute, except in a browser
  // that signed in to it before. Started away from the end of a minute and of an hour, so the counts hold.
  while (new Date().getUTCSeconds() > 40 || new Date().getUTCMinutes() === 59) await wait(1000);
  const guessed = `guess-${crypto.randomUUID().slice(0, 6)}@hopvote.test`;
  const password = crypto.randomUUID();
  const guessAccount = await fetch(`${BASE}/api/auth/signup`, { method: "POST", headers: { "content-type": "application/json", origin: BASE, connection: "close" }, body: JSON.stringify({ name: "Guess", email: guessed, password }) }).then((r) => r.json());
  await fetch(`${BASE}/api/auth/verify`, { method: "POST", headers: { "content-type": "application/json", origin: BASE, connection: "close" }, body: JSON.stringify({ token: guessAccount.devToken }) });
  const login = (pass, extra = "") =>
    fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json", origin: BASE, connection: "close", ...(extra ? { cookie: extra } : {}) }, body: JSON.stringify({ email: guessed, password: pass }) });
  const first = await login(password);
  const known = first.headers.getSetCookie().find((c) => c.startsWith("hv_known="))?.split(";")[0];
  const session = first.headers.getSetCookie().find((c) => c.startsWith("hv_session="))?.split(";")[0];
  ok(first.status === 200 && !!known, "a sign-in marks this browser as known");
  const wrong = [];
  for (let i = 0; i < 10; i++) wrong.push((await login("wrong-password")).status);
  ok(wrong.every((s) => s === 401), "10 wrong passwords are refused as usual");
  const slow = [(await login("wrong-password")).status, (await login("wrong-password")).status];
  ok(slow[0] === 401 && slow[1] === 429, "then one try a minute for this account");
  ok((await login(password, known)).status === 200, "the owner's own browser still signs in at once");
  ok((await login(password)).status === 429, "another browser waits for the next minute");
  ok(sql(`SELECT COUNT(*) AS n FROM users WHERE email = '${guessed}'`)[0]?.n === 1, "nothing locks or changes the account");
  // Wrong passwords sent all at once, each from another address: every try is counted before its password is checked,
  // so no more than the 10 of the hour (and the minute's one) are checked.
  const tag0 = createHash("sha256").update(`login:${guessed}`).digest("base64").slice(0, 16);
  sql(`DELETE FROM ops_daily WHERE key LIKE 'login-%:${tag0}:%'`);
  const guesses = await Promise.all(
    Array.from({ length: 40 }, (_, i) =>
      fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json", origin: BASE, connection: "close", "CF-Connecting-IP": `10.77.${i}.${Math.floor(Math.random() * 250)}` }, body: JSON.stringify({ email: guessed, password: `wrong-${i}` }) }).then((r) => r.status),
    ),
  );
  ok(guesses.filter((s) => s === 401).length <= 11 && guesses.filter((s) => s === 429).length >= 29, `40 wrong passwords at once: ${guesses.filter((s) => s === 401).length} checked, the others wait`);
  await fetch(`${BASE}/api/account`, { method: "DELETE", headers: { "content-type": "application/json", origin: BASE, cookie: session, connection: "close" }, body: JSON.stringify({ confirm: "DELETE" }) });
  const tag = createHash("sha256").update(`login:${guessed}`).digest("base64").slice(0, 16);
  sql(`DELETE FROM ops_daily WHERE key LIKE 'login-%:${tag}:%'`);

  // "Continue with Google": the nonce comes from the server, tied to an HttpOnly cookie of this browser.
  const start = await fetch(`${BASE}/api/auth/google/start`, { headers: { connection: "close" } });
  if (start.status === 200) {
    const nonceCookie = start.headers.getSetCookie().find((c) => c.startsWith("hv_gnonce=")) ?? "";
    ok(/HttpOnly/.test(nonceCookie) && /^[\w-]{43}$/.test((await start.json()).nonce), "Google sign-in starts with a server nonce in an HttpOnly cookie");
    const forged = await fetch(`${BASE}/api/auth/google`, { method: "POST", headers: { "content-type": "application/json", origin: BASE, connection: "close" }, body: JSON.stringify({ credential: "a.b.c", nonce: "anything" }) });
    ok(forged.status === 401, "a token without that cookie is refused");
  }
} catch (err) {
  ok(false, `crashed: ${err?.stack ?? err}`);
} finally {
  const gone = await call("/api/account", { method: "DELETE", body: { confirm: "DELETE" } });
  ok(gone.status === 200, "test account deleted");
}
console.log(failures ? `\n${failures} check(s) failed` : "\nAll answer checks passed");
process.exit(failures ? 1 : 0);
