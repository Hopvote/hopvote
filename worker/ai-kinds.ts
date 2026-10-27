// What the AI may write for each kind of question, and how its answer becomes a question Hopvote can save.
// Pure (no Worker API), so scripts/ai-kinds-test.mjs bundles it and checks it offline with canned model answers.
// The output of fromModel() is the raw shape that cleanQuestion (worker/index.ts) validates, like any save.
import { BLANK_LENGTH, FILL_LENGTH, MAX_BLANKS, MAX_DECOYS, normalize, parseFill } from "../src/fill";
import { MAX_PAIRS } from "../src/kinds";
import { ENTRY_LENGTH } from "../src/wheel";
import { mediaOf } from "../src/media";
import { MIN_TOPICS, TOPIC_LENGTH } from "../src/rounds";

// Plain characters only: models sometimes write non-breaking hyphens (missing from many brand fonts), en and em dashes.
export const str = (v: unknown, max: number) =>
  String(v ?? "")
    .replace(/[\u2010\u2011]/g, "-")
    .replace(/(\d)\s*[\u2012\u2013\u2014]\s*(\d)/g, "$1-$2")
    .replace(/\s*[\u2012\u2013\u2014\u2015]\s*/g, ", ")
    .replace(/\s+/g, " ")
    .replace(/^[,\s]+|[,\s]+$/g, "")
    .trim()
    .slice(0, max)
    .trim();
export const cleanOption = (v: unknown) => str(v, 80).replace(/\.$/, "");
// French puts a no-break space before ? ! ; and : (« Soleil ? »), so the mark never wraps to a line of its own.
// Only after a word, and only before a space or the end: links ("?q=", "https:") and times ("10:45") stay as they are.
export const frenchSpaces = (s: string) =>
  s.replace(/(?<=[\p{L}\p{N}\])»"'’])[ \u00a0\u202f]?([?!;])(?=[\s?!»"]|$)/gu, "\u00a0$1").replace(/(?<=[\p{L}\p{N}\])»"'’])[ \u00a0\u202f]?:(?=\s|$)/gu, "\u00a0:");
// Counts that are updated over time make a right answer that goes out of date ("Jupiter has [79] known moons").
const CHANGING = /(?<!\p{L})(moons?|lunes?|lunas?|satellites?|satélites?|populations?|población|inhabitants|habitants|habitantes|abitanti|einwohner|records?|currently|actuellement|actualmente)(?!\p{L})/iu;
export const changesOverTime = (text: string) => CHANGING.test(text);
export const same = (a: string, b: string) => a.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "") === b.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

// The kinds the AI writes. Never "spot" (it needs the presenter's image) nor "contact" (personal data).
export type Kind =
  | "choice" | "quiz" | "number" | "order" | "fill" | "match" | "scale" | "scales" | "rank" | "points"
  | "words" | "open" | "qa" | "wheel" | "slide" | "countdown" | "link" | "media";
export type Style = "mixed" | "quiz" | "poll" | "icebreaker" | "feedback";
export const STYLES: Style[] = ["mixed", "quiz", "poll", "icebreaker", "feedback"];
// Knowledge checks: each has a right answer, so each must rest on a safe fact.
export const KNOWLEDGE: Kind[] = ["quiz", "number", "order", "fill", "match"];
const ALL: Kind[] = ["choice", "quiz", "number", "order", "fill", "match", "scale", "scales", "rank", "points", "words", "open", "qa", "wheel", "slide", "countdown", "link", "media"];

