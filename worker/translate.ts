// Translates presentation text for participants, with Cloudflare Workers AI, within the daily AI budget.
// Each text is translated once per language and cached in D1; past the budget, phones keep the original.
import { aiAvailable, aiRun, NoBudget, type Share } from "./ai-budget";
import { ENGLISH_NAME, LANG_CODES } from "../src/languages";

export const LANGS = LANG_CODES;

// Common words per language, to guess which language a presentation is written in.
const STOPWORDS: Record<string, string[]> = {
  en: ["the", "and", "you", "your", "what", "is", "are", "of", "to", "for", "how", "in", "this", "with", "do", "which", "we", "our", "my", "it", "who", "why", "when", "where", "does", "did", "will", "should", "would", "can", "could", "best", "most", "favorite", "favourite", "next", "first", "goes", "today", "that", "they", "their", "from", "have", "has", "one", "word", "about"],
  fr: ["le", "la", "les", "des", "et", "est", "vous", "tu", "ton", "pour", "quel", "quelle", "une", "un", "du", "en", "sur", "ce", "cette", "qui", "que", "nos", "votre", "comment", "pourquoi", "quand", "où", "combien", "vos", "notre", "avec", "dans", "pas", "aux", "chez", "êtes", "sont", "mot", "aujourd"],
  es: ["el", "los", "las", "y", "es", "qué", "cómo", "para", "una", "del", "con", "por", "tu", "su", "este", "esta", "cuál"],
  de: ["der", "die", "das", "und", "ist", "wie", "was", "ihr", "sie", "ein", "eine", "für", "mit", "nicht", "welche", "dein", "unser"],
  it: ["il", "lo", "gli", "e", "è", "che", "come", "per", "una", "della", "del", "con", "quale", "tuo", "questo", "questa"],
  pt: ["o", "os", "as", "e", "é", "que", "como", "para", "uma", "do", "da", "com", "qual", "seu", "sua", "este", "esta", "você"],
  nl: ["de", "het", "een", "en", "is", "wat", "hoe", "voor", "van", "met", "jouw", "welke", "niet", "deze"],
  pl: ["i", "w", "na", "nie", "się", "jest", "co", "jak", "czy", "dla", "że", "jaki", "jaka", "jakie", "twój", "twoja", "nasz", "który", "która"],
  ro: ["și", "este", "în", "cu", "pentru", "ce", "care", "cum", "din", "pe", "nu", "tău", "ta", "cel", "cea", "mai", "sunt", "sau"],
  tr: ["ve", "bir", "bu", "ne", "nasıl", "için", "mi", "mı", "mu", "mü", "ile", "hangi", "sizin", "senin", "çok", "daha", "nedir", "neden"],
  hu: ["a", "az", "és", "hogy", "nem", "mi", "mit", "melyik", "milyen", "egy", "van", "vagy", "is", "meg", "ez", "ezt", "hogyan", "neked", "legjobb", "mennyire"],
  cs: ["je", "na", "se", "že", "co", "jak", "který", "která", "jaký", "jaká", "pro", "není", "nebo", "váš", "tvůj", "jste"],
  sk: ["je", "na", "sa", "že", "čo", "ako", "ktorý", "ktorá", "aký", "aká", "pre", "nie", "alebo", "váš", "tvoj", "ste"],
  sl: ["in", "je", "na", "se", "da", "kaj", "kako", "kateri", "katera", "za", "ni", "ali", "vaš", "tvoj", "so", "ste"],
  hr: ["je", "na", "se", "da", "što", "kako", "koji", "koja", "za", "nije", "ili", "vaš", "tvoj", "su", "ste"],
  sv: ["och", "är", "att", "det", "som", "ett", "på", "för", "med", "vad", "hur", "vilken", "vilket", "din", "inte"],
  da: ["og", "er", "at", "det", "som", "et", "på", "for", "med", "hvad", "hvordan", "hvilken", "hvilket", "din", "ikke"],
  nb: ["og", "er", "at", "det", "som", "et", "på", "for", "med", "hva", "hvordan", "hvilken", "hvilket", "din", "ikke"],
  fi: ["ja", "on", "että", "ei", "mikä", "mitä", "miten", "kuinka", "se", "tämä", "sinun", "teidän", "onko", "tai", "kanssa"],
  et: ["ja", "on", "et", "ei", "mis", "kuidas", "milline", "see", "sinu", "teie", "kas", "või", "ka"],
  lv: ["un", "ir", "ka", "ne", "kas", "kā", "kurš", "kura", "tas", "tā", "jūsu", "tavs", "vai", "ar", "par"],
  lt: ["ir", "yra", "kad", "ne", "kas", "kaip", "kuris", "kuri", "tai", "jūsų", "tavo", "ar", "su", "apie"],
  id: ["dan", "yang", "di", "ini", "itu", "apa", "bagaimana", "untuk", "dengan", "tidak", "anda", "kamu", "mana", "adalah"],
  vi: ["và", "là", "của", "có", "không", "gì", "như", "thế", "nào", "cho", "với", "bạn", "này", "một"],
};

