// End-to-end check of a live session: account, presentation, phones, presenter, slide view, results.
// Usage: node scripts/e2e.mjs [base URL]. Defaults to the local dev server; it creates and deletes a throwaway account.
const BASE = (process.argv[2] ?? "http://localhost:5180").replace(/\/$/, "");
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE) && process.env.E2E_ALLOW_REMOTE !== "1") {
  console.error("Refusing to create test accounts outside localhost. Set E2E_ALLOW_REMOTE=1 to override.");
  process.exit(2);
}
const WS = BASE.replace(/^http/, "ws");
let cookie = "";
let failures = 0;
const ok = (cond, label) => {
  console.log(`${cond ? "✓" : "✗"} ${label}`);
  if (!cond) failures++;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(path, { method = "GET", body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}), origin: BASE },
    body: body ? JSON.stringify(body) : undefined,
  });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  const text = await res.text();
  let data = text;
  try {
    data = JSON.parse(text);
  } catch {}
  return { status: res.status, data, headers: res.headers };
}

// A socket that remembers the last state it received and can wait for a condition on it.
function socket(query) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS}/api/rooms/${code}/ws${query}`);
    const client = { ws, state: null, full: false, listeners: [] };
    ws.onmessage = (e) => {
      if (e.data === "pong") return;
      const data = JSON.parse(e.data);
      if (data.type === "full") client.full = true;
      if (data.type === "state") client.state = data;
      client.listeners.forEach((f) => f());
    };
    client.send = (m) => ws.send(typeof m === "string" ? m : JSON.stringify(m));
    client.until = (pred, label, ms = 3000) =>
      new Promise((done) => {
        const check = () => {
          if (client.state && pred(client.state)) {
            clearTimeout(timer);
            client.listeners = client.listeners.filter((f) => f !== check);
            done(true);
          }
        };
        const timer = setTimeout(() => {
          client.listeners = client.listeners.filter((f) => f !== check);
          ok(false, `${label} (timed out)`);
          done(false);
        }, ms);
        client.listeners.push(check);
        check();
      }).then((hit) => hit && ok(true, label));
    ws.onopen = () => resolve(client);
    ws.onerror = reject;
  });
}

let code = "";
const email = `e2e-${crypto.randomUUID().slice(0, 8)}@hopvote.test`;
const password = crypto.randomUUID();

try {
  const health = await call("/api/health");
  ok(health.status === 200 && health.data.ok, "health check");

  const pending = await call("/api/auth/signup", { method: "POST", body: { name: "E2E", email, password } });
  ok(pending.status === 200 && !cookie, "signup waits for the email");
  const signup = await call("/api/auth/verify", { method: "POST", body: { token: pending.data?.devToken } });
  ok(signup.status === 200 && !!cookie, "confirming the email gives a session");

  const created = await call("/api/rooms", {
    method: "POST",
    body: {
      title: "E2E check",
      names: true,
      lang: "en",
      questions: [
        { type: "choice", question: "Pick one", options: ["A", "B", "C"] },
        { type: "words", question: "One word?", options: [] },
        { type: "open", question: "Say something", options: [] },
        { type: "rank", question: "Rank these", options: ["X", "Y", "Z"] },
        { type: "contact", question: "Your email", options: [], fields: ["email"] },
      ],
    },
  });
  code = created.data.code;
  ok(created.status === 200 && /^[A-Z0-9]{5}$/.test(code), `presentation created (${code})`);

  const six = await call("/api/rooms", { method: "POST", body: { questions: Array.from({ length: 6 }, (_, i) => ({ question: `Q${i}`, options: ["a", "b"] })) } });
  ok(six.status === 200, "a new account has every feature: 6 questions are fine");

  const notObject = await call("/api/rooms", { method: "POST", body: [1, 2] });
  ok(notObject.status === 400, "a JSON body that is not an object is refused");
  const hugeBody = await call("/api/rooms", { method: "POST", body: { question: "x".repeat(1_100_000), options: ["a", "b"] } });
  ok(hugeBody.status === 400, "a JSON body over 1 MB is refused");

  const { data: host } = await call(`/api/polls/${code}/host`);
  const presenter = await socket(`?key=${host.hostKey}`);
  await presenter.until((s) => s.question === "Pick one" && s.online === 0, "presenter connected, nobody counted yet");

  const viewer = await socket("?view=1");
  const phones = await Promise.all(["Ana", "Ben", "Chloé"].map((n, i) => socket(`?voter=e2e-voter-${i}`).then((p) => ((p.name = n), (p.id = `e2e-voter-${i}`), p))));
  await presenter.until((s) => s.online === 3, "three phones counted, the slide viewer is not");
  phones.forEach((p) => p.send({ type: "name", voter: p.id, name: p.name, avatar: "🦊" }));
  await presenter.until((s) => s.people.length === 3, "names show on the waiting screen");

  // Waiting screen: answers are refused until the presenter starts.
  presenter.send({ type: "lobby", on: true });
  await presenter.until((s) => s.lobby, "waiting screen on");
  phones[0].send({ type: "vote", voter: phones[0].id, option: 0 });
  await wait(500);
  ok(presenter.state.counts[0] === 0, "no answer counted on the waiting screen");
  ok(!presenter.state.free, "no Made with Hopvote line: every account has every feature");
  presenter.send({ type: "lobby", on: false });
  await presenter.until((s) => !s.lobby, "presenter starts");

  phones.forEach((p, i) => p.send({ type: "vote", voter: p.id, option: i === 2 ? 1 : 0 }));
  await presenter.until((s) => s.counts[0] === 2 && s.counts[1] === 1, "votes counted live");
  phones[2].send({ type: "vote", voter: phones[2].id, option: 0 });
  await presenter.until((s) => s.counts[0] === 3 && s.counts[1] === 0, "changing one's mind moves the vote");
  viewer.send({ type: "vote", voter: "intruder", option: 2 });
  viewer.send({ type: "goto", index: 3 });
  await wait(400);
  ok(presenter.state.counts[2] === 0 && presenter.state.index === 0, "the viewer can neither vote nor drive");
  phones[0].send("x".repeat(10_000));
  await wait(300);
  ok(phones[0].ws.readyState === WebSocket.OPEN, "an oversized message is ignored, the phone stays connected");

  // A phone cannot vote or name itself as another person.
  phones[0].send({ type: "name", voter: "e2e-fake", name: "Fake" });
  phones[0].send({ type: "vote", voter: "e2e-fake", option: 2 });
  await wait(400);
  ok(presenter.state.counts[2] === 0 && presenter.state.people.length === 3, "a phone cannot act as another voter");

  presenter.send({ type: "lock", on: true });
  await phones[0].until((s) => s.locked, "pausing voting reaches the phones");
  phones[0].send({ type: "vote", voter: phones[0].id, option: 2 });
  await wait(400);
  ok(presenter.state.counts[2] === 0, "no vote counted while voting is paused");
  phones[0].send({ type: "lock", on: false });
  await wait(300);
  ok(presenter.state.locked === true, "a phone cannot resume voting");
  presenter.send({ type: "lock", on: false });
  await phones[0].until((s) => !s.locked, "resuming voting reaches the phones");

  // A reset starts the presentation over, including the pause.
  presenter.send({ type: "lock", on: true });
  await phones[0].until((s) => s.locked, "voting paused again");
  const reset = await call(`/api/polls/${code}/reset`, { method: "POST" });
  ok(reset.status === 200, "reset answers");
  await phones[0].until((s) => !s.locked, "a reset also lifts the pause");

  presenter.send({ type: "goto", index: 1 });
  await phones[0].until((s) => s.index === 1, "phones follow the presenter");
  phones.forEach((p) => p.send({ type: "words", voter: p.id, words: ["Energy", "team"] }));
  await presenter.until((s) => s.words.some(([w, n]) => w === "energy" && n === 3), "word cloud counts words");

  presenter.send({ type: "goto", index: 2 });
  await phones[1].until((s) => s.index === 2, "open text question");
  phones[1].send({ type: "answer", voter: phones[1].id, text: "Great session" });
  await presenter.until((s) => s.answers.length === 1, "open answer arrives");

  presenter.send({ type: "goto", index: 3 });
  await phones[0].until((s) => s.index === 3, "ranking question");
  phones[0].send({ type: "rank", voter: phones[0].id, order: [2, 0, 1] });
  await presenter.until((s) => s.answered === 1, "ranking counted");

  presenter.send({ type: "goto", index: 4 });
  await phones[0].until((s) => s.index === 4, "contact question");
  phones[0].send({ type: "contact", voter: phones[0].id, consent: true, data: { email: "ana@example.com" } });
  await presenter.until((s) => s.answered === 1, "contact received");

  const results = await call(`/api/polls/${code}`);
  ok(results.data.questions[4].contacts.length === 1, "owner sees the contact");
  const byKey = await call(`/api/rooms/${code}/results?key=${host.hostKey}`);
  ok(byKey.status === 200 && byKey.data.questions.every((q) => q.contacts.length === 0), "results by key never include contacts");

  const brand = await call(`/api/rooms/${code}/brand`);
  ok(brand.status === 200 && brand.data.brand === null, "a presentation without a brand shows none");
  const tr = await call(`/api/rooms/${code}/translate?lang=fr&i=0`);
  ok(tr.status === 200 && tr.data.from === "en", "translation knows the source language");

  for (const p of [...phones, viewer, presenter]) p.ws.close();

  let limited = false;
  for (let i = 0; i < 25 && !limited; i++) {
    const r = await call("/api/auth/login", { method: "POST", body: { email: "nobody@hopvote.test", password: "wrong-password" } });
    limited = r.status === 429;
  }
  ok(limited, "repeated sign-in attempts are rate limited");
} catch (err) {
  ok(false, `unexpected error: ${err?.stack ?? err}`);
} finally {
  if (cookie) {
    const gone = await call("/api/account", { method: "DELETE", body: { confirm: "DELETE" } });
    ok(gone.status === 200, "test account deleted");
  }
}

console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