// Names models use for the same kinds.
export const ALIASES: Record<string, Kind> = {
  multiple_choice: "choice", multiplechoice: "choice", poll: "choice", mcq: "choice", single_choice: "choice", multi_choice: "choice", multiple: "choice",
  true_false: "quiz", truefalse: "quiz", trivia: "quiz",
  rating: "scale", rate: "scale", likert: "scale", stars: "scale",
  rating_scale: "scales", ratings: "scales", statements: "scales", multi_scale: "scales",
  word_cloud: "words", wordcloud: "words", cloud: "words", word: "words",
  open_text: "open", text: "open", open_ended: "open", free_text: "open",
  ranking: "rank", rank_order: "rank", prioritise: "points", prioritize: "points", prioritization: "points", "100_points": "points",
  right_order: "order", correct_order: "order", sequence: "order", ordering: "order", sort: "order",
  guess: "number", estimate: "number", estimation: "number", guess_a_number: "number", numeric: "number",
  blanks: "fill", fill_in_the_blanks: "fill", fill_in_the_blank: "fill", fill_blanks: "fill", cloze: "fill", gap_fill: "fill",
  matching: "match", pairs: "match", match_pairs: "match",
  spin_the_wheel: "wheel", spinner: "wheel", random: "wheel",
  q_and_a: "qa", q_a: "qa", questions: "qa", audience_qa: "qa",
  timer: "countdown", break: "countdown",
  video: "media", audio: "media",
};
const kindOf = (raw: unknown): string => {
  const key = String(raw ?? "").trim().toLowerCase().replace(/[\s&/-]+/g, "_");
  return (ALL as string[]).includes(key) ? key : (ALIASES[key] ?? key);
};

// One line per kind for the prompt, with its JSON shape.
export const KIND_LINES: Record<Kind, string> = {
  choice: `"choice": a poll with 3 or 4 options; add "multi": true only when several answers make sense. {"type": "choice", "question": "...?", "options": ["...", "...", "..."]}`,
  quiz: `"quiz": 3 or 4 options, "answer" is the exact text of the one right option, wrong options are plausible. {"type": "quiz", "question": "...?", "options": ["...", "...", "..."], "answer": "..."}`,
  number: `"number": guess a number; "answer" is one plain number, no unit, no thousands separator (the unit goes in the question); only a figure that never changes (a year, a distance, a fixed count), never one that is updated over time (populations, records, counts of moons, prices). {"type": "number", "question": "In what year ...?", "answer": 0}`,
  order: `"order": put items in the right order (dates, sizes, steps of a process); "items": 4 or 5 short items listed in the correct order, with one clear criterion, never showing the dates, figures or ranks that give the order away (no "1st", "2nd", "Second", no year in the item); the question is an instruction with no final punctuation that names the criterion and the direction. {"type": "order", "question": "Sort from oldest to newest", "items": ["...", "...", "...", "..."]}`,
  fill: `"fill": fill in the blanks; "question" is a short instruction with no final punctuation; "text" is one or two short sentences with 1 to 3 answers between square brackets, each a fact that never changes (never a count that is updated over time, such as moons, populations or records); "extra": 2 to 4 plausible words that would make the sentence false in every blank, no commas. {"type": "fill", "question": "Complete the sentence", "text": "... [answer] ... [answer] ...", "extra": ["...", "..."]}`,
  match: `"match": 3 to 5 pairs to link, each side 1 to 4 words, each left item has exactly one right partner; the question is an instruction with no final punctuation. {"type": "match", "question": "Match each ... to its ...", "pairs": [["...", "..."], ["...", "..."], ["...", "..."]]}`,
  scale: `"scale": a rating from 1 to 5; "labels": [low end, high end], 1 to 3 words each. {"type": "scale", "question": "...?", "labels": ["...", "..."]}`,
  scales: `"scales": 3 to 5 short statements, each rated on the same 1 to 5 scale; "labels": [low end, high end]. {"type": "scales", "question": "...?", "statements": ["...", "...", "..."], "labels": ["...", "..."]}`,
  rank: `"rank": people order 3 to 5 items by preference; the question is an instruction with no final punctuation. {"type": "rank", "question": "...", "options": ["...", "...", "..."]}`,
  points: `"points": people share 100 points between 3 to 5 items; the question is an instruction with no final punctuation. {"type": "points", "question": "Share 100 points between ...", "options": ["...", "...", "..."]}`,
  words: `"words": a word cloud; the question says how many words, for example "In one word, ...". {"type": "words", "question": "...?"}`,
  open: `"open": a short written answer. {"type": "open", "question": "...?"}`,
  qa: `"qa": invites the audience to send their own questions to the speaker. {"type": "qa", "question": "...?"}`,
  wheel: `"wheel": a wheel spun on screen to pick a topic, a challenge or a question at random; "entries": 4 to 8 short entries, never people's names. {"type": "wheel", "question": "...", "entries": ["...", "...", "...", "..."]}`,
  slide: `"slide": a screen between questions (a section title or instructions); "text": 1 or 2 short sentences; the question is the slide title with no final punctuation. {"type": "slide", "question": "...", "text": "..."}`,
  countdown: `"countdown": a timer on screen for a break or group work; "minutes": 1, 3, 5, 10 or 15; the question is a short title with no final punctuation. {"type": "countdown", "question": "...", "minutes": 5}`,
  link: `"link": a QR code to the exact link written in the brief. {"type": "link", "question": "...", "url": "the exact link from the brief"}`,
  media: `"media": plays the exact video or audio link written in the brief. {"type": "media", "question": "...", "url": "the exact link from the brief"}`,
};

