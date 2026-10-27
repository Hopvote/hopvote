import { DurableObject } from "cloudflare:workers";
import type { Env } from "./index";
import { AVATARS } from "../src/avatars";
import { PHONE } from "../src/phone";
import { accountShare, type Share } from "./ai-budget";
import { networkOf } from "./auth";
import { limitsOf } from "./limits";
import { isProfane, isRudeName, nameKey } from "./profanity";
import { canOpen } from "./team";
import { detectLang, LANGS, translateTexts } from "./translate";
import { textVersion } from "../src/text-version";
import { parseFill, rightBlank, shownAnswer, wordBank } from "../src/fill";
import { COUNTDOWN_DEFAULT, inZone, POINTS, type Clock, type Zone } from "../src/kinds";
import { SPIN_MS, spinTarget, tagOf, WHEEL_SIZE, type Spin } from "../src/wheel";
import { shownDecor, type Decor } from "../src/decor";
import { decisionOf, finalOnPath, isPicker, nextStep, prevStep, remainingOf, roundsLeft, roundsOf, topicAt, whereOf, type How, type Play, type Rounds } from "../src/rounds";

// choice: answers among options (several when `multi`; a quiz when `correct` is set, timed with `timer`).
// scale: a note from 1 to `max`. words: up to 3 words each, shown as a cloud. open: free text answers.
// rank: each participant orders the options (a game when `ordered`: the options are written in the right order).
// qa: the room asks questions and upvotes them. scales: several statements (`options`), each rated from 1 to `max`.
// number: everyone answers with a number (a game when `answer` is set: the closest wins).
// slide: a title, a text and an image, nothing to answer. link: a QR code to `url`, phones get a button to open it.
// points: each person shares 100 points between the options. fill: a text with blanks to fill (`fill`, answers in brackets).
// match: pairs to match (`options` holds the left items then the right ones). spot: a spot to tap on the image (a game with `zone`).
// wheel: spins among the options, or the first names of the people connected. countdown: a timer of `duration` seconds.
// media: a video or audio to play (`url`).
export type QuestionType =
  | "choice" | "scale" | "words" | "open" | "rank" | "qa" | "contact" | "scales" | "number" | "slide" | "link"
  | "points" | "fill" | "match" | "spot" | "wheel" | "countdown" | "media";
// Details a contact question can collect. They stay private: only the owner's results show them.
export const CONTACT_FIELDS = ["name", "email", "phone", "company"] as const;
export type ContactField = (typeof CONTACT_FIELDS)[number];
type Contact = Partial<Record<ContactField, string>> & { at: number };
export type Question = {
  type?: QuestionType;
  question: string;
  options: string[];
  image?: string;
  correct?: number;
  multi?: boolean;
  timer?: number;
  max?: number;
  labels?: [string, string];
  fields?: ContactField[];
  // Ratings only: how the results show (bars when missing).
  style?: "slider" | "gauge" | "dots";
  // Slides: the text under the title.
  text?: string;
  // Links: where the QR code and the phones' button lead.
  url?: string;
  // Number questions: the right value, which makes it a game.
  answer?: number;
  // Rankings: the options are written in the right order, which makes it a game.
  ordered?: boolean;
  // Fill in the blanks: the text, each answer between brackets. "words": people place words instead of typing them,
  // among the answers and `decoys`.
  fill?: string;
  fillMode?: "words";
  decoys?: string[];
  // Find on the image: the right zone, which makes it a game.
  zone?: Zone;
  // Timers: their length in seconds.
  duration?: number;
  // Topic rounds (src/rounds.ts): the picker is a wheel or a poll marked `topics`, its options are the topics, `rounds` how many
  // to play (all when missing). The questions of a topic carry `topic`, the index of their topic.
  topics?: true;
  rounds?: number;
  topic?: number;
};

export const typeOf = (q: Question): QuestionType => q.type ?? "choice";
// The cap stored with the room (readOwnerPlan), for when the database cannot be read.
const capOf = (deck: { maxVoters?: number }) => deck.maxVoters ?? 0;
// How long a room trusts the owner's plan it last read: a change reaches open rooms within this delay.
const PLAN_TTL = 30_000;

const isQuiz = (q: Question) => typeOf(q) === "choice" && q.correct !== undefined;
// Questions with a right answer, that earn points: a quiz, a number with its answer, a ranking in the right order,
// blanks to fill, pairs to match, a spot with its zone.
// They share the quiz rules: answers stop once the answer is shown, an optional timer, the leaderboard.
const isScored = (q: Question) =>
  isQuiz(q) ||
  (typeOf(q) === "number" && typeof q.answer === "number") ||
  (typeOf(q) === "rank" && q.ordered === true) ||
  typeOf(q) === "fill" ||
  typeOf(q) === "match" ||
  (typeOf(q) === "spot" && !!q.zone);
// Questions with nothing to answer: they never count answers.
const NOTHING_TO_ANSWER = ["slide", "wheel", "countdown", "media"];
// Games whose answers stay hidden from every screen until the right answer shows, so nobody copies the room.
const hiddenUntilShown = (q: Question) =>
  (typeOf(q) === "number" && isScored(q)) || (typeOf(q) === "rank" && !!q.ordered) || ["fill", "match"].includes(typeOf(q)) || (typeOf(q) === "spot" && !!q.zone);
