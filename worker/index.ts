import { BOARD_MODES, CONTACT_FIELDS, Room, type BoardMode, type ContactField, type Question } from "./room";
import { accountInfo, changePassword, clearGoogleNonce, currentUser, deleteUser, forgotPassword, googleNonce, googleNonceOk, googleSignIn, login, logout, logoutOthers, networkOf, rename, resetPassword, signup, verifySignup, type User } from "./auth";
import { verifyGoogleToken } from "./google";
import { detectLang, LANGS, translateTexts } from "./translate";
import type { Share } from "./ai-budget";
import { brandFor, cleanBrand, deleteKit, FONT_TYPES, listKits, parseBrand, saveKit, type Brand } from "./brand";
import { aiGenerate, aiImprove, aiRewrite } from "./ai";
import { listTemplates, reportTemplate, shareTemplate, sharedFor, unshareTemplate, useTemplate } from "./templates";
import { SCREEN_STRINGS, UI_STRINGS } from "../src/ui-strings";
import { limitsOf } from "./limits";
import { dailyCleanup, removeUnusedImages } from "./cleanup";
import { acceptInvitation, CAN_OPEN, invitationInfo, inviteMember, leaveTeam, loadTeam, publicUser, removeMember, teamInfo } from "./team";
import { BLANK_LENGTH, FILL_LENGTH, MAX_BLANKS, MAX_DECOYS, normalize, parseFill } from "../src/fill";
import { COUNTDOWN_MAX, COUNTDOWN_MIN, COUNTDOWN_DEFAULT, MAX_PAIRS, MIN_ZONE, SPOT_SCALE, type Zone } from "../src/kinds";
import { mediaOf } from "../src/media";
import { ENTRY_LENGTH, MAX_ENTRIES } from "../src/wheel";
import { parseDecor, type Decor } from "../src/decor";
import { MAX_TOPICS, MIN_TOPICS, TOPIC_LENGTH, isPicker, validRounds } from "../src/rounds";

export { Room };

export interface Env {
  ROOMS: DurableObjectNamespace<Room>;
  DB: D1Database;
  // Public OAuth client id for "Sign in with Google"; empty hides the button.
  GOOGLE_CLIENT_ID?: string;
  AI: Ai;
  // Per-address rate limits (Workers Rate Limiting): sign-in attempts, and writes like uploads or new presentations.
  AUTH_LIMIT?: RateLimit;
  WRITE_LIMIT?: RateLimit;
  // Resend key for sign-up and password emails; MAIL_DEV=1 logs the links instead (local only).
  RESEND_API_KEY?: string;
  MAIL_DEV?: string;
  // "1" once your domain is verified in Resend: turns on email confirmation at sign-up.
  MAIL_READY?: string;
  // This copy's public address, like https://polls.example.com: links in sign-up, password and team emails.
  PUBLIC_URL?: string;
  // Sender of every email, on a domain verified in Resend, like "Polls <hello@example.com>".
  MAIL_FROM?: string;
}

// Codes without look-alike characters (0/O, 1/I/L) so people can type them.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const MAX_OPTIONS = 10;

const planOf = (user: User) => limitsOf(user.plan);
const MAX_TEXT = 140;

function randomString(alphabet: string, length: number) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

// JSON bodies are small (decks, forms); anything bigger than 1 MB, or not an object, is refused as invalid.
const MAX_JSON_BYTES = 1_000_000;