// The links written in the brief: the only ones a "link" or "media" question may use.
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"')\]]+/gi;
export const urlsOf = (brief: string) => [...(brief.match(URL_RE) ?? [])].map((u) => u.replace(/[.,;:!?]+$/, ""));
// A break, a workshop or group work: only then may a session hold a timer or a slide.
const BREAK_RE = /\b(break|breaks|workshop|workshops|breakout|group work|team work|teamwork|exercise|pause|pauses|atelier|ateliers|travail en groupe|en groupe|en sous-groupes?|exercice|taller|descanso|trabajo en grupo|kaffeepause|gruppenarbeit|pausa|laboratorio|lavoro di gruppo)\b/i;
export const mentionsBreak = (brief: string) => BREAK_RE.test(brief);

export type Context = { style: Style; brief: string; count: number };

// The kinds a style accepts back from the model (the plan's kinds, plus the fallbacks the prompt allows).
export function allowedKinds({ style, brief, count }: Context): Set<Kind> {
  const base: Record<Style, Kind[]> = {
    quiz: [...KNOWLEDGE],
    mixed: ["choice", "quiz", "number", "order", "fill", "match", "scale", "scales", "rank", "points", "words", "open", "qa", "wheel"],
    poll: ["choice", "scale", "scales", "rank", "points", "words", "open", "number"],
    icebreaker: ["choice", "words", "open", "wheel", "number"],
    feedback: ["scale", "scales", "choice", "words", "open", "points"],
  };
  const set = new Set(base[style]);
  if (style === "mixed" && mentionsBreak(brief) && count >= 5) {
    set.add("countdown");
    set.add("slide");
  }
  if (style !== "quiz" && urlsOf(brief).length) {
    set.add("link");
    set.add("media");
  }
  return set;
}

export type Slot = { kind: Kind; role?: "icebreaker" | "close" | "knowledge" | "quiz-fallback" };

const shuffle = <T>(list: T[], rand: () => number) => {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};
const pick = <T>(list: T[], rand: () => number) => list[Math.floor(rand() * list.length) % list.length];
// `n` kinds from a pool, each once before any repeats (repeats go round `filler`).
const draw = (pool: Kind[], n: number, rand: () => number, filler: Kind[]) => {
  const out = shuffle(pool, rand).slice(0, n);
  const more = shuffle(filler, rand);
  for (let i = 0; out.length < n; i++) out.push(more[i % more.length]);
  return out;
};