// The kind of question as the builder names it, for the presentations list.
const uiKind = (q: Question) => (isPicker(q) ? "topics" : isQuiz(q) ? "quiz" : typeOf(q) === "rank" && q.ordered ? "order" : typeOf(q));
// A right order and pairs to match are written as their answer (item i at place i, left i with right i): every screen but
// the presenter's gets the items in a mixed order until the answer shows, and phones answer in that order.
const isMixed = (q: Question) => (typeOf(q) === "rank" && q.ordered === true) || typeOf(q) === "match";
// The mixed order: place j shows item mix[j] (for pairs, the right-hand items only). Any order, the written one included.
// The order for a seed stored under "mix" (mixFor); new seeds, stored under "mix2", use strongMix.
function mixOf(size: number, seed: string) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const next = () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)) >>> 0) / 4294967296;
  const mix = Array.from({ length: size }, (_, i) => i);
  for (let i = size - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [mix[i], mix[j]] = [mix[j], mix[i]];
  }
  return mix;
}
// The same kind of shuffle, its randomness drawn from SHA-256 of the seed and the question: the orders shown once the
// answers are revealed tell nothing about the next questions' orders.
async function strongMix(size: number, seed: string) {
  let bytes = new Uint8Array(0);
  let at = 0;
  let block = 0;
  const next = async () => {
    if (at + 4 > bytes.length) {
      bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${seed}:${block++}`)));
      at = 0;
    }
    const n = new DataView(bytes.buffer).getUint32(at);
    at += 4;
    return n / 4294967296;
  };
  const mix = Array.from({ length: size }, (_, i) => i);
  for (let i = size - 1; i > 0; i--) {
    const j = Math.floor((await next()) * (i + 1));
    [mix[i], mix[j]] = [mix[j], mix[i]];
  }
  return mix;
}
// The options as the mixed order shows them.
const mixedOptions = (q: Question, mix: number[]) => {
  if (typeOf(q) !== "match") return mix.map((i) => q.options[i]);
  const half = q.options.length / 2;
  return [...q.options.slice(0, half), ...mix.map((i) => q.options[half + i])];
};

// A question's translation is real when its question and slide text changed (both last in `all` when there is a slide text),
// unless they are a single word or empty. Originals returned past the AI budget, or echoed by a model, are not.
// Options, scale labels and the deck title may stay as they are (names, brands, words shared by both languages).
const translatedWell = (all: string[], out: string[], slide: boolean) =>
  [1, ...(slide ? [all.length - 1] : [])].every((i) => !/\s/.test(all[i].trim()) || out[i] !== all[i]);

const MAX_WORDS = 3;
const MAX_POSTS_PER_VOTER = 3;
// About 260 bytes per post: 2000 stay far below the 2 MB a stored value may hold.
const MAX_POSTS = 2000;
const MAX_CLOUD_WORDS = 5000;
// Number answers (and spots on an image) kept for the results: one per participant, far more than any plan allows.
const MAX_NUMBERS = 5000;
// Different answers counted per blank: past this, new ones are still scored but not listed.
const MAX_FILL_ANSWERS = 300;
const MAX_NUMBER = 1e12;
// Phones send small JSON; anything bigger is not ours.
const MAX_MESSAGE = 8 * 1024;
const WORD_LENGTH = 25;
const OPEN_LENGTH = 200;
const NAME_LENGTH = 20;
// First names go on the big screen: no invisible or direction characters, no links. Joiners for emoji sequences stay.
const NAME_HIDDEN = /[\p{Cc}\u200b\u200e\u200f\u202a-\u202e\u2060-\u2069\ufeff]/gu;
// A web address, read as the room reads it (nameKey: full-width and ideographic dots are dots, look-alike letters are
// Latin): a dot right between a letter or digit and a common domain ending. Endings that are also words or name parts
// (me, it, de, co, dev...) count only with a path after them (t.me/x). Initials and titles (J. Smith, Dr.House,
// T.J. Miller, J.De Vries, Team.IT) are names, not addresses.
const NAME_LINK = /(:\/\/|www\.|[\p{L}\p{N}]\.(?:(?:com|net|org|info|biz|io|ai|app|xyz|site|online|link|shop|store|gov|edu|fr|uk|ru|cn|nl|eu|tv|pl|pt|br|tk|cc|ws)(?![\p{L}\p{N}])|(?:me|it|us|be|to|co|live|club|top|de|ca|ch|es|at|in|se|dev|ly|gg|gl|gd|ee|sh|lol|fun)\/))/iu;
const cleanName = (raw: unknown) => {
  const name = cleanText(String(raw ?? "").replace(NAME_HIDDEN, ""), NAME_LENGTH);
  return NAME_LINK.test(nameKey(name)) || isRudeName(name) ? "" : name;
};
// Each room's and each owner's part of the day's translations, in neurons (worker/ai-budget.ts holds 9,000 a day for all,
// plus a small 30-day reserve). A large event (30 questions in 10 languages) needs about 12,000, with room left for others.
const ROOM_AI_DAILY = 20_000;
const OWNER_AI_DAILY = 20_000;
// What the audience wrote (Q&A, open answers, words) has its own part, inside the room's and beside the owner's:
// anyone with the code can post, and must never leave the questions untranslated.
const ROOM_POSTS_AI_DAILY = 8000;
const OWNER_POSTS_AI_DAILY = 8000;
// Translations a room runs at once; the others wait their turn (the question on screen is asked first).
const ROOM_AI_AT_ONCE = 8;
// Floods are cut in memory, per address and per socket: nothing is stored, and a room that wakes up starts afresh.
// Each limit is a burst and a refill a second, wide enough for a class or a hall of 5,000 phones behind one address.
const LIMITS = {
  // New connections from one address (3,000 phones joining at once get in within a few retries).
  join: [1500, 50],
  // Messages from one phone: answers, upvotes, names. A person taps a few times a minute.
  phone: [60, 5],
  // Messages from the presenter's screen, however fast the arrows are pressed.
  screen: [300, 30],
  // Messages from every socket of one address together.
  address: [10_000, 1000],
  // Questions to translate with the AI asked from one address (cached ones are free; the room prepares most itself).
  translate: [60, 1],
} as const;
// Sockets one address may hold open in a room: more than the biggest plan's audience.
const SOCKETS_PER_ADDRESS = 6000;
type Bucket = { left: number; at: number };
// Takes one from a bucket that holds `burst` and refills `rate` a second. False when it is empty (nothing taken).
function take(b: Bucket, [burst, rate]: readonly [number, number]) {
  const now = Date.now();
  b.left = Math.min(burst, b.left + ((now - b.at) / 1000) * rate);
  b.at = now;
  if (b.left < 1) return false;
  b.left--;
  return true;
}
const BOARD_SIZE = 10;
// A timed answer arriving a little after zero still counts: phones and screens are never perfectly in sync.
const GRACE_MS = 800;

type Post = { id: string; text: string; at: number; hidden?: boolean; votes?: number; done?: boolean };
// Someone or something the wheel picked: `key` tells two entries with the same name apart (a person's id, or "#" and its place).
type Picked = { label: string; key: string };

// Lowercase, trimmed, one word or short expression: "  Motivé ! " and "motivé" count together.
const cleanWord = (w: unknown) =>
  String(w ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.!?,;:]+$/, "")
    .toLocaleLowerCase()
    .slice(0, WORD_LENGTH);

const cleanText = (t: unknown, max: number) => String(t ?? "").trim().replace(/\s+/g, " ").slice(0, max);

// A presentation: several questions shown one at a time, joined with a single code.
export type Deck = {
  title: string;
  questions: Question[];
  hostKey: string;
  createdAt: number;
  // Distinct participants allowed by the owner's plan when last read; missing means no cap.
  maxVoters?: number;
  // The join code, to find the owner's plan. Older rooms learn it on their next connection.
  code?: string;
  // Ask participants for a first name, shown on the waiting screen.
  names?: boolean;
  // Language the questions are written in. Older rooms were all French.
  lang?: string;
  // Key for slides: navigation only.
  slideKey?: string;
  // The launch animation: a curtain and "Here we go!" when the presenter starts, then no going back to the waiting screen.
  intro?: boolean;
  // The quiz leaderboard: after each scored question ("each"), only at the end ("end"), or never ("off").
  // Missing: as before, the presenter's Leaderboard button only.
  boardMode?: BoardMode;
  // A seasonal decor (src/decor.ts); missing: the normal one. Screens draw it only until its end date.
  decor?: Decor;
  // The last save from the builder, so a teammate's changes are not overwritten without a word.
  edited?: { id: string; name: string; at: number };
};

// "round": with topic rounds, the standings after each round (and the podium at the end).
export type BoardMode = "each" | "round" | "end" | "off";
export const BOARD_MODES: readonly BoardMode[] = ["each", "round", "end", "off"];
// Where a player stands: their rank (equal scores share one), points, points won on the question on screen, players ranked.
type Standing = { rank: number; score: number; gained: number; of: number };
// The leaderboard as screens draw it. `tag` lets a phone find itself without the room sending anyone's id;
// `prev` is the rank before the question on screen (0: not ranked yet), `gained` the points it brought.
type BoardEntry = { name: string; avatar: string; score: number; rank: number; tag: string; gained: number; prev: number };
type Ranking = { top: BoardEntry[]; standings: Map<string, Standing> };

// Topic rounds as the room plays them (stored under "rounds"; missing: nothing played yet). `order`: the topics played, in order,
// with how each was chosen (`how`) and the vote that chose it (`votes`, null when the vote played no part). At the picker,
// `chosen` is the topic chosen for the next round (`chosenHow`, `ballot`: the vote closed for it). `pass` numbers the votes:
// each new vote (a new round, or choosing again) gets the next one, so a vote from an earlier one is refused.
// A topic is locked once one of its questions has an answer: computed, never stored.
type Ballot = { counts: number[]; n: number; tie: boolean; empty: boolean };
type RoundsState = { order: number[]; how: How[]; votes: (Ballot | null)[]; chosen: number | null; chosenHow: How | null; ballot: Ballot | null; pass: number };
const freshRounds = (): RoundsState => ({ order: [], how: [], votes: [], chosen: null, chosenHow: null, ballot: null, pass: 1 });

// Rooms created before presentations existed held a single question.
type LegacyPoll = Question & { hostKey: string; createdAt: number; maxVoters?: number };

// Phones tag each answer with the question on screen (`index`) and the round of answers (`round`, changed by every reset),
// and a `ref` the room echoes back in an "ack", so a phone only says "sent" once the answer is really counted.
type Tags = { ref?: unknown; index?: unknown; round?: unknown };
type ClientMessage = Tags & (
  | { type: "vote"; voter: string; option: number | number[]; pass?: unknown }
  | { type: "rank"; voter: string; order: number[] }
  | { type: "words"; voter: string; words: unknown[] }
  | { type: "answer"; voter: string; text: string; id?: string }
  | { type: "ask"; voter: string; text: string; id?: string }
  | { type: "upvote"; voter: string; id: string }
  | { type: "name"; voter: string; name: string; avatar?: string; lang?: string }
  | { type: "contact"; voter: string; data: Record<string, unknown>; consent: boolean }
  | { type: "scales"; voter: string; values: number[] }
  | { type: "number"; voter: string; value: number }
  | { type: "opened"; voter: string }
  | { type: "points"; voter: string; values: number[] }
  | { type: "fill"; voter: string; values: unknown[] }
  | { type: "match"; voter: string; order: number[] }
  | { type: "spot"; voter: string; x: number; y: number }
  | { type: "goto"; index: number }
  | { type: "reveal"; show: boolean }
  | { type: "start"; lead?: number }
  | { type: "board"; show: boolean }
  | { type: "hide"; id: string }
  | { type: "drop"; word: string }
  | { type: "done"; id: string }
  | { type: "lobby"; on: boolean }
  | { type: "lock"; on: boolean }
  | { type: "spin"; from?: unknown }
  | { type: "unspin" }
  | { type: "step"; dir: unknown; from: unknown }
  | { type: "pick"; topic?: unknown; from?: unknown }
  | { type: "repick"; from?: unknown }
  | { type: "clock"; act: "start" | "pause" | "reset" | "add"; by?: number }
  | { type: "unname"; tag: string }
);

// What became of an answer: counted or not, and whether screens need an update.
type Outcome = { ok: boolean; changed: boolean };
const REJECTED: Outcome = { ok: false, changed: false };
const SAME: Outcome = { ok: true, changed: false };
const CHANGED: Outcome = { ok: true, changed: true };
// A post id chosen by the phone, so an answer sent again after a network drop is not posted twice.
const POST_ID = /^[a-z0-9]{8,16}$/;

// Where a person's answer to a question is stored, one prefix per kind of question.
const ANSWER_KEYS = ["v", "w", "contact", "on", "qn"];
const HOST_ONLY = new Set(["goto", "reveal", "start", "board", "hide", "drop", "done", "lobby", "lock", "spin", "unspin", "clock", "step", "pick", "repick", "unname"]);
// What a slide may do with its own key: run the session and moderate it on screen,
// never read private answers or contacts.
const SLIDE_ALLOWED = new Set(["goto", "reveal", "start", "board", "lobby", "lock", "hide", "drop", "done", "spin", "unspin", "clock", "step", "pick", "repick"]);
// Host actions that change topic rounds: run one at a time with the answers (see serial), so a vote never lands mid-change.
const ROUND_ACTIONS = new Set(["step", "pick", "repick", "goto", "spin"]);

// One live presentation: holds votes and pushes results to every connected screen.
export class Room extends DurableObject<Env> {
  private broadcastTimer: ReturnType<typeof setTimeout> | null = null;
  // The owner's plan as last read from the database, and the read under way if any.
  private owner: { plan: string | null; at: number; id?: string } | null = null;
  private ownerRead: Promise<string | null> | null = null;
  // Answers are applied one at a time (see serial), and translations under way are shared by every phone asking.
  private queue: Promise<unknown> = Promise.resolve();
  private translating = new Map<string, Promise<unknown>>();
  // Questions already translated while the room is awake, by languages and texts: phones get them without a database read.
  private translatedQuestions = new Map<string, string[]>();
  // Audience posts already translated while the room is awake, by language and text.
  private postTranslations = new Map<string, string>();
  // Until when audience posts stop asking for a translation, by job and network, after the budget refused one.
  private aiPaused = new Map<string, number>();
  // The leaderboard as last computed, reused by every broadcast until a score or a name changes (see scoresChanged).
  // In memory only: a room that wakes up computes it again.
  private rankingCache: { key: string; version: number; data: Ranking } | null = null;
  private scoreVersion = 0;
  // Flood limits (see LIMITS), by address and by socket.
  private buckets = new Map<string, Bucket>();
  private socketBuckets = new WeakMap<WebSocket, Bucket>();
  // The room's part of the day's translations (see aiShares): kept in memory, and stored so it holds when the room sleeps.
  private aiSpent: { day: string; neurons: number; posts?: number } | null = null;
  private aiSpentRead: Promise<{ day: string; neurons: number; posts?: number } | undefined> | null = null;
  private aiRunning = 0;
  private aiWaiting: (() => void)[] = [];
  // Mixed orders already drawn (see mixFor), so a broadcast does not hash them again.
  private mixes = new Map<string, number[]>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Keep-alive pings are answered without waking the object, so idle rooms stay free.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  // The presenter key the room accepts: what its author is given (index.ts keyFor), so a key change stopped halfway
  // (the room changed, the database not) never leaves its author with a key the room refuses.
  async hostKey() {
    return (await this.load())?.hostKey ?? null;
  }

  // Teammates never get the room's own keys: a key of their own ("h" to present, "s" for a slide), signed with
  // the host key and checked against the team each time it is used, so it stops working once they leave the team
  // or the team stops. New host keys (newKeys) end them all.
  async memberKey(userId: string, kind: "h" | "s") {
    const deck = await this.load();
    if (!deck) return null;
    return `${kind}.${userId}.${await this.memberSign(deck, kind, userId)}`;
  }

  private async memberSign(deck: Deck, kind: string, userId: string) {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(deck.hostKey), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${kind}:${userId}`));
    return Array.from(new Uint8Array(mac).slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
  }

  // What a teammate's key opens right now: "h", "s", or null (not signed by this room's key, or no longer in the team).
  private async memberRole(deck: Deck, key: string, code: string | undefined) {
    const m = /^([hs])\.([0-9a-f-]{36})\.([0-9a-f]{32})$/.exec(key);
    if (!m || !code || (await this.memberSign(deck, m[1], m[2])) !== m[3]) return null;
    return (await canOpen(this.env, m[2], code).catch(() => false)) ? (m[1] as "h" | "s") : null;
  }

  // New keys for the presenter and the slides: every key given before stops working, screens using one are told to ask again.
  async newKeys(hostKey: string) {
    const deck = await this.load();
    if (!deck) return false;
    const { slideKey: _old, ...rest } = deck;
    await this.ctx.storage.put("deck", { ...rest, hostKey });
    for (const ws of [...this.ctx.getWebSockets("host"), ...this.ctx.getWebSockets("slide")]) ws.close(4403, "new keys");
    return true;
  }

  async init(deck: Deck): Promise<boolean> {
    if (await this.load()) return false;
    await this.ctx.storage.put({ deck, current: 0 });
    return true;
  }

  private async load(): Promise<Deck | null> {
    const deck = await this.ctx.storage.get<Deck>("deck");
    if (deck) return deck;
    const legacy = await this.ctx.storage.get<LegacyPoll>("poll");
    if (!legacy) return null;
    const { question, options, ...rest } = legacy;
    const upgraded: Deck = { ...rest, title: question, questions: [{ question, options }] };
    const counts = await this.ctx.storage.get<number[]>("counts");
    await this.ctx.storage.put({ deck: upgraded, current: 0, ...(counts ? { "counts:0": counts } : {}) });
    return upgraded;
  }

  private get = <T>(key: string) => this.ctx.storage.get<T>(key);

  // The mixed order of a right order or pairs question (isMixed), the same for every phone until the room is reset.
  // Its seed is drawn once and never leaves the room. null: a question whose options are not its answer.
  private async mixFor(q: Question | undefined, index: number): Promise<number[] | null> {
    if (!q || !isMixed(q)) return null;
    const size = typeOf(q) === "match" ? q.options.length / 2 : q.options.length;
    const old = await this.get<string>("mix");
    if (old) return mixOf(size, `${old}:${index}`);
    let seed = await this.get<string>("mix2");
    if (!seed) {
      seed = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("");
      await this.ctx.storage.put("mix2", seed);
    }
    const key = `${seed}:${index}:${size}`;
    let mix = this.mixes.get(key);
    if (!mix) {
      if (this.mixes.size > 200) this.mixes.clear();
      this.mixes.set(key, (mix = await strongMix(size, `${seed}:${index}`)));
    }
    return mix;
  }

  // The plan of the account that owns this room, read live: a change of limits also reaches rooms made before it.
  // It may wait on the database, which lets other events run: call it before reading any state the caller relies on.
  private async ownerPlan(deck: Deck): Promise<string | null> {
    if (!deck.code) return null;
    if (this.owner && Date.now() - this.owner.at < PLAN_TTL) return this.owner.plan;
    // One read at a time: a burst of answers after the room wakes up shares it.
    this.ownerRead ??= this.readOwnerPlan(deck.code).finally(() => (this.ownerRead = null));
    return this.ownerRead;
  }

  private async readOwnerPlan(code: string): Promise<string | null> {
    try {
      const row = await this.env.DB.prepare("SELECT u.id, u.plan FROM polls p JOIN users u ON u.id = p.user_id WHERE p.code = ?")
        .bind(code)
        .first<{ id: string; plan: string }>();
      const plan = row ? row.plan : null;
      this.owner = { plan, at: Date.now(), id: row?.id };
      // Stored with the room too, so it still holds if the database cannot be reached later.
      const cap = plan ? limitsOf(plan).voters : 0;
      const stored = await this.load();
      if (cap && stored && stored.maxVoters !== cap) await this.ctx.storage.put("deck", { ...stored, maxVoters: cap });
      return plan;
    } catch (err) {
      console.error(JSON.stringify({ at: "room.ownerPlan", error: err instanceof Error ? err.message : String(err) }));
      // Keep the last plan known (or the cap stored with the room) and try again later, not on every answer.
      this.owner = { plan: this.owner?.plan ?? null, at: Date.now(), id: this.owner?.id };
      return this.owner.plan;
    }
  }

  // Distinct participants allowed right now; 0 means no cap.
  private async capFor(deck: Deck) {
    const plan = await this.ownerPlan(deck);
    return plan ? limitsOf(plan).voters : capOf(deck);
  }

  private slots(q: Question) {
    const type = typeOf(q);
    if (type === "scale") return q.max ?? 5;
    if (type === "choice" || type === "rank" || type === "points") return q.options.length;
    // One row of ratings per statement, side by side.
    if (type === "scales") return q.options.length * (q.max ?? 5);
    return 0;
  }

  private async countsFor(deck: Deck, index: number) {
    return (await this.get<number[]>(`counts:${index}`)) ?? Array.from({ length: this.slots(deck.questions[index]) }, () => 0);
  }

  private async wordsFor(index: number) {
    return (await this.get<Record<string, number>>(`words:${index}`)) ?? {};
  }

  // Number answers by participant.
  private async numbersFor(index: number) {
    return (await this.get<Record<string, number>>(`nums:${index}`)) ?? {};
  }

  // Rankings with a right order: how many found it all, and how many put each item at its place.
  // The same for pairs to match (each pair) and blanks to fill (each blank).
  private async orderFor(deck: Deck, index: number) {
    const q = deck.questions[index];
    const type = q ? typeOf(q) : "choice";
    const size = !q ? 0 : type === "match" ? q.options.length / 2 : type === "fill" ? parseFill(q.fill ?? "").answers.length : q.options.length;
    const right = (await this.get<number>(`okn:${index}`)) ?? 0;
    const placed = (await this.get<number[]>(`pos:${index}`)) ?? Array.from({ length: size }, () => 0);
    return { right, placed };
  }

  // Spots tapped on an image, by participant.
  private async spotsFor(index: number) {
    return (await this.get<Record<string, [number, number]>>(`spots:${index}`)) ?? {};
  }

  // Blanks to fill: the answers typed in each blank, with how many people typed them.
  private async fillWordsFor(index: number, size: number) {
    const stored = (await this.get<Record<string, number>[]>(`fillw:${index}`)) ?? [];
    return Array.from({ length: size }, (_, i) => stored[i] ?? {});
  }

  // The most typed answers of each blank, most typed first.
  private topAnswers(words: Record<string, number>[], limit: number) {
    return words.map((w) => Object.entries(w).sort((a, b) => b[1] - a[1]).slice(0, limit));
  }

  private async postsFor(deck: Deck, index: number) {
    const type = typeOf(deck.questions[index]);
    return (await this.get<Post[]>(`${type === "qa" ? "qa" : "open"}:${index}`)) ?? [];
  }

  // Number of people (or posts, for text questions) behind this question's results.
  private async answeredFor(deck: Deck, index: number) {
    const type = typeOf(deck.questions[index]);
    if (type === "words") return (await this.get<number>(`wn:${index}`)) ?? 0;
    // Hidden posts are taken out of the room: they don't count either.
    if (type === "open" || type === "qa") return (await this.postsFor(deck, index)).filter((a) => !a.hidden).length;
    if (NOTHING_TO_ANSWER.includes(type)) return 0;
    const voters = await this.get<number>(`n:${index}`);
    return voters ?? (await this.countsFor(deck, index)).reduce((a, b) => a + b, 0);
  }

  private async contactsFor(index: number) {
    const list: Contact[] = [];
    for (const [, value] of await this.ctx.storage.list<Contact>({ prefix: `contact:${index}:` })) list.push(value);
    return list.sort((a, b) => a.at - b.at);
  }

  // Quiz points: 1000 for a right answer, from 500 to 1000 by speed when the question is timed.
  // An answer a little before the clock (phones out of step) still gets 1000 at most.
  private points(q: Question, startedAt: number | undefined, at: number) {
    if (!q.timer || !startedAt) return 1000;
    const left = Math.min(1, Math.max(0, 1 - (at - startedAt) / (q.timer * 1000)));
    return Math.round(500 + 500 * left);
  }

  // Number games: 1000 points for the exact value, fewer the further the answer is (nothing past 10% off), scaled by speed when timed.
  private closeness(q: Question, value: number, startedAt: number | undefined, at: number) {
    const answer = q.answer ?? 0;
    const off = Math.abs(value - answer) / Math.max(Math.abs(answer), 1);
    const share = Math.max(0, 1 - off * 10);
    return Math.round(share * this.points(q, startedAt, at));
  }

  // A score or a name changed: the next leaderboard is computed again.
  private scoresChanged() {
    this.scoreVersion++;
    this.rankingCache = null;
  }

  // Everyone's place, with the points the questions of `range` brought (the question on screen, or the round that just
  // ended): one read of every score. Equal scores share a rank (1, 2, 2, 4); the top of the board lists them by name.
  private async ranking(range: number[]): Promise<Ranking> {
    const key = `${(await this.get<number>("round")) ?? 0}:${range.join(",")}`;
    const version = this.scoreVersion;
    if (this.rankingCache && this.rankingCache.key === key && this.rankingCache.version === version) return this.rankingCache.data;
    const totals = new Map<string, number>();
    const gained = new Map<string, number>();
    const inRange = new Set(range.map(String));
    for (const [k, value] of await this.ctx.storage.list<number>({ prefix: "p:" })) {
      const [, index, ...rest] = k.split(":");
      const voter = rest.join(":");
      totals.set(voter, (totals.get(voter) ?? 0) + value);
      if (inRange.has(index)) gained.set(voter, (gained.get(voter) ?? 0) + value);
    }
    const ranksOf = (list: [string, number][]) => {
      const out = new Map<string, number>();
      let last = -1;
      let rank = 0;
      list.forEach(([voter, score], i) => {
        if (score !== last) (rank = i + 1), (last = score);
        out.set(voter, rank);
      });
      return out;
    };
    const sorted = [...totals].sort((a, b) => b[1] - a[1]);
    const ranks = ranksOf(sorted);
    const before = ranksOf(
      sorted
        .map(([voter, score]): [string, number] => [voter, score - (gained.get(voter) ?? 0)])
        .filter(([, score]) => score > 0)
        .sort((a, b) => b[1] - a[1]),
    );
    // The board lists players with points, and only they get a place: a phone with no points yet reads "No points yet",
    // never a rank or a medal. `of` counts everyone who played. Names are read for the top ones and those tied with the last.
    const withPoints = sorted.filter(([, score]) => score > 0);
    const standings = new Map<string, Standing>();
    for (const [voter, score] of withPoints) standings.set(voter, { rank: ranks.get(voter)!, score, gained: gained.get(voter) ?? 0, of: sorted.length });
    const cut = withPoints[BOARD_SIZE - 1]?.[1] ?? 0;
    const near = withPoints.filter(([, score]) => score >= cut).slice(0, 200);
    const stored = await this.getMany<string>(near.flatMap(([voter]) => [`name:${voter}`, `avatar:${voter}`]));
    const top = near
      .map(([voter, score]) => ({
        name: stored.get(`name:${voter}`) ?? "Anonymous",
        // The buddy the player picked on their phone, so the screen shows the same face.
        avatar: stored.get(`avatar:${voter}`) ?? "",
        score,
        rank: ranks.get(voter)!,
        tag: tagOf(voter),
        gained: gained.get(voter) ?? 0,
        prev: before.get(voter) ?? 0,
      }))
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
      .slice(0, BOARD_SIZE);
    const data = { top, standings };
    if (version === this.scoreVersion) this.rankingCache = { key, version, data };
    return data;
  }

  // The results page's leaderboard: the same places as the live screens (equal scores share a rank, listed by name).
  private async finalBoard() {
    const { top } = await this.ranking([(await this.get<number>("current")) ?? 0]);
    return top.map(({ name, avatar, score, rank }) => ({ name, avatar, score, rank }));
  }

  // Each phone's own place, when its screen shows it: the leaderboard on screen, or a scored question's answer
  // in a presentation that shows the standings after each question. Null when phones show no place.
  private async standingsShown(deck: Deck): Promise<Map<string, Standing> | null> {
    if ((deck.boardMode !== "each" && deck.boardMode !== "round" && deck.boardMode !== "end") || !deck.names || !deck.questions.some(isScored)) return null;
    const current = Math.max(0, Math.min((await this.get<number>("current")) ?? 0, deck.questions.length - 1));
    const q = deck.questions[current];
    const shown = !!(await this.get<boolean | number>("board"));
    const revealed = deck.boardMode === "each" && !!q && isScored(q) && !!(await this.get<boolean>(`reveal:${current}`));
    if (!shown && !revealed) return null;
    return (await this.ranking(this.boardRange(deck, current))).standings;
  }

  // The questions whose points the leaderboard shows as just won: the round in progress with the leaderboard after each
  // round, else the question on screen.
  private boardRange(deck: Deck, current: number) {
    const r = deck.boardMode === "round" ? roundsOf(deck.questions) : null;
    const t = r ? topicAt(r, current) : null;
    return r && t !== null ? r.topics[t].indices : [current];
  }

  // Topic rounds as played so far.
  private async roundsState(): Promise<RoundsState> {
    return { ...freshRounds(), ...((await this.get<RoundsState>("rounds")) ?? {}) };
  }

  private playOf = (s: RoundsState): Play => ({ order: s.order, chosen: s.chosen });

  // A topic is locked once one of its questions has an answer: it can no longer be chosen again or left for another.
  private async topicLocked(deck: Deck, r: Rounds, topic: number) {
    for (const i of r.topics[topic]?.indices ?? []) if ((await this.answeredFor(deck, i)) > 0 || (await this.get<number>(`start:${i}`))) return true;
    return false;
  }

  // The vote at the picker as it stands, kept when it closes (null when nobody voted).
  private async liveBallot(deck: Deck, r: Rounds): Promise<Ballot | null> {
    const n = await this.answeredFor(deck, r.picker);
    return n ? { counts: await this.countsFor(deck, r.picker), n, tie: false, empty: false } : null;
  }

  // The room's votes for the topics over the whole game, for the results and the totals: each round's vote (cleared from the
  // picker as its round starts), plus the one open or closed right now.
  private async pickerVotes(deck: Deck, r: Rounds) {
    const s = await this.roundsState();
    const counts = r.topics.map(() => 0);
    let n = 0;
    const add = (b: Ballot | null | undefined) => {
      if (!b) return;
      b.counts.forEach((c, i) => i < counts.length && (counts[i] += c));
      n += b.n;
    };
    s.votes.forEach(add);
    // Back from a round, its vote is the one held for it (the picker's own counts were cleared).
    add((await this.liveBallot(deck, r)) ?? (s.chosen !== null ? s.ballot : null));
    return { counts, n };
  }

  // How many answered question `index`; the room's votes for the topics count every round's.
  private async answeredTotal(deck: Deck, index: number, r: Rounds | null) {
    return r && r.how === "vote" && index === r.picker ? (await this.pickerVotes(deck, r)).n : this.answeredFor(deck, index);
  }

  // Clears the picker's vote, for the next one: its counts, how many voted, and each person's vote.
  private async clearPickerVote(picker: number) {
    const keys = [...(await this.ctx.storage.list({ prefix: `v:${picker}:` })).keys(), `counts:${picker}`, `n:${picker}`, `lock:${picker}`];
    for (let i = 0; i < keys.length; i += 128) await this.ctx.storage.delete(keys.slice(i, i + 128));
  }

  // A round starts: its topic joins the topics played, the vote that chose it is kept, and the picker is ready for the next one.
  private async enterTopic(r: Rounds, s: RoundsState, topic: number, how: How) {
    const next: RoundsState = {
      ...s,
      order: [...s.order, topic],
      how: [...s.how, how],
      votes: [...s.votes, s.chosen === topic ? s.ballot : null],
      chosen: null,
      chosenHow: null,
      ballot: null,
      pass: s.pass + 1,
    };
    await this.clearPickerVote(r.picker);
    await this.ctx.storage.put("rounds", next);
  }

  // Back from the round in progress to the picker: its topic is chosen again, as it was, without a new draw.
  private async leaveTopic(s: RoundsState) {
    const order = [...s.order];
    const how = [...s.how];
    const votes = [...s.votes];
    const topic = order.pop()!;
    const chosenHow = how.pop() ?? "host";
    const ballot = votes.pop() ?? null;
    await this.ctx.storage.put("rounds", { ...s, order, how, votes, chosen: topic, chosenHow, ballot });
  }

  // A phone's state with its own place added at the end (`me`, null when it has no points yet).
  private withMe(shared: string, ws: WebSocket, standings: Map<string, Standing> | null) {
    if (!standings || !this.ctx.getTags(ws).includes("voter")) return shared;
    const voter = (ws.deserializeAttachment() as { voter?: string } | null)?.voter;
    if (!voter) return shared;
    return `${shared.slice(0, -1)},"me":${JSON.stringify(standings.get(voter.slice(0, 40)) ?? null)}}`;
  }

  // For the presentations list: answers, people, and the kinds of questions (a choice with a right answer is a quiz).
  async summary() {
    const deck = await this.load();
    if (!deck) return { total: 0, questions: 0, participants: 0, kinds: [] as string[] };
    let total = 0;
    const r = roundsOf(deck.questions);
    for (let i = 0; i < deck.questions.length; i++) total += await this.answeredTotal(deck, i, r);
    const kinds = [...new Set(deck.questions.map(uiKind))];
    return { total, questions: deck.questions.length, participants: (await this.get<number>("voters")) ?? 0, kinds };
  }

  // The summary as the app's home page shows it: also the kind of each question, the people connected right now and the
  // question on screen, when it was last edited and last shown, and how many answered each question (null: nothing to answer).
  async overview() {
    const deck = await this.load();
    if (!deck) return null;
    const answered: (number | null)[] = [];
    const r = roundsOf(deck.questions);
    for (let i = 0; i < deck.questions.length; i++) {
      answered.push(NOTHING_TO_ANSWER.includes(typeOf(deck.questions[i])) ? null : await this.answeredTotal(deck, i, r));
    }
    return {
      total: answered.reduce<number>((a, n) => a + (n ?? 0), 0),
      questions: deck.questions.length,
      participants: (await this.get<number>("voters")) ?? 0,
      kinds: [...new Set(deck.questions.map(uiKind))],
      sequence: deck.questions.map(uiKind),
      live: this.onlineCount(),
      current: (await this.get<number>("current")) ?? 0,
      editedAt: deck.edited?.at ?? null,
      shownAt: (await this.get<number>("shownAt")) ?? null,
      answered,
    };
  }

  // What anyone with the code may know: enough to show a join card.
  async info() {
    const deck = await this.load();
    return deck ? { title: deck.title, questions: deck.questions.length } : null;
  }

  // The text phones may ask to translate: title, and one question with its choices and scale labels.
  async texts(index: number, loaded?: Deck) {
    const deck = loaded ?? (await this.load());
    const q = deck?.questions[index];
    if (!deck || !q) return null;
    // A topic's question also brings its topic's name, for the phones' "History 2/4".
    const picker = q.topic !== undefined ? deck.questions.find(isPicker) : undefined;
    const topic = picker?.options[q.topic!];
    return { lang: deck.lang ?? "fr", title: deck.title, question: q.question, options: q.options, labels: q.labels ?? null, text: q.text ?? "", ...(topic ? { topic } : {}) };
  }

  // One question in a participant's language. Phones asking at the same moment share a single translation,
  // and the next question is translated right away, so it shows translated as soon as the presenter moves on.
  // `v`: the fingerprint of the original texts, so a phone that asked ahead knows the translation still matches.
  // `v` only comes with a real translation: a phone does not keep originals returned in its place (AI budget spent, model echo).
  // `deck`: already loaded by the caller (pretranslate), so it is not read again.
  // `ip`: the address of the phone asking, for its own limit (see aiShares).
  async translate(index: number, to: string, ahead = true, deck?: Deck, ip?: string): Promise<{ from: string; v?: string; title: string; question: string; options: string[]; labels: string[] | null; text: string; topic?: string } | null> {
    const loaded = deck ?? (await this.load());
    const texts = loaded && (await this.texts(index, loaded));
    if (!loaded || !texts) return null;
    if (ahead) this.translate(index + 1, to, false, loaded, ip).catch(() => {});
    // "auto": the language of the questions is unknown, the model reads it.
    const from = texts.lang === "auto" || LANGS.includes(texts.lang) ? texts.lang : "en";
    // A slide's text goes last, only when there is one: questions without it translate exactly as before.
    const base = [texts.title, texts.question, ...texts.options, ...(texts.labels ?? ["", ""]), ...(texts.text ? [texts.text] : [])];
    // A topic's name goes after everything else, only for topic rounds: other questions translate exactly as before.
    const all = texts.topic ? [...base, texts.topic] : base;
    const key = `${from}>${to}:${JSON.stringify(all)}`;
    let run = this.translating.get(key) as Promise<string[]> | undefined;
    const known = this.translatedQuestions.get(key);
    if (known) run = Promise.resolve(known);
    else if (!run) {
      run = this.aiShares(loaded, ip)
        .then((shares) => translateTexts(this.env, all, from, to, "poll", shares))
        .then((out) => {
          // Kept only when complete: past the AI budget, or when a model echoes the text, originals come back and are asked again later.
          if (translatedWell(base, out, !!texts.text)) {
            if (this.translatedQuestions.size > 400) this.translatedQuestions.clear();
            this.translatedQuestions.set(key, out);
          }
          return out;
        })
        .finally(() => this.translating.delete(key));
      this.translating.set(key, run);
    }
    const out = await run;
    const n = texts.options.length;
    return {
      from,
      ...(translatedWell(base, out, !!texts.text) ? { v: textVersion(texts) } : {}),
      title: out[0],
      question: out[1],
      options: out.slice(2, 2 + n),
      labels: texts.labels ? out.slice(2 + n, 4 + n) : null,
      text: texts.text ? (out[4 + n] ?? texts.text) : "",
      ...(texts.topic ? { topic: out[base.length] || texts.topic } : {}),
    };
  }

  // What a phone may ask to translate (/api/rooms/:code/translate): the question on screen, those already shown since the
  // last reset, the one before (a phone a moment behind) and the next one (asked early, and with topic rounds the next one
  // on the way the game goes). Never questions further on: anyone with the code could read a quiz before it is played.
  async translateShown(index: number, to: string, ahead: boolean, ip: string) {
    const deck = await this.load();
    if (!deck) return null;
    const current = (await this.get<number>("current")) ?? 0;
    // With topic rounds the question next in the list may belong to a topic not played yet: only the way the game goes.
    const r = roundsOf(deck.questions);
    let near = index === current || (!r && Math.abs(index - current) <= 1) || ((await this.get<number[]>("shown")) ?? []).includes(index);
    if (!near && r) {
      const step = nextStep(r, this.playOf(await this.roundsState()), current, deck.questions.length);
      near = !!step && "to" in step && step.to === index;
    }
    if (!near) return { refused: true as const };
    const out = await this.translate(index, to, ahead, deck, ip);
    // A right order or pairs: the options in the order the phones got them (snapshot), with the fingerprint of that order.
    // After the reveal too: phones keep showing the mixed order, and map the translation onto it.
    const q = deck.questions[index];
    const mix = out ? await this.mixFor(q, index) : null;
    const texts = mix && (await this.texts(index, deck));
    if (!out || !mix || !texts) return out;
    return {
      ...out,
      options: mixedOptions({ ...q, options: out.options }, mix),
      ...(out.v ? { v: textVersion({ ...texts, options: mixedOptions(q, mix) }) } : {}),
    };
  }

  // What a translation for this room may spend, held before each model call (worker/ai-budget.ts): the room's part of the
  // day, its owner's part, and for a phone's request, a few calls at a time for its network, so one address cannot keep
  // the room's part for itself. `posts`: what the audience wrote, counted apart (see ROOM_POSTS_AI_DAILY).
  private async aiShares(deck: Deck, ip?: string, posts = false): Promise<Share[]> {
    await this.ownerPlan(deck);
    const shares: Share[] = [this.roomShare(posts)];
    const id = this.owner?.id;
    if (id) shares.push(posts ? accountShare(this.env, id, OWNER_POSTS_AI_DAILY, "tp") : accountShare(this.env, id, OWNER_AI_DAILY));
    // The network's limit last: a call another part refuses does not use it up (it is never given back).
    if (ip) {
      const key = `t:${networkOf(ip)}`;
      shares.push({ hold: async () => this.allow(key, LIMITS.translate), settle: async () => {} });
    }
    return shares;
  }

  // The room's part of the day's translations (and within it, the audience's). Holding also waits for one of the room's
  // ROOM_AI_AT_ONCE turns, given back once the call is settled.
  private roomShare(posts: boolean): Share {
    return {
      hold: async (neurons) => {
        this.aiSpentRead ??= this.get<{ day: string; neurons: number; posts?: number }>("aiSpent");
        const stored = await this.aiSpentRead;
        const day = new Date().toISOString().slice(0, 10);
        this.aiSpent ??= stored ?? { day, neurons: 0 };
        if (this.aiSpent.day !== day) this.aiSpent = { day, neurons: 0 };
        if (this.aiSpent.neurons + neurons > ROOM_AI_DAILY) return false;
        if (posts && (this.aiSpent.posts ?? 0) + neurons > ROOM_POSTS_AI_DAILY) return false;
        this.aiSpent.neurons += neurons;
        if (posts) this.aiSpent.posts = (this.aiSpent.posts ?? 0) + neurons;
        if (this.aiRunning >= ROOM_AI_AT_ONCE) await new Promise<void>((go) => this.aiWaiting.push(go));
        this.aiRunning++;
        await this.ctx.storage.put("aiSpent", this.aiSpent);
        return true;
      },
      settle: async (neurons) => {
        this.aiRunning--;
        this.aiWaiting.shift()?.();
        if (!this.aiSpent || !neurons) return;
        this.aiSpent.neurons = Math.max(0, this.aiSpent.neurons + neurons);
        if (posts) this.aiSpent.posts = Math.max(0, (this.aiSpent.posts ?? 0) + neurons);
        await this.ctx.storage.put("aiSpent", this.aiSpent);
      },
    };
  }

  // Takes one from the flood limit `key` (see LIMITS). Bounded: past 20,000 addresses and sockets, they all start afresh.
  private allow(key: string, limit: readonly [number, number]) {
    if (this.buckets.size > 20_000) this.buckets.clear();
    let b = this.buckets.get(key);
    if (!b) this.buckets.set(key, (b = { left: limit[0], at: Date.now() }));
    return take(b, limit);
  }

  // Translates the question on screen and the next one, in the background, for the languages of the phones in the room
  // other than the presentation's: called when the presenter moves or starts, and when a phone joins with its language.
  // Phones then find the translation ready, or join the one under way. Never the whole deck, never a one-language room.
  private pretranslate(deck: Deck, langs = this.phoneLangs()) {
    const todo = langs.filter((lang) => lang !== (deck.lang ?? "fr"));
    if (!todo.length) return;
    (async () => {
      const current = (await this.get<number>("current")) ?? 0;
      // With topic rounds, the next question on the way the game goes (at the picker: the chosen topic's first one).
      const r = roundsOf(deck.questions);
      const step = r ? nextStep(r, this.playOf(await this.roundsState()), current, deck.questions.length) : null;
      const next = r ? (step && "to" in step ? step.to : current) : current + 1;
      for (const index of new Set([current, next])) {
        if (index >= deck.questions.length) continue;
        for (const lang of todo) this.translate(index, lang, false, deck).catch(() => {});
      }
    })().catch(() => {});
  }

  // Answers are public only for the question on screen: other questions' answers stay with the owner.
  private async onScreen(index: number) {
    return ((await this.get<number>("current")) ?? 0) === index;
  }

  // Whether what the audience wrote may be translated into `to`: only while a connected phone reads another language
  // (otherwise there is nothing to translate), and only into a language a phone here reads, the presentation's, or the
  // presenter's own (English or French when the presentation's is unknown).
  private readHere(deck: Deck, to: string) {
    const langs = this.phoneLangs();
    return langs.some((lang) => lang !== to) && (langs.includes(to) || to === deck.lang || to === "en" || to === "fr");
  }

  // The languages phones read right now. Screens ask for translated answers only when the room mixes languages.
  private phoneLangs() {
    const langs = new Set<string>();
    for (const ws of this.openVoters()) {
      const lang = (ws.deserializeAttachment() as { lang?: string } | null)?.lang;
      if (lang) langs.add(lang);
    }
    return [...langs];
  }

  // What the audience wrote (Q&A questions, open answers) in one language, for phones and the big screen.
  // Only visible posts; texts are read in their own language by the model, one batch for the new ones.
  async translatePosts(index: number, to: string, ip?: string): Promise<Record<string, string>> {
    const deck = await this.load();
    const q = deck?.questions[index];
    if (!deck || !q || !["open", "qa"].includes(typeOf(q)) || !(await this.onScreen(index)) || !this.readHere(deck, to)) return {};
    const posts = (await this.postsFor(deck, index)).filter((a) => !a.hidden);
    const key = (text: string) => `${to}:${text}`;
    // The newest first, at most 60 at a time: a long wall is caught up over a few calls.
    await this.translateMissing(`posts:${to}:${index}`, ip, () => [...new Set(posts.map((a) => a.text))].filter((t) => !this.postTranslations.has(key(t))).reverse().slice(0, 60), async (missing) => {
      // Texts clearly written in the target language need no model.
      const todo = missing.filter((t) => detectLang([t]) !== to);
      for (const t of missing) if (!todo.includes(t)) this.postTranslations.set(key(t), t);
      if (!todo.length) return true;
      const report: { refused?: boolean } = {};
      const out = await translateTexts(this.env, todo, "auto", to, "posts", await this.aiShares(deck, ip, true), report);
      // Refused by the day's budget or a part of it (the room's, its owner's, this network's): only what was translated
      // is kept, and the rest is asked again after a pause (see translateMissing).
      todo.forEach((t, i) => {
        if (!report.refused || (out[i] && out[i] !== t)) this.postTranslations.set(key(t), out[i] || t);
      });
      return !report.refused;
    });
    const out: Record<string, string> = {};
    for (const a of posts) {
      const text = this.postTranslations.get(key(a.text));
      if (text && text !== a.text) out[a.id] = text;
    }
    return out;
  }

  // The words of a cloud in one language, so the same idea in several languages counts once on the big screen.
  async translateWords(index: number, to: string, ip?: string): Promise<Record<string, string>> {
    const deck = await this.load();
    const q = deck?.questions[index];
    if (!deck || !q || typeOf(q) !== "words" || !(await this.onScreen(index)) || !this.readHere(deck, to)) return {};
    const cloud = Object.entries(await this.wordsFor(index)).sort((a, b) => b[1] - a[1]).slice(0, 80).map(([w]) => w);
    const key = (word: string) => `w:${to}:${word}`;
    await this.translateMissing(`words:${to}:${index}`, ip, () => cloud.filter((w) => !this.postTranslations.has(key(w))), async (missing) => {
      const report: { refused?: boolean } = {};
      const out = await translateTexts(this.env, missing, "auto", to, "words", await this.aiShares(deck, ip, true), report);
      // As for posts: a word refused by the budget is asked again after a pause.
      missing.forEach((w, i) => {
        const word = out[i].trim().toLocaleLowerCase().slice(0, 25);
        if (!report.refused || (word && word !== w)) this.postTranslations.set(key(w), word || w);
      });
      return !report.refused;
    });
    const out: Record<string, string> = {};
    for (const w of cloud) {
      const word = this.postTranslations.get(key(w));
      if (word && word !== w) out[w] = word;
    }
    return out;
  }

  // One translation batch at a time per job. A request arriving during another one's batch waits for it,
  // then translates what that batch did not cover (answers sent in the meantime).
  // `translate` says false when the budget refused: that job then pauses a minute for the network asking (`ip`), so
  // the texts are asked again later, without reading the database on every request in the meantime.
  private async translateMissing(job: string, ip: string | undefined, missing: () => string[], translate: (texts: string[]) => Promise<boolean>) {
    // A room awake for days keeps memory bounded: past 20,000 texts, start over (the database cache stays).
    if (this.postTranslations.size > 20000) this.postTranslations.clear();
    const pause = `${job}:${ip ? networkOf(ip) : ""}`;
    if (this.aiPaused.size > 20_000) this.aiPaused.clear();
    for (let round = 0; round < 3; round++) {
      if ((this.aiPaused.get(pause) ?? 0) > Date.now()) return;
      const todo = missing();
      if (!todo.length) return;
      const running = this.translating.get(job);
      if (running) {
        await running.catch(() => {});
        continue;
      }
      const run = translate(todo).then((done) => {
        if (!done) this.aiPaused.set(pause, Date.now() + 60_000);
      }).finally(() => this.translating.delete(job));
      this.translating.set(job, run);
      await run;
    }
  }

  // Results for tools holding the host key (or a teammate's presenter key).
  async resultsFor(key: string, code?: string) {
    const deck = await this.load();
    if (!deck || !key || (key !== deck.hostKey && (await this.memberRole(deck, key, code ?? deck.code)) !== "h")) return null;
    // Contact details never leave the owner's own pages.
    const results = await this.results();
    return results && { ...results, questions: results.questions.map((q) => ({ ...q, contacts: [] })) };
  }

  // Every question with its results, for the owner's results page.
  async results() {
    const deck = await this.load();
    if (!deck) return null;
    const questions = [];
    // Topic rounds' picker: the room's votes of every round (each is cleared from it as its round starts), or the topics
    // the wheel chose, in the order they played.
    const r = roundsOf(deck.questions);
    const s = r ? await this.roundsState() : null;
    const votes = r && r.how === "vote" ? await this.pickerVotes(deck, r) : null;
    for (let i = 0; i < deck.questions.length; i++) {
      const posts = (await this.postsFor(deck, i)).filter((a) => !a.hidden);
      const q = deck.questions[i];
      const type = typeOf(q);
      const atPicker = !!r && i === r.picker;
      questions.push({
        ...q,
        type,
        counts: atPicker && votes ? votes.counts : await this.countsFor(deck, i),
        words: await this.wordsFor(i),
        answers: posts.map(({ text, at, votes, done }) => ({ text, at, votes: votes ?? 0, done: !!done })),
        contacts: typeOf(deck.questions[i]) === "contact" ? await this.contactsFor(i) : [],
        answered: atPicker && votes ? votes.n : await this.answeredFor(deck, i),
        numbers: typeOf(deck.questions[i]) === "number" ? Object.values(await this.numbersFor(i)) : [],
        order: (type === "rank" && q.ordered) || type === "match" || type === "fill" ? await this.orderFor(deck, i) : null,
        // Spots tapped on an image, the answers typed in each blank, and who the wheel picked.
        spots: type === "spot" ? Object.values(await this.spotsFor(i)) : [],
        fillTop: type === "fill" ? this.topAnswers(await this.fillWordsFor(i, parseFill(q.fill ?? "").answers.length), 8) : [],
        picked: atPicker && r && s && r.how === "wheel" ? s.order.map((t) => r.topics[t].label) : type === "wheel" ? ((await this.get<Picked[]>(`picked:${i}`)) ?? []).map((p) => p.label) : [],
      });
    }
    const participants = (await this.get<number>("voters")) ?? 0;
    const names = !!deck.names;
    const hasQuiz = deck.questions.some(isScored);
    // `edited`: the builder sends it back when saving, to notice a teammate's save in between.
    const edited = deck.edited ? { at: deck.edited.at, name: deck.edited.name } : null;
    // Topic rounds: the topics played in order, how each was chosen and the vote that chose it, and those never played.
    const rounds =
      r && s
        ? {
            how: r.how,
            topics: r.topics.map((t) => ({ label: t.label, indices: t.indices })),
            rounds: r.rounds,
            played: await this.playedRounds(r, s),
            notPlayed: remainingOf(r, this.playOf(s)),
          }
        : null;
    // `boardMode`: null for presentations saved before the setting (the Leaderboard button only).
    return { title: deck.title, lang: deck.lang ?? "fr", names, intro: !!deck.intro, boardMode: deck.boardMode ?? null, decor: deck.decor ?? null, edited, questions, participants, leaderboard: hasQuiz ? await this.finalBoard() : [], ...(rounds ? { rounds } : {}) };
  }

  // The rounds played, in order: how each topic was chosen, the vote that chose it, and who won the most points on its
  // questions (`best`: every player tied on the top score, null when the round brought no points). One read of every score.
  private async playedRounds(r: Rounds, s: RoundsState) {
    const won = s.order.map(() => new Map<string, number>());
    const roundOf = new Map<string, number>();
    s.order.forEach((t, k) => r.topics[t].indices.forEach((i) => roundOf.set(String(i), k)));
    if (s.order.length) {
      for (const [key, value] of await this.ctx.storage.list<number>({ prefix: "p:" })) {
        const [, index, ...rest] = key.split(":");
        const k = roundOf.get(index);
        if (k === undefined || !value) continue;
        const voter = rest.join(":");
        won[k].set(voter, (won[k].get(voter) ?? 0) + value);
      }
    }
    const tops = won.map((m) => {
      const score = Math.max(0, ...m.values());
      return { score, voters: score > 0 ? [...m].filter(([, v]) => v === score).map(([voter]) => voter).slice(0, 5) : [] };
    });
    const names = await this.getMany<string>(tops.flatMap((x) => x.voters.map((v) => `name:${v}`)));
    return s.order.map((topic, k) => ({
      topic,
      how: s.how[k] ?? "host",
      votes: s.votes[k] ?? null,
      best: tops[k].score > 0 ? { score: tops[k].score, names: tops[k].voters.map((v) => names.get(`name:${v}`) ?? "Anonymous").sort((a, b) => a.localeCompare(b)) } : null,
    }));
  }

  // Teammates with this presentation open in the builder, refreshed every 20 seconds by each of them.
  // Stored with the room: an idle room may sleep between two of these calls.
  async editing(id: string, name: string) {
    const now = Date.now();
    const list = (await this.get<Record<string, { name: string; at: number }>>("editors")) ?? {};
    list[id] = { name, at: now };
    for (const [key, value] of Object.entries(list)) if (now - value.at > 45_000) delete list[key];
    await this.ctx.storage.put("editors", list);
    return Object.entries(list)
      .filter(([key]) => key !== id)
      .map(([, value]) => value.name);
  }

  // Waiting screen before the presenter starts: the slide shows the QR code, phones wait.
  async setLobby(on: boolean) {
    await this.ctx.storage.put("lobby", on);
    this.scheduleBroadcast(0);
  }

  // A slide added to a deck opens on the waiting screen, unless the session is already running:
  // then the phones in the room keep their question.
  async lobbyIfIdle() {
    if ((await this.get<number>("voters")) || (await this.get<number>("current")) || (await this.get<number>("launch"))) return;
    await this.setLobby(true);
  }

  // Clears every answer and goes back to the first question, keeping the questions.
  async reset() {
    const prefixes = ["counts:", "n:", "v:", "t:", "p:", "seen:", "words:", "w:", "wn:", "open:", "on:", "qa:", "qn:", "up:", "reveal:", "start:", "name:", "avatar:", "contact:", "ban:", "lock:", "nums:", "pos:", "okn:", "fillw:", "spots:", "spin:", "picked:", "clock:"];
    for (const prefix of prefixes) {
      const keys = [...(await this.ctx.storage.list({ prefix })).keys()];
      for (let i = 0; i < keys.length; i += 128) await this.ctx.storage.delete(keys.slice(i, i + 128));
    }
    // A new seed too: orders revealed in this session tell nothing about the next one's.
    await this.ctx.storage.delete(["voters", "named", "counts", "board", "launch", "rounds", "shown", "mix", "mix2"]);
    this.scoresChanged();
    await this.ctx.storage.deleteAlarm();
    // A new round: phones forget the answers they remember from before, and answers sent before it are refused.
    await this.ctx.storage.put({ current: 0, round: Date.now() });
    this.scheduleBroadcast(0);
  }

  // Saves an edit. Answers belong to the questions: they are cleared only when the questions change,
  // not for a new title, language, first-names setting, leaderboard setting or results style.
  // Settings left out (`intro`, `boardMode`, `decor`: tools that do not know them) keep their stored value; a decor set
  // to null goes back to the normal one. The decor only changes the look: answers stay.
  async update(
    title: string,
    questions: Question[],
    names = false,
    lang = "en",
    opts: { intro?: boolean; boardMode?: BoardMode; decor?: Decor | null; by?: { id: string; name: string }; base?: number } = {},
  ): Promise<{ ok: boolean } | { conflict: string }> {
    const deck = await this.load();
    if (!deck) return { ok: false };
    // A teammate saved after this builder opened the presentation: their changes would be lost.
    if (opts.base !== undefined && deck.edited && deck.edited.at > opts.base && deck.edited.id !== opts.by?.id) return { conflict: deck.edited.name || "A teammate" };
    // The results style only changes the look, and the number of topic rounds only how long the game lasts: answers stay.
    const content = (list: Question[]) => JSON.stringify(list.map(({ style: _style, rounds: _rounds, ...q }) => q));
    const changed = content(deck.questions) !== content(questions);
    const edited = opts.by ? { ...opts.by, at: Date.now() } : deck.edited;
    const boardMode = opts.boardMode ?? deck.boardMode;
    const { decor: _decor, ...rest } = deck;
    const decor = opts.decor === undefined ? deck.decor : opts.decor;
    await this.ctx.storage.put("deck", { ...rest, title, questions, names, lang, intro: opts.intro ?? deck.intro, ...(boardMode ? { boardMode } : {}), ...(decor ? { decor } : {}), edited });
    if (changed) await this.reset();
    else this.scheduleBroadcast(0);
    return { ok: true };
  }

  async destroy() {
    for (const ws of this.ctx.getWebSockets()) ws.close(4404, "deleted");
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  async fetch(request: Request): Promise<Response> {
    let deck = await this.load();
    if (!deck) return new Response("Not found", { status: 404 });
    // Rooms made before the code was stored learn it here, to look up their owner's plan.
    const code = new URL(request.url).pathname.match(/^\/api\/rooms\/([A-Z0-9]{5})\/ws$/)?.[1];
    if (code && !deck.code) {
      deck = { ...deck, code };
      await this.ctx.storage.put("deck", deck);
    }
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }
    const params = new URL(request.url).searchParams;
    const key = params.get("key");
    let isHost = !!key && key === deck.hostKey;
    let isSlide = !!key && !!deck.slideKey && key === deck.slideKey;
    if (key && !isHost && !isSlide) {
      const role = await this.memberRole(deck, key, code ?? deck.code);
      isHost = role === "h";
      isSlide = role === "s";
      // The database read let other events run.
      deck = (await this.load()) ?? deck;
    }
    // One address opening sockets without end (each one could speak for a new person): refused for a moment,
    // phones try again on their own a second later.
    // An IPv6 address counts with its /64, which one person can walk through (auth.ts networkOf).
    const ip = networkOf(request.headers.get("CF-Connecting-IP") ?? "local").slice(0, 64);
    if (!isHost && (!this.allow(`j:${ip}`, LIMITS.join) || this.ctx.getWebSockets(`ip:${ip}`).length >= SOCKETS_PER_ADDRESS)) {
      return new Response("Too many connections", { status: 429, headers: { "Retry-After": "2" } });
    }
    const { 0: client, 1: server } = new WebSocketPair();
    // A key that opens nothing (changed since, or a teammate who left): the screen is told to ask for the key again.
    if (key && !isHost && !isSlide) {
      server.accept();
      server.close(4403, "key");
      return new Response(null, { status: 101, webSocket: client });
    }
    // Hibernatable socket: the object sleeps between votes, so an idle room costs nothing.
    // A slide drives with its own key; one without a key only watches. Neither is a participant.
    // The address is kept with the socket (in memory only) for the flood limits.
    this.ctx.acceptWebSocket(server, [isHost ? "host" : isSlide ? "slide" : params.get("view") ? "viewer" : "voter", `ip:${ip}`]);
    // The home page shows when the presentation was last on a presenter's screen.
    if (isHost) await this.ctx.storage.put("shownAt", Date.now());
    const voter = cleanText(params.get("voter"), 64);
    if (!isHost && voter) server.serializeAttachment({ voter });
    const first = JSON.stringify(await this.snapshot(deck, isHost));
    server.send(isHost ? first : this.withMe(first, server, await this.standingsShown(deck)));
    // Everyone else learns that someone arrived (the waiting screen counts them).
    if (!isHost && !isSlide) this.scheduleBroadcast();
    return new Response(null, { status: 101, webSocket: client });
  }

  // A quiz timer ran out: show the answer everywhere. Every timer that ended counts, not only the question on screen,
  // since the presenter may have moved on (a room has a single alarm), and the alarm is set again for timers still running.
  async alarm() {
    const deck = await this.load();
    if (!deck) return;
    const now = Date.now();
    let next = Infinity;
    for (const [key, startedAt] of await this.ctx.storage.list<number>({ prefix: "start:" })) {
      const index = Number(key.slice("start:".length));
      const q = deck.questions[index];
      if (!q?.timer) continue;
      const end = startedAt + q.timer * 1000;
      // Shown once: a presenter who hides the answer again keeps it hidden.
      if (now >= end) {
        if ((await this.get<boolean>(`reveal:${index}`)) === undefined) await this.ctx.storage.put(`reveal:${index}`, true);
      } else next = Math.min(next, end + GRACE_MS);
    }
    if (next < Infinity) await this.ctx.storage.setAlarm(next);
    this.scheduleBroadcast(0);
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    if ((typeof raw === "string" ? raw.length : raw.byteLength) > MAX_MESSAGE) return;
    let msg: ClientMessage;
    try {
      msg = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
    } catch {
      return;
    }
    if (!msg || typeof msg !== "object") return;
    const tags = this.ctx.getTags(ws);
    // Floods are refused before anything is read or written: per socket (the presenter's screen gets more), and per address.
    const limit = tags.includes("host") || tags.includes("slide") ? LIMITS.screen : LIMITS.phone;
    let b = this.socketBuckets.get(ws);
    if (!b) this.socketBuckets.set(ws, (b = { left: limit[0], at: Date.now() }));
    const ip = tags.find((t) => t.startsWith("ip:"));
    const flood = !take(b, limit) || (!!ip && !tags.includes("host") && !this.allow(`m:${ip}`, LIMITS.address));
    // The phone learns whether its answer counted.
    const ref = Number.isInteger(msg.ref) ? msg.ref : null;
    const ack = (ok: boolean) => {
      if (ref === null) return;
      try {
        ws.send(JSON.stringify({ type: "ack", ref, ok }));
      } catch {
        // Socket already gone.
      }
    };
    if (flood) return ack(false);
    const deck = await this.load();
    if (!deck) return ack(false);
    if (HOST_ONLY.has(msg.type) && !tags.includes("host") && !(tags.includes("slide") && SLIDE_ALLOWED.has(msg.type))) return ack(false);
    // Slides and viewers never answer.
    if (!HOST_ONLY.has(msg.type) && !tags.includes("voter")) return ack(false);
    if (HOST_ONLY.has(msg.type)) {
      const owner = tags.includes("host");
      // Topic rounds change with the answers one at a time; every other presentation runs as before.
      if (ROUND_ACTIONS.has(msg.type) && deck.questions.some(isPicker)) await this.serial(async () => this.hostAction((await this.load()) ?? deck, msg, owner));
      else await this.hostAction(deck, msg, owner);
      this.scheduleBroadcast(0);
      return ack(true);
    }
    const outcome = await this.participantAction(ws, deck, msg);
    // A counted answer may change a score, a name changes how the leaderboard reads.
    if (outcome.ok) this.scoresChanged();
    if (outcome.changed) this.scheduleBroadcast();
    ack(outcome.ok);
  }

  // Runs answers one after the other. Answers that waited together on the owner's plan resume together,
  // and the input gate does not keep them apart: without this, two votes could both add 1 to the same count.
  private serial<T>(run: () => Promise<T>): Promise<T> {
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => {});
    return next;
  }

  private async hostAction(deck: Deck, msg: ClientMessage, owner: boolean) {
    const current = (await this.get<number>("current")) ?? 0;
    const q = deck.questions[current];
    const r = roundsOf(deck.questions);
    // Topic rounds' wheel and vote: `from` (when sent) is the question the screen saw; a screen behind never spins the wheel
    // or closes the vote of a picker it has not shown yet.
    if ((msg.type === "spin" || msg.type === "pick" || msg.type === "repick") && msg.from !== undefined && Number(msg.from) !== current) return;
    switch (msg.type) {
      case "goto": {
        const index = Number(msg.index);
        if (!Number.isInteger(index) || index < 0 || index >= deck.questions.length) return;
        if (r && !(await this.gotoRounds(deck, r, current, index))) return;
        await this.moveTo(index);
        this.pretranslate(deck);
        return;
      }
      case "step": {
        // → and ← in a presentation with topic rounds. `from`: the question the screen saw, so a second screen (two tabs) sending
        // the same step moves once.
        if (Number(msg.from) !== current) return;
        const dir = Number(msg.dir) < 0 ? -1 : 1;
        if (!r) {
          const index = current + dir;
          if (index < 0 || index >= deck.questions.length) return;
          await this.moveTo(index);
          this.pretranslate(deck);
          return;
        }
        const s = await this.roundsState();
        const play = this.playOf(s);
        const target = dir > 0 ? nextStep(r, play, current, deck.questions.length) : prevStep(r, play, current);
        if (!target || "need" in target) return;
        if (target.enter !== undefined) {
          // The wheel turns to its end before the round starts.
          if (s.chosenHow === "wheel") {
            const spin = await this.get<Spin>(`spin:${r.picker}`);
            if (spin && Date.now() < spin.at + SPIN_MS) return;
          }
          const d = decisionOf(r, play);
          await this.enterTopic(r, s, target.enter, d?.last ? "last" : s.chosen === target.enter ? (s.chosenHow ?? "host") : "host");
        } else if (target.back) await this.leaveTopic(s);
        await this.moveTo(target.to);
        this.pretranslate(deck);
        return;
      }
      case "pick": {
        // The presenter closes the vote (no topic: the room's choice) or chooses the topic.
        if (!r || current !== r.picker) return;
        const s = await this.roundsState();
        if (!roundsLeft(r, this.playOf(s))) return;
        const left = remainingOf(r, this.playOf(s));
        const random = (n: number) => crypto.getRandomValues(new Uint32Array(1))[0] % n;
        if (msg.topic !== undefined && msg.topic !== null) {
          const topic = Number(msg.topic);
          if (!Number.isInteger(topic) || !left.includes(topic)) return;
          if (s.chosen !== null && s.chosen !== topic && (await this.topicLocked(deck, r, s.chosen))) return;
          // An open vote closes with the presenter's choice; what the room voted stays in the results.
          const ballot = s.chosen === null && r.how === "vote" ? await this.liveBallot(deck, r) : s.ballot;
          await this.ctx.storage.put("rounds", { ...s, chosen: topic, chosenHow: "host", ballot });
        } else {
          if (r.how !== "vote" || s.chosen !== null || left.length < 2) return;
          // The most voted topic left wins; a tie is drawn at random among the tied ones, no vote at all among every topic left.
          const counts = await this.countsFor(deck, r.picker);
          const n = await this.answeredFor(deck, r.picker);
          const best = Math.max(...left.map((t) => counts[t] ?? 0));
          const tied = best > 0 ? left.filter((t) => (counts[t] ?? 0) === best) : left;
          const winner = tied[random(tied.length)];
          await this.ctx.storage.put("rounds", { ...s, chosen: winner, chosenHow: "vote", ballot: { counts, n, tie: best > 0 && tied.length > 1, empty: best === 0 } });
        }
        this.pretranslate(deck);
        return;
      }
      case "repick": {
        // Choose again, as long as the chosen topic has no answer yet: a vote opens afresh, the wheel is ready to turn.
        if (!r || current !== r.picker) return;
        const s = await this.roundsState();
        if (s.chosen === null || (await this.topicLocked(deck, r, s.chosen))) return;
        if (r.how === "vote") await this.clearPickerVote(r.picker);
        await this.ctx.storage.put("rounds", { ...s, chosen: null, chosenHow: null, ballot: null, pass: r.how === "vote" ? s.pass + 1 : s.pass });
        return;
      }
      case "reveal":
        await this.ctx.storage.put(`reveal:${current}`, !!msg.show);
        return;
      case "start": {
        if (!q?.timer || (await this.get<number>(`start:${current}`))) return;
        // `lead`: a count-in (3, 2, 1, here we go) before the clock runs, the same on every screen and phone.
        const lead = Math.min(5000, Math.max(0, Math.round(Number(msg.lead) || 0)));
        const startAt = Date.now() + lead;
        await this.ctx.storage.put(`start:${current}`, startAt);
        // An earlier alarm (another question's timer) stays: it sets the next one when it runs.
        const at = startAt + q.timer * 1000 + GRACE_MS;
        const set = await this.ctx.storage.getAlarm();
        if (!set || set > at) await this.ctx.storage.setAlarm(at);
        return;
      }
      case "board":
        // Stored as the time it opened, so screens and phones play its animation together, and only when it just opened.
        // Presentations with the leaderboard off never show one.
        if (deck.boardMode === "off") return;
        await this.ctx.storage.put("board", msg.show ? Date.now() : false);
        return;
      case "lobby": {
        // With the launch animation the session starts once per round: the waiting screen does not come back.
        const launched = deck.intro ? await this.get<number>("launch") : undefined;
        if (msg.on && launched) return;
        if (!msg.on && deck.intro && !launched && (await this.get<boolean>("lobby"))) await this.ctx.storage.put("launch", Date.now());
        await this.ctx.storage.put("lobby", !!msg.on);
        // Waiting screen or start: the first question (and the next) ready in the phones' languages.
        this.pretranslate(deck);
        return;
      }
      case "lock":
        // Voting paused for this question only: results stay, phones stop taking answers.
        if (msg.on) await this.ctx.storage.put(`lock:${current}`, true);
        else await this.ctx.storage.delete(`lock:${current}`);
        return;
      case "spin": {
        if (q?.topics && r && current === r.picker) {
          if (r.how === "wheel") await this.spinTopics(deck, r);
          return;
        }
        if (!q || typeOf(q) !== "wheel") return;
        // A spin runs to its end before the next one.
        const last = await this.get<Spin & { list: string[] }>(`spin:${current}`);
        if (last && Date.now() < last.at + SPIN_MS) return;
        const entries = await this.wheelEntries(deck, q);
        let picked = (await this.get<Picked[]>(`picked:${current}`)) ?? [];
        let left = entries.filter((e) => !picked.some((p) => p.key === e.key));
        // Everyone was picked once: the wheel starts again with everyone.
        if (!left.length) {
          picked = [];
          left = entries;
        }
        if (!left.length) return;
        const random = (n: number) => crypto.getRandomValues(new Uint32Array(1))[0] % n;
        const winner = left[random(left.length)];
        // A crowd is drawn as a sample that holds the winner: slices stay readable.
        let list = left;
        if (list.length > WHEEL_SIZE) {
          const others = left.filter((e) => e !== winner);
          const keep = new Set<Picked>([winner]);
          while (keep.size < WHEEL_SIZE) keep.add(others[random(others.length)]);
          list = left.filter((e) => keep.has(e));
        }
        const win = list.indexOf(winner);
        const from = last ? last.to % 360 : 0;
        const jitter = crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296 - 0.5;
        const spin = {
          at: Date.now(),
          from,
          to: spinTarget(from, win, list.length, 5 + random(3), jitter),
          win,
          n: (last?.n ?? 0) + 1,
          // The winner's phone recognizes itself; nobody else learns who it is.
          tag: winner.key.startsWith("#") ? "" : tagOf(winner.key),
          list: list.map((e) => e.label),
        };
        await this.ctx.storage.put({ [`spin:${current}`]: spin, [`picked:${current}`]: [...picked, { label: winner.label, key: winner.key }] });
        return;
      }
      case "unspin":
        // The wheel starts over: everyone is back on it. Not for topic rounds: a topic played stays played.
        if (!q || typeOf(q) !== "wheel" || q.topics) return;
        await this.ctx.storage.delete([`spin:${current}`, `picked:${current}`]);
        return;
      case "clock": {
        if (!q || typeOf(q) !== "countdown") return;
        const total = (q.duration ?? COUNTDOWN_DEFAULT) * 1000;
        const now = Date.now();
        const clock = (await this.get<Clock>(`clock:${current}`)) ?? { run: false, end: 0, left: total, total };
        const left = clock.run ? Math.max(0, clock.end - now) : clock.left;
        let next: Clock = clock;
        if (msg.act === "start") next = { run: true, end: now + (left > 0 ? left : total), left: 0, total };
        else if (msg.act === "pause") next = { run: false, end: 0, left, total };
        else if (msg.act === "reset") next = { run: false, end: 0, left: total, total };
        else if (msg.act === "add") {
          // A minute more by default, up to three hours on the clock.
          const by = Math.min(600, Math.max(10, Math.round(Number(msg.by) || 60))) * 1000;
          const more = Math.min(3 * 3600_000, left + by);
          next = clock.run && left > 0 ? { run: true, end: now + more, left: 0, total } : { run: false, end: 0, left: more, total };
        } else return;
        await this.ctx.storage.put(`clock:${current}`, next);
        return;
      }
      case "drop": {
        // Removes a word from the cloud for good: later answers cannot bring it back.
        if (!q || typeOf(q) !== "words") return;
        const word = cleanWord(msg.word);
        if (!word) return;
        const ban = (await this.get<string[]>(`ban:${current}`)) ?? [];
        if (!ban.includes(word) && ban.length < 200) ban.push(word);
        const cloud = await this.wordsFor(current);
        delete cloud[word];
        await this.ctx.storage.put({ [`ban:${current}`]: ban, [`words:${current}`]: cloud });
        return;
      }
      case "unname": {
        // The presenter takes a first name off the screens (and the leaderboard) for good: the phone cannot set it again.
        const tag = String(msg.tag ?? "");
        if (!tag) return;
        for (const key of (await this.ctx.storage.list({ prefix: "name:" })).keys()) {
          const voter = key.slice("name:".length);
          if (tagOf(voter) !== tag) continue;
          await this.ctx.storage.delete(key);
          await this.ctx.storage.put(`noname:${voter}`, true);
          this.scoresChanged();
        }
        return;
      }
      case "hide":
      case "done": {
        if (!q) return;
        const type = typeOf(q);
        if (type !== "open" && type !== "qa") return;
        const key = `${type}:${current}`;
        const list = (await this.get<Post[]>(key)) ?? [];
        const item = list.find((a) => a.id === String(msg.id));
        if (!item) return;
        // A slide's key can hide an answer but never show a hidden one again: only the owner undoes moderation.
        if (msg.type === "hide" && item.hidden && !owner) return;
        if (msg.type === "hide") item.hidden = !item.hidden;
        else item.done = !item.done;
        await this.ctx.storage.put(key, list);
        return;
      }
    }
  }

  // The presenter moves to a question. The questions shown since the last reset are remembered (see translateShown).
  private async moveTo(index: number) {
    const shown = (await this.get<number[]>("shown")) ?? [];
    const from = (await this.get<number>("current")) ?? 0;
    const more = [from, index].filter((i, k, all) => !shown.includes(i) && all.indexOf(i) === k);
    await this.ctx.storage.put({ current: index, board: false, ...(more.length ? { shown: [...shown, ...more] } : {}) });
  }

  // A click on another topic's question (a dot, an older tab) chooses that topic, as the presenter would at the picker.
  // Back to the picker from the round in progress, its topic is chosen again. False: the move is refused.
  private async gotoRounds(deck: Deck, r: Rounds, current: number, index: number) {
    const s = await this.roundsState();
    const play = this.playOf(s);
    const t = topicAt(r, index);
    if (t !== null && !s.order.includes(t)) {
      if (!roundsLeft(r, play)) return false;
      // A topic already started is never left for another.
      if (s.chosen !== null && s.chosen !== t && (await this.topicLocked(deck, r, s.chosen))) return false;
      const ballot = s.chosen === t ? s.ballot : s.chosen === null && r.how === "vote" ? await this.liveBallot(deck, r) : s.ballot;
      const d = decisionOf(r, play);
      await this.enterTopic(r, { ...s, chosen: t, ballot }, t, s.chosen === t ? (s.chosenHow ?? "host") : d?.last && d.topic === t ? "last" : "host");
      return true;
    }
    const here = topicAt(r, current);
    // Not when the picker already holds the next round's topic: the round on screen then stays played.
    if (index === r.picker && here !== null && s.order[s.order.length - 1] === here && s.chosen === null) await this.leaveTopic(s);
    return true;
  }

  // The picker's wheel turns among the topics left and chooses the next round's. The only topic left needs no wheel.
  private async spinTopics(deck: Deck, r: Rounds) {
    const s = await this.roundsState();
    const play = this.playOf(s);
    // A topic chosen is only chosen again with "Choose again" (repick), never by another spin.
    if (!roundsLeft(r, play) || s.chosen !== null) return;
    const last = await this.get<Spin & { list: string[] }>(`spin:${r.picker}`);
    if (last && Date.now() < last.at + SPIN_MS) return;
    const left = remainingOf(r, play);
    if (left.length < 2) return;
    const random = (n: number) => crypto.getRandomValues(new Uint32Array(1))[0] % n;
    const win = random(left.length);
    const from = last ? last.to % 360 : 0;
    const jitter = crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296 - 0.5;
    const spin = { at: Date.now(), from, to: spinTarget(from, win, left.length, 5 + random(3), jitter), win, n: (last?.n ?? 0) + 1, tag: "", list: left.map((t) => r.topics[t].label) };
    await this.ctx.storage.put({ [`spin:${r.picker}`]: spin, rounds: { ...s, chosen: left[win], chosenHow: "wheel", ballot: null } });
    this.pretranslate(deck);
  }

  // What the wheel spins among: its own entries, or the first names of the people connected right now.
  // `limit`: how many people to read at most (the screens only draw a few dozen).
  private async wheelEntries(deck: Deck, q: Question, limit = MAX_NUMBERS): Promise<Picked[]> {
    if (q.options.length) return q.options.map((label, i) => ({ label, key: `#${i}` }));
    if (!deck.names) return [];
    const voters = new Set<string>();
    for (const ws of this.openVoters()) {
      const v = (ws.deserializeAttachment() as { voter?: string } | null)?.voter;
      if (v) voters.add(v);
    }
    const list = [...voters].slice(0, limit);
    const names = await this.getMany<string>(list.map((v) => `name:${v}`));
    return list.map((v) => ({ label: names.get(`name:${v}`) ?? "", key: v })).filter((e) => e.label);
  }

  private async participantAction(ws: WebSocket, deck: Deck, msg: ClientMessage): Promise<Outcome> {
    const voter = String((msg as { voter?: unknown }).voter ?? "").slice(0, 40);
    if (!voter) return REJECTED;

    // One socket speaks for one person. Without this, a single socket could invent voter ids to write
    // unlimited name rows (names are not capped like votes), burning the daily Durable Object write quota.
    const bound = (ws.deserializeAttachment() as { voter?: string } | null)?.voter?.slice(0, 40);
    if (bound && bound !== voter) return REJECTED;
    if (!bound) ws.serializeAttachment({ voter });

    if (msg.type === "name") {
      // Sent by every phone on connect (anonymous ones too, without a name) so the screen shows the same buddy.
      // Only written when it changed: each stored row counts against the daily quota. A full room stores nothing for
      // newcomers (they cannot take part), a name the presenter removed is not taken again, and a name with a link or an
      // insult is not shown (the buddy is).
      // Phones that only send a name never take a place: past twice the cap of people given a name, newcomers store nothing.
      const name = cleanName(msg.name);
      const cap = await this.capFor(deck);
      const had = await this.get<string>(`name:${voter}`);
      const hadAvatar = await this.get<string>(`avatar:${voter}`);
      const known = had !== undefined || hadAvatar !== undefined;
      const named = (await this.get<number>("named")) ?? 0;
      const counted = !cap || known || (await this.get<boolean>(`seen:${voter}`)) || (((await this.get<number>("voters")) ?? 0) < cap && named < cap * 2);
      const writes: Record<string, unknown> = {};
      if (counted && name && name !== had && !(await this.get<boolean>(`noname:${voter}`))) writes[`name:${voter}`] = name;
      if (counted && msg.avatar && AVATARS.includes(msg.avatar) && msg.avatar !== hadAvatar) writes[`avatar:${voter}`] = msg.avatar;
      if (Object.keys(writes).length) await this.ctx.storage.put(known ? writes : { ...writes, named: named + 1 });
      // Remember who this socket is, so the waiting screen can list the people in the room,
      // and the phone's language, so answers are translated only when the room mixes languages.
      // A name sent again during a quiz may come without a language: the one already known stays.
      const knownLang = (ws.deserializeAttachment() as { lang?: string } | null)?.lang;
      const lang = typeof msg.lang === "string" && LANGS.includes(msg.lang) ? msg.lang : knownLang;
      ws.serializeAttachment({ voter, ...(lang ? { lang } : {}) });
      // A phone in another language than the presentation's: the question on screen and the next one get ready for it.
      if (lang && lang !== knownLang) this.pretranslate(deck, [lang]);
      return CHANGED;
    }

    // The owner's plan comes first: it may wait on the database. Everything after it reads the room afresh, one answer at a time.
    const cap = await this.capFor(deck);
    return this.serial(() => this.applyAnswer(ws, voter, cap, msg));
  }

  private async applyAnswer(ws: WebSocket, voter: string, cap: number, msg: ClientMessage): Promise<Outcome> {
    const deck = await this.load();
    if (!deck) return REJECTED;

    // Nothing to answer while the slide shows the waiting screen.
    if (await this.get<boolean>("lobby")) return REJECTED;

    const current = (await this.get<number>("current")) ?? 0;
    // An answer for another question (held during a network drop, or tapped as the presenter moved on), or from before a reset.
    if (msg.index !== undefined && msg.index !== current) return REJECTED;
    if (msg.round !== undefined && msg.round !== ((await this.get<number>("round")) ?? 0)) return REJECTED;
    const question = deck.questions[current];
    // The current index can point past the end if questions were removed while the room was open.
    if (!question) return REJECTED;
    const type = typeOf(question);
    const now = Date.now();

    if (await this.get<boolean>(`lock:${current}`)) return REJECTED;

    // A slide, a wheel, a timer or a video has nothing to answer.
    if (NOTHING_TO_ANSWER.includes(type)) return REJECTED;

    // The vote for the next topic: one topic not played yet, while none is chosen, in the vote under way (`pass`:
    // a vote held from an earlier round, or from before choosing again, is refused).
    if (question.topics) {
      const r = roundsOf(deck.questions);
      if (!r || r.how !== "vote" || current !== r.picker || msg.type !== "vote") return REJECTED;
      const s = await this.roundsState();
      const play = this.playOf(s);
      if (!roundsLeft(r, play) || decisionOf(r, play)) return REJECTED;
      if (msg.pass !== undefined && Number(msg.pass) !== s.pass) return REJECTED;
      const picked = Array.isArray(msg.option) ? msg.option : [msg.option];
      if (picked.length !== 1 || !remainingOf(r, play).includes(Number(picked[0]))) return REJECTED;
    }

    if (isScored(question)) {
      // Answers stop once the answer is shown, and a timed quiz only takes answers while the clock runs.
      if (await this.get<boolean>(`reveal:${current}`)) return REJECTED;
      if (question.timer) {
        const startedAt = await this.get<number>(`start:${current}`);
        if (!startedAt || now > startedAt + question.timer * 1000 + GRACE_MS) return REJECTED;
        // Nothing counts during the count-in, before the question shows (a little slack for clocks out of step).
        if (now < startedAt - 300) return REJECTED;
      }
    }

    // The cap counts people, not votes: a participant is counted once for the whole presentation.
    const seenKey = `seen:${voter}`;
    const seen = await this.get<boolean>(seenKey);
    let voters = (await this.get<number>("voters")) ?? 0;
    if (!seen) {
      if (cap && voters >= cap) {
        ws.send(JSON.stringify({ type: "full" }));
        return REJECTED;
      }
      voters++;
    }
    // Written once per person: every stored row counts against the daily quota.
    const markSeen: Record<string, unknown> = seen ? {} : { [seenKey]: true, voters };
    const voteKey = `v:${current}:${voter}`;
    const nKey = `n:${current}`;

    if (msg.type === "vote" && (type === "choice" || type === "scale")) {
      const slots = this.slots(question);
      const multi = type === "choice" && question.multi && !isQuiz(question);
      const picked = [...new Set((Array.isArray(msg.option) ? msg.option : [msg.option]).map(Number))].filter(
        (o) => Number.isInteger(o) && o >= 0 && o < slots,
      );
      if (!picked.length || (!multi && picked.length > 1)) return REJECTED;
      const previous = await this.get<number | number[]>(voteKey);
      const before = previous === undefined ? [] : Array.isArray(previous) ? previous : [previous];
      if (before.length === picked.length && before.every((o) => picked.includes(o))) return SAME;
      const counts = await this.countsFor(deck, current);
      for (const o of before) counts[o]--;
      for (const o of picked) counts[o]++;
      const answered = await this.answeredFor(deck, current);
      const put: Record<string, unknown> = {
        [voteKey]: multi ? picked : picked[0],
        [`counts:${current}`]: counts,
        [nKey]: previous === undefined ? answered + 1 : answered,
        ...markSeen,
      };
      if (isQuiz(question)) {
        const right = picked[0] === question.correct;
        put[`p:${current}:${voter}`] = right ? this.points(question, await this.get<number>(`start:${current}`), now) : 0;
      }
      await this.ctx.storage.put(put);
      return CHANGED;
    }

    if (msg.type === "rank" && type === "rank") {
      const size = question.options.length;
      let order = (Array.isArray(msg.order) ? msg.order : []).map(Number);
      if (order.length !== size || new Set(order).size !== size || order.some((o) => !Number.isInteger(o) || o < 0 || o >= size)) return REJECTED;
      // A right order reached the phone mixed: its places are read back as the written items.
      const mix = await this.mixFor(question, current);
      if (mix) order = order.map((o) => mix[o]);
      const previous = await this.get<number[]>(voteKey);
      if (previous && previous.every((item, pos) => item === order[pos])) return SAME;
      // Each item scores by position: first place gets size - 1 points, last gets 0.
      const counts = await this.countsFor(deck, current);
      previous?.forEach((item, pos) => (counts[item] -= size - 1 - pos));
      order.forEach((item, pos) => (counts[item] += size - 1 - pos));
      const answered = await this.answeredFor(deck, current);
      const put: Record<string, unknown> = { [voteKey]: order, [`counts:${current}`]: counts, [nKey]: previous ? answered : answered + 1, ...markSeen };
      if (question.ordered) {
        // The right order is the order the options were written in: item i belongs at place i.
        const { right, placed } = await this.orderFor(deck, current);
        const isRight = (o: number[]) => o.every((item, pos) => item === pos);
        previous?.forEach((item, pos) => item === pos && (placed[pos] = Math.max(0, placed[pos] - 1)));
        order.forEach((item, pos) => item === pos && placed[pos]++);
        put[`pos:${current}`] = placed;
        put[`okn:${current}`] = Math.max(0, right - (previous && isRight(previous) ? 1 : 0) + (isRight(order) ? 1 : 0));
        put[`p:${current}:${voter}`] = isRight(order) ? this.points(question, await this.get<number>(`start:${current}`), now) : 0;
      }
      await this.ctx.storage.put(put);
      return CHANGED;
    }

    if (msg.type === "scales" && type === "scales") {
      const max = question.max ?? 5;
      const size = question.options.length;
      const values = (Array.isArray(msg.values) ? msg.values : []).map(Number);
      // Every statement rated, each from 0 (shown as 1) to max - 1.
      if (values.length !== size || values.some((v) => !Number.isInteger(v) || v < 0 || v >= max)) return REJECTED;
      const previous = await this.get<number[]>(voteKey);
      if (previous && previous.length === size && previous.every((v, i) => v === values[i])) return SAME;
      const counts = await this.countsFor(deck, current);
      previous?.forEach((v, i) => counts[i * max + v] > 0 && counts[i * max + v]--);
      values.forEach((v, i) => counts[i * max + v]++);
      const answered = await this.answeredFor(deck, current);
      await this.ctx.storage.put({ [voteKey]: values, [`counts:${current}`]: counts, [nKey]: previous ? answered : answered + 1, ...markSeen });
      return CHANGED;
    }

    if (msg.type === "number" && type === "number") {
      const value = Number(msg.value);
      if (!Number.isFinite(value) || Math.abs(value) > MAX_NUMBER) return REJECTED;
      // Six decimals at most: 0.1 + 0.2 stays 0.3.
      const clean = Math.round(value * 1e6) / 1e6;
      const previous = await this.get<number>(voteKey);
      if (previous === clean) return SAME;
      const numbers = await this.numbersFor(current);
      if (previous === undefined && Object.keys(numbers).length >= MAX_NUMBERS) return REJECTED;
      numbers[voter] = clean;
      const answered = await this.answeredFor(deck, current);
      const put: Record<string, unknown> = { [voteKey]: clean, [`nums:${current}`]: numbers, [nKey]: previous === undefined ? answered + 1 : answered, ...markSeen };
      if (isScored(question)) put[`p:${current}:${voter}`] = this.closeness(question, clean, await this.get<number>(`start:${current}`), now);
      await this.ctx.storage.put(put);
      return CHANGED;
    }

    if (msg.type === "points" && type === "points") {
      const size = question.options.length;
      const values = (Array.isArray(msg.values) ? msg.values : []).map(Number);
      // Every item gets its share (zero too), and the shares add up to exactly 100.
      if (values.length !== size || values.some((v) => !Number.isInteger(v) || v < 0 || v > POINTS) || values.reduce((a, b) => a + b, 0) !== POINTS) return REJECTED;
      const previous = await this.get<number[]>(voteKey);
      if (previous && previous.length === size && previous.every((v, i) => v === values[i])) return SAME;
      const counts = await this.countsFor(deck, current);
      previous?.forEach((v, i) => (counts[i] = Math.max(0, counts[i] - v)));
      values.forEach((v, i) => (counts[i] += v));
      const answered = await this.answeredFor(deck, current);
      await this.ctx.storage.put({ [voteKey]: values, [`counts:${current}`]: counts, [nKey]: previous ? answered : answered + 1, ...markSeen });
      return CHANGED;
    }

    if (msg.type === "fill" && type === "fill") {
      const { answers } = parseFill(question.fill ?? "");
      const size = answers.length;
      const values = (Array.isArray(msg.values) ? msg.values : []).map((v) => cleanText(v, 60));
      if (!size || values.length !== size || values.every((v) => !v)) return REJECTED;
      const previous = await this.get<string[]>(voteKey);
      if (previous && previous.length === size && previous.every((v, i) => v === values[i])) return SAME;
      const rights = (list: string[]) => list.map((v, i) => rightBlank(v, answers[i]));
      const { right, placed } = await this.orderFor(deck, current);
      const words = await this.fillWordsFor(current, size);
      const before = previous ? rights(previous) : null;
      before?.forEach((ok, i) => ok && (placed[i] = Math.max(0, placed[i] - 1)));
      previous?.forEach((v, i) => {
        const w = shownAnswer(v);
        if (w && words[i][w] && --words[i][w] <= 0) delete words[i][w];
      });
      const now_ = rights(values);
      now_.forEach((ok, i) => ok && placed[i]++);
      values.forEach((v, i) => {
        const w = shownAnswer(v);
        if (w && (words[i][w] || Object.keys(words[i]).length < MAX_FILL_ANSWERS)) words[i][w] = (words[i][w] ?? 0) + 1;
      });
      const answered = await this.answeredFor(deck, current);
      const share = now_.filter(Boolean).length / size;
      await this.ctx.storage.put({
        [voteKey]: values,
        [`pos:${current}`]: placed,
        [`okn:${current}`]: Math.max(0, right - (before?.every(Boolean) ? 1 : 0) + (now_.every(Boolean) ? 1 : 0)),
        [`fillw:${current}`]: words,
        [nKey]: previous ? answered : answered + 1,
        // Points for each blank right, scaled by speed when timed.
        [`p:${current}:${voter}`]: Math.round(share * this.points(question, await this.get<number>(`start:${current}`), now)),
        ...markSeen,
      });
      return CHANGED;
    }

    if (msg.type === "match" && type === "match") {
      const size = question.options.length / 2;
      // For each item on the left, the item on the right it goes with (pair i matches left i with right i).
      let order = (Array.isArray(msg.order) ? msg.order : []).map(Number);
      if (order.length !== size || new Set(order).size !== size || order.some((o) => !Number.isInteger(o) || o < 0 || o >= size)) return REJECTED;
      // The right-hand items reached the phone mixed: read back as the written ones.
      const mix = await this.mixFor(question, current);
      if (mix) order = order.map((o) => mix[o]);
      const previous = await this.get<number[]>(voteKey);
      if (previous && previous.every((o, i) => o === order[i])) return SAME;
      const { right, placed } = await this.orderFor(deck, current);
      const isRight = (o: number[]) => o.every((item, i) => item === i);
      previous?.forEach((item, i) => item === i && (placed[i] = Math.max(0, placed[i] - 1)));
      order.forEach((item, i) => item === i && placed[i]++);
      const answered = await this.answeredFor(deck, current);
      const share = order.filter((item, i) => item === i).length / size;
      await this.ctx.storage.put({
        [voteKey]: order,
        [`pos:${current}`]: placed,
        [`okn:${current}`]: Math.max(0, right - (previous && isRight(previous) ? 1 : 0) + (isRight(order) ? 1 : 0)),
        [nKey]: previous ? answered : answered + 1,
        [`p:${current}:${voter}`]: Math.round(share * this.points(question, await this.get<number>(`start:${current}`), now)),
        ...markSeen,
      });
      return CHANGED;
    }

    if (msg.type === "spot" && type === "spot") {
      const x = Math.round(Number(msg.x));
      const y = Math.round(Number(msg.y));
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1000 || y < 0 || y > 1000) return REJECTED;
      const previous = await this.get<[number, number]>(voteKey);
      if (previous && previous[0] === x && previous[1] === y) return SAME;
      const spots = await this.spotsFor(current);
      if (!previous && Object.keys(spots).length >= MAX_NUMBERS) return REJECTED;
      spots[voter] = [x, y];
      const answered = await this.answeredFor(deck, current);
      const put: Record<string, unknown> = { [voteKey]: [x, y], [`spots:${current}`]: spots, [nKey]: previous ? answered : answered + 1, ...markSeen };
      if (question.zone) put[`p:${current}:${voter}`] = inZone(x, y, question.zone) ? this.points(question, await this.get<number>(`start:${current}`), now) : 0;
      await this.ctx.storage.put(put);
      return CHANGED;
    }

    if (msg.type === "opened" && type === "link") {
      // Counted once per person: opening the link again changes nothing.
      if (await this.get<number>(voteKey)) return SAME;
      const answered = await this.answeredFor(deck, current);
      await this.ctx.storage.put({ [voteKey]: 1, [nKey]: answered + 1, ...markSeen });
      return CHANGED;
    }

    if (msg.type === "words" && type === "words") {
      const banned = new Set((await this.get<string[]>(`ban:${current}`)) ?? []);
      const words = [...new Set((Array.isArray(msg.words) ? msg.words : []).map(cleanWord).filter((w) => w && !banned.has(w)))].slice(0, MAX_WORDS);
      if (!words.length) return REJECTED;
      const key = `w:${current}:${voter}`;
      const previous = await this.get<string[]>(key);
      if (previous && previous.length === words.length && previous.every((w) => words.includes(w))) return SAME;
      const cloud = await this.wordsFor(current);
      for (const w of previous ?? []) if (cloud[w] && --cloud[w] <= 0) delete cloud[w];
      for (const w of words) if (cloud[w] || Object.keys(cloud).length < MAX_CLOUD_WORDS) cloud[w] = (cloud[w] ?? 0) + 1;
      const answered = (await this.get<number>(`wn:${current}`)) ?? 0;
      await this.ctx.storage.put({ [key]: words, [`words:${current}`]: cloud, [`wn:${current}`]: previous ? answered : answered + 1, ...markSeen });
      return CHANGED;
    }

    if ((msg.type === "answer" && type === "open") || (msg.type === "ask" && type === "qa")) {
      const text = cleanText(msg.text, OPEN_LENGTH);
      if (!text) return REJECTED;
      const countKey = `${type === "qa" ? "qn" : "on"}:${current}:${voter}`;
      const listKey = `${type}:${current}`;
      const list = (await this.get<Post[]>(listKey)) ?? [];
      const id = typeof msg.id === "string" && POST_ID.test(msg.id) ? msg.id : crypto.randomUUID().slice(0, 8);
      // Already posted: the phone sent it again after a network drop.
      if (list.some((a) => a.id === id)) return SAME;
      const sent = (await this.get<number>(countKey)) ?? 0;
      if (sent >= MAX_POSTS_PER_VOTER || list.length >= MAX_POSTS) return REJECTED;
      list.push({ id, text, at: now, ...(isProfane(text) ? { hidden: true } : {}), ...(type === "qa" ? { votes: 0 } : {}) });
      await this.ctx.storage.put({ [listKey]: list, [countKey]: sent + 1, ...markSeen });
      return CHANGED;
    }

    if (msg.type === "contact" && type === "contact") {
      if (msg.consent !== true) return REJECTED;
      const fields = question.fields?.length ? question.fields : (["email"] as ContactField[]);
      const raw = msg.data ?? {};
      const contact: Contact = { at: now };
      for (const f of fields) {
        const value = cleanText(raw[f], f === "email" ? 120 : 80);
        if (!value) continue;
        if (f === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) return REJECTED;
        // A phone number in an unusual format is left out rather than losing the whole contact.
        if (f === "phone" && !PHONE.test(value)) continue;
        contact[f] = value;
      }
      // At least one detail, and the email when it is asked for.
      if (Object.keys(contact).length < 2 || (fields.includes("email") && !contact.email)) return REJECTED;
      const key = `contact:${current}:${voter}`;
      const had = await this.get<Contact>(key);
      const answered = await this.answeredFor(deck, current);
      await this.ctx.storage.put({ [key]: contact, [nKey]: had ? answered : answered + 1, ...markSeen });
      return CHANGED;
    }

    if (msg.type === "upvote" && type === "qa") {
      const listKey = `qa:${current}`;
      const list = (await this.get<Post[]>(listKey)) ?? [];
      const item = list.find((a) => a.id === String(msg.id));
      if (!item || item.hidden) return REJECTED;
      const upKey = `up:${current}:${voter}`;
      const mine = (await this.get<string[]>(upKey)) ?? [];
      const had = mine.includes(item.id);
      item.votes = Math.max(0, (item.votes ?? 0) + (had ? -1 : 1));
      await this.ctx.storage.put({ [listKey]: list, [upKey]: had ? mine.filter((id) => id !== item.id) : [...mine, item.id], ...markSeen });
      return CHANGED;
    }

    return REJECTED;
  }

  async webSocketClose(ws: WebSocket, code: number) {
    // A browser closing without a code reports 1005 (or 1006), which close() refuses to send: it throws,
    // and the screens would never learn that the phone left.
    try {
      ws.close(code >= 1000 && code <= 4999 && ![1004, 1005, 1006, 1015].includes(code) ? code : 1000, "bye");
    } catch {
      // Already closed.
    }
    this.scheduleBroadcast();
  }

  async webSocketError(ws: WebSocket) {
    try {
      ws.close(1011, "error");
    } catch {
      // Already closed.
    }
    this.scheduleBroadcast();
  }

  // Groups bursts of votes into one update every 200 ms instead of one per vote.
  private scheduleBroadcast(delay = 200) {
    if (this.broadcastTimer) return;
    this.broadcastTimer = setTimeout(async () => {
      this.broadcastTimer = null;
      const deck = await this.load();
      if (!deck) return;
      const forVoters = JSON.stringify(await this.snapshot(deck));
      const forHosts = JSON.stringify(await this.snapshot(deck, true));
      // Phones also learn their own place when their screen shows it: added to the shared text, never computed per phone.
      const standings = await this.standingsShown(deck);
      for (const ws of this.ctx.getWebSockets()) {
        try {
          ws.send(this.ctx.getTags(ws).includes("host") ? forHosts : this.withMe(forVoters, ws, standings));
        } catch {
          // Socket already gone.
        }
      }
    }, delay);
  }

  // Phones connected right now. A socket being closed is still listed for a moment: skip it.
  private openVoters() {
    return this.ctx.getWebSockets("voter").filter((ws) => ws.readyState === WebSocket.OPEN);
  }

  // People connected right now: one per phone, even if it holds a stale second connection.
  private onlineCount() {
    const ids = new Set<string>();
    let anonymous = 0;
    for (const ws of this.openVoters()) {
      const v = (ws.deserializeAttachment() as { voter?: string } | null)?.voter;
      if (v) ids.add(v);
      else anonymous++;
    }
    return ids.size + anonymous;
  }

  // First names of the people connected right now, newest last.
  // The presenter also learns who already answered the question on screen (participants never get that).
  private async people(deck: Deck, current: number, host: boolean) {
    const voters = new Set<string>();
    for (const ws of this.openVoters()) {
      const v = (ws.deserializeAttachment() as { voter?: string } | null)?.voter;
      if (v) voters.add(v);
    }
    // Anonymous rooms: only the buddies, so the waiting screen shows the face each phone picked, never a name.
    const list = [...voters].slice(0, deck.names ? 300 : 80);
    const stored = await this.getMany<string>(list.flatMap((v) => (deck.names ? [`name:${v}`, `avatar:${v}`] : [`avatar:${v}`])));
    if (!deck.names) return list.map((v) => stored.get(`avatar:${v}`)).filter((a): a is string => !!a).map((avatar) => ({ name: "", avatar }));
    const answered = host ? await this.getMany(list.flatMap((v) => ANSWER_KEYS.map((k) => `${k}:${current}:${v}`))) : null;
    // Someone still typing their name shows as the buddy they picked, never as a stranger's face.
    return list
      .map((v) => {
        const person: { name: string; avatar: string; done?: boolean; tag?: string } = { name: stored.get(`name:${v}`) ?? "", avatar: stored.get(`avatar:${v}`) ?? "" };
        if (answered) person.done = ANSWER_KEYS.some((k) => answered.has(`${k}:${current}:${v}`));
        // The presenter can take a name off the screen (unname): the room tells it which one by its tag, never the id.
        if (host && person.name) person.tag = tagOf(v);
        return person;
      })
      .filter((p) => p.name || p.avatar);
  }

  // Many keys in a few reads: storage takes up to 128 keys per call, far faster than one call per key in big rooms.
  private async getMany<T>(keys: string[]) {
    const out = new Map<string, T>();
    for (let i = 0; i < keys.length; i += 128) for (const [key, value] of await this.ctx.storage.get<T>(keys.slice(i, i + 128))) out.set(key, value);
    return out;
  }

  // Spots grouped by cells of 1% of the image: x, y (the cell's middle) and how many people tapped there, one after the other.
  private groupSpots(spots: Record<string, [number, number]>) {
    const cells = new Map<number, number>();
    for (const [x, y] of Object.values(spots)) {
      const cell = Math.min(99, Math.floor(x / 10)) * 100 + Math.min(99, Math.floor(y / 10));
      cells.set(cell, (cells.get(cell) ?? 0) + 1);
    }
    const out: number[] = [];
    for (const [cell, n] of cells) out.push(Math.floor(cell / 100) * 10 + 5, (cell % 100) * 10 + 5, n);
    return out;
  }

  // The wheel as screens draw it: the entries of the last spin (or the ones it will spin among), the spin, who was picked.
  private async wheelState(deck: Deck, index: number, q: Question) {
    const spin = (await this.get<Spin & { list: string[] }>(`spin:${index}`)) ?? null;
    const picked = (await this.get<Picked[]>(`picked:${index}`)) ?? [];
    let list = spin?.list;
    if (!list) {
      const entries = await this.wheelEntries(deck, q, WHEEL_SIZE * 2);
      const left = entries.filter((e) => !picked.some((p) => p.key === e.key));
      list = (left.length ? left : entries).slice(0, WHEEL_SIZE).map((e) => e.label);
    }
    return { list, spin: spin && { at: spin.at, from: spin.from, to: spin.to, win: spin.win, n: spin.n, tag: spin.tag }, picked: picked.map((p) => p.label) };
  }

  // Topic rounds as screens and phones draw them (null: a presentation without them). See src/room.ts TopicsState.
  private async topicsView(deck: Deck, r: Rounds, current: number) {
    const s = await this.roundsState();
    const play = this.playOf(s);
    const at = whereOf(r, current);
    const topic = topicAt(r, current);
    const atPicker = at === "picker";
    const d = atPicker ? decisionOf(r, play) : null;
    const chosen = d?.topic ?? null;
    const k = topic !== null ? s.order.indexOf(topic) : -1;
    const indices = topic !== null ? r.topics[topic].indices : [];
    const next = nextStep(r, play, current, deck.questions.length);
    const ballot = atPicker && chosen !== null && !d?.last ? s.ballot : null;
    const scored = (t: number) => r.topics[t].indices.some((i) => isScored(deck.questions[i]));
    return {
      view: {
        // Every topic: its name, its number of questions, whether it was played (or is playing), whether it has points to win.
        list: r.topics.map((t, i) => ({ label: t.label, n: t.indices.length, done: s.order.includes(i), scored: scored(i) })),
        // Who chooses: the wheel or the room's vote.
        how: r.how,
        // Where the question on screen stands: before the rounds, the picker, a topic's question, after the rounds.
        at,
        // The topic of the question on screen.
        topic,
        // At the picker: the topic chosen for the next round, and how ("last": the only one left, no wheel or vote).
        chosen,
        chosenHow: chosen === null ? null : d?.last ? "last" : (s.chosenHow ?? "host"),
        // The round shown (1 for the first) out of the rounds to play.
        roundNo: atPicker ? s.order.length + 1 : at === "topic" ? (k >= 0 ? k + 1 : s.order.length + 1) : s.order.length,
        of: r.rounds,
        // In a topic: the question's place in it (from 1) and the topic's number of questions.
        pos: topic !== null ? indices.indexOf(current) + 1 : 0,
        size: indices.length,
        // The chosen topic has answers already: it can no longer be chosen again.
        locked: chosen !== null && !d?.last ? await this.topicLocked(deck, r, chosen) : false,
        // Rounds still to play from the picker.
        left: roundsLeft(r, play),
        // What → and ← lead to (null: nothing, a slide tool moves to its next slide). "pick": the wheel or the vote first.
        hasNext: next !== null,
        hasPrev: prevStep(r, play, current) !== null,
        // The vote closed on a tie (drawn at random among the tied topics), or with no vote at all (drawn among every topic left).
        tie: !!ballot?.tie && s.chosenHow === "vote",
        empty: !!ballot?.empty && s.chosenHow === "vote",
        // The vote under way: phones send it with their vote, and keep their own answer per pass.
        pass: s.pass,
        // The topics played, in order, and how each was chosen.
        order: s.order,
        hows: s.how,
      },
      // At the picker once the vote closed: the counts that chose the topic.
      ballot,
      // The picker's wheel: the topics left, or those of the spin that chose the topic on screen.
      wheel: atPicker && r.how === "wheel" ? await this.topicsWheel(r, s, chosen !== null && s.chosenHow === "wheel" && !d?.last) : null,
    };
  }

  private async topicsWheel(r: Rounds, s: RoundsState, spun: boolean) {
    const spin = spun ? ((await this.get<Spin & { list: string[] }>(`spin:${r.picker}`)) ?? null) : null;
    const list = spin?.list ?? remainingOf(r, this.playOf(s)).map((t) => r.topics[t].label);
    return { list, spin: spin && { at: spin.at, from: spin.from, to: spin.to, win: spin.win, n: spin.n, tag: spin.tag }, picked: [] as string[] };
  }

  private freshClock(q: Question): Clock {
    const total = (q.duration ?? COUNTDOWN_DEFAULT) * 1000;
    return { run: false, end: 0, left: total, total };
  }

  private async snapshot(deck: Deck, host = false) {
    // First, as it may wait on the database: everything below then reads one consistent state of the room.
    const plan = await this.ownerPlan(deck);
    // A stored index past the end (questions removed while the room was open) must not break every screen.
    const current = Math.max(0, Math.min((await this.get<number>("current")) ?? 0, deck.questions.length - 1));
    const q: Question = deck.questions[current] ?? { type: "choice", question: "", options: [] };
    const type = typeOf(q);
    const revealed = !!(await this.get<boolean>(`reveal:${current}`));
    const cloud = type === "words" ? await this.wordsFor(current) : {};
    let posts = type === "open" || type === "qa" ? await this.postsFor(deck, current) : [];
    // The host keeps hidden posts (to show them again); voters never receive them.
    posts = posts.filter((a) => host || !a.hidden);
    if (type === "qa") posts.sort((a, b) => Number(!!a.done) - Number(!!b.done) || (b.votes ?? 0) - (a.votes ?? 0) || a.at - b.at);
    else posts = posts.slice(-120).reverse();
    const startedAt = q.timer ? ((await this.get<number>(`start:${current}`)) ?? null) : null;
    // A leaderboard needs names: anonymous presentations never show one, nor those with the leaderboard off.
    // Stored as the time it opened (older rooms: true).
    const boardFlag = await this.get<boolean | number>("board");
    const hasBoard = !!deck.names && deck.boardMode !== "off" && deck.questions.some(isScored);
    const showBoard = !!deck.names && deck.boardMode !== "off" && !!boardFlag;
    const scored = isScored(q);
    // The new games (a number to find, a ranking in the right order, blanks, pairs, a spot) keep their results hidden from every
    // screen until the answer is shown, so nobody copies the room. Quizzes keep showing their bars live, as before.
    const hideGame = !revealed && hiddenUntilShown(q);
    const counts = await this.countsFor(deck, current);
    const numbers = type === "number" ? Object.values(await this.numbersFor(current)) : [];
    const order = (type === "rank" && q.ordered) || type === "match" || type === "fill" ? await this.orderFor(deck, current) : null;
    const fill = type === "fill" ? parseFill(q.fill ?? "") : null;
    // Right order and pairs: the presenter gets the written order, every other screen the mixed one until the answer shows.
    const mix = host ? null : await this.mixFor(q, current);
    const spots = type === "spot" ? await this.spotsFor(current) : null;
    const r = roundsOf(deck.questions);
    const topics = r ? await this.topicsView(deck, r, current) : null;
    const play = topics ? this.playOf(await this.roundsState()) : null;
    // Once a number game's answer shows: the closest answer, with the person's first name when the room asks for names.
    let closest: { value: number; name: string } | null = null;
    if (type === "number" && scored && revealed) {
      let best: [string, number] | null = null;
      for (const [voter, value] of Object.entries(await this.numbersFor(current))) {
        if (!best || Math.abs(value - q.answer!) < Math.abs(best[1] - q.answer!)) best = [voter, value];
      }
      if (best) closest = { value: best[1], name: deck.names ? ((await this.get<string>(`name:${best[0]}`)) ?? "") : "" };
    }
    return {
      type: "state",
      round: (await this.get<number>("round")) ?? 0,
      title: deck.title,
      lang: deck.lang ?? "fr",
      index: current,
      count: deck.questions.length,
      kind: type,
      question: q.question,
      options: mix && !revealed ? mixedOptions(q, mix) : q.options,
      // Once the answer shows: the mixed order, for phones to read their own answer again in the written one.
      mix: mix && revealed ? mix : null,
      image: q.image ?? null,
      max: q.max ?? 5,
      labels: q.labels ?? null,
      style: type === "scale" ? (q.style ?? "bars") : "",
      fields: type === "contact" ? (q.fields?.length ? q.fields : ["email"]) : [],
      multi: !!q.multi && !isQuiz(q),
      quiz: scored,
      hasQuiz: deck.questions.some(isScored),
      // The leaderboard button: quizzes in presentations that ask for names.
      hasBoard,
      // When the leaderboard shows: after each scored question, at the end, never, or with the button only ("manual").
      boardMode: deck.boardMode ?? "manual",
      // The seasonal decor, only until its end date (src/decor.ts): after it every screen is back to the normal one.
      decor: shownDecor(deck.decor),
      // When the leaderboard opened (server time), to play its animation only then; null for older rooms.
      boardAt: showBoard && typeof boardFlag === "number" ? boardFlag : null,
      // No scored question after this one: the leaderboard shown now is the final one.
      // With topic rounds, on the way the game goes.
      boardFinal: r && play ? finalOnPath(r, play, current, (i) => isScored(deck.questions[i]), deck.boardMode === "round") : !deck.questions.slice(current + 1).some(isScored),
      timer: scored ? (q.timer ?? 0) : 0,
      startedAt,
      now: Date.now(),
      correct: revealed ? (q.correct ?? null) : null,
      revealed,
      counts: topics?.ballot ? topics.ballot.counts : hideGame ? counts.map(() => 0) : counts,
      // Slides and links.
      text: q.text ?? "",
      url: type === "link" || type === "media" ? (q.url ?? "") : "",
      ordered: type === "rank" && !!q.ordered,
      // Number questions: every answer (for the spread), the right value and the closest answer once shown.
      numbers: hideGame ? [] : numbers,
      answer: type === "number" && revealed ? (q.answer ?? null) : null,
      closest,
      // Rankings in the right order: how many found it, and how many put each item at its place (pairs and blanks too).
      orderResults: order && !hideGame ? order : null,
      // Blanks to fill: the text around the blanks, never the answers; once shown, the accepted answers and what the room typed.
      gaps: fill ? fill.pieces : [],
      // Words to place: the answers and the extra words, shuffled (never in the blanks' order).
      bank: fill && q.fillMode === "words" ? wordBank(fill.answers, q.decoys ?? [], q.fill ?? "") : [],
      blanks: fill && revealed ? fill.answers : [],
      fillTop: fill && !hideGame ? this.topAnswers(await this.fillWordsFor(current, fill.answers.length), 4) : [],
      // Find on the image: where people tapped, grouped by 1% of the image; once shown, the zone and how many tapped in it.
      spots: spots && !hideGame ? this.groupSpots(spots) : [],
      zone: type === "spot" && revealed ? (q.zone ?? null) : null,
      found: spots && revealed && q.zone ? Object.values(spots).filter(([x, y]) => inZone(x, y, q.zone!)).length : 0,
      wheel: topics?.wheel ?? (type === "wheel" ? await this.wheelState(deck, current, q) : null),
      clock: type === "countdown" ? ((await this.get<Clock>(`clock:${current}`)) ?? this.freshClock(q)) : null,
      words: Object.entries(cloud).sort((a, b) => b[1] - a[1]).slice(0, 80),
      answers: posts,
      answered: topics?.ballot ? topics.ballot.n : await this.answeredFor(deck, current),
      board: showBoard ? (await this.ranking(this.boardRange(deck, current))).top : null,
      lobby: !!(await this.get<boolean>("lobby")),
      // When the presenter started, with the launch animation: screens and phones play it if it is recent.
      launch: deck.intro ? ((await this.get<number>("launch")) ?? null) : null,
      locked: !!(await this.get<boolean>(`lock:${current}`)),
      names: !!deck.names,
      people: await this.people(deck, current, host),
      online: this.onlineCount(),
      langs: this.phoneLangs(),
      // Topic rounds (src/rounds.ts), only in presentations that have them.
      ...(topics ? { topics: topics.view } : {}),
    };
  }
}
