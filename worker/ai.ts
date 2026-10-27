import { ENGLISH_NAME } from "../src/languages";
import { detectLang } from "./translate";
// AI writing help with Cloudflare Workers AI (no key, within the daily AI budget): write a presentation, improve one, or rework a question.
// gpt-oss-120b writes the best questions; Llama 3.3 takes over when it fails, so a request almost never comes back empty.
import type { User } from "./auth";
import type { Env } from "./index";
import { aiAvailable, aiRun } from "./ai-budget";
import { AI_TOPICS, STYLES, allowedKinds, cleanOption, cleanTopics, frenchQuestion, frenchSpaces, fromModel, kindLines, planKinds, planText, roundsAsk, roundsFromModel, same, str, topicContext, topicPlan, type Context, type Style } from "./ai-kinds";
import { limitsOf } from "./limits";
import { fitRounds } from "../src/rounds";

const MAIN = "@cf/openai/gpt-oss-120b";
const FALLBACK = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
// Writing help requests per account and per day.
const DAILY = 100;
const LANGUAGE = ENGLISH_NAME;

const CRAFT = `You are an expert event facilitator who writes questions for live audience polls.
The question is shown on a big screen and people answer on their phones in a few seconds.
Good questions: one idea each, concrete, specific to the topic, easy to answer, inclusive, never patronising.
Never ask something the presenter already stated (if the brief says the company was founded in 2015, do not ask "what is our industry"; a quiz on the founding year is fine).
Never invent anything about the presenter's organisation: no nicknames, office names, people, products, numbers or events that are not in the brief. If the brief gives few facts, ask about opinions, expectations and experiences instead.
Never guess personal facts in options (cities, countries, job titles, names): use broad, inclusive options instead, for example "In the office", "Remote", "On the move".
Every right answer (a quiz option, a number, a right order, the words of a blank, a pair) comes from the brief or from widely known general knowledge you are completely sure of. Use only facts that do not change over time. Do not combine several facts in one question. Each quiz has exactly one right option, and every other option is clearly wrong. Never invent people's names, links or figures.
Options are short (2 to 6 words), parallel in form, mutually exclusive, with no trailing period. 3 or 4 options unless asked otherwise.
Questions are at most 110 characters, end with a question mark, with correct accents and punctuation for the language. Instructions and titles (ranking, right order, match pairs, fill in the blanks, prioritize, wheel, slide, timer) end with no punctuation. No emojis, no numbering.
Answer with one JSON object only, no text before or after it.`;

// Counts one use; refuses past the account's daily allowance, or when the AI budget is spent.
async function spend(env: Env, user: User) {
  if (!(await aiAvailable(env, "writing"))) return false;
  const day = new Date().toISOString().slice(0, 10);
  const limit = DAILY;
  const row = await env.DB.prepare(
    "INSERT INTO ai_usage (user_id, day, n) VALUES (?, ?, 1) ON CONFLICT(user_id, day) DO UPDATE SET n = n + 1 RETURNING n",
  )
    .bind(user.id, day)
    .first<{ n: number }>();
  return (row?.n ?? 1) <= limit;
}

// Whether a model answered during a request: its neurons are spent even if the answer was not usable.
type Run = { answered: boolean };

// A call no model answered (busy, down, budget spent) does not count against the person's daily allowance.
// One a model did answer counts, even if unusable: otherwise odd requests could burn the shared AI budget for free.
async function refund(env: Env, user: User, result: AiResult, run: Run) {
  if (run.answered) return result;
  await env.DB.prepare("UPDATE ai_usage SET n = n - 1 WHERE user_id = ? AND day = ? AND n > 0")
    .bind(user.id, new Date().toISOString().slice(0, 10))
    .run()
    .catch(() => {});
  return result;
}

type Reply = { response?: unknown; choices?: { message?: { content?: string } }[]; output?: { type?: string; content?: { text?: string }[] }[]; usage?: unknown };