// The kinds of each question, chosen by the code (randomized on each call, so "Try again" gives another mix).
export function planKinds(ctx: Context, rand: () => number = Math.random): Slot[] {
  const { style, brief } = ctx;
  const count = Math.min(10, Math.max(3, Math.round(ctx.count) || 5));
  const link: Kind | null = style !== "quiz" && urlsOf(brief).length ? (urlsOf(brief).some((u) => mediaOf(u)) ? "media" : "link") : null;
  if (style === "quiz") {
    const others = shuffle(["number", "order", "fill", "match"] as Kind[], rand);
    const rest = count <= 4 ? others.slice(0, count - 1) : shuffle([...others, ...Array<Kind>(count - 5).fill("quiz")], rand);
    return [{ kind: "quiz" }, ...rest.map((kind) => ({ kind, role: kind === "quiz" ? undefined : ("quiz-fallback" as const) }))];
  }
  let slots: Slot[];
  if (style === "mixed") {
    const knowledge = draw(KNOWLEDGE, count >= 8 ? 2 : 1, rand, KNOWLEDGE).map((kind) => ({ kind, role: "knowledge" as const }));
    // Extras, most wanted first: the link the presenter gave, the break they mentioned, a Q&A, a slide.
    // Few of them, so most places stay questions (a short presentation holds 5).
    const wanted: Slot[] = [];
    if (link) wanted.push({ kind: link });
    if (mentionsBreak(brief)) wanted.push({ kind: "countdown" });
    if (count >= 8) wanted.push({ kind: "qa" });
    if (mentionsBreak(brief)) wanted.push({ kind: "slide" });
    const extra = wanted.slice(0, count >= 10 ? 3 : count >= 8 ? 2 : count >= 5 ? 1 : 0);
    const middle = count - 2 - knowledge.length - extra.length;
    const ice = pick(["choice", "words", "wheel"] as Kind[], rand);
    const close = pick(["scale", "open"] as Kind[], rand);
    // The first and last kinds come back only once the others are used.
    const pool = (["scale", "scales", "rank", "points", "choice", "words", "open"] as Kind[]).filter((k) => k !== ice && k !== close);
    const polls = draw(pool, Math.max(0, middle), rand, ["choice", "scale", "words"]).map((kind) => ({ kind }));
    // The Q&A sits just before the close; the rest is shuffled.
    const qa = extra.filter((s) => s.kind === "qa");
    const body = shuffle([...polls, ...knowledge, ...extra.filter((s) => s.kind !== "qa")], rand);
    slots = [{ kind: ice, role: "icebreaker" }, ...body, ...qa, { kind: close, role: "close" }];
    return slots.slice(0, count);
  }
  if (style === "poll") {
    const rest = draw(["scale", "scales", "rank", "points", "words", "open", "number"], count - 1, rand, ["choice", "scale", "rank"]);
    slots = [{ kind: "choice" }, ...rest.map((kind) => ({ kind }))];
  } else if (style === "icebreaker") {
    const ice = pick(["choice", "words"] as Kind[], rand);
    const rest = draw((["words", "open", "wheel", "number"] as Kind[]).filter((k) => k !== ice), count - 1, rand, ["choice", "words", "open"]);
    slots = [{ kind: ice, role: "icebreaker" as const }, ...rest.map((kind) => ({ kind }))];
  } else {
    const rest = draw(["scales", "choice", "words", "points"], count - 2, rand, ["choice", "scale", "words"]);
    slots = [{ kind: "scale" }, ...rest.map((kind) => ({ kind })), { kind: "open", role: "close" }];
  }
  // A link or a video the presenter gave takes a middle place, never the first or the last.
  if (link) slots.splice(1 + Math.floor(rand() * (slots.length - 2)), 1, { kind: link });
  return slots.slice(0, count);
}

const ROLE_NOTE: Record<NonNullable<Slot["role"]>, string> = {
  icebreaker: "an easy icebreaker",
  close: "the closing feedback or takeaway",
  knowledge: `a knowledge check, only on a fact from the brief or one you are completely sure of; otherwise write a "choice" poll instead`,
  "quiz-fallback": `if no safe fact suits this type, write a "quiz" instead`,
};
// "Question 1: type "choice" (an easy icebreaker)", one line per planned question.
export const planText = (plan: Slot[]) => plan.map((s, i) => `Question ${i + 1}: type "${s.kind}"${s.role ? ` (${ROLE_NOTE[s.role]})` : ""}`).join("\n");
// The type lines the prompt needs: the planned kinds and their fallbacks.
export function kindLines(plan: Slot[]) {
  const kinds = new Set<Kind>(plan.map((s) => s.kind));
  if (plan.some((s) => s.role === "knowledge")) kinds.add("choice");
  if (plan.some((s) => s.role === "quiz-fallback")) kinds.add("quiz");
  return [...kinds].map((k) => `- ${KIND_LINES[k]}`).join("\n");
}

