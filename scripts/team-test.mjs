// Local check of teams and the launch animation: invitations, shared presentations, teammates editing at once, who may
// delete, seats, removal, leaving, and the launch that plays once.
// Dev server only (npx vite --port 5180). Run: node scripts/team-test.mjs
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

// One signed-in person: their own cookie.
function person() {
  const me = { cookie: "" };
  me.call = async (path, { method = "GET", body } = {}) => {
    const res = await fetch(BASE + path, {
      method,
      headers: { ...(body ? { "content-type": "application/json" } : {}), ...(me.cookie ? { cookie: me.cookie } : {}), origin: BASE, connection: "close" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get("set-cookie");
    if (set) me.cookie = set.split(";")[0];
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  };
  me.signup = async (name) => {
    me.email = `team-${name.toLowerCase()}-${crypto.randomUUID().slice(0, 6)}@hopvote.test`;
    const pending = await me.call("/api/auth/signup", { method: "POST", body: { name, email: me.email, password: crypto.randomUUID() } });
    await me.call("/api/auth/verify", { method: "POST", body: { token: pending.data?.devToken } });
    me.id = sql(`SELECT id FROM users WHERE email = '${me.email}'`)[0]?.id;
    return me;
  };
  return me;
}

function socket(code, query) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS}/api/rooms/${code}/ws${query}`);
    const client = { ws, state: null, ref: 1 };
    ws.onmessage = (e) => {
      if (e.data === "pong") return;
      const data = JSON.parse(e.data);
      if (data.type === "state") client.state = data;
    };
    client.send = (m) => ws.send(JSON.stringify({ ...m, ref: client.ref++ }));
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

// What the room does with a key: "open" when it lets the socket in, or the code it closes it with (4403: key refused).
function keyCheck(code, key) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`${WS}/api/rooms/${code}/ws?key=${encodeURIComponent(key)}`);
    ws.onmessage = (e) => {
      if (e.data === "pong") return;
      ws.onclose = null;
      ws.close();
      resolve("open");
    };
    ws.onclose = (e) => resolve(e.code);
    ws.onerror = () => {};
  });
}
// A presenter screen that stays open, and the code it was closed with.
function presenter(code, key) {
  const ws = new WebSocket(`${WS}/api/rooms/${code}/ws?key=${encodeURIComponent(key)}`);
  const out = { ws, closed: null };
  ws.onclose = (e) => (out.closed = e.code);
  ws.onerror = () => {};
  // Like a real screen, it has already sent something (the local dev server passes a close only to such sockets).
  return new Promise((resolve) => (ws.onopen = () => (ws.send(JSON.stringify({ type: "goto", index: 0, ref: 1 })), setTimeout(() => resolve(out), 300))));
}
const results = (code, key) => fetch(`${BASE}/api/rooms/${code}/results?key=${encodeURIComponent(key)}`, { headers: { connection: "close" } }).then((r) => r.status);

const deck = (title, extra = {}) => ({ title, questions: [{ type: "choice", question: `${title}?`, options: ["A", "B"] }], ...extra });
const owner = person();
const member = person();
const stranger = person();
try {
  await owner.signup("Olivia");
  await member.signup("Max");
  await stranger.signup("Mallory");
  ok(owner.id && member.id && stranger.id, "three test accounts created");

  // Every account can lead a team (the plan is set again in case).
  sql(`UPDATE users SET plan = 'pro' WHERE id = '${owner.id}'`);
  const ownDeck = (await owner.call("/api/rooms", { method: "POST", body: deck("Owner deck") })).data.code;
  const memberDeck = (await member.call("/api/rooms", { method: "POST", body: deck("Member deck") })).data.code;
  ok(!!ownDeck && !!memberDeck, "each made a presentation");
  ok((await member.call(`/api/polls/${ownDeck}/host`)).status === 404, "before joining, a stranger's presentation stays closed");

  // Invitation and joining.
  const invite = await owner.call("/api/team/invite", { method: "POST", body: { email: member.email } });
  ok(invite.status === 200 && !!invite.data.devToken, "the owner invites by email");
  const info = await member.call(`/api/team/invite?t=${invite.data.devToken}`);
  ok(info.data.owner === "Olivia", "the invitation names the team's owner");
  ok((await owner.call("/api/team/accept", { method: "POST", body: { token: invite.data.devToken } })).status === 400, "the owner can't join their own team");
  const leaked = await stranger.call("/api/team/accept", { method: "POST", body: { token: invite.data.devToken } });
  ok(leaked.status === 403 && leaked.data.error.includes(member.email), "a forwarded link doesn't let another account in");
  ok((await member.call("/api/team/accept", { method: "POST", body: { token: invite.data.devToken } })).status === 200, "the member joins");
  ok((await member.call("/api/team/accept", { method: "POST", body: { token: invite.data.devToken } })).status === 404, "the link works once");
  const me = (await member.call("/api/me")).data.user;
  ok(me.plan === "pro" && me.teamRole === "member" && !("team" in me), "the member is in the team");
  const team = (await member.call("/api/team")).data;
  ok(team.role === "member" && team.owner === "Olivia" && team.members.length === 1 && !team.members[0].email, "the member sees the team, without addresses");

  // Shared presentations.
  const memberList = (await member.call("/api/polls")).data.polls;
  ok(memberList.some((p) => p.code === ownDeck && p.by === "Olivia") && memberList.some((p) => p.code === memberDeck && !p.by), "the member sees the owner's presentation, marked with her name");
  const ownerList = (await owner.call("/api/polls")).data.polls;
  ok(ownerList.some((p) => p.code === memberDeck && p.by === "Max"), "the owner sees the member's presentation");
  ok((await member.call(`/api/polls/${ownDeck}/host`)).status === 200, "the member can present the owner's presentation");
  // Keys: a teammate presents with a key of their own, never the room's.
  const ownerKey = (await owner.call(`/api/polls/${ownDeck}/host`)).data.hostKey;
  const memberKey = (await member.call(`/api/polls/${ownDeck}/host`)).data.hostKey;
  ok(memberKey && ownerKey && memberKey !== ownerKey, "the member gets a presenter key of their own");
  ok((await keyCheck(ownDeck, memberKey)) === "open" && (await results(ownDeck, memberKey)) === 200, "which presents and reads the results");
  ok((await keyCheck(ownDeck, memberKey.replace(/.$/, (c) => (c === "0" ? "1" : "0")))) === 4403, "a key changed by hand is refused");
  ok((await member.call(`/api/polls/${ownDeck}/share`, { method: "POST", body: { category: "Team", description: "Not mine" } })).status === 403, "a member can't share the owner's presentation in Community");
  ok((await member.call(`/api/polls/${ownDeck}/keys`, { method: "POST" })).status === 403, "nor make new keys for it");
  // A template shared by a teammate before that check: the presentation's author can still take it down.
  const tplId = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  sql(`INSERT INTO shared_templates (id, user_id, code, title, category, description, questions, created_at) VALUES ('${tplId}', '${member.id}', '${ownDeck}', 'Owner deck', 'Team', 'Old share', '[]', ${Date.now()})`);
  await owner.call(`/api/templates/${tplId}`, { method: "DELETE" });
  ok(!sql(`SELECT 1 AS x FROM shared_templates WHERE id = '${tplId}'`).length, "the author takes down a copy a teammate shared");
  const room = await socket(memberDeck, `?voter=${crypto.randomUUID()}`);
  ok(await room.until((s) => !s.free), "the member's presentation runs with every feature");
  room.ws.close();
  const many = await member.call("/api/rooms", { method: "POST", body: { title: "Long", questions: Array.from({ length: 12 }, (_, i) => ({ type: "choice", question: `Q${i}?`, options: ["A", "B"] })) } });
  ok(many.status === 200, "the member can make a 12-question presentation");

  // Editing at the same time.
  ok((await owner.call(`/api/polls/${ownDeck}/editing`, { method: "POST" })).data.others.length === 0, "nobody else editing at first");
  ok((await member.call(`/api/polls/${ownDeck}/editing`, { method: "POST" })).data.others.join() === "Olivia", "the member sees Olivia editing");
  ok((await owner.call(`/api/polls/${ownDeck}/editing`, { method: "POST" })).data.others.join() === "Max", "Olivia sees Max editing");
  const opened = (await member.call(`/api/polls/${ownDeck}`)).data.edited?.at ?? 0;
  const ownerOpened = (await owner.call(`/api/polls/${ownDeck}`)).data.edited?.at ?? 0;
  ok((await owner.call(`/api/polls/${ownDeck}`, { method: "PUT", body: { ...deck("Owner deck v2"), base: ownerOpened } })).status === 200, "Olivia saves");
  const clash = await member.call(`/api/polls/${ownDeck}`, { method: "PUT", body: { ...deck("Max's version"), base: opened } });
  ok(clash.status === 409 && clash.data.code === "conflict" && clash.data.by === "Olivia", "Max's save is stopped: Olivia saved in between");
  ok((await member.call(`/api/polls/${ownDeck}`, { method: "PUT", body: { ...deck("Max's version"), base: opened, force: true } })).status === 200, "Max can keep his version on purpose");
  ok((await owner.call(`/api/polls/${ownDeck}`)).data.title === "Max's version", "the saved title is Max's");

  // Who may delete.
  ok((await member.call(`/api/polls/${ownDeck}`, { method: "DELETE" })).status === 403, "a member can't delete the owner's presentation");
  ok((await owner.call(`/api/polls/${many.data.code}`, { method: "DELETE" })).status === 200, "the owner can delete a member's presentation");

  // Seats: the owner plus 2.
  for (let i = 0; i < 1; i++) await owner.call("/api/team/invite", { method: "POST", body: { email: `seat${i}-${crypto.randomUUID().slice(0, 4)}@hopvote.test` } });
  const full = await owner.call("/api/team/invite", { method: "POST", body: { email: `extra-${crypto.randomUUID().slice(0, 4)}@hopvote.test` } });
  ok(full.status === 400 && /full/.test(full.data.error), "a fourth presenter is refused");
  const ownerTeam = (await owner.call("/api/team")).data;
  ok(ownerTeam.role === "owner" && ownerTeam.members.length === 2 && ownerTeam.seats === 3, "the owner sees 2 people, one joined and one invited, out of 3 seats");

  // Removal: the member's presentations stay theirs, the team no longer opens them.
  const live = await presenter(ownDeck, ownerKey);
  await owner.call("/api/team/remove", { method: "POST", body: { email: member.email } });
  await wait(300);
  for (let i = 0; i < 20 && live.closed === null; i++) await wait(100);
  ok(live.closed === 4403, "a presenter screen open during the removal is told to ask for the new key");
  ok((await keyCheck(ownDeck, memberKey)) === 4403 && (await results(ownDeck, memberKey)) === 404, "the removed member's key stops working");
  ok((await keyCheck(ownDeck, ownerKey)) === 4403, "the room's old key too: the keys changed");
  const ownerKey2 = (await owner.call(`/api/polls/${ownDeck}/host`)).data.hostKey;
  ok(ownerKey2 && ownerKey2 !== ownerKey && (await keyCheck(ownDeck, ownerKey2)) === "open", "the owner's screen gets the new key and presents");
  const after = (await member.call("/api/me")).data.user;
  ok(after.teamRole !== "member", "a removed member is out of the team");
  ok((await member.call(`/api/polls/${ownDeck}/host`)).status === 404, "and no longer opens the team's presentations");
  ok((await member.call(`/api/polls/${memberDeck}/host`)).status === 200, "but keeps their own");
  ok((await owner.call(`/api/polls/${memberDeck}/host`)).status === 404, "which the owner no longer opens");

  // Joining again, then leaving.
  const again = await owner.call("/api/team/invite", { method: "POST", body: { email: member.email } });
  await member.call("/api/team/accept", { method: "POST", body: { token: again.data.devToken } });
  ok((await member.call("/api/me")).data.user.teamRole === "member", "the member joins again");
  const memberKey2 = (await member.call(`/api/polls/${ownDeck}/host`)).data.hostKey;
  ok((await keyCheck(ownDeck, memberKey2)) === "open", "back in the team, the member presents again");
  ok((await member.call("/api/team/leave", { method: "POST" })).status === 200 && (await member.call("/api/me")).data.user.teamRole !== "member", "a member can leave");
  ok((await member.call(`/api/polls/${ownDeck}/host`)).status === 404, "and the team's presentations close for them");

  // New keys asked by the author: every key given before stops working.
  const before = (await owner.call(`/api/polls/${ownDeck}/host`)).data.hostKey;
  const fresh = await owner.call(`/api/polls/${ownDeck}/keys`, { method: "POST" });
  ok(fresh.status === 200 && fresh.data.hostKey !== before && (await keyCheck(ownDeck, fresh.data.hostKey)) === "open", "New keys gives the author a working key");
  ok((await keyCheck(ownDeck, before)) === 4403 && (await results(ownDeck, before)) === 404, "and the old one is refused");
  // A key change stopped halfway (the room has the new key, the database the old one): the author still gets the key
  // the room accepts.
  const stored = sql(`SELECT host_key FROM polls WHERE code = '${ownDeck}'`)[0]?.host_key;
  sql(`UPDATE polls SET host_key = 'halfway${crypto.randomUUID().slice(0, 8)}' WHERE code = '${ownDeck}'`);
  const healed = (await owner.call(`/api/polls/${ownDeck}/host`)).data.hostKey;
  ok(healed === fresh.data.hostKey && (await keyCheck(ownDeck, healed)) === "open", "with the database a step behind the room, the author still gets a working key");
  sql(`UPDATE polls SET host_key = '${stored}' WHERE code = '${ownDeck}'`);

  // Seats are counted in the same statement: invitations sent at once can't fill more than the team.
  sql(`DELETE FROM team_members WHERE owner_id = '${owner.id}'`);
  const burst = await Promise.all(Array.from({ length: 6 }, (_, i) => owner.call("/api/team/invite", { method: "POST", body: { email: `burst${i}-${crypto.randomUUID().slice(0, 4)}@hopvote.test` } })));
  ok(burst.filter((r) => r.status === 200).length === 2, "6 invitations sent at once: 2 go out, the rest find the team full");
  ok(sql(`SELECT COUNT(*) AS n FROM team_members WHERE owner_id = '${owner.id}'`)[0]?.n === 2, "the team holds 2 invitations, no more");
  sql(`DELETE FROM team_members WHERE owner_id = '${owner.id}'`);

  // The launch animation: plays once per round, then the waiting screen does not come back.
  const show = (await owner.call("/api/rooms", { method: "POST", body: deck("Launch", { intro: true }) })).data;
  const host = await socket(show.code, `?key=${show.hostKey}`);
  host.send({ type: "lobby", on: true });
  ok(await host.until((s) => s.lobby && s.launch === null), "the waiting screen shows, nothing launched yet");
  host.send({ type: "lobby", on: false });
  ok(await host.until((s) => !s.lobby && typeof s.launch === "number"), "starting records the launch");
  host.send({ type: "lobby", on: true });
  await wait(400);
  ok(!host.state.lobby, "the waiting screen does not come back after the launch");
  ok((await owner.call(`/api/polls/${show.code}`)).data.intro === true, "the setting is saved with the presentation");
  await owner.call(`/api/polls/${show.code}/reset`, { method: "POST" });
  ok(await host.until((s) => s.launch === null), "a reset allows a new launch");
  host.ws.close();
  const plain = (await owner.call("/api/rooms", { method: "POST", body: deck("Plain") })).data;
  const host2 = await socket(plain.code, `?key=${plain.hostKey}`);
  host2.send({ type: "lobby", on: true });
  await host2.until((s) => s.lobby);
  host2.send({ type: "lobby", on: false });
  await wait(300);
  host2.send({ type: "lobby", on: true });
  ok(await host2.until((s) => s.lobby && s.launch === null), "without the setting, the waiting screen comes back as before");
  host2.ws.close();
} finally {
  for (const p of [owner, member, stranger]) if (p.cookie) await p.call("/api/account", { method: "DELETE", body: { confirm: "DELETE" } });
  const left = sql(`SELECT COUNT(*) AS n FROM team_members WHERE owner_id = '${owner.id}' OR user_id = '${member.id}'`)[0]?.n;
  ok(left === 0, "deleting the accounts removes the team");
}
console.log(failures ? `\n${failures} team check(s) failed` : "\nAll team checks passed");
process.exit(failures ? 1 : 0);