// Reads a body but stops at `max` bytes, so a chunked body with no declared length is never held whole in memory.
async function readCapped(request: Request, max: number): Promise<Uint8Array | null> {
  if (Number(request.headers.get("content-length") ?? 0) > max) return null;
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

async function readJson<T>(request: Request): Promise<T | null> {
  try {
    const bytes = await readCapped(request, MAX_JSON_BYTES);
    if (!bytes) return null;
    const text = new TextDecoder().decode(bytes);
    const data: unknown = JSON.parse(text);
    return data && typeof data === "object" && !Array.isArray(data) ? (data as T) : null;
  } catch {
    return null;
  }
}

const room = (env: Env, code: string) => env.ROOMS.get(env.ROOMS.idFromName(code));

// The phone interface is the same for everyone: once its texts are cached nothing runs, but a text no model translates well
// would be asked again on every visit. Each part of it, in each language, gets one try (a minute: the large model, then the
// fallbacks) every 10 minutes in this worker, whoever asks: only the request that opened the try runs models, and requests
// arriving meanwhile wait for its answer (uiPart).
const uiTries = new Map<string, number>();
const uiShare = (key: string): Share => {
  let mine = false;
  return {
    hold: async () => {
      const now = Date.now();
      const at = uiTries.get(key);
      if (at === undefined || now - at >= 600_000) {
        if (uiTries.size > 2000) uiTries.clear();
        uiTries.set(key, now);
        mine = true;
      }
      return mine && now - (uiTries.get(key) ?? 0) < 60_000;
    },
    settle: async () => {},
  };
};
const uiRuns = new Map<string, Promise<string[]>>();
function uiPart(env: Env, texts: string[], to: string, key: string) {
  let run = uiRuns.get(key);
  if (!run) {
    run = translateTexts(env, texts, "en", to, "interface", [uiShare(key)]).finally(() => uiRuns.delete(key));
    uiRuns.set(key, run);
  }
  return run;
}

// Codes are guessed, not known, when one network keeps asking for rooms that do not exist (the code space can be walked
// to read titles, and each try wakes a room). Past WRITE_LIMIT's count of such misses in a minute, this worker answers that
// network's room requests itself for a minute, except for the codes it already served: a hall behind one address mistyping
// a few codes still reaches its own room. The same wrong code asked again within a minute counts once (phones retry, and
// a hall of people may type the same mistake). An IPv6 address counts with its /64 (auth.ts networkOf).
const guessers = new Map<string, number>();
const knownCodes = new Set<string>();
const recentMisses = new Map<string, number>();
function guessing(ip: string, code: string) {
  const net = networkOf(ip);
  const until = guessers.get(net);
  if (!until) return false;
  if (until > Date.now()) return !knownCodes.has(code);
  guessers.delete(net);
  return false;
}
async function roomSeen(env: Env, ip: string, code: string, found: boolean) {
  if (found) {
    if (knownCodes.size > 5000) knownCodes.clear();
    knownCodes.add(code);
    return;
  }
  const net = networkOf(ip);
  const now = Date.now();
  const miss = `${net}:${code}`;
  if (now - (recentMisses.get(miss) ?? 0) < 60_000) return;
  if (recentMisses.size > 5000) recentMisses.clear();
  recentMisses.set(miss, now);
  if (env.WRITE_LIMIT && !(await env.WRITE_LIMIT.limit({ key: `miss:${net}` })).success) {
    if (guessers.size > 5000) guessers.clear();
    guessers.set(net, now + 60_000);
  }
}

const IMAGE_PATH = /^\/api\/images\/[a-f0-9]{32}$/;
// Uploaded files: question and brand images, and brand fonts.
const IMAGE_TYPES = ["image/webp", "image/jpeg", "image/png", ...FONT_TYPES];
const MAX_IMAGE_BYTES = 1_500_000;
// Uploads live in D1 with everything else (10 GB at most per database), so each account has a share:
// a number of files, bytes in all and bytes a day (the last 24 hours). Photos are shrunk to a few hundred KB before upload.
const MAX_IMAGES_PER_USER = 300;
const IMAGE_BYTES = { total: 300_000_000, day: 100_000_000 };
// Past this size of the whole database (D1 holds 10 GB at most), no new file is taken, whoever sends it.
const IMAGES_STOP_BYTES = 4.5 * 1024 ** 3;
// The database size as the last upload saw it (D1 reports it after each query), in this worker's memory.
let dbBytes = 0;

const TYPES = ["choice", "scale", "words", "open", "rank", "qa", "contact", "scales", "number", "slide", "link", "points", "fill", "match", "spot", "wheel", "countdown", "media"] as const;
// A game's timer: any whole number of seconds from 5 to 600 (the builder offers 10, 20, 30, 60 or a time of your own).
const timerOf = (raw: unknown) => {
  const s = Number(raw);
  return Number.isInteger(s) && s >= 5 && s <= 600 ? s : undefined;
};
const SLIDE_TEXT = 600;
const URL_LENGTH = 500;
// A link to open: http or https only, written with or without "https://".
function cleanUrl(raw: unknown) {
  let text = String(raw ?? "").trim();
  if (!text || text.length > URL_LENGTH) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(text)) text = `https://${text}`;
  try {
    const url = new URL(text);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || !url.hostname.includes(".")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function cleanQuestion(raw: {
  type?: unknown;
  question?: unknown;
  options?: unknown;
  image?: unknown;
  correct?: unknown;
  multi?: unknown;
  timer?: unknown;
  max?: unknown;
  labels?: unknown;
  fields?: unknown;
  style?: unknown;
  text?: unknown;
  url?: unknown;
  answer?: unknown;
  ordered?: unknown;
  fill?: unknown;
  fillMode?: unknown;
  decoys?: unknown;
  zone?: unknown;
  duration?: unknown;
  topics?: unknown;
  rounds?: unknown;
  topic?: unknown;
}): Question | string {
  const type = TYPES.find((t) => t === raw?.type) ?? "choice";
  const question = String(raw?.question ?? "").trim().slice(0, MAX_TEXT);
  if (!question) return "Every question needs a title";
  const image = typeof raw?.image === "string" && IMAGE_PATH.test(raw.image) ? raw.image : undefined;
  const q: Question = { type, question, options: [] };
  if (image) q.image = image;
  if (raw?.topics === true && (type === "wheel" || type === "choice")) {
    // Topic rounds (src/rounds.ts): a wheel or a vote among 2 to 8 topics, each named once. A vote has no right answer.
    const topics = (Array.isArray(raw?.options) ? raw.options : []).map((o) => String(o ?? "").trim().replace(/\s+/g, " ").slice(0, TOPIC_LENGTH)).filter(Boolean);
    if (topics.length < MIN_TOPICS) return `Add at least ${MIN_TOPICS} topics to "${question.slice(0, 40)}"`;
    if (topics.length > MAX_TOPICS) return `Up to ${MAX_TOPICS} topics in "${question.slice(0, 40)}"`;
    if (new Set(topics.map((t) => t.toLocaleLowerCase())).size !== topics.length) return `Each topic of "${question.slice(0, 40)}" needs its own name`;
    const out: Question = { type, question, options: topics, topics: true };
    if (image) out.image = image;
    const rounds = Number(raw?.rounds);
    if (Number.isInteger(rounds) && rounds >= 1 && rounds <= topics.length) out.rounds = rounds;
    return out;
  }

  // Empty options are dropped; `kept` maps each option left to its place in what was sent, so the right answer stays the same option.
  let kept: number[] = [];
  let sent: string[] = [];
  if (type === "choice" || type === "rank" || type === "scales" || type === "points") {
    sent = (Array.isArray(raw?.options) ? raw.options : []).map((o) => String(o).trim().slice(0, MAX_TEXT));
    kept = sent.map((_, i) => i).filter((i) => sent[i]).slice(0, MAX_OPTIONS);
    q.options = kept.map((i) => sent[i]);
    if (q.options.length < 2) return type === "scales" ? `Add at least 2 statements to "${question.slice(0, 40)}"` : `Add at least 2 options to "${question.slice(0, 40)}"`;
  }
  if (type === "rank" && raw?.ordered === true) {
    // The options are written in the right order: a game, with an optional timer.
    q.ordered = true;
    const timer = timerOf(raw?.timer);
    if (timer) q.timer = timer;
  }
  if (type === "number" && raw?.answer !== undefined && raw?.answer !== null && raw?.answer !== "") {
    const answer = Number(raw.answer);
    if (!Number.isFinite(answer) || Math.abs(answer) > 1e12) return `The right answer of "${question.slice(0, 40)}" is not a number`;
    q.answer = Math.round(answer * 1e6) / 1e6;
    const timer = timerOf(raw?.timer);
    if (timer) q.timer = timer;
  }
  if (type === "slide") {
    const text = String(raw?.text ?? "").trim().slice(0, SLIDE_TEXT);
    if (text) q.text = text;
  }
  if (type === "link") {
    const url = cleanUrl(raw?.url);
    if (!url) return `Add a valid link to "${question.slice(0, 40)}"`;
    q.url = url;
  }
  if (type === "media") {
    const url = cleanUrl(raw?.url);
    if (!url || !mediaOf(url)) return `Add a video or audio link to "${question.slice(0, 40)}"`;
    q.url = url;
  }
  if (type === "fill") {
    const text = String(raw?.fill ?? "").trim().replace(/[ \t]+/g, " ").slice(0, FILL_LENGTH);
    const { answers } = parseFill(text);
    if (!answers.length) return `Put the answers between brackets in "${question.slice(0, 40)}"`;
    if (answers.length > MAX_BLANKS) return `Up to ${MAX_BLANKS} blanks in "${question.slice(0, 40)}"`;
    if (answers.some((a) => !a.length)) return `Each blank of "${question.slice(0, 40)}" needs its answer`;
    q.fill = text;
    // People place words (the answers and the extra ones) instead of typing them. Extra words are kept once each,
    // never one that is already an answer.
    if (raw?.fillMode === "words") {
      q.fillMode = "words";
      const seen = new Set(answers.flat().map(normalize));
      const decoys = (Array.isArray(raw?.decoys) ? raw.decoys : [])
        .map((d) => String(d ?? "").trim().replace(/\s+/g, " ").slice(0, BLANK_LENGTH))
        .filter((d) => {
          const key = normalize(d);
          if (!key || seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .slice(0, MAX_DECOYS);
      if (decoys.length) q.decoys = decoys;
    }
    const timer = timerOf(raw?.timer);
    if (timer) q.timer = timer;
  }
  if (type === "match") {
    // The left items, then the right items: pair i is left i with right i. Empty pairs are dropped.
    const list = (Array.isArray(raw?.options) ? raw.options : []).map((o) => String(o ?? "").trim().slice(0, MAX_TEXT));
    const half = Math.floor(list.length / 2);
    const pairs = Array.from({ length: half }, (_, i) => [list[i], list[half + i]] as const).filter(([a, b]) => a || b);
    if (pairs.some(([a, b]) => !a || !b)) return `Each pair of "${question.slice(0, 40)}" needs both sides`;
    if (pairs.length < 2) return `Add at least 2 pairs to "${question.slice(0, 40)}"`;
    const kept = pairs.slice(0, MAX_PAIRS);
    q.options = [...kept.map(([a]) => a), ...kept.map(([, b]) => b)];
    const timer = timerOf(raw?.timer);
    if (timer) q.timer = timer;
  }
  if (type === "spot") {
    if (!image) return `Add the image to "${question.slice(0, 40)}"`;
    // The right zone, in thousandths of the image: a game when set.
    const zone = Array.isArray(raw?.zone) && raw.zone.length === 4 ? (raw.zone.map((n) => Math.round(Number(n))) as Zone) : null;
    if (zone && zone.every(Number.isFinite) && zone[0] >= 0 && zone[1] >= 0 && zone[2] >= MIN_ZONE && zone[3] >= MIN_ZONE && zone[0] + zone[2] <= SPOT_SCALE && zone[1] + zone[3] <= SPOT_SCALE) {
      q.zone = zone;
      const timer = timerOf(raw?.timer);
      if (timer) q.timer = timer;
    }
  }
  if (type === "wheel") {
    // Its own entries, or none: then it spins among the first names of the people connected.
    q.options = (Array.isArray(raw?.options) ? raw.options : []).map((o) => String(o ?? "").trim().slice(0, ENTRY_LENGTH)).filter(Boolean).slice(0, MAX_ENTRIES);
    if (q.options.length === 1) return `Add at least 2 entries to "${question.slice(0, 40)}"`;
  }
  if (type === "countdown") {
    const d = Number(raw?.duration);
    q.duration = Number.isInteger(d) && d >= COUNTDOWN_MIN && d <= COUNTDOWN_MAX ? d : COUNTDOWN_DEFAULT;
  }
  if (type === "choice") {
    const picked = raw?.correct === undefined || raw?.correct === null ? NaN : Number(raw.correct);
    const correct = Number.isInteger(picked) ? kept.indexOf(picked) : -1;
    if (correct < 0 && Number.isInteger(picked) && picked >= 0 && picked < sent.length) return `The right answer of "${question.slice(0, 40)}" is an empty option`;
    if (correct >= 0) {
      q.correct = correct;
      const timer = timerOf(raw?.timer);
      if (timer) q.timer = timer;
    } else if (raw?.multi === true) {
      q.multi = true;
    }
  }
  if (type === "contact") {
    const fields = (Array.isArray(raw?.fields) ? raw.fields : []).filter((f): f is ContactField => CONTACT_FIELDS.includes(f as ContactField));
    q.fields = fields.length ? [...new Set(fields)] : ["email"];
  }
  // A question of a topic: the index of its topic (parseDeck checks it against the picker).
  if (raw?.topic !== undefined && raw?.topic !== null) {
    const topic = Number(raw.topic);
    if (!Number.isInteger(topic) || topic < 0 || topic >= MAX_TOPICS) return `"${question.slice(0, 40)}" belongs to no topic`;
    q.topic = topic;
  }
  if (type === "scale" || type === "scales") {
    q.max = Number(raw?.max) === 10 ? 10 : 5;
    // The results style: bars unless the owner picked another one.
    const style = String(raw?.style ?? "");
    if (type === "scale" && (style === "slider" || style === "gauge" || style === "dots")) q.style = style;
    const labels = Array.isArray(raw?.labels) ? raw.labels.map((l) => String(l ?? "").trim().slice(0, 40)) : [];
    if (labels[0] || labels[1]) q.labels = [labels[0] ?? "", labels[1] ?? ""];
  }
  return q;
}

type DeckBody = { title?: unknown; questions?: unknown; question?: unknown; options?: unknown; names?: unknown; brand?: unknown; lang?: unknown; intro?: unknown; boardMode?: unknown; decor?: unknown; base?: unknown; force?: unknown };

// The language a presentation's text reads in: what a save without a chosen language stores.
function detectedLang(title: string, questions: (Pick<Question, "question" | "options" | "text" | "fill"> & { labels?: string[] })[]) {
  return detectLang([title, ...questions.flatMap((q) => [q.question, ...q.options, ...(q.labels ?? []), ...(q.text ? [q.text] : []), ...(q.fill ? [parseFill(q.fill).pieces.join(" ")] : [])])]);
}

function parseDeck(body: DeckBody, user: User): { title: string; questions: Question[]; names: boolean; lang: string; brand: Brand | null; intro?: boolean; boardMode?: BoardMode; decor?: Decor | null } | Response {
  // Older clients send a single question.
  const rawQuestions = Array.isArray(body.questions) ? body.questions : [{ question: body.question, options: body.options }];
  if (rawQuestions.length === 0) return json({ error: "Add at least one question" }, 400);
  const plan = planOf(user);
  if (rawQuestions.length > plan.questions) return json({ error: `${plan.questions} questions max per presentation.`, code: "limit" }, 400);
  const questions: Question[] = [];
  for (const raw of rawQuestions) {
    const q = cleanQuestion(raw);
    if (typeof q === "string") return json({ error: q }, 400);
    // A wheel without entries spins among first names: the presentation must ask for them.
    if (q.type === "wheel" && !q.options.length && body.names !== true) return json({ error: `Add entries to "${q.question.slice(0, 40)}", or ask for first names` }, 400);
    questions.push(q);
  }
  // Topic rounds hold together: one picker, each topic's questions right after it, in order, none empty.
  // Without a picker, a topic left on a question means nothing: it is dropped.
  if (!questions.some(isPicker)) for (const q of questions) delete q.topic;
  const rounds = validRounds(questions);
  if (rounds) return json({ error: rounds }, 400);
  const title = String(body.title ?? "").trim().slice(0, MAX_TEXT) || questions[0].question;
  // Participants give a first name, shown on the waiting screen; otherwise everyone stays anonymous.
  // Phones translate from this language.
  const lang = typeof body.lang === "string" && LANGS.includes(body.lang) ? body.lang : detectedLang(title, questions);
  // Logo, color and background for this presentation.
  // The launch animation: a save without it leaves it as it is.
  // The quiz leaderboard (after each question, at the end, off): missing or unknown, the stored one stays.
  const boardMode = BOARD_MODES.find((m) => m === body.boardMode);
  // The seasonal decor: "halloween", null or "normal" for the normal one; missing or unknown, the stored one stays.
  const decor = parseDecor(body.decor);
  return { title, questions, names: body.names === true, lang, brand: cleanBrand(body.brand), intro: typeof body.intro === "boolean" ? body.intro : undefined, boardMode, decor };
}

// The last brand used prefills the next presentation.
// The next new presentation starts with the last design saved, or with none when the builder went back to the default.
// Tools that send no design at all (`sent` false) leave the remembered one alone.
async function rememberBrand(env: Env, user: User, brand: Brand | null, sent: boolean) {
  if (brand || sent) await env.DB.prepare("UPDATE users SET brand = ? WHERE id = ?").bind(brand ? JSON.stringify(brand) : null, user.id).run();
}

// AI help for the builder: /api/ai/generate, /api/ai/improve and /api/ai/rewrite.
async function aiRoute(request: Request, env: Env, user: User, action: string, headers: Record<string, string> = {}) {
  const body = (await readJson<Record<string, unknown>>(request)) ?? {};
  const out =
    action === "generate" ? await aiGenerate(env, user, body, (raw) => cleanQuestion(raw as never)) : action === "improve" ? await aiImprove(env, user, body) : await aiRewrite(env, user, body);
  return out.ok ? json(out.data, 200, headers) : json({ error: out.error }, out.status, headers);
}

async function updatePoll(request: Request, env: Env, user: User, code: string) {
  const body = await readJson<DeckBody>(request);
  if (!body) return json({ error: "Invalid request" }, 400);
  const parsed = parseDeck(body, user);
  if (parsed instanceof Response) return parsed;
  // `base`: when the builder opened it. A teammate's save since then is not overwritten unless the person insists.
  const base = typeof body.base === "number" && body.force !== true ? body.base : undefined;
  const saved = await room(env, code).update(parsed.title, parsed.questions, parsed.names, parsed.lang, { intro: parsed.intro, boardMode: parsed.boardMode, decor: parsed.decor, by: { id: user.id, name: user.name }, base });
  if ("conflict" in saved) return json({ error: "A teammate saved this presentation while you were editing it.", code: "conflict", by: saved.conflict }, 409);
  // Access was checked by the caller: the author may be a teammate.
  await env.DB.prepare("UPDATE polls SET question = ?, options = ?, questions = ?, brand = ? WHERE code = ?")
    .bind(parsed.title, JSON.stringify(parsed.questions[0].options), JSON.stringify(parsed.questions), parsed.brand ? JSON.stringify(parsed.brand) : null, code)
    .run();
  await rememberBrand(env, user, parsed.brand, "brand" in body);
  return json({ ok: true });
}

// The real format, read from the file's first bytes: a renamed file is stored as what it is, anything else is refused.
function sniff(data: ArrayBuffer): string | null {
  const b = new Uint8Array(data.slice(0, 12));
  const text = (from: number, to: number) => String.fromCharCode(...b.slice(from, to));
  if (b[0] === 0x89 && text(1, 4) === "PNG") return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (text(0, 4) === "RIFF" && text(8, 12) === "WEBP") return "image/webp";
  if (text(0, 4) === "wOF2") return "font/woff2";
  if (text(0, 4) === "wOFF") return "font/woff";
  if (text(0, 4) === "OTTO") return "font/otf";
  if ((b[0] === 0 && b[1] === 1 && b[2] === 0 && b[3] === 0) || text(0, 4) === "true") return "font/ttf";
  return null;
}

async function uploadImage(request: Request, env: Env, user: User) {
  if (!IMAGE_TYPES.includes(request.headers.get("content-type") ?? "")) return json({ error: "File format not supported" }, 415);
  // Refuse on the declared length first, so an oversized body is never read into memory.
  if (Number(request.headers.get("content-length") ?? 0) > MAX_IMAGE_BYTES) return json({ error: "File too large (1.5 MB max)" }, 413);
  const bytes = await readCapped(request, MAX_IMAGE_BYTES);
  if (!bytes) return json({ error: "File too large (1.5 MB max)" }, 413);
  const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const type = sniff(data);
  if (!type || !IMAGE_TYPES.includes(type)) return json({ error: "File format not supported" }, 415);
  if (dbBytes > IMAGES_STOP_BYTES) return json({ error: "Uploads are paused for now. Try again later." }, 503);
  const quota = IMAGE_BYTES;
  const id = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
  // Counted and written in one statement: uploads sent at the same moment cannot pass the account's share together.
  const insert = () =>
    env.DB.prepare(
      `INSERT INTO images (id, user_id, type, data, created_at) SELECT ?1, ?2, ?3, ?4, ?5
       FROM (SELECT COUNT(*) AS n, COALESCE(SUM(length(data)), 0) AS bytes, COALESCE(SUM(CASE WHEN created_at > ?6 THEN length(data) END), 0) AS day FROM images WHERE user_id = ?2)
       WHERE n < ?7 AND bytes + ?8 <= ?9 AND day + ?8 <= ?10`,
    )
      .bind(id, user.id, type, data, Date.now(), Date.now() - 86_400_000, MAX_IMAGES_PER_USER, data.byteLength, quota.total, quota.day)
      .run();
  let result = await insert();
  // At the cap, files no presentation uses any more make room first.
  if (!result.meta.changes && (await removeUnusedImages(env, 86_400_000, user.id)) > 0) result = await insert();
  dbBytes = result.meta.size_after ?? dbBytes;
  if (!result.meta.changes) {
    const used = await env.DB.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(length(data)), 0) AS bytes FROM images WHERE user_id = ?").bind(user.id).first<{ n: number; bytes: number }>();
    const full = (used?.n ?? 0) >= MAX_IMAGES_PER_USER || (used?.bytes ?? 0) + data.byteLength > quota.total;
    return json({ error: full ? "Too many uploaded files. Remove unused images from your presentations first." : "Upload limit reached for today. Try again tomorrow." }, 429);
  }
  return json({ url: `/api/images/${id}` });
}

async function serveImage(env: Env, id: string) {
  const row = await env.DB.prepare("SELECT type, data FROM images WHERE id = ?").bind(id).first<{ type: string; data: ArrayBuffer }>();
  if (!row) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(row.data), {
    // Fonts are read by @font-face, which follows CORS: any origin may read them.
    headers: { "content-type": row.type, "cache-control": "public, max-age=31536000, immutable", "access-control-allow-origin": "*" },
  });
}

async function createPoll(request: Request, env: Env, user: User) {
  const body = await readJson<DeckBody>(request);
  if (!body) return json({ error: "Invalid request" }, 400);
  const parsed = parseDeck(body, user);
  if (parsed instanceof Response) return parsed;
  const { title, questions, names, lang, brand } = parsed;
  const plan = planOf(user);
  const limit = () => json({ error: `Up to ${plan.decks} presentations on this account.`, code: "limit" }, 403);

  if (Number.isFinite(plan.decks)) {
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM polls WHERE user_id = ?").bind(user.id).first<{ n: number }>();
    if ((row?.n ?? 0) >= plan.decks) return limit();
  }

  const hostKey = randomString(CODE_ALPHABET, 24);
  const createdAt = Date.now();
  // The row goes in first, then the room; a code already taken (by a row or a room) is tried again with another.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomString(CODE_ALPHABET, 5);
    const added = await env.DB.prepare(
      `INSERT INTO polls (code, user_id, question, options, host_key, created_at, questions, brand) SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8`,
    )
      .bind(code, user.id, title, JSON.stringify(questions[0].options), hostKey, createdAt, JSON.stringify(questions), brand ? JSON.stringify(brand) : null)
      .run()
      .then((r) => (r.meta.changes ?? 0) > 0)
      .catch((err: unknown) => {
        if (String(err).includes("UNIQUE")) return null;
        throw err;
      });
    if (added === null) continue;
    const drop = () => env.DB.prepare("DELETE FROM polls WHERE code = ? AND user_id = ?").bind(code, user.id).run();
    const made = await room(env, code)
      .init({ title, questions, hostKey, createdAt, maxVoters: plan.voters, names, lang, code, intro: parsed.intro === true, ...(parsed.boardMode ? { boardMode: parsed.boardMode } : {}), ...(parsed.decor ? { decor: parsed.decor } : {}) })
      .catch(async (err: unknown) => {
        await drop();
        throw err;
      });
    if (made) {
      await rememberBrand(env, user, brand, "brand" in body);
      return json({ code, hostKey });
    }
    await drop();
  }
  return json({ error: "Try again in a moment" }, 503);
}

// A user's presentations, and their team's: each teammate's shows who made it.
async function visiblePolls(env: Env, user: User, limit: number) {
  const { results } = await env.DB.prepare(
    `SELECT p.code, p.question, p.created_at, p.user_id, u.name FROM polls p JOIN users u ON u.id = p.user_id WHERE ${CAN_OPEN} ORDER BY p.created_at DESC LIMIT ?3`,
  )
    .bind(user.id, user.team ?? null, limit)
    .all<{ code: string; question: string; created_at: number; user_id: string; name: string }>();
  return results.map((p) => ({ ...p, by: p.user_id === user.id ? undefined : p.name }));
}

// Only some of them (the home page following a live session asks for the live ones): one room each, not all 200.
async function pollsByCode(env: Env, user: User, codes: string[]) {
  const { results } = await env.DB.prepare(
    `SELECT p.code, p.question, p.created_at, p.user_id, u.name FROM polls p JOIN users u ON u.id = p.user_id WHERE ${CAN_OPEN} AND p.code IN (SELECT value FROM json_each(?3))`,
  )
    .bind(user.id, user.team ?? null, JSON.stringify(codes))
    .all<{ code: string; question: string; created_at: number; user_id: string; name: string }>();
  return results.map((p) => ({ ...p, by: p.user_id === user.id ? undefined : p.name }));
}

async function listPolls(env: Env, user: User, only: string | null) {
  const codes = only === null ? null : [...new Set(only.split(",").filter((c) => /^[A-Z0-9]{5}$/.test(c)))].slice(0, 20);
  const results = codes ? (codes.length ? await pollsByCode(env, user, codes) : []) : await visiblePolls(env, user, 200);
  const polls = await Promise.all(
    results.map(async (p) => {
      const o = await room(env, p.code).overview();
      return {
        code: p.code,
        title: p.question,
        questions: o?.questions ?? 0,
        createdAt: p.created_at,
        votes: o?.total ?? 0,
        participants: o?.participants ?? 0,
        kinds: o?.kinds ?? [],
        sequence: o?.sequence ?? [],
        by: p.by,
        live: o?.live ?? 0,
        current: o?.current ?? 0,
        editedAt: o?.editedAt ?? null,
        shownAt: o?.shownAt ?? null,
        answered: o?.answered ?? [],
      };
    }),
  );
  const plan = planOf(user);
  const finite = (n: number) => (Number.isFinite(n) ? n : null);
  return json({ polls, limits: { decks: finite(plan.decks), questions: plan.questions, voters: plan.voters } });
}

// A presentation the user may open and run: their own, or a teammate's while the team runs.
async function ownedPoll(env: Env, user: User, code: string) {
  return env.DB.prepare(`SELECT p.code, p.host_key, p.created_at, p.brand, p.question, p.questions, p.user_id FROM polls p WHERE p.code = ?3 AND ${CAN_OPEN}`)
    .bind(user.id, user.team ?? null, code)
    .first<{ code: string; host_key: string; created_at: number; brand: string | null; question: string; questions: string; user_id: string }>();
}

// The presenter key of a presentation for this person: the room's own for its author, one of their own for a teammate
// (room.ts memberKey), which stops working once they leave the team.
async function keyFor(env: Env, user: User, owned: { code: string; host_key: string; user_id: string }) {
  if (owned.user_id === user.id) return (await room(env, owned.code).hostKey()) ?? owned.host_key;
  return room(env, owned.code).memberKey(user.id, "h");
}

// New presenter and slide keys: every key given before stops working (someone who could open these left the team,
// or the author asked). Screens using an old key ask for the new one on their own.
async function rotateKeys(env: Env, codes: string[]) {
  const keys = codes.map((code) => ({ code, key: randomString(CODE_ALPHABET, 24) }));
  for (let i = 0; i < keys.length; i += 20) {
    const part = keys.slice(i, i + 20);
    await Promise.all(part.map(({ code, key }) => room(env, code).newKeys(key)));
    await env.DB.batch(part.map(({ code, key }) => env.DB.prepare("UPDATE polls SET host_key = ? WHERE code = ?").bind(key, code)));
  }
  return new Map(keys.map(({ code, key }) => [code, key]));
}

const AUTH_PATHS = new Set(["/api/auth/signup", "/api/auth/login", "/api/auth/verify", "/api/auth/forgot", "/api/auth/reset", "/api/auth/google", "/api/account/password"]);
const tooMany = () => json({ error: "Too many attempts. Wait a minute and try again." }, 429, { "Retry-After": "60" });

async function api(request: Request, env: Env, url: URL): Promise<Response> {
  const { pathname } = url;
  const method = request.method;

  if (pathname === "/api/health") {
    const db = await env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>().catch(() => null);
    return json({ ok: !!db, time: Date.now() }, db ? 200 : 503, { "Cache-Control": "no-store" });
  }

  // Brute force and floods are cut per address before any work is done.
  if (method === "POST" || method === "PUT" || method === "DELETE") {
    const ip = request.headers.get("CF-Connecting-IP") ?? "local";
    const limiter = AUTH_PATHS.has(pathname) ? env.AUTH_LIMIT : env.WRITE_LIMIT;
    // Each sign-in action has its own count, so a class signing up together is not blocked by the logins.
    // An IPv6 address counts with its /64, which one person can walk through.
    const key = AUTH_PATHS.has(pathname) ? `${pathname}:${networkOf(ip)}` : `${pathname.split("/")[2]}:${ip}`;
    if (limiter && !(await limiter.limit({ key })).success) return tooMany();
  }

  // Cookies ride along on cross-site requests; refuse writes that don't come from our own pages.
  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
    const origin = request.headers.get("Origin");
    if (origin && new URL(origin).host !== url.host) return json({ error: "Origin refused" }, 403);
  }

  // The owner's logo, color and background, for the big screen and the phones.
  const brandRoute = pathname.match(/^\/api\/rooms\/([A-Z0-9]{5})\/brand$/);
  if (brandRoute && method === "GET") {
    return json({ brand: await brandFor(env, brandRoute[1]) }, 200, { "Cache-Control": "public, max-age=30" });
  }

  // Public room requests from an address walking the code space stop here (see guessing).
  const ip = request.headers.get("CF-Connecting-IP") ?? "local";
  const roomCode = pathname.match(/^\/api\/rooms\/([A-Z0-9]{5})\//)?.[1];
  if (roomCode && method === "GET" && guessing(ip, roomCode)) return tooMany();

  // Read-only endpoints any origin may call: a room's title, and its results with a presenter key.
  const pub = pathname.match(/^\/api\/rooms\/([A-Z0-9]{5})\/(info|results)$/);
  if (pub) {
    const cors = { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" };
    if (method === "OPTIONS") return new Response(null, { headers: { ...cors, "Access-Control-Allow-Methods": "GET", "Access-Control-Allow-Headers": "*" } });
    if (method !== "GET") return json({ error: "Method not allowed" }, 405, cors);
    const data =
      pub[2] === "info"
        ? await room(env, pub[1]).info()
        : await room(env, pub[1]).resultsFor(url.searchParams.get("key") ?? "", pub[1]);
    if (pub[2] === "info") await roomSeen(env, ip, pub[1], !!data);
    if (!data) return json({ error: pub[2] === "info" ? "Presentation not found" : "Wrong key" }, 404, cors);
    return json(data, 200, cors);
  }

  // The phone interface in the participant's language, translated once and cached.
  // Interface text in a language not written by hand. set=screen: the big screen's, which also shows the phones' result views.
  if (pathname === "/api/ui" && method === "GET") {
    const to = url.searchParams.get("lang") ?? "";
    if (!LANGS.includes(to)) return json({ error: "Language not supported" }, 400);
    const list = url.searchParams.get("set") === "screen" ? [...new Set([...UI_STRINGS, ...SCREEN_STRINGS])] : UI_STRINGS;
    // In parts, so each model answer stays short (each text is cached on its own: a part already done costs nothing).
    const out: string[] = [];
    for (let i = 0; i < list.length; i += 70) out.push(...(await uiPart(env, list.slice(i, i + 70), to, `${to}:${list.length}:${i}`)));
    // Past the AI quota the originals come back untranslated: keep that answer for a minute, not a day.
    const translated = to === "en" || out.filter((t, i) => t !== list[i]).length >= list.length / 2;
    return json(Object.fromEntries(list.map((s, i) => [s, out[i]])), 200, { "Cache-Control": translated ? "public, max-age=86400" : "public, max-age=60" });
  }

  // Participants read the question in their language. Only this room's own text can be translated,
  // and only the question on screen or next to it (Room.translateShown).
  const tr = pathname.match(/^\/api\/rooms\/([A-Z0-9]{5})\/translate$/);
  if (tr && method === "GET") {
    const to = url.searchParams.get("lang") ?? "";
    const index = Number(url.searchParams.get("i") ?? 0);
    if (!LANGS.includes(to) || !Number.isInteger(index)) return json({ error: "Language not supported" }, 400);
    // Done inside the room: when the presenter moves on, every phone in that language shares one translation.
    // ahead=0: the phone is asking early for the next question, the room does not go one further.
    const out = await room(env, tr[1]).translateShown(index, to, url.searchParams.get("ahead") !== "0", ip);
    await roomSeen(env, ip, tr[1], !!out);
    if (!out || "refused" in out) return json({ error: "Not found" }, 404);
    return json(out, 200, { "Cache-Control": "private, max-age=60" });
  }

  // What the audience wrote, in one language: Q&A questions and open answers, or the words of a cloud.
  const posts = pathname.match(/^\/api\/rooms\/([A-Z0-9]{5})\/(posts|words)$/);
  if (posts && method === "GET") {
    const to = url.searchParams.get("lang") ?? "";
    const index = Number(url.searchParams.get("i") ?? 0);
    if (!LANGS.includes(to) || !Number.isInteger(index)) return json({ error: "Language not supported" }, 400);
    const out = posts[2] === "words" ? await room(env, posts[1]).translateWords(index, to, ip) : await room(env, posts[1]).translatePosts(index, to, ip);
    return json(out, 200, { "Cache-Control": "no-store" });
  }

  const ws = pathname.match(/^\/api\/rooms\/([A-Z0-9]{5})\/ws$/);
  if (ws) {
    const res = await room(env, ws[1]).fetch(request);
    await roomSeen(env, ip, ws[1], res.status !== 404);
    return res;
  }

  if (pathname === "/api/auth/signup" && method === "POST") {
    const result = await signup((await readJson(request)) ?? {}, env, request.headers.get("CF-Connecting-IP") ?? "local");
    if ("error" in result) return json({ error: result.error }, 400);
    if ("cookie" in result) return json({ user: publicUser(await loadTeam(env, result.user)) }, 200, { "Set-Cookie": result.cookie });
    return json({ pending: true, ...("devToken" in result ? { devToken: result.devToken } : {}) });
  }
  if (pathname === "/api/auth/verify" && method === "POST") {
    const result = await verifySignup((await readJson<{ token?: unknown }>(request))?.token, env);
    if ("error" in result) return json({ error: result.error }, 400);
    return json({ user: publicUser(await loadTeam(env, result.user)) }, 200, { "Set-Cookie": result.cookie });
  }
  if (pathname === "/api/auth/forgot" && method === "POST") {
    const result = await forgotPassword((await readJson(request)) ?? {}, env, request.headers.get("CF-Connecting-IP") ?? "local");
    return "error" in result ? json({ error: result.error }, 400) : json({ ok: true });
  }
  if (pathname === "/api/auth/reset" && method === "POST") {
    const result = await resetPassword((await readJson<{ token?: unknown; password?: unknown }>(request)) ?? {}, env);
    if ("error" in result) return json({ error: result.error }, 400);
    const res = json({ user: publicUser(await loadTeam(env, result.user)) }, 200, { "Set-Cookie": result.cookie });
    res.headers.append("Set-Cookie", result.known);
    return res;
  }
  if (pathname === "/api/auth/login" && method === "POST") {
    const result = await login((await readJson(request)) ?? {}, env, request);
    if ("error" in result) return json({ error: result.error, code: "code" in result ? result.code : undefined }, result.code === "slow" ? 429 : 401);
    const res = json({ user: publicUser(await loadTeam(env, result.user)) }, 200, { "Set-Cookie": result.cookie });
    // This browser now skips the wait when someone else is guessing the password (auth.ts guessing).
    res.headers.append("Set-Cookie", result.known);
    return res;
  }
  const image = pathname.match(/^\/api\/images\/([a-f0-9]{32})$/);
  if (image && method === "GET") return serveImage(env, image[1]);

  if (pathname === "/api/config") {
    return json({ googleClientId: env.GOOGLE_CLIENT_ID || null });
  }
  // The nonce Google writes into the ID token, tied to a secret in this browser's cookie.
  if (pathname === "/api/auth/google/start" && method === "GET") {
    if (!env.GOOGLE_CLIENT_ID) return json({ error: "Google sign-in unavailable" }, 404);
    const { nonce, cookie } = await googleNonce();
    return json({ nonce }, 200, { "Set-Cookie": cookie, "Cache-Control": "no-store" });
  }
  if (pathname === "/api/auth/google" && method === "POST") {
    if (!env.GOOGLE_CLIENT_ID) return json({ error: "Google sign-in unavailable" }, 404);
    const body = await readJson<{ credential?: unknown }>(request);
    const claims = await verifyGoogleToken(String(body?.credential ?? ""), env.GOOGLE_CLIENT_ID);
    // The nonce ties the token to the sign-in this browser started: a token taken from elsewhere is refused.
    if (!claims || !(await googleNonceOk(request, claims.nonce))) {
      return json({ error: "Google sign-in refused, try again" }, 401);
    }
    const result = await googleSignIn(claims.email, claims.given_name ?? claims.name ?? "", env);
    const res = json({ user: publicUser(await loadTeam(env, result.user)) }, 200, { "Set-Cookie": result.cookie });
    res.headers.append("Set-Cookie", clearGoogleNonce());
    return res;
  }
  if (pathname === "/api/auth/logout" && method === "POST") {
    return json({ ok: true }, 200, { "Set-Cookie": await logout(request, env) });
  }

  const user = await currentUser(request, env);
  if (pathname === "/api/me") return json({ user: user && publicUser(user) });
  if (!user) return json({ error: "Log in to continue" }, 401);

  if (pathname === "/api/account" && method === "GET") return json(publicUser(await accountInfo(request, env, user)));
  if (pathname === "/api/account" && method === "PATCH") {
    const result = await rename(env, user, (await readJson<{ name?: unknown }>(request))?.name);
    return "error" in result ? json({ error: result.error }, 400) : json(result);
  }
  if (pathname === "/api/account/password" && method === "POST") {
    const body = await readJson<{ current?: unknown; next?: unknown }>(request);
    const result = await changePassword(env, user, body?.current, body?.next, request);
    return "error" in result ? json({ error: result.error }, 400) : json(result);
  }
  if (pathname === "/api/account/sessions" && method === "DELETE") {
    await logoutOthers(request, env, user);
    return json({ ok: true });
  }
  if (pathname === "/api/account" && method === "DELETE") {
    // Checked here too, not only in the page: a stray or forged request can't wipe an account.
    if ((await readJson<{ confirm?: unknown }>(request))?.confirm !== "DELETE") return json({ error: "Type DELETE to confirm" }, 400);
    const { results } = await env.DB.prepare("SELECT code FROM polls WHERE user_id = ?").bind(user.id).all<{ code: string }>();
    for (const { code } of results) await room(env, code).destroy();
    return json({ ok: true }, 200, { "Set-Cookie": await deleteUser(env, user) });
  }

  if (pathname === "/api/brand-kits" && method === "GET") return json({ kits: await listKits(env, user.id) });
  if (pathname === "/api/brand-kits" && method === "POST") {
    const out = await saveKit(env, user.id, (await readJson<Record<string, unknown>>(request)) ?? {});
    return "error" in out ? json(out, 400) : json(out);
  }
  const kit = pathname.match(/^\/api\/brand-kits\/([a-f0-9]{16})$/);
  if (kit && method === "DELETE") {
    await deleteKit(env, user.id, kit[1]);
    return json({ ok: true });
  }

  if (pathname === "/api/templates" && method === "GET") return json({ templates: await listTemplates(env, user) });
  const tpl = pathname.match(/^\/api\/templates\/([a-f0-9]{16})(\/use|\/report)?$/);
  if (tpl) {
    if (tpl[2] === "/use" && method === "POST") {
      const template = await useTemplate(env, user, tpl[1]);
      return template ? json({ template }) : json({ error: "Template not found" }, 404);
    }
    if (tpl[2] === "/report" && method === "POST") {
      await reportTemplate(env, user, tpl[1]);
      return json({ ok: true });
    }
    if (!tpl[2] && method === "DELETE") {
      await unshareTemplate(env, user, tpl[1]);
      return json({ ok: true });
    }
  }

  const siteAi = pathname.match(/^\/api\/ai\/(generate|improve|rewrite)$/);
  if (siteAi && method === "POST") return aiRoute(request, env, user, siteAi[1]);

  // Teams: up to 3 presenters sharing their presentations.
  if (pathname.startsWith("/api/team")) {
    const ip = request.headers.get("CF-Connecting-IP") ?? "local";
    const body = method === "GET" ? null : await readJson<{ email?: unknown; token?: unknown }>(request);
    const out =
      pathname === "/api/team" && method === "GET" ? await teamInfo(env, user)
      : pathname === "/api/team/invite" && method === "GET" ? await invitationInfo(env, url.searchParams.get("t"))
      : pathname === "/api/team/invite" && method === "POST" ? await inviteMember(env, user, body?.email, ip)
      : pathname === "/api/team/remove" && method === "POST" ? await removeMember(env, user, body?.email)
      : pathname === "/api/team/leave" && method === "POST" ? await leaveTeam(env, user)
      : pathname === "/api/team/accept" && method === "POST" ? await acceptInvitation(env, user, body?.token)
      : null;
    if (!out) return json({ error: "Not found" }, 404);
    if ("rotate" in out && out.rotate?.length) await rotateKeys(env, out.rotate);
    return "error" in out ? json({ error: out.error }, out.status) : json(out.data);
  }

  if (pathname === "/api/rooms" && method === "POST") return createPoll(request, env, user);
  if (pathname === "/api/polls" && method === "GET") return listPolls(env, user, url.searchParams.get("codes"));
  if (pathname === "/api/images" && method === "POST") return uploadImage(request, env, user);

  const poll = pathname.match(/^\/api\/polls\/([A-Z0-9]{5})(\/host|\/keys|\/reset|\/share|\/editing)?$/);
  if (poll) {
    const owned = await ownedPoll(env, user, poll[1]);
    if (!owned) return json({ error: "Presentation not found" }, 404);
    if (poll[2] === "/host" && method === "GET") return json({ hostKey: await keyFor(env, user, owned) });
    // New keys: screens, slides and tools given the old ones stop presenting. Its author or the team's owner.
    if (poll[2] === "/keys" && method === "POST") {
      if (owned.user_id !== user.id && user.teamRole !== "owner") return json({ error: "Only its author or the team's owner can do this." }, 403);
      const fresh = (await rotateKeys(env, [owned.code])).get(owned.code)!;
      return json({ hostKey: await keyFor(env, user, { ...owned, host_key: fresh }) });
    }
    // The builder says every 20 seconds that this person is editing; the answer names the teammates editing too.
    if (poll[2] === "/editing" && method === "POST") return json({ others: await room(env, owned.code).editing(user.id, user.name) });
    if (poll[2] === "/reset" && method === "POST") {
      await room(env, owned.code).reset();
      return json({ ok: true });
    }
    if (poll[2] === "/share" && method === "POST") {
      // Only its author shares a presentation with the community, under their own name.
      if (owned.user_id !== user.id) return json({ error: "Only its author can share this presentation." }, 403);
      const shared = await shareTemplate(env, user, owned, (await readJson<Record<string, unknown>>(request)) ?? {});
      return shared && "error" in shared ? json({ error: shared.error }, shared.status) : json({ shared });
    }
    if (!poll[2] && method === "PUT") return updatePoll(request, env, user, owned.code);
    if (!poll[2] && method === "GET") {
      const results = await room(env, owned.code).results();
      if (!results) return json({ error: "Presentation not found" }, 404);
      return json({ code: owned.code, createdAt: owned.created_at, mine: owned.user_id === user.id, brand: parseBrand(owned.brand), shared: await sharedFor(env, owned.code), detected: detectedLang(results.title, results.questions), ...results });
    }
    if (!poll[2] && method === "DELETE") {
      // In a team, only its author or the team's owner deletes a presentation.
      if (owned.user_id !== user.id && user.teamRole !== "owner") return json({ error: "Only its author or the team's owner can delete it." }, 403);
      await room(env, owned.code).destroy();
      // A shared template is a copy: it stays in the library without its source.
      await env.DB.batch([
        env.DB.prepare("DELETE FROM polls WHERE code = ?").bind(owned.code),
        env.DB.prepare("UPDATE shared_templates SET code = NULL WHERE code = ?").bind(owned.code),
      ]);
      return json({ ok: true });
    }
  }

  return json({ error: "Not found" }, 404);
}

// Every API answer carries safe defaults; an unexpected error answers cleanly and is logged.
async function safeApi(request: Request, env: Env, url: URL) {
  let res: Response;
  try {
    res = await api(request, env, url);
  } catch (err) {
    console.error(JSON.stringify({ at: url.pathname, method: request.method, error: err instanceof Error ? err.stack ?? err.message : String(err) }));
    res = json({ error: "Something went wrong. Try again." }, 500);
  }
  if (res.status === 101) return res;
  const out = new Response(res.body, res);
  out.headers.set("X-Content-Type-Options", "nosniff");
  out.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  return out;
}

export default {
  // Once a day (the cron in wrangler.jsonc): expired rows and unused images go (worker/cleanup.ts).
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(dailyCleanup(env));
  },
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return safeApi(request, env, url);
    if (url.pathname.startsWith("/fonts/") && request.method === "GET") return fonts(request, url, ctx);
    // Every other address is a page of the app, served from the assets before the worker runs.
    return json({ error: "Not found" }, 404);
  },
} satisfies ExportedHandler<Env>;

// Google Fonts served from this site: visitors' browsers never contact Google (no IP sent to a third party),
// and each file is fetched once per edge location, then cached there.
const FONT_FILE = /^\/fonts\/g\/s\/[a-z0-9-]+\/v\d+\/[\w-]+\.(woff2|woff|ttf)$/;
async function fonts(request: Request, url: URL, ctx: ExecutionContext) {
  const isCss = url.pathname === "/fonts/css2" && url.searchParams.has("family");
  if (!isCss && !FONT_FILE.test(url.pathname)) return new Response("Not found", { status: 404 });
  // The edge cache of this location (Workers' own cache, typed as the browser's here).
  const cache = (caches as unknown as { default: Cache }).default;
  const hit = await cache.match(request);
  if (hit) return hit;
  // A current browser's name, so Google answers with WOFF2 files.
  // Google being slow or down must not hold the request open or raise a 500.
  const signal = AbortSignal.timeout(8000);
  const upstream = await (isCss
    ? fetch(`https://fonts.googleapis.com/css2${url.search}`, { signal, headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36" } })
    : fetch(`https://fonts.gstatic.com/${url.pathname.slice("/fonts/g/".length)}`, { signal })
  ).catch(() => null);
  if (!upstream) return new Response("Fonts unavailable", { status: 502, headers: { "Cache-Control": "no-store" } });
  if (!upstream.ok) return new Response("Not found", { status: 404 });
  const res = isCss
    ? new Response((await upstream.text()).replaceAll("https://fonts.gstatic.com/", `${url.origin}/fonts/g/`), {
        headers: { "Content-Type": "text/css; charset=utf-8", "Cache-Control": "public, max-age=86400", "Access-Control-Allow-Origin": "*" },
      })
    : new Response(upstream.body, {
        headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "font/woff2", "Cache-Control": "public, max-age=31536000, immutable", "Access-Control-Allow-Origin": "*" },
      });
  ctx.waitUntil(cache.put(request, res.clone()));
  return res;
}
