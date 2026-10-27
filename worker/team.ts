// Teams: an account and up to 2 people it invites present together. Everyone keeps their own account; the team opens
// and edits each other's presentations. A removed member keeps their presentations; the team no longer sees them.
import type { Env } from "./index";
import { mailLimit, randomToken, sha256, type User } from "./auth";
import { sendMail } from "./mail";

export const TEAM_SEATS = 3;
const INVITE_DAYS = 7;

// Added to a query on `users u`: the team the user belongs to (its owner's id).
export const TEAM_JOIN = "LEFT JOIN team_members tm ON tm.user_id = u.id";
export const TEAM_COLUMNS = "tm.owner_id AS team_owner";
export type TeamColumns = { team_owner?: string | null };

// A user as the app sees them: `team` is the team's id (its owner's), `teamRole` whether they joined it or lead their own.
export function withTeam<T extends { id: string; plan: string }>(row: T & TeamColumns) {
  const { team_owner, ...user } = row;
  const base = user as T;
  if (team_owner) return { ...base, ownPlan: base.plan, team: team_owner, teamRole: "member" as const };
  return { ...base, ownPlan: base.plan, team: base.id, teamRole: "owner" as const };
}

// The same, for a user loaded without their team (right after signing in).
export async function loadTeam(env: Env, user: User) {
  const row = await env.DB.prepare(`SELECT ${TEAM_COLUMNS} FROM users u ${TEAM_JOIN} WHERE u.id = ?`).bind(user.id).first<TeamColumns>();
  return withTeam({ ...user, ...(row ?? {}) });
}

// What the app receives about the signed-in person: the team's id stays on the server.
export const publicUser = (user: User) => {
  const { team: _team, ...rest } = user;
  return rest;
};

// The presentations a user can open: their own, and their team's while it runs. Binds ?1 = user id, ?2 = team id or null.
export const CAN_OPEN = "(p.user_id = ?1 OR (?2 IS NOT NULL AND (p.user_id = ?2 OR p.user_id IN (SELECT user_id FROM team_members WHERE owner_id = ?2 AND user_id IS NOT NULL))))";

// Whether this account may open this presentation right now (a teammate's presenter key is checked with it).
export async function canOpen(env: Env, userId: string, code: string) {
  const row = await env.DB.prepare(`SELECT u.id, u.plan, ${TEAM_COLUMNS} FROM users u ${TEAM_JOIN} WHERE u.id = ?`).bind(userId).first<{ id: string; plan: string } & TeamColumns>();
  if (!row) return false;
  const { team } = withTeam(row);
  return !!(await env.DB.prepare(`SELECT 1 FROM polls p WHERE p.code = ?3 AND ${CAN_OPEN}`).bind(userId, team ?? null, code).first());
}

// Every presentation of a team (its owner's and its members'): their keys change when someone who opened them leaves.
async function teamCodes(env: Env, ownerId: string) {
  const { results } = await env.DB.prepare("SELECT code FROM polls WHERE user_id = ?1 OR user_id IN (SELECT user_id FROM team_members WHERE owner_id = ?1 AND user_id IS NOT NULL)")
    .bind(ownerId)
    .all<{ code: string }>();
  return results.map((r) => r.code);
}

// `rotate`: presentations whose keys must change (index.ts rotateKeys).
type Result = { data: unknown; rotate?: string[] } | { error: string; status: number };
const fail = (error: string, status = 400): Result => ({ error, status });