// A number as models write it: 1889, "1 889", "1,889", "3,14", "3.14". Anything with words ("about 40", "330 m") is refused.
export function parseAnswer(raw: unknown): number | undefined {
  if (typeof raw === "number") return Number.isFinite(raw) && Math.abs(raw) <= 1e12 ? raw : undefined;
  let text = String(raw ?? "").trim().replace(/[\s\u00a0\u202f\u2009']/g, "").replace(/^\+/, "").replace(/[\u2212\u2013]/g, "-");
  if (!text) return undefined;
  // Commas as thousands separators (1,889 or 12,000,000), else a decimal comma (3,14).
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(text)) text = text.replace(/,/g, "");
  else if (/^-?\d{1,3}(\.\d{3}){2,}(,\d+)?$/.test(text)) text = text.replace(/\./g, "").replace(",", ".");
  else text = text.replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(text)) return undefined;
  const n = Number(text);
  return Number.isFinite(n) && Math.abs(n) <= 1e12 ? n : undefined;
}

type ModelQuestion = Record<string, unknown>;
export type Mapped = { kind: string; raw: Record<string, unknown> } | { kind: string; drop: string };

const list = (...values: unknown[]) => (values.find((v) => Array.isArray(v)) as unknown[] | undefined) ?? [];
// Items once each (compared without case or accents), in the order given.
function distinct(items: string[]) {
  const seen = new Set<string>();
  return items.filter((o) => {
    const key = normalize(o);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
const hasDuplicates = (items: string[]) => new Set(items.map(normalize)).size !== items.length;
const COUNTDOWN_MINUTES = [1, 3, 5, 10, 15];
// An item's rank written in it: its first number ("1re", "3rd", "Apollo 11"), or an ordinal word ("Second", "troisième").
const ORDINAL_WORDS = [
  ["first", "premier", "premiere", "première"],
  ["second", "seconde", "deuxieme", "deuxième"],
  ["third", "troisieme", "troisième"],
  ["fourth", "quatrieme", "quatrième"],
  ["fifth", "cinquieme", "cinquième"],
  ["sixth", "sixieme", "sixième"],
];
const rankOf = (item: string) => {
  const n = item.match(/\d+(?:[.,]\d+)?/);
  if (n) return Number(n[0].replace(",", "."));
  const words = item.toLowerCase().split(/[^\p{L}]+/u);
  const at = ORDINAL_WORDS.findIndex((forms) => words.some((w) => forms.includes(w)));
  return at < 0 ? undefined : at + 1;
};
// Items whose numbers rise or fall along the right order show the answer ("1re, 2e, 3e République", "1492, 1789, 1969").
export const givesOrderAway = (items: string[]) => {
  const ranks = items.map(rankOf).filter((r): r is number => r !== undefined);
  if (ranks.length < 3 || ranks.length < items.length - 1) return false;
  const steps = ranks.slice(1).map((r, i) => Math.sign(r - ranks[i]));
  return steps.every((s) => s > 0) || steps.every((s) => s < 0);
};
const labelsOf = (q: ModelQuestion) => {
  const labels = list(q.labels).map((l) => str(l, 40));
  return labels.length >= 2 && labels[0] && labels[1] ? [labels[0], labels[1]] : undefined;
};
const sideOf = (pair: unknown, at: 0 | 1) => {
  if (Array.isArray(pair)) return cleanOption(pair[at]);
  if (pair && typeof pair === "object") {
    const p = pair as Record<string, unknown>;
    return cleanOption(at === 0 ? (p.left ?? p.a ?? p.item ?? p.term) : (p.right ?? p.b ?? p.match ?? p.pair ?? p.definition));
  }
  return "";
};

// The French spacing on every text of a mapped question (title, options, slide text, sentence to fill, scale labels).
export function frenchQuestion(raw: Record<string, unknown>) {
  const fix = (v: unknown) => (typeof v === "string" ? frenchSpaces(v) : Array.isArray(v) ? v.map((x) => (typeof x === "string" ? frenchSpaces(x) : x)) : v);
  const out: Record<string, unknown> = { ...raw };
  for (const key of ["question", "options", "text", "fill", "labels"]) if (key in out) out[key] = fix(out[key]);
  return out;
}

// One question from the model, as cleanQuestion expects it, or the reason it cannot be used.
export function fromModel(q: ModelQuestion | null | undefined, ctx: Context, allowed: Set<Kind> = allowedKinds(ctx)): Mapped {
  if (!q || typeof q !== "object") return { kind: "?", drop: "not an object" };
  let kind = kindOf(q.type ?? "choice");
  const answerGiven = q.answer !== undefined && q.answer !== null && q.answer !== "";
  // A choice that comes with its answer is a quiz the model mislabelled, a ranking flagged as ordered is a right order.
  if (kind === "choice" && answerGiven) kind = "quiz";
  if (kind === "rank" && q.ordered === true) kind = "order";
  // Outside a quiz-like slot, a quiz turns into a plain poll rather than being lost.
  if (kind === "quiz" && !allowed.has("quiz") && allowed.has("choice")) kind = "choice";
  if (kind === "spot" || kind === "contact") return { kind, drop: "kind never generated" };
  if (!(ALL as string[]).includes(kind)) return { kind, drop: "unknown kind" };
  if (!allowed.has(kind as Kind)) return { kind, drop: `kind not allowed in ${ctx.style}` };
  const question = str(q.question ?? q.title ?? q.prompt, 140);
  if (!question) return { kind, drop: "no question" };
  const options = (max: number) => distinct(list(q.options, q.choices, q.items).map(cleanOption)).slice(0, max);

  switch (kind as Kind) {
    case "choice": {
      const opts = options(6);
      if (opts.length < 2) return { kind, drop: "fewer than 2 options" };
      return { kind, raw: { type: "choice", question, options: opts, ...(q.multi === true ? { multi: true } : {}) } };
    }
    case "quiz": {
      const opts = options(6);
      if (opts.length < 2) return { kind, drop: "fewer than 2 options" };
      let correct = answerGiven ? opts.findIndex((o) => same(o, cleanOption(q.answer))) : -1;
      // A right answer given as its position instead of its text.
      if (correct < 0 && typeof q.answer === "number" && Number.isInteger(q.answer) && q.answer >= 0 && q.answer < opts.length) correct = q.answer;
      if (correct < 0 && typeof q.correct === "number" && Number.isInteger(q.correct) && q.correct >= 0 && q.correct < opts.length) correct = q.correct;
      if (correct < 0) return { kind, drop: "quiz answer not among the options" };
      if (/\d/.test(opts[correct]) && changesOverTime(question)) return { kind, drop: "quiz answer changes over time" };
      return { kind, raw: { type: "choice", question, options: opts, correct, timer: 20 } };
    }
    case "number": {
      // A poll ("how many..."), or a game when it has a right answer; a quiz session needs the answer.
      const poll = ctx.style === "poll" || ctx.style === "icebreaker" || ctx.style === "feedback";
      if (poll || !answerGiven) {
        if (ctx.style === "quiz") return { kind, drop: "number without an answer" };
        return { kind, raw: { type: "number", question } };
      }
      const answer = parseAnswer(q.answer);
      if (answer === undefined) return ctx.style === "quiz" ? { kind, drop: "number answer is not a number" } : { kind, raw: { type: "number", question } };
      // A right answer that goes out of date: dropped in a quiz, a plain guess (no right answer) elsewhere.
      if (changesOverTime(question)) return ctx.style === "quiz" ? { kind, drop: "number answer changes over time" } : { kind, raw: { type: "number", question } };
      return { kind, raw: { type: "number", question, answer, timer: 20 } };
    }
    case "order": {
      // An item never carries what gives its place away: "Revolution (1789)" and "1789: Revolution" become "Revolution".
      const items = list(q.items, q.options, q.order).map((o) => cleanOption(o).replace(/\s*\([^()]*\d[^()]*\)$/, "").replace(/^\d{3,4}\s*[:.,]?\s+(?=\p{L})/u, "")).filter(Boolean);
      if (hasDuplicates(items)) return { kind, drop: "duplicate order items" };
      if (items.length < 3) return { kind, drop: "fewer than 3 order items" };
      if (givesOrderAway(items.slice(0, 6))) return { kind, drop: "order items give their order away" };
      return { kind, raw: { type: "rank", question, options: items.slice(0, 6), ordered: true, timer: 30 } };
    }
    case "fill": {
      let text = str(q.text ?? q.fill ?? q.sentence, FILL_LENGTH);
      if (!text && /\[[^\]]+\]/.test(question)) text = question;
      const { answers } = parseFill(text);
      if (!answers.length) return { kind, drop: "fill text has no [blanks]" };
      if (answers.length > MAX_BLANKS) return { kind, drop: `more than ${MAX_BLANKS} blanks` };
      if (answers.some((a) => !a.length || a.some((w) => w.length > BLANK_LENGTH))) return { kind, drop: "empty or long blank" };
      if (answers.some((a) => a.some((w) => /\d/.test(w))) && changesOverTime(text)) return { kind, drop: "fill answer changes over time" };
      const taken = new Set(answers.flat().map(normalize));
      // Extra words never hold a comma: other editors split them on commas.
      const decoys = distinct(list(q.extra, q.decoys, q.distractors, q.wrong).map((d) => str(d, BLANK_LENGTH)).filter((d) => d && !d.includes(","))).filter((d) => !taken.has(normalize(d)));
      const title = question === text ? str(q.instruction, 140) || "..." : question;
      if (title === "...") return { kind, drop: "fill has no instruction" };
      return { kind, raw: { type: "fill", question: title, fill: text, fillMode: "words", decoys: decoys.slice(0, Math.min(4, MAX_DECOYS)), timer: 30 } };
    }
    case "match": {
      let raw = list(q.pairs, q.matches);
      if (!raw.length && Array.isArray(q.left) && Array.isArray(q.right)) raw = q.left.map((l, i) => [l, (q.right as unknown[])[i]]);
      const pairs = raw.map((p) => [sideOf(p, 0), sideOf(p, 1)] as const);
      // A pair missing a side is left out; the rest still pair up correctly.
      const full = pairs.filter(([a, b]) => a && b);
      if (hasDuplicates(full.map(([a]) => a)) || hasDuplicates(full.map(([, b]) => b))) return { kind, drop: "match sides repeat" };
      if (full.length < 2) return { kind, drop: "fewer than 2 full pairs" };
      const kept = full.slice(0, MAX_PAIRS);
      return { kind, raw: { type: "match", question, options: [...kept.map(([a]) => a), ...kept.map(([, b]) => b)], timer: 30 } };
    }
    case "scale": {
      const labels = labelsOf(q);
      return { kind, raw: { type: "scale", question, max: 5, ...(labels ? { labels } : {}) } };
    }
    case "scales": {
      const statements = distinct(list(q.statements, q.options, q.items).map(cleanOption)).slice(0, 6);
      if (statements.length < 2) return { kind, drop: "fewer than 2 statements" };
      const labels = labelsOf(q);
      return { kind, raw: { type: "scales", question, options: statements, max: 5, ...(labels ? { labels } : {}) } };
    }
    case "rank":
    case "points": {
      const opts = options(6);
      if (opts.length < 2) return { kind, drop: "fewer than 2 options" };
      return { kind, raw: { type: kind, question, options: opts } };
    }
    case "wheel": {
      const entries = distinct(list(q.entries, q.options, q.items).map((e) => str(e, ENTRY_LENGTH))).slice(0, 12);
      if (entries.length < 2) return { kind, drop: "fewer than 2 wheel entries" };
      return { kind, raw: { type: "wheel", question, options: entries } };
    }
    case "slide": {
      const text = str(q.text ?? q.body, 600);
      return { kind, raw: { type: "slide", question, ...(text ? { text } : {}) } };
    }
    case "countdown": {
      // Snapped to the builder's usual lengths (1, 3, 5, 10 or 15 minutes), so it lands on one of its buttons.
      const minutes = Number(q.minutes ?? (Number(q.duration) > 0 ? Number(q.duration) / 60 : 5));
      const wanted = Number.isFinite(minutes) ? minutes : 5;
      const duration = 60 * COUNTDOWN_MINUTES.reduce((best, m) => (Math.abs(m - wanted) <= Math.abs(best - wanted) ? m : best));
      return { kind, raw: { type: "countdown", question, duration } };
    }
    case "link":
    case "media": {
      const url = String(q.url ?? "").trim();
      const inBrief = urlsOf(ctx.brief).some((u) => u === url || u.replace(/\/$/, "") === url.replace(/\/$/, ""));
      if (!url || !inBrief) return { kind, drop: "link not written in the brief" };
      return { kind, raw: { type: mediaOf(url) ? "media" : "link", question, url } };
    }
    default:
      return { kind, raw: { type: kind, question } };
  }
}

// ---------- Topic rounds (src/rounds.ts) ----------
// A picker (the wheel or the room's vote among the topics), then each topic's quiz questions. The topics come from the
// presenter or are proposed by the model; one call per topic writes its questions, in the quiz style.
export const AI_TOPICS = { min: MIN_TOPICS, max: 4 };
export const PER_TOPIC = { min: 2, max: 5 };
export type RoundsAsk = { how: "wheel" | "vote"; topics: string[]; perTopic: number };

// Topic names as the picker stores them: plain, at most 40 characters, each once, never more than 4 per request.
export const cleanTopics = (value: unknown) =>
  distinct((Array.isArray(value) ? value : []).map((t) => cleanOption(t).slice(0, TOPIC_LENGTH).trim()).filter(Boolean)).slice(0, AI_TOPICS.max);

// What a request for topic rounds asks: who picks the topic, the topics given (none: the model proposes them), and the
// questions per topic (2 to 5, 3 when missing).
export function roundsAsk(body: Record<string, unknown>): RoundsAsk {
  const per = Math.round(Number(body.perTopic));
  return {
    how: body.how === "vote" ? "vote" : "wheel",
    topics: cleanTopics(body.topics),
    perTopic: Number.isFinite(per) && per > 0 ? Math.min(PER_TOPIC.max, Math.max(PER_TOPIC.min, per)) : 3,
  };
}

// The context of one topic's call: a quiz on that topic, within the presenter's brief.
export const topicContext = (brief: string, topic: string, perTopic: number): Context => ({ style: "quiz", brief: `${brief}\nTopic of this round: ${topic}`, count: perTopic });
// The kinds of one topic's questions: the quiz plan, cut to the number asked (the plan holds 3 at least).
export const topicPlan = (ctx: Context, rand: () => number = Math.random) => planKinds(ctx, rand).slice(0, ctx.count);

// The rounds as cleanQuestion expects them: the picker first, then each topic's questions with its `topic`. A topic left
// without a usable question is dropped (the topics after it move up); null when fewer than 2 topics are left.
// `clean`: the save's own checks (worker/index.ts cleanQuestion), a text when a question is refused.
export function roundsFromModel(
  ask: { how: "wheel" | "vote"; perTopic: number },
  picker: { question: string; topics: string[] },
  sets: unknown[][],
  ctxOf: (topic: string) => Context,
  clean: (raw: Record<string, unknown>) => unknown = (raw) => raw,
): { questions: Record<string, unknown>[]; dropped: string[] } | null {
  const kept: { label: string; questions: Record<string, unknown>[] }[] = [];
  const dropped: string[] = [];
  picker.topics.forEach((label, t) => {
    const ctx = ctxOf(label);
    const allowed = allowedKinds(ctx);
    const out: Record<string, unknown>[] = [];
    for (const q of (sets[t] ?? []).slice(0, ask.perTopic + 2)) {
      const mapped = fromModel(q as ModelQuestion, ctx, allowed);
      if (!("raw" in mapped)) continue;
      const done = clean(mapped.raw);
      if (done && typeof done === "object") out.push(done as Record<string, unknown>);
      if (out.length === ask.perTopic) break;
    }
    if (out.length) kept.push({ label, questions: out });
    else dropped.push(label);
  });
  if (kept.length < AI_TOPICS.min) return null;
  const question = str(picker.question, 140);
  const head = clean({ type: ask.how === "vote" ? "choice" : "wheel", question, options: kept.map((k) => k.label), topics: true });
  if (!question || !head || typeof head !== "object") return null;
  return { questions: [head as Record<string, unknown>, ...kept.flatMap((k, t) => k.questions.map((q) => ({ ...q, topic: t })))], dropped };
}
