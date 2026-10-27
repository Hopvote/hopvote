import { parseBrand } from "./brand";
import { sendMail } from "./mail";
import { bump, counter } from "./ops";
import { TEAM_COLUMNS, TEAM_JOIN, withTeam, type TeamColumns } from "./team";
import type { Env } from "./index";

// `plan` is the plan stored on the account (every account has the same limits, worker/limits.ts). `team` is their team's
// id (its owner's id).
export type User = { id: string; email: string; name: string; plan: string; ownPlan?: string; team?: string | null; teamRole?: "owner" | "member" | null };

const SESSION_COOKIE = "hv_session";
const SESSION_DAYS = 30;
// Workers caps PBKDF2 at 100k iterations.
const PBKDF2_ITERATIONS = 100_000;

const enc = new TextEncoder();

function toBase64(bytes: ArrayBuffer | Uint8Array) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

export function randomToken(bytes = 32) {
  return toBase64(crypto.getRandomValues(new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function sha256(text: string) {
  return toBase64(await crypto.subtle.digest("SHA-256", enc.encode(text)));
}

async function hashPassword(password: string, salt: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: enc.encode(salt), iterations: PBKDF2_ITERATIONS },
    key,
    256,
  );
  return toBase64(bits);
}

export function sameString(a: string, b: string) {
  const x = enc.encode(a);
  const y = enc.encode(b);
  // timingSafeEqual is a Workers extension missing from the DOM typings.
  const subtle = crypto.subtle as SubtleCrypto & { timingSafeEqual(a: ArrayBufferView, b: ArrayBufferView): boolean };
  return x.length === y.length && subtle.timingSafeEqual(x, y);
}

function readCookie(request: Request, name: string) {
  const header = request.headers.get("Cookie") ?? "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

function sessionCookie(token: string, maxAge: number) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

// The network an address belongs to, for limits: an IPv6 address by its /64 (one home or phone gets a whole block),
// an IPv4 address whole (a school or a conference shares one).
export function networkOf(ip: string) {
  if (!ip.includes(":")) return ip;
  const [head, tail = ""] = ip.toLowerCase().split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups = ip.includes("::") ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right] : left;
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

export async function currentUser(request: Request, env: Env): Promise<User | null> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT u.id, u.email, u.name, u.plan, ${TEAM_COLUMNS} FROM sessions s JOIN users u ON u.id = s.user_id ${TEAM_JOIN}
     WHERE s.token_hash = ? AND s.expires_at > ?`,
  )
    .bind(await sha256(token), Date.now())
    .first<User & TeamColumns>();
  if (!row) return null;
  return withTeam(row);
}

async function startSession(env: Env, userId: string) {
  const token = randomToken();
  await env.DB.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(await sha256(token), userId, Date.now() + SESSION_DAYS * 86_400_000)
    .run();
  return sessionCookie(token, SESSION_DAYS * 86_400);
}

type Credentials = { email?: unknown; password?: unknown; name?: unknown };

function clean(body: Credentials) {
  return {
    email: String(body.email ?? "").trim().toLowerCase().slice(0, 200),
    password: String(body.password ?? ""),
    name: String(body.name ?? "").trim().slice(0, 60),
  };
}

const emailOk = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);

const SIGNUP_HOURS = 24;
const RESET_MINUTES = 60;
// This copy's public address (PUBLIC_URL in wrangler.jsonc), for the links in emails; the dev server with MAIL_DEV.
const siteFor = (env: Env) => (env.MAIL_DEV === "1" ? "http://localhost:5180" : (env.PUBLIC_URL ?? "").replace(/\/+$/, ""));

// Emails a day: Resend's free plan sends 100, and these caps stay under it (raise MAIL_DAY on a larger plan). Repeating a
// form must not spend them, nor flood someone's inbox: at most 3 sign-up or password emails a day to one address, 20 from
// one network. Sign-ups (anyone can fill the form) stop first, so password resets and team invitations keep their share.
const MAIL_PER_ADDRESS = 3;
const MAIL_PER_NETWORK = 20;
const MAIL_DAY = { signup: 60, reset: 85, invite: 95 };
const BUSY = "Our email service is busy today. Continue with Google, or try again tomorrow.";

export async function mailLimit(env: Env, email: string, ip: string, kind: keyof typeof MAIL_DAY = "signup"): Promise<"busy" | "network" | "address" | null> {
  if ((await counter(env, "emails").catch(() => 0)) >= MAIL_DAY[kind]) return "busy";
  // Local tests sign up many accounts from one machine.
  if ((await bump(env, `mail-ip:${(await sha256(networkOf(ip))).slice(0, 16)}`)) > (env.MAIL_DEV === "1" ? 500 : MAIL_PER_NETWORK)) return "network";
  if ((await bump(env, `mail-to:${(await sha256(email)).slice(0, 16)}`)) > MAIL_PER_ADDRESS) return "address";
  // The email's place is taken before it is sent, in one statement: forms sent at the same moment cannot all pass a count
  // that only grows once each email has gone ("emails", mail.ts), and spend the places kept for resets and invitations.
  return (await takeMailPlace(env, MAIL_DAY[kind])) ? null : "busy";
}

async function takeMailPlace(env: Env, limit: number) {
  // Local development sends nothing (mail.ts): the count is only read, so test sign-ups never fill it.
  if (!env.RESEND_API_KEY) return (await counter(env, "mail-held").catch(() => 0)) < limit;
  const row = await env.DB.prepare("INSERT INTO ops_daily (day, key, n) VALUES (?1, 'mail-held', 1) ON CONFLICT(day, key) DO UPDATE SET n = n + 1 WHERE n < ?2 RETURNING n")
    .bind(new Date().toISOString().slice(0, 10), limit)
    .first<{ n: number }>()
    .catch(() => ({ n: 0 }));
  return !!row;
}

// Signing up only sends a confirmation email: the account exists once its owner opens the link.
// The answer is the same whether or not the email is already used, so nobody can test which addresses have an account.
export async function signup(body: Credentials, env: Env, ip = "") {
  const { email, password, name } = clean(body);
  if (!name) return { error: "Enter your first name" };
  if (!emailOk(email)) return { error: "Invalid email address" };
  if (password.length < 8) return { error: "Password must be at least 8 characters" };

  // Until the email service is connected, accounts open right away, without email confirmation.
  if ((!env.RESEND_API_KEY || env.MAIL_READY !== "1") && env.MAIL_DEV !== "1") return directSignup(env, email, name, password);

  const limit = await mailLimit(env, email, ip);
  if (limit === "busy") return { error: BUSY };
  if (limit === "network") return { error: "Too many sign-ups from this network today. Continue with Google, or try again tomorrow." };
  // Enough emails to this address today: the one already sent still works.
  if (limit === "address") return { pending: true };

  const exists = await env.DB.prepare("SELECT 1 FROM users WHERE email = ?").bind(email).first();
  if (exists) {
    const sent = await sendMail(env, email, "You already have a Hopvote account", "You already have an account", "Someone (probably you) tried to sign up with this email. Log in instead, or reset your password if you forgot it.", "Log in", `${siteFor(env)}/login`);
    return sent ? { pending: true } : { error: "We couldn't send the email. Try again in a few minutes." };
  }
  const token = randomToken();
  // The account opens from the emailed link: its password comes with a proven address.
  const salt = PROVEN + randomToken(16);
  await env.DB.batch([
    // Only the newest link works: an older email must not create the account with the password typed before.
    env.DB.prepare("DELETE FROM pending_signups WHERE email = ? OR expires_at < ?").bind(email, Date.now()),
    env.DB.prepare("INSERT INTO pending_signups (token_hash, email, name, pass_hash, pass_salt, expires_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(await sha256(token), email, name, await hashPassword(password, salt), salt, Date.now() + SIGNUP_HOURS * 3_600_000),
  ]);
  // The name is typed by whoever fills the form: only a plain first name goes into the email.
  const greeting = /^[\p{L}\p{M}' -]{1,40}$/u.test(name) ? `Welcome, ${name}` : "Welcome";
  const sent = await sendMail(env, email, "Confirm your Hopvote account", greeting, "Confirm your email to finish creating your Hopvote account.", "Confirm my email", `${siteFor(env)}/verify?t=${token}`);
  // Local test scripts read the link from the answer; never set in production.
  if (sent && env.MAIL_DEV === "1") return { pending: true, devToken: token };
  return sent ? { pending: true } : { error: "We couldn't send the email. Try again in a few minutes." };
}

async function directSignup(env: Env, email: string, name: string, password: string) {
  const exists = await env.DB.prepare("SELECT 1 FROM users WHERE email = ?").bind(email).first();
  if (exists) return { error: "An account already exists with this email" };
  const id = crypto.randomUUID();
  // Nobody opened an email: whoever typed the password may not own the address (see googleSignIn).
  const salt = UNPROVEN + randomToken(16);
  await env.DB.prepare("INSERT INTO users (id, email, name, pass_hash, pass_salt, plan, created_at) VALUES (?, ?, ?, ?, ?, 'pro', ?)")
    .bind(id, email, name, await hashPassword(password, salt), salt, Date.now())
    .run();
  return { user: { id, email, name, plan: "pro" } as User, cookie: await startSession(env, id) };
}

// Opened from the confirmation email: creates the account and signs it in.
export async function verifySignup(token: unknown, env: Env) {
  const hash = await sha256(String(token ?? ""));
  const row = await env.DB.prepare("SELECT email, name, pass_hash, pass_salt FROM pending_signups WHERE token_hash = ? AND expires_at > ?")
    .bind(hash, Date.now())
    .first<{ email: string; name: string; pass_hash: string; pass_salt: string }>();
  if (!row) return { error: "This link expired or was already used. Log in, or sign up again." };
  const existing = await env.DB.prepare("SELECT id, email, name, plan FROM users WHERE email = ?").bind(row.email).first<User>();
  await env.DB.prepare("DELETE FROM pending_signups WHERE email = ?").bind(row.email).run();
  if (existing) return { error: "This email already has an account. Log in instead." };
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO users (id, email, name, pass_hash, pass_salt, plan, created_at) VALUES (?, ?, ?, ?, ?, 'pro', ?)")
    .bind(id, row.email, row.name, row.pass_hash, row.pass_salt, Date.now())
    .run();
  return { user: { id, email: row.email, name: row.name, plan: "pro" } as User, cookie: await startSession(env, id) };
}

// Wrong passwords are counted per account and per UTC hour, whatever the address they come from. Past FAIL_LIMIT,
// the account takes one try a minute: guessing stays slow, and its owner is never locked out. A browser that signed in
// to it before skips the wait (KNOWN_COOKIE), and Google sign-in and password resets work as usual.
const FAIL_LIMIT = 10;
const KNOWN_COOKIE = "hv_known";
const SLOW = "Too many tries on this account. Wait a minute, or reset your password.";

// Proves this browser signed in to the account with its current password: a new password ends it.
const knownMark = async (row: { id: string; pass_hash: string }) => (await sha256(`known:${row.id}:${row.pass_hash}`)).replace(/[+/=]/g, "").slice(0, 32);
const knownCookie = async (row: { id: string; pass_hash: string }) => `${KNOWN_COOKIE}=${await knownMark(row)}; Path=/api/; HttpOnly; Secure; SameSite=Lax; Max-Age=${365 * 86_400}`;

// Same answer whether the account exists or not. Returns true when this try must wait.
// Each try is counted as a failure before its password is checked, and given back once it proves right (passed): tries
// sent together all count, instead of all passing while the first ones are still being checked.
async function guessing(env: Env, email: string, row: { id: string; pass_hash: string } | null, request?: Request) {
  const tag = (await sha256(`login:${email}`)).slice(0, 16);
  const now = new Date().toISOString();
  const failures = await bump(env, failKey(tag, now));
  if (failures <= FAIL_LIMIT) return false;
  if (row?.pass_hash && request && readCookie(request, KNOWN_COOKIE) === (await knownMark(row))) return false;
  return (await bump(env, `login-slow:${tag}:${now.slice(11, 16)}`)) > 1;
}

const failKey = (tag: string, now: string) => `login-fail:${tag}:${now.slice(11, 13)}`;
// The right password: its try no longer counts as a failure.
const passed = async (env: Env, email: string) =>
  env.DB.prepare("UPDATE ops_daily SET n = MAX(0, n - 1) WHERE day = ? AND key = ?")
    .bind(new Date().toISOString().slice(0, 10), failKey((await sha256(`login:${email}`)).slice(0, 16), new Date().toISOString()))
    .run()
    .catch(() => {});

export async function login(body: Credentials, env: Env, request?: Request) {
  const { email, password } = clean(body);
  const row = await env.DB.prepare("SELECT id, email, name, plan, pass_hash, pass_salt FROM users WHERE email = ?")
    .bind(email)
    .first<User & { pass_hash: string; pass_salt: string }>();
  if (await guessing(env, email, row, request)) return { error: SLOW, code: "slow" };
  // Hash even when the account is missing so both cases take the same time.
  const hash = await hashPassword(password, row?.pass_salt ?? "no-account");
  if (!row || !row.pass_hash || !sameString(hash, row.pass_hash)) {
    // Signed up but never opened the email: say so, the right password proves it is them.
    const pending = await env.DB.prepare("SELECT pass_hash, pass_salt FROM pending_signups WHERE email = ? AND expires_at > ? ORDER BY expires_at DESC LIMIT 1")
      .bind(email, Date.now())
      .first<{ pass_hash: string; pass_salt: string }>();
    if (!row && pending && sameString(await hashPassword(password, pending.pass_salt), pending.pass_hash)) {
      return { error: "Confirm your email first: open the link we sent you.", code: "unverified" };
    }
    return { error: "Wrong email or password" };
  }
  await passed(env, email);
  const { pass_hash, pass_salt, ...user } = row;
  return { user, cookie: await startSession(env, row.id), known: await knownCookie(row) };
}

// Always answers the same way; an email goes out only when the account exists.
export async function forgotPassword(body: Credentials, env: Env, ip = "") {
  const { email } = clean(body);
  if (!emailOk(email)) return { error: "Invalid email address" };
  const limit = await mailLimit(env, email, ip, "reset");
  if (limit === "busy" || limit === "network") return { error: "Our email service is busy today. Try again tomorrow." };
  if (limit === "address") return { ok: true };
  const user = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first<{ id: string }>();
  if (user) {
    const token = randomToken();
    await env.DB.batch([
      env.DB.prepare("DELETE FROM reset_tokens WHERE user_id = ? OR expires_at < ?").bind(user.id, Date.now()),
      env.DB.prepare("INSERT INTO reset_tokens (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
        .bind(await sha256(token), user.id, Date.now() + RESET_MINUTES * 60_000),
    ]);
    await sendMail(env, email, "Reset your Hopvote password", "Reset your password", "Choose a new password for your Hopvote account. The link works for one hour.", "Choose a new password", `${siteFor(env)}/reset?t=${token}`);
  }
  return { ok: true };
}

// Sets the new password, signs out every browser, then signs this one in.
export async function resetPassword(body: { token?: unknown; password?: unknown }, env: Env) {
  const password = String(body.password ?? "");
  if (password.length < 8) return { error: "Password must be at least 8 characters" };
  const hash = await sha256(String(body.token ?? ""));
  const row = await env.DB.prepare("SELECT user_id FROM reset_tokens WHERE token_hash = ? AND expires_at > ?").bind(hash, Date.now()).first<{ user_id: string }>();
  if (!row) return { error: "This link expired or was already used. Ask for a new one." };
  // Opened from an email: the address is proven.
  const salt = PROVEN + randomToken(16);
  const passHash = await hashPassword(password, salt);
  await env.DB.batch([
    env.DB.prepare("UPDATE users SET pass_hash = ?, pass_salt = ? WHERE id = ?").bind(passHash, salt, row.user_id),
    env.DB.prepare("DELETE FROM reset_tokens WHERE user_id = ?").bind(row.user_id),
    env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(row.user_id),
  ]);
  const user = await env.DB.prepare("SELECT id, email, name, plan FROM users WHERE id = ?").bind(row.user_id).first<User>();
  // This browser proved the account is theirs: it signs in without waiting while someone else is guessing (guessing).
  const known = await knownCookie({ id: row.user_id, pass_hash: passHash });
  return { user: user!, cookie: await startSession(env, row.user_id), known };
}

// Password salts say how the address was checked when the password was set: PROVEN through an emailed link,
// UNPROVEN for an account opened without any email. A salt with neither mark counts as proven: the account keeps
// its password and its links when its owner first signs in with Google.
const PROVEN = "v:";
const UNPROVEN = "u:";
const unproven = (row: { pass_hash: string; pass_salt: string }) => !!row.pass_hash && row.pass_salt.startsWith(UNPROVEN);

// Signs in (or signs up) someone whose Google account email is verified.
export async function googleSignIn(email: string, name: string, env: Env) {
  const clean = email.trim().toLowerCase();
  // Google vouches for the address: any sign-up still waiting for its email is no longer needed.
  await env.DB.prepare("DELETE FROM pending_signups WHERE email = ?").bind(clean).run();
  const row = await env.DB.prepare("SELECT id, email, name, plan, pass_hash, pass_salt FROM users WHERE email = ?")
    .bind(clean)
    .first<User & { pass_hash: string; pass_salt: string }>();
  if (row) {
    const { pass_hash, pass_salt, ...user } = row;
    // Someone may have opened this account with the address before its owner: their password and every other
    // sign-in go, and the account now signs in with Google (its owner can set a password again in Settings).
    if (unproven(row)) {
      await env.DB.batch([
        env.DB.prepare("UPDATE users SET pass_hash = '', pass_salt = '' WHERE id = ?").bind(row.id),
        env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(row.id),
        env.DB.prepare("DELETE FROM reset_tokens WHERE user_id = ?").bind(row.id),
        // And any team they put it in, or made with it: nobody they chose keeps opening its presentations.
        env.DB.prepare("DELETE FROM team_members WHERE user_id = ?1 OR owner_id = ?1").bind(row.id),
      ]);
    }
    return { user, cookie: await startSession(env, row.id) };
  }
  const id = crypto.randomUUID();
  const trimmed = name.trim().replace(/[.,;:!?]+$/, "").trim();
  const display = (trimmed ? trimmed[0].toLocaleUpperCase() + trimmed.slice(1) : clean.split("@")[0]).slice(0, 60);
  // No password: this account signs in with Google only, until its owner sets one.
  await env.DB.prepare("INSERT INTO users (id, email, name, pass_hash, pass_salt, plan, created_at) VALUES (?, ?, ?, '', '', 'pro', ?)")
    .bind(id, clean, display, Date.now())
    .run();
  return { user: { id, email: clean, name: display, plan: "pro" } as User, cookie: await startSession(env, id) };
}

// "Continue with Google": the nonce Google puts in the ID token is the hash of a secret kept in this browser's cookie,
// so a token copied from somewhere else can't be used without the browser that asked for it.
const NONCE_COOKIE = "hv_gnonce";
const nonceOf = async (secret: string) => (await sha256(`nonce:${secret}`)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export async function googleNonce() {
  const secret = randomToken();
  return { nonce: await nonceOf(secret), cookie: `${NONCE_COOKIE}=${secret}; Path=/api/auth/google; HttpOnly; Secure; SameSite=Lax; Max-Age=900` };
}

export async function googleNonceOk(request: Request, nonce: unknown) {
  const secret = readCookie(request, NONCE_COOKIE);
  return !!secret && typeof nonce === "string" && sameString(nonce, await nonceOf(secret));
}

export const clearGoogleNonce = () => `${NONCE_COOKIE}=; Path=/api/auth/google; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

export async function logout(request: Request, env: Env) {
  const token = readCookie(request, SESSION_COOKIE);
  if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
  return sessionCookie("", 0);
}

// What the Settings page shows about the signed-in account.
export async function accountInfo(request: Request, env: Env, user: User) {
  const row = await env.DB.prepare("SELECT created_at, pass_hash != '' AS has_password, brand FROM users WHERE id = ?")
    .bind(user.id)
    .first<{ created_at: number; has_password: number; brand: string | null }>();
  // Signed-in browsers.
  const sessions = await env.DB.prepare("SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?1 AND expires_at > ?2")
    .bind(user.id, Date.now())
    .first<{ n: number }>();
  return { ...user, createdAt: row?.created_at ?? 0, hasPassword: !!row?.has_password, sessions: sessions?.n ?? 1, brand: parseBrand(row?.brand) };
}

export async function rename(env: Env, user: User, name: unknown) {
  const clean = String(name ?? "").trim().slice(0, 60);
  if (!clean) return { error: "Enter your first name" };
  await env.DB.prepare("UPDATE users SET name = ? WHERE id = ?").bind(clean, user.id).run();
  return { user: { ...user, name: clean } };
}

// Changes the password, or sets a first one on an account created with Google.
export async function changePassword(env: Env, user: User, current: unknown, next: unknown, request?: Request) {
  const password = String(next ?? "");
  if (password.length < 8) return { error: "Password must be at least 8 characters" };
  const row = await env.DB.prepare("SELECT pass_hash, pass_salt FROM users WHERE id = ?")
    .bind(user.id)
    .first<{ pass_hash: string; pass_salt: string }>();
  if (row?.pass_hash && !sameString(await hashPassword(String(current ?? ""), row.pass_salt), row.pass_hash)) {
    return { error: "Wrong current password" };
  }
  // The new password keeps what was known of the address; a first password on a Google account has it proven.
  const mark = !row?.pass_hash ? PROVEN : [PROVEN, UNPROVEN].find((m) => row.pass_salt.startsWith(m)) ?? "";
  const salt = mark + randomToken(16);
  await env.DB.prepare("UPDATE users SET pass_hash = ?, pass_salt = ? WHERE id = ?")
    .bind(await hashPassword(password, salt), salt, user.id)
    .run();
  // A new password ends every other session: whoever knew the old one is out.
  if (request) await logoutOthers(request, env, user);
  return { ok: true };
}

// Signs out every other browser, keeping this one.
export async function logoutOthers(request: Request, env: Env, user: User) {
  const token = readCookie(request, SESSION_COOKIE) ?? "";
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?").bind(user.id, await sha256(token)),
  ]);
}

export async function deleteUser(env: Env, user: User) {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM template_reports WHERE user_id = ? OR template_id IN (SELECT id FROM shared_templates WHERE user_id = ?)").bind(user.id, user.id),
    env.DB.prepare("DELETE FROM shared_templates WHERE user_id = ?").bind(user.id),
    // Which templates the account opened (templates.ts useTemplate).
    env.DB.prepare("DELETE FROM ops_daily WHERE day = 'template-uses' AND key LIKE ?").bind(`use:%:${user.id}`),
    env.DB.prepare("DELETE FROM brand_kits WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM ai_usage WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM images WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM polls WHERE user_id = ?").bind(user.id),
    // Leaving their team, or ending the one they lead: members keep their own presentations.
    env.DB.prepare("DELETE FROM team_members WHERE user_id = ? OR owner_id = ?").bind(user.id, user.id),
    env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM reset_tokens WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM users WHERE id = ?").bind(user.id),
  ]);
  return sessionCookie("", 0);
}