// Who is in the team, as the owner or a member sees it.
export async function teamInfo(env: Env, user: User): Promise<Result> {
  if (!user.team) return { data: { role: null, seats: TEAM_SEATS, members: [] } };
  const { results } = await env.DB.prepare(
    "SELECT tm.email, tm.user_id, tm.invited_at, u.name FROM team_members tm LEFT JOIN users u ON u.id = tm.user_id WHERE tm.owner_id = ? ORDER BY tm.invited_at",
  )
    .bind(user.team)
    .all<{ email: string; user_id: string | null; invited_at: number; name: string | null }>();
  if (user.teamRole === "owner") {
    const old = Date.now() - INVITE_DAYS * 86_400_000;
    return {
      data: {
        role: "owner",
        seats: TEAM_SEATS,
        members: results.map((m) => ({ email: m.email, name: m.name ?? "", joined: !!m.user_id, expired: !m.user_id && m.invited_at < old })),
      },
    };
  }
  // Members see names only, not the addresses the owner invited.
  const owner = await env.DB.prepare("SELECT name FROM users WHERE id = ?").bind(user.team).first<{ name: string }>();
  return {
    data: {
      role: "member",
      seats: TEAM_SEATS,
      owner: owner?.name ?? "",
      members: results.filter((m) => m.user_id).map((m) => ({ name: m.name ?? "", joined: true, you: m.user_id === user.id })),
    },
  };
}