// Languages told apart by their alphabet. Kana comes first: Japanese also uses Chinese characters.
const SCRIPTS: [RegExp, string][] = [
  [/[\u3040-\u30ff]/gu, "ja"],
  [/[\uac00-\ud7af\u1100-\u11ff]/gu, "ko"],
  [/[\u4e00-\u9fff]/gu, "zh"],
  [/[\u0600-\u06ff]/gu, "ar"],
  [/[\u0590-\u05ff]/gu, "he"],
  [/[\u0370-\u03ff]/gu, "el"],
  [/[\u0900-\u097f]/gu, "hi"],
  [/[\u0e00-\u0e7f]/gu, "th"],
  [/[\u0400-\u04ff]/gu, "cyrillic"],
];

// Best guess at the language of a presentation's text, or "auto" when unsure:
// then every phone asks for a translation, rather than some readers being left with a language they don't read.
export function detectLang(texts: string[]) {
  const text = texts.join(" ");
  const letters = (text.match(/\p{L}/gu) ?? []).length;
  if (!letters) return "auto";
  const count = (re: RegExp) => (text.match(re) ?? []).length;
  const kana = count(/[\u3040-\u30ff]/gu);
  let script = "";
  let most = 0;
  for (const [re, lang] of SCRIPTS) {
    // Japanese mixes kana with Chinese characters.
    const n = lang === "ja" && kana ? kana + count(/[\u4e00-\u9fff]/gu) : count(re);
    if (n > most) [script, most] = [lang, n];
  }
  if (most / letters > 0.3) {
    if (script !== "cyrillic") return script;
    if (/[іїєґ]/iu.test(text)) return "uk";
    if (/[ыэё]/iu.test(text)) return "ru";
    return /ъ/u.test(text) ? "bg" : "auto";
  }
  const words = text.toLowerCase().split(/[^\p{L}']+/u).flatMap((w) => w.split("'")).filter(Boolean);
  const scores = Object.entries(STOPWORDS)
    .map(([lang, list]) => {
      const set = new Set(list);
      return [lang, words.filter((w) => set.has(w)).length] as const;
    })
    .sort((a, b) => b[1] - a[1]);
  const [[best, score], [, second]] = scores;
  // Close languages (Danish and Norwegian, Czech and Slovak) share words: a clear lead is needed.
  // A very short text (a wheel title, "Who goes first?") may hold a single common word: enough when no other language has one.
  if (score >= 2 && score > second) return best;
  return score === 1 && second === 0 && words.length <= 8 ? best : "auto";
}

type TranslateEnv = { AI: Ai; DB: D1Database };

const NAMES: Record<string, string> = { ...ENGLISH_NAME, auto: "the language they are written in" };
// The small fallback model names Norwegian "no".
const M2M: Record<string, string> = { nb: "no" };

// What the texts are, so the model translates them as a set rather than as loose words.
export type TranslateKind = "poll" | "interface" | "posts" | "words";
const BRIEF: Record<TranslateKind, string> = {
  words: "They are single words or very short expressions typed by participants for a word cloud, possibly in different languages. Translate each one on its own into its most natural equivalent of one to three words, lowercase unless it is a proper noun; a word already in the target language comes back unchanged.",
  posts: "They are short questions and answers typed by different participants of a live session, each one on its own and possibly in different languages. Translate each one into a natural, faithful version; keep the person's tone, names and numbers; a text already in the target language comes back unchanged.",
  poll: "They are the texts of one live audience poll shown on a big screen and on phones: the first is the presentation title, the second the question, the others are its answer options and scale labels. Translate them together, so each option reads as a natural answer to the question.",
  interface: "They are the labels and messages of the phone screen of a live polling app (buttons, hints, status messages). Use the short, plain wording real apps use in that language.",
};

// Cache version: bump it when the translation method changes, so older translations are redone.
const VERSION = "v2";

async function cacheId(text: string, from: string, to: string, kind: TranslateKind) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${VERSION}:${kind}:${from}>${to}:${text}`)));
  return Array.from(bytes.slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
}

type Reply = { response?: unknown; choices?: { message?: { content?: string } }[]; output?: { type?: string; content?: { text?: string }[] }[] };
const replyText = (raw: Reply) => {
  const value =
    raw?.response ??
    raw?.choices?.[0]?.message?.content ??
    raw?.output?.filter((o) => o.type === "message").flatMap((o) => o.content ?? []).map((c) => c.text ?? "").join("");
  return typeof value === "object" ? JSON.stringify(value) : String(value ?? "");
};

// One call for the whole set, with a large model that understands context. Null when no model answered well.
async function translateSet(env: TranslateEnv, texts: string[], from: string, to: string, kind: TranslateKind, shares: Share[]): Promise<string[] | null> {
  const instructions = `You are a professional translator for event and business software.
Translate every text from ${NAMES[from] ?? from} to ${NAMES[to] ?? to}. ${BRIEF[kind]}
Rules: keep the exact meaning and intent, not a word-for-word copy; translate idioms and wordplay into natural equivalents; keep the same tone and register; keep names, brands, product names, numbers, URLs and emojis unchanged; keep answers short and parallel; follow the typography of ${NAMES[to] ?? to}${to === "fr" ? " (a space before ? ! : ;)" : ""}; add no explanation, quotes or extra punctuation.
Answer with one JSON object only: {"t": [...]} with exactly ${texts.length} strings, in the same order.`;
  const input = JSON.stringify(texts);
  const runs: [string, Record<string, unknown>][] = [
    ["@cf/openai/gpt-oss-120b", { instructions, input, reasoning: { effort: "low" }, max_output_tokens: 4000 }],
    ["@cf/meta/llama-3.3-70b-instruct-fp8-fast", { messages: [{ role: "system", content: instructions }, { role: "user", content: input }], max_tokens: 3000, temperature: 0.2 }],
  ];
  // A poll sent back exactly as it was (every text of several words unchanged) is a failed answer: the next model tries.
  // Not when the source language is unknown, as the texts may already be in the target language.
  const sentences = kind === "poll" && from !== "auto" ? texts.filter((t) => /\s/.test(t.trim())) : [];
  let echo: string[] | null = null;
  for (const [model, body] of runs) {
    try {
      const text = replyText((await aiRun(env, model, body, { use: "translation", shares })) as Reply);
      const json = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as { t?: unknown };
      const out = Array.isArray(json.t) ? json.t.map((v) => String(v ?? "").trim()) : [];
      if (out.length === texts.length && out.every((v, i) => v || !texts[i].trim())) {
        if (!sentences.length || texts.some((t, i) => /\s/.test(t.trim()) && out[i] !== t.trim())) return out;
        echo ??= out;
        console.error(JSON.stringify({ at: "translate", model, error: "echo" }));
      }
    } catch (err) {
      // No budget left for this room, its owner or the day: the next model would not get any either.
      if (err instanceof NoBudget) throw err;
      console.error(JSON.stringify({ at: "translate", model, error: String(err) }));
    }
  }
  // Both models kept the texts: that answer, rather than the small model text by text.
  return echo;
}

// Last resort, text by text: the small translation model. It needs to know the source language.
async function translateOne(env: TranslateEnv, text: string, from: string, to: string, shares: Share[]) {
  if (from === "auto") return text;
  try {
    const out = (await aiRun(env, "@cf/meta/m2m100-1.2b", { text, source_lang: M2M[from] ?? from, target_lang: M2M[to] ?? to }, { use: "translation", shares })) as { translated_text?: string };
    return out.translated_text?.trim() || text;
  } catch (err) {
    if (err instanceof NoBudget) throw err;
    // Quota reached or model unavailable: the original text is better than nothing.
    return text;
  }
}

// Plain characters only: models like non-breaking hyphens (missing from many brand fonts) and em dashes.
const plain = (text: string) => text.replace(/[\u2010\u2011]/g, "-").replace(/\s*\u2014\s*/g, ", ");

// `shares`: the room's and its owner's part of the AI budget (worker/room.ts), held before each model call.
// `report.refused`: set when the day's budget or a share kept texts from being translated (they come back as they were).
export async function translateTexts(env: TranslateEnv, texts: string[], from: string, to: string, kind: TranslateKind = "poll", shares: Share[] = [], report: { refused?: boolean } = {}): Promise<string[]> {
  if (from === to) return texts;
  return (await translateRaw(env, texts, from, to, kind, shares, report)).map((t, i) => (t === texts[i] ? t : plain(t)));
}

async function translateRaw(env: TranslateEnv, texts: string[], from: string, to: string, kind: TranslateKind, shares: Share[], report: { refused?: boolean }): Promise<string[]> {
  const ids = await Promise.all(texts.map((t) => cacheId(t, from, to, kind)));
  const out = [...texts];
  const missing: number[] = [];
  await Promise.all(
    texts.map(async (text, i) => {
      if (!text.trim()) return;
      // A cache read that fails only costs a new translation.
      const cached = await env.DB.prepare("SELECT text FROM translations WHERE id = ?").bind(ids[i]).first<{ text: string }>().catch(() => null);
      if (cached) out[i] = cached.text;
      else missing.push(i);
    }),
  );
  // Nothing new to translate, or the AI budget is spent: cached translations and the original text.
  if (!missing.length) return out;
  if (!(await aiAvailable(env, "translation"))) {
    report.refused = true;
    return out;
  }
  missing.sort((a, b) => a - b);
  // A poll is translated whole (its cached parts give the model context too); the interface in one batch.
  const set = kind === "poll" ? texts : missing.map((i) => texts[i]);
  const fresh = new Map<number, string>();
  let done: string[] | null = null;
  try {
    done = await translateSet(env, set, from, to, kind, shares);
    if (done) for (const i of missing) fresh.set(i, done[kind === "poll" ? i : missing.indexOf(i)]);
    else for (const i of missing) fresh.set(i, await translateOne(env, texts[i], from, to, shares));
  } catch (err) {
    // The room, its owner or the day has no AI budget left: cached translations and the original text, as past the quota.
    if (!(err instanceof NoBudget)) throw err;
    report.refused = true;
    return out;
  }
  const now = Date.now();
  // A single word the large model kept as is (a name, a word shared by both languages) is cached too, so it is not asked again;
  // a whole sentence returned unchanged is most likely a failed translation, and the small model's original on failure too: not cached.
  const writes = [...fresh].filter(([i, v]) => v && (v !== texts[i] || (done && !/\s/.test(texts[i].trim())))).map(([i, v]) => env.DB.prepare("INSERT OR IGNORE INTO translations (id, text, created_at) VALUES (?, ?, ?)").bind(ids[i], v, now));
  // The translation is still served if the cache write fails.
  if (writes.length) await env.DB.batch(writes).catch((err) => console.error(JSON.stringify({ at: "translate-cache", error: String(err) })));
  for (const [i, v] of fresh) out[i] = v || texts[i];
  return out;
}