function parse<T>(raw: Reply): T | null {
  const value =
    raw?.response ??
    raw?.choices?.[0]?.message?.content ??
    raw?.output?.filter((o) => o.type === "message").flatMap((o) => o.content ?? []).map((c) => c.text ?? "").join("");
  if (value && typeof value === "object") return value as T;
  const text = String(value ?? "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return start >= 0 && end > start ? (JSON.parse(text.slice(start, end + 1)) as T) : null;
}

// Plain JSON in the answer, read here: strict JSON decoding drops optional fields, accents and punctuation.
// `maxTokens`: room for the answer (gpt-oss counts its reasoning in it); a whole presentation with rich kinds needs more.
async function ask<T>(env: Env, run: Run, prompt: string, accept: (value: T) => boolean = () => true, maxTokens = 3000): Promise<T | null> {
  const runs: [string, Record<string, unknown>][] = [
    [MAIN, { instructions: CRAFT, input: prompt, reasoning: { effort: "low" }, max_output_tokens: maxTokens }],
    [FALLBACK, { messages: [{ role: "system", content: CRAFT }, { role: "user", content: prompt }], max_tokens: Math.min(maxTokens, 3000), temperature: 0.5 }],
  ];
  for (const [model, input] of runs) {
    try {
      const raw = (await aiRun(env, model, input)) as Reply;
      run.answered = true;
      const value = parse<T>(raw);
      if (value && accept(value)) return value;
      console.error(JSON.stringify({ at: "ai", model, error: "unusable answer" }));
    } catch (err) {
      console.error(JSON.stringify({ at: "ai", model, error: String(err) }));
    }
  }
  return null;
}

export type AiResult = { ok: true; data: unknown } | { ok: false; status: number; error: string };
const BUSY: AiResult = { ok: false, status: 503, error: "The AI is busy. Try again in a moment." };
const LIMIT: AiResult = { ok: false, status: 429, error: "Daily AI limit reached. Try again tomorrow." };


// Tones offered in the builder. "clearer" is the default.
const TONES: Record<string, string> = {
  clearer: "clearer and easier to read at a glance",
  formal: "more formal and professional, as for executives or clients",
  friendly: "warmer and friendlier, relaxed but still professional",
  shorter: "shorter and punchier, cutting every unneeded word",
  fun: "more playful and fun, with light humour, still respectful",
};
const toneOf = (value: unknown) => TONES[String(value)] ?? TONES.clearer;
const noteOf = (value: unknown) => {
  const note = str(value, 300);
  return note ? `\nInstruction from the presenter, follow it: ${note}` : "";
};
const contextOf = (value: unknown) => {
  const title = str(value, 140);
  return title ? `\nThe presentation is called "${title}".` : "";
};
// Kinds whose options the AI may rewrite (improve and rewrite; generate maps every kind in ai-kinds.ts).
const WITH_OPTIONS = new Set(["choice", "quiz", "rank", "order", "scales", "points"]);
// What each kind of question is, in the builder's names (src/questions.ts UiKind), for the model.
const KIND_HINT: Record<string, string> = {
  choice: "multiple choice poll", quiz: "quiz with one right answer", rank: "ranking, people order the items by preference", words: "word cloud",
  scale: "rating from 1 to 5 or 1 to 10", open: "open text answer", qa: "audience Q&A prompt", contact: "contact details request",
  scales: "rating scale, several statements rated on one scale", points: "prioritize, people share 100 points between the items",
  number: "guess a number", order: "right order game, the items are listed in the correct order", fill: "fill in the blanks title",
  match: "match pairs title", spot: "find on the image title", wheel: "spin the wheel title", slide: "slide title",
  link: "title shown with a QR code to a link", media: "title shown above a video or audio", countdown: "timer title",
};
// How each kind names its options, and the rule its options follow.
const OPTION_NOUN: Record<string, string> = { scales: "statements", points: "items", order: "items", rank: "items" };
const ORDER_RULE = "The items are listed in the right order, which is the answer of the game: reword each item without changing what it is, keep exactly the same items in the same order, never replace, add or reorder one.";

// Keeps the ending the original had: its question mark (with the French space) or no final period.
function keepMark(original: string, next: string) {
  if (!next) return next;
  if (!/[.!]\s*$/.test(original)) next = next.replace(/\.\s*$/, "");
  if (!/\?\s*$/.test(original) || /[?？!]\s*$/.test(next)) return next;
  return next.replace(/\s+$/, "") + (/\s\?\s*$/.test(original) ? " ?" : "?");
}

// What each format is for; the kinds of its questions come from planKinds (worker/ai-kinds.ts).
const STYLE_TEXT: Record<Style, string> = {
  mixed: "A varied session: an easy icebreaker first, then polls and moments that get people talking, a knowledge check only on safe facts, and a feedback or takeaway question to close.",
  quiz: "A knowledge quiz, from easy to harder. Wrong options are plausible. Spread the right quiz answers across positions.",
  poll: "Opinion questions only: no right answers, no quiz.",
  icebreaker: "Light warm-up questions that get everyone talking, easy to answer, with no right answers.",
  feedback: "Feedback on a session or an event: satisfaction, what worked, the feeling, one improvement.",
};

type Generated = { title?: string; questions?: Record<string, unknown>[] };
type Kept = { title: string; questions: unknown[] };

export async function aiGenerate(env: Env, user: User, body: Record<string, unknown>, clean: (raw: unknown) => unknown): Promise<AiResult> {
  const topic = str(body.topic, 600);
  if (topic.length < 3) return { ok: false, status: 400, error: "Describe your topic in a few words" };
  if (body.mode === "rounds") return aiRounds(env, user, body, topic, clean);
  const style: Style = STYLES.includes(String(body.style) as Style) ? (String(body.style) as Style) : "mixed";
  const count = Math.min(10, Math.max(3, Math.round(Number(body.count)) || 5));
  const audience = str(body.audience, 120);
  // Left on "Detect": the brief's language, named for the model rather than guessed by it.
  const language = LANGUAGE[String(body.lang)] ?? LANGUAGE[detectLang([topic, audience])] ?? "the language of the brief";
  if (!(await spend(env, user))) return LIMIT;
  const run: Run = { answered: false };
  const french = language === LANGUAGE.fr;
  // The code picks each question's kind, a new mix on every call, so "Try again" gives another presentation.
  const ctx: Context = { style, brief: topic, count };
  const plan = planKinds(ctx);
  const allowed = allowedKinds(ctx);

  // Same checks as questions written by hand. An answer with too few usable questions is refused, so the second model gets its turn;
  // the best answer seen is kept in case neither does better.
  let best: Kept | null = null;
  const keep = (v: Generated) => {
    const questions: unknown[] = [];
    for (const q of (Array.isArray(v?.questions) ? v.questions : []).slice(0, count + 2)) {
      const mapped = fromModel(q, ctx, allowed);
      const out = "raw" in mapped ? clean(french ? frenchQuestion(mapped.raw) : mapped.raw) : mapped.drop;
      if (out && typeof out === "object") questions.push(out);
      else console.error(JSON.stringify({ at: "ai", kind: mapped.kind, error: String(out) }));
    }
    const kept = { title: french ? frenchSpaces(str(v?.title, 140)) : str(v?.title, 140), questions: questions.slice(0, count) };
    if (!best || kept.questions.length > best.questions.length) best = kept;
    return kept.questions.length >= Math.ceil(count / 2);
  };

  await ask<Generated>(
    env,
    run,
    `Write exactly ${count} questions in ${language} for this live session.
Brief from the presenter: ${topic}${audience ? `\nAudience: ${audience}` : ""}
Tone: ${toneOf(body.tone)}.
${STYLE_TEXT[style]}
Follow this plan, in this order:
${planText(plan)}
Types:
${kindLines(plan)}
Every text is in ${language}. Also give the session a short, catchy title (max 50 characters).
JSON format, one object per question in the plan's order: {"title": "...", "questions": [{"type": "...", "question": "...", ...}]}`,
    keep,
    5000,
  );
  const result = best as Kept | null;
  if (!result) return refund(env, user, BUSY, run);
  if (!result.questions.length) return refund(env, user, { ok: false, status: 503, error: "The AI answer was not usable. Try again." }, run);
  return { ok: true, data: result };
}

type Item = { question: string; options: string[]; kind: string };
const readItems = (value: unknown): Item[] =>
  (Array.isArray(value) ? value : []).slice(0, 50).map((q: Record<string, unknown>) => ({
    question: str(q?.question, 200),
    options: (Array.isArray(q?.options) ? q.options : []).map((o: unknown) => str(o, 80)),
    kind: String(q?.kind ?? "choice"),
  }));

// Fresh options only when they match the old ones one for one, so a quiz answer stays on the right option.
function mergeOptions(old: string[], fresh: unknown[] | undefined) {
  const next = (fresh ?? []).map(cleanOption);
  if (next.length !== old.length) return old;
  return next.map((o, k) => (old[k] ? o || old[k] : ""));
}

// Rewrites a whole presentation in one call. Same number of questions, options and order.
export async function aiImprove(env: Env, user: User, body: Record<string, unknown>): Promise<AiResult> {
  const items = readItems(body.questions);
  if (!items.some((q) => q.question)) return { ok: false, status: 400, error: "Write a question first" };
  const scope = ["questions", "options"].includes(String(body.scope)) ? String(body.scope) : "both";
  const language = LANGUAGE[String(body.lang)] ?? LANGUAGE[detectLang(items.flatMap((q) => [q.question, ...q.options]))] ?? "the language of the questions";
  if (!(await spend(env, user))) return LIMIT;
  const run: Run = { answered: false };

  const list = items.map((q, i) => ({
    i,
    type: KIND_HINT[q.kind] ?? q.kind,
    question: q.question,
    ...(WITH_OPTIONS.has(q.kind) && q.options.some(Boolean) ? { options: q.options } : {}),
    ...(q.kind === "order" ? { rule: "same items, same order" } : {}),
  }));
  const ordered = items.some((q) => q.kind === "order" && q.options.some(Boolean));
  const what = scope === "questions" ? "Rewrite only the questions; copy options unchanged." : scope === "options" ? "Rewrite only the options; copy questions unchanged." : "Rewrite the questions and their options.";
  const result = await ask<{ questions?: { i?: number; question?: string; options?: unknown[] }[] }>(
    env,
    run,
    `Make this presentation ${toneOf(body.tone)}. ${what}${contextOf(body.title)}
Clearly apply the tone, keep each question's meaning and what it asks people to do (a word cloud question keeps asking for the same number of words, "In one word" stays one word), and keep the same number and order of options (a quiz answer is tied to its position). Empty options stay empty.
A question stays a direct question ending with a question mark: never turn it into a "Please ..." instruction. An instruction or a title (ranking, right order, match pairs, fill in the blanks, prioritize, slide, timer) stays one, with no final punctuation.${ordered ? `\nRight order questions: ${ORDER_RULE}` : ""}
Fix vague or clumsy wording, and options that overlap or do not answer their question.${scope === "options" || body.tone === "shorter" ? "" : " Write complete, natural questions, never telegraphic fragments."}
Write in ${language}.${noteOf(body.note)}
Presentation: ${JSON.stringify(list)}
JSON format: {"questions": [{"i": 0, "question": "...?", "options": ["...", "..."]}]}`,
    (v) => Array.isArray(v?.questions) && v.questions.length > 0,
  );
  if (!result?.questions) return refund(env, user, BUSY, run);

  const byIndex = new Map(result.questions.map((q, n) => [Number.isInteger(q.i) ? (q.i as number) : n, q]));
  const questions = items.map((q, i) => {
    const out = byIndex.get(i);
    const question = scope !== "options" && q.question ? keepMark(q.question, str(out?.question, 139)) || q.question : q.question;
    const options = scope === "questions" || !WITH_OPTIONS.has(q.kind) ? q.options : mergeOptions(q.options, out?.options);
    return language === LANGUAGE.fr ? { question: frenchSpaces(question), options: options.map(frenchSpaces) } : { question, options };
  });
  return { ok: true, data: { questions } };
}

// One question: three rewordings to pick from, or a better set of options.
export async function aiRewrite(env: Env, user: User, body: Record<string, unknown>): Promise<AiResult> {
  const question = str(body.question, 200);
  const kind = String(body.kind ?? "choice");
  const options = (Array.isArray(body.options) ? body.options : []).map((o) => str(o, 80)).slice(0, 10);
  const filled = options.filter(Boolean);
  const mode = body.mode === "options" ? "options" : "question";
  if (!question) return { ok: false, status: 400, error: "Write a question first" };
  const language = LANGUAGE[String(body.lang)] ?? LANGUAGE[detectLang([question, ...filled])] ?? "the language of the question";
  if (!(await spend(env, user))) return LIMIT;
  const run: Run = { answered: false };

  if (mode === "question") {
    const result = await ask<{ suggestions?: unknown[] }>(
      env,
      run,
      `Rewrite this ${KIND_HINT[kind] ?? "poll"} question in 3 clearly different ways, each ${toneOf(body.tone)}, same meaning, in ${language}. Keep it a direct question (an instruction or a title, such as a ranking, a right order, match pairs, fill in the blanks or a slide, stays one with no final punctuation).${contextOf(body.title)}
${filled.length ? `Its options are: ${filled.map((o) => `"${o}"`).join(", ")}. The rewording must still fit them.\n` : ""}Question: "${question}"${noteOf(body.note)}
JSON format: {"suggestions": ["...?", "...?", "...?"]}`,
      (v) => Array.isArray(v?.suggestions) && v.suggestions.length > 0,
    );
    if (!result?.suggestions) return refund(env, user, BUSY, run);
    const fr = (s: string) => (language === LANGUAGE.fr ? frenchSpaces(s) : s);
    const suggestions = [...new Set(result.suggestions.map((s) => fr(keepMark(question, str(s, 139)))).filter((s) => s && !same(s, question)))].slice(0, 3);
    if (!suggestions.length) return refund(env, user, BUSY, run);
    return { ok: true, data: { question: suggestions[0], suggestions, options } };
  }

  // `correct`: the right answer's place among the options sent (the empty rows are not sent).
  const quiz = kind === "quiz" && Number.isInteger(body.correct) ? filled[body.correct as number] : undefined;
  const noun = OPTION_NOUN[kind] ?? "options";
  const result = await ask<{ options?: unknown[] }>(
    env,
    run,
    `Question (${KIND_HINT[kind] ?? "poll"}): "${question}"${contextOf(body.title)}
${filled.length
      ? kind === "order"
        ? `Current items, in the right order: ${filled.map((o) => `"${o}"`).join(", ")}.
Improve their wording, ${toneOf(body.tone)}, parallel in form. ${ORDER_RULE} Keep exactly ${filled.length} items.`
        : `Current ${noun}: ${filled.map((o) => `"${o}"`).join(", ")}${quiz ? ` (right answer: "${quiz}")` : ""}.
Improve them so each one clearly ${kind === "scales" ? "is a short statement people can rate for this exact question" : "answers this exact question"}: ${toneOf(body.tone)}, parallel in form, distinct, none overlapping. Replace any one that does not fit. Keep exactly ${filled.length} ${noun} in the same order${quiz ? ", and the right answer stays at the same position and stays true" : ""}.`
      : kind === "order"
        ? `Suggest 4 items for this exact question, listed in the right order, using only facts you are completely sure of, ${toneOf(body.tone)}.`
        : kind === "scales"
          ? `Suggest 4 short statements that people rate for this exact question, ${toneOf(body.tone)}.`
          : `Suggest 4 ${noun === "items" ? "items" : "answer options"} that fit this exact question, ${toneOf(body.tone)}.`}
Write in ${language}.${noteOf(body.note)}
JSON format: {"options": ["...", "..."]}`,
    (v) => Array.isArray(v?.options) && v.options.length > 0,
  );
  if (!result?.options) return refund(env, user, BUSY, run);
  const fresh = result.options.map(cleanOption).filter(Boolean).slice(0, 10);
  const next = (filled.length ? (fresh.length === filled.length ? fresh : filled) : fresh).map((o) => (language === LANGUAGE.fr ? frenchSpaces(o) : o));
  return { ok: true, data: { question, suggestions: [], options: next } };
}

// Topic rounds (src/rounds.ts): a picker, the wheel or the room's vote among 2 to 4 topics (the presenter's, or proposed by
// the model), then 2 to 5 quiz questions per topic, one call per topic. One use of the daily allowance for the whole request.
// The result fits the cap of questions (with 5: the picker and 2 topics of 2 questions).
async function aiRounds(env: Env, user: User, body: Record<string, unknown>, brief: string, clean: (raw: unknown) => unknown): Promise<AiResult> {
  const want = roundsAsk(body);
  const audience = str(body.audience, 120);
  const language = LANGUAGE[String(body.lang)] ?? LANGUAGE[detectLang([brief, audience, ...want.topics])] ?? "the language of the brief";
  const french = language === LANGUAGE.fr;
  const fr = (s: string) => (french ? frenchSpaces(s) : s);
  const cap = Math.min(limitsOf(user.plan).questions, Number.isInteger(body.max) && (body.max as number) > 0 ? (body.max as number) : Infinity);
  if (cap < 3) return { ok: false, status: 400, error: "Topic rounds need room for 3 questions: the picker and 2 topics" };
  if (!(await spend(env, user))) return LIMIT;
  const run: Run = { answered: false };
  const given = want.topics.length >= AI_TOPICS.min;
  const choosing = want.how === "vote" ? "the room votes for" : "a wheel picks";

  // The frame: the session's title, the picker's question and, without topics given, the topics.
  const frame = await ask<{ title?: unknown; picker?: unknown; topics?: unknown }>(
    env,
    run,
    `Plan a quiz night played in topic rounds, in ${language}: before each round, ${choosing} the next topic, then ${want.perTopic} quiz questions on that topic are played.
Brief from the presenter: ${brief}${audience ? `\nAudience: ${audience}` : ""}
${given ? `The topics are fixed: ${want.topics.map((t) => `"${t}"`).join(", ")}. Copy them exactly.` : `Propose 3 or 4 topics that fit the brief: short names of 1 to 3 words (at most 30 characters), clearly different from each other, each rich enough for ${want.perTopic} quiz questions on safe, well known facts.`}
Also write a short, catchy title for the session (at most 50 characters) and the question shown on screen while ${choosing} the next topic (at most 80 characters, ending with a question mark).
Every text is in ${language}.
JSON format: {"title": "...", "picker": "...?", "topics": ["...", "...", "..."]}`,
    (v) => given || cleanTopics(v?.topics).length >= AI_TOPICS.min,
    1500,
  );
  if (!frame) return refund(env, user, BUSY, run);
  const topics = given ? want.topics : cleanTopics(frame.topics).map(fr);
  const pickerQuestion = fr(str(frame.picker, 140)) || (french ? "Quel sera le prochain thème\u00a0?" : "What will the next topic be?");

  // One call per topic, all at once.
  const sets = await Promise.all(
    topics.map(async (label) => {
      const ctx = topicContext(brief, label, want.perTopic);
      const plan = topicPlan(ctx);
      const answer = await ask<{ questions?: unknown[] }>(
        env,
        run,
        `Write exactly ${want.perTopic} quiz questions in ${language} for one round of a quiz night. Every question is about this round's topic: "${label}".
Brief of the whole session: ${brief}${audience ? `\nAudience: ${audience}` : ""}
Tone: ${toneOf(body.tone)}.
${STYLE_TEXT.quiz}
Follow this plan, in this order:
${planText(plan)}
Types:
${kindLines(plan)}
Every text is in ${language}.
JSON format, one object per question in the plan's order: {"questions": [{"type": "...", "question": "...", ...}]}`,
        (v) => Array.isArray(v?.questions) && v.questions.length > 0,
        3000,
      );
      return Array.isArray(answer?.questions) ? answer.questions : [];
    }),
  );
  const built = roundsFromModel(want, { question: pickerQuestion, topics }, sets, (label) => topicContext(brief, label, want.perTopic), (raw) => clean(french ? frenchQuestion(raw) : raw));
  if (!built) return refund(env, user, { ok: false, status: 503, error: "The AI answer was not usable. Try again." }, run);
  const fitted = fitRounds(built.questions as never[], cap) as Record<string, unknown>[] | null;
  if (!fitted) return refund(env, user, { ok: false, status: 503, error: "The AI answer was not usable. Try again." }, run);
  const title = fr(str(frame.title, 140));
  return { ok: true, data: { title, questions: fitted, how: want.how, cut: fitted.length < built.questions.length, dropped: built.dropped } };
}