export async function inviteMember(env: Env, user: User, rawEmail: unknown, ip: string): Promise<Result> {
  if (user.teamRole !== "owner") return fail("Only the team's owner can do this.", 403);
  const email = String(rawEmail ?? "").trim().toLowerCase().slice(0, 200);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return fail("Enter a valid email address");
  if (email === user.email.toLowerCase()) return fail("You're already in your team.");
  const taken = await env.DB.prepare("SELECT COUNT(*) AS n, SUM(email = ?2) AS same, SUM(email = ?2 AND user_id IS NOT NULL) AS joined FROM team_members WHERE owner_id = ?1")
    .bind(user.id, email)
    .first<{ n: number; same: number | null; joined: number | null }>();
  if (taken?.joined) return fail("This person is already in your team.");
  if (!taken?.same && (taken?.n ?? 0) >= TEAM_SEATS - 1) return fail(`Your team is full: ${TEAM_SEATS} presenters, you included.`);
  const elsewhere = await env.DB.prepare("SELECT 1 FROM team_members tm JOIN users u ON u.id = tm.user_id WHERE u.email = ? AND tm.owner_id != ?")
    .bind(email, user.id)
    .first();
  if (elsewhere) return fail("This person is already in another team.");
  const limit = await mailLimit(env, email, ip, "invite");
  if (limit === "busy") return fail("Our email service is busy today. Try again tomorrow.", 503);
  if (limit) return fail("Too many invitations for now. Try again tomorrow.", 429);

  const token = randomToken();
  // The seats are counted in the same statement: invitations sent at the same moment can't all pass.
  const added = await env.DB.prepare(
    `INSERT INTO team_members (owner_id, email, user_id, token_hash, invited_at, joined_at) SELECT ?1, ?2, NULL, ?3, ?4, NULL
     WHERE (SELECT COUNT(*) FROM team_members WHERE owner_id = ?1 AND email != ?2) < ?5
     ON CONFLICT(owner_id, email) DO UPDATE SET token_hash = excluded.token_hash, invited_at = excluded.invited_at`,
  )
    .bind(user.id, email, await sha256(token), Date.now(), TEAM_SEATS - 1)
    .run();
  if (!added.meta.changes) return fail(`Your team is full: ${TEAM_SEATS} presenters, you included.`);
  const site = env.MAIL_DEV === "1" ? "http://localhost:5180" : (env.PUBLIC_URL ?? "").replace(/\/+$/, "");
  // The name is typed by the owner: only a plain first name goes into the email (letters, up to 3 words and 24 characters),
  // never a sentence or an address.
  const typed = user.name.trim().replace(/\s+/g, " ");
  const who = /^[\p{L}\p{M}' -]{1,24}$/u.test(typed) && typed.split(" ").length <= 3 ? typed : null;
  const sent = await sendMail(
    env,
    email,
    who ? `${who} invites you to their Hopvote team` : "You're invited to a Hopvote team",
    who ? `Join ${who}'s team` : "Join the team",
    `${who ? `${who} added you to their` : "You were added to a"} Hopvote team: you'll share presentations and run live polls together, each with your own account. The link works for ${INVITE_DAYS} days.`,
    "Join the team",
    `${site}/team/join?t=${token}`,
  );
  if (!sent) return fail("We couldn't send the email. Try again later.", 503);
  return { data: { ok: true, ...(env.MAIL_DEV === "1" ? { devToken: token } : {}) } };
}

// The owner takes someone out of the team, or cancels an invitation. Their own presentations stay theirs.
// Someone who joined could open every presentation of the team: their keys change once they are out.
// Cancelling an invitation nobody accepted changes nothing.
export async function removeMember(env: Env, user: User, rawEmail: unknown): Promise<Result> {
  if (user.teamRole !== "owner") return fail("Only the team's owner can do this.", 403);
  const email = String(rawEmail ?? "").trim().toLowerCase();
  const joined = await env.DB.prepare("SELECT 1 FROM team_members WHERE owner_id = ? AND email = ? AND user_id IS NOT NULL").bind(user.id, email).first();
  const rotate = joined ? await teamCodes(env, user.id) : [];
  await env.DB.prepare("DELETE FROM team_members WHERE owner_id = ? AND email = ?").bind(user.id, email).run();
  return { data: { ok: true }, rotate };
}

export async function leaveTeam(env: Env, user: User): Promise<Result> {
  const row = await env.DB.prepare("SELECT owner_id FROM team_members WHERE user_id = ?").bind(user.id).first<{ owner_id: string }>();
  const rotate = row ? await teamCodes(env, row.owner_id) : [];
  await env.DB.prepare("DELETE FROM team_members WHERE user_id = ?").bind(user.id).run();
  return { data: { ok: true }, rotate };
}

async function invitation(env: Env, token: unknown) {
  if (typeof token !== "string" || !/^[\w-]{20,100}$/.test(token)) return null;
  return env.DB.prepare(
    "SELECT tm.owner_id, tm.email, u.name FROM team_members tm JOIN users u ON u.id = tm.owner_id WHERE tm.token_hash = ? AND tm.user_id IS NULL AND tm.invited_at > ?",
  )
    .bind(await sha256(token), Date.now() - INVITE_DAYS * 86_400_000)
    .first<{ owner_id: string; email: string; name: string }>();
}

// What the join page shows before the person accepts.
export async function invitationInfo(env: Env, token: unknown): Promise<Result> {
  const row = await invitation(env, token);
  if (!row) return fail("This invitation has expired or was already used. Ask for a new one.", 404);
  return { data: { owner: row.name, email: row.email } };
}

export async function acceptInvitation(env: Env, user: User, token: unknown): Promise<Result> {
  const row = await invitation(env, token);
  if (!row) return fail("This invitation has expired or was already used. Ask for a new one.", 404);
  if (row.owner_id === user.id) return fail("This is your own team.");
  // The link is for one address: a forwarded or leaked invitation doesn't let another account in.
  if (user.email.trim().toLowerCase() !== row.email) return fail(`This invitation was sent to "${row.email}". Log in with that email to join.`, 403);
  if (user.teamRole === "member") return fail("You're already in a team. Leave it first, in Settings.", 409);
  const leads = await env.DB.prepare("SELECT 1 FROM team_members WHERE owner_id = ? AND user_id IS NOT NULL").bind(user.id).first();
  if (leads) return fail("You already lead a team of your own.", 409);
  try {
    // Seats are counted again as the person joins.
    const joined = await env.DB.prepare(
      `UPDATE team_members SET user_id = ?1, token_hash = NULL, joined_at = ?2 WHERE owner_id = ?3 AND email = ?4 AND user_id IS NULL
       AND (SELECT COUNT(*) FROM team_members WHERE owner_id = ?3 AND user_id IS NOT NULL) < ?5`,
    )
      .bind(user.id, Date.now(), row.owner_id, row.email, TEAM_SEATS - 1)
      .run();
    if (!joined.meta.changes) return fail(`This team is full: ${TEAM_SEATS} presenters, its owner included.`, 409);
  } catch {
    // The unique index: this account joined another team meanwhile.
    return fail("You're already in a team. Leave it first, in Settings.", 409);
  }
  return { data: { ok: true } };
}
