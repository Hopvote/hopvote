import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { RoomState } from "./room";
import { UI_FIXES, UI_TRANSLATIONS } from "./ui-translations";
import { LANG_ALIASES, LANGUAGE_LIST } from "./languages";
import { textVersion } from "./text-version";

// Languages offered to participants, each written in its own language.
export const LANGUAGES: [string, string][] = LANGUAGE_LIST.map(([code, native]) => [code, native]);

const KEY = "hopvote:lang";
// The phone interface is written in English.
const SOURCE = "en";

// The phone's own language, when Hopvote offers it.
function phoneLang() {
  const nav = (navigator.language || "en").split("-")[0].toLowerCase();
  const code = LANG_ALIASES[nav] ?? nav;
  return LANGUAGES.some(([c]) => c === code) ? code : null;
}

function savedLang() {
  try {
    const saved = localStorage.getItem(KEY);
    return saved && LANGUAGES.some(([c]) => c === saved) ? saved : null;
  } catch {
    return null;
  }
}

// The phone's language if we offer it, unless the person picked one before.
export function initialLang() {
  return savedLang() ?? phoneLang() ?? SOURCE;
}

// A phone in a language Hopvote does not offer starts on the original text, not an English translation:
// the person likely reads the presenter's language better than English.
export const startsOnOriginal = () => !savedLang() && !phoneLang();

export function saveLang(lang: string) {
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    // Only the preference is lost.
  }
}

// Machine translation sometimes drops a leading capital: keep the original's.
const sameCase = (original: string, translated: string) =>
  original && original[0] === original[0].toLocaleUpperCase() && original[0] !== original[0].toLocaleLowerCase() ? translated.charAt(0).toLocaleUpperCase() + translated.slice(1) : translated;

// `topic`: a topic round's question also brings its topic's name (src/rounds.ts).
type Texts = { title: string; question: string; options: string[]; labels: [string, string] | null; text?: string; v?: string; topic?: string };

// The next question's translation, asked while the current one is on screen, so it shows at once when the presenter moves on.
// Kept by room, language, question, fingerprint of its original texts and presentation language: an edit since makes it unused.
const early = new Map<string, Texts>();
const askingEarly = new Set<string>();
function askEarly(code: string, lang: string, index: number, from: string) {
  const id = `${code}|${lang}|${index}|${from}`;
  if (askingEarly.has(id)) return;
  askingEarly.add(id);
  // ahead=0: the room already prepares the next question; this request does not ask it to go one further.
  fetch(`/api/rooms/${code}/translate?lang=${lang}&i=${index}&ahead=0`)
    .then((r) => (r.ok ? (r.json() as Promise<Texts>) : null))
    .then((t) => {
      // No "v": the room sent the originals back (AI budget spent, failed translation), asked again when the question shows.
      if (!t?.v) return;
      // The oldest goes first; the one on screen is also kept in the hook's state.
      if (early.size >= 100) early.delete(early.keys().next().value!);
      early.set(`${code}|${lang}|${index}|${t.v}|${from}`, t);
    })
    .catch(() => {})
    .finally(() => askingEarly.delete(id));
}

// Returns the state with its text in `lang`, plus whether the translation is showing.
export function useTranslated(code: string, state: RoomState | null, lang: string, original: boolean) {
  // Each translation is kept with the request it answers: the previous question's never shows on the next one.
  const [got, setGot] = useState<{ for: string; texts: Texts | null } | null>(null);
  const index = state?.index ?? 0;
  // Any edit to the texts (options too) asks for a fresh translation, past the browser's one-minute cache.
  const version = state ? textVersion(state) : "";
  // The translation this screen needs, and the last one that came back (or failed): loading from the first render on,
  // so the phone never flashes the presentation's language before asking.
  const wanted = state && lang !== state.lang ? `${lang}|${index}|${version}|${state.lang}` : "";
  const [answered, setAnswered] = useState("");
  // Asked early while the previous question was on screen: no wait at all.
  const ready = wanted ? early.get(`${code}|${wanted}`) : undefined;
  const loading = !!wanted && answered !== wanted && !ready;
  const texts = ready ?? (got && got.for === wanted ? got.texts : null);
  // The request came back with nothing (an error, or the server could not translate): the phone says so.
  const failed = !!wanted && answered === wanted && !texts;

  useEffect(() => {
    if (!state || lang === state.lang) return;
    let gone = false;
    const asked = wanted;
    // Then the next question, once this one is here.
    const next = () => !gone && index + 1 < state.count && askEarly(code, lang, index + 1, state.lang);
    const hit = early.get(`${code}|${asked}`);
    if (hit) {
      // Kept in state too: it stays on screen even if the early map drops it meanwhile.
      setGot({ for: asked, texts: hit });
      setAnswered(asked);
      next();
      return;
    }
    fetch(`/api/rooms/${code}/translate?lang=${lang}&i=${index}&v=${version}`)
      .then((r) => (r.ok ? (r.json() as Promise<Texts>) : null))
      .then((t: Texts | null) => !gone && setGot({ for: asked, texts: t }))
      .catch(() => {})
      .finally(() => {
        if (gone) return;
        setAnswered(asked);
        next();
      });
    return () => {
      gone = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, lang, index, version, state?.lang]);

  if (!state || !texts || original || lang === state.lang) return { view: state, translated: false, loading, failed: failed && !original };
  // Already in the phone's language (the presentation's language was unknown), or the question came back as it was:
  // nothing to say. The deck title alone does not count, as the question screen does not show it.
  const body = texts.question === state.question && texts.options.every((o, i) => o === state.options[i]) && (texts.text ?? "") === (state.text ?? "");
  const empty = !state.question && !state.options.length && !state.text;
  const same = body && (!empty || texts.title === state.title);
  if (same) return { view: state, translated: false, loading, failed: false };
  const view: RoomState = {
    ...state,
    title: texts.title,
    question: texts.question,
    options: texts.options.length === state.options.length ? texts.options.map((o, i) => sameCase(state.options[i], o)) : state.options,
    labels: texts.labels ?? state.labels,
    // A slide's text; older servers don't send it.
    text: state.text && texts.text ? texts.text : state.text,
    // The topic of a topic round's question, for the phone's "Round 1 · History".
    ...(state.topics && state.topics.topic !== null && texts.topic
      ? { topics: { ...state.topics, list: state.topics.list.map((x, i) => (i === state.topics!.topic ? { ...x, label: texts.topic! } : x)) } }
      : {}),
  };
  return { view, translated: true, loading, failed: false };
}

// What the audience wrote in `lang`: Q&A questions and open answers by post id, or cloud words by word.
// Asked again as new answers arrive, one request at a time and at most once a second. `crowd`: every phone of the room
// runs this, so the gap grows with the room (3,000 phones ask every 30 s), keeping the whole room near 100 requests a second.
export function usePostTranslations(code: string, state: RoomState | null, lang: string, enabled: boolean, crowd = false) {
  const [map, setMap] = useState<Record<string, string>>({});
  const index = state?.index ?? 0;
  const kind = state?.kind === "words" ? "words" : "posts";
  // Nothing to ask while every phone reads this same language.
  const mixed = !state?.langs || state.langs.some((l) => l !== lang);
  // Sorted: an upvote or a vote that only changes the order asks nothing new.
  const ids =
    !enabled || !state || !mixed
      ? ""
      : state.kind === "words"
        ? state.words.map(([w]) => w).sort().join(",")
        : state.kind === "qa" || state.kind === "open"
          ? state.answers.map((a) => a.id).sort().join(",")
          : "";
  const scope = `${code}|${index}|${lang}|${kind}`;
  const gap = crowd ? Math.max(1000, (state?.online ?? 0) * 10) : 1000;
  const live = useRef({ scope, gap, busy: false, again: false, at: 0, timer: null as ReturnType<typeof setTimeout> | null });
  live.current.scope = scope;
  live.current.gap = gap;
  useEffect(() => setMap({}), [scope]);
  useEffect(() => {
    if (!ids) return;
    const load = () => {
      const l = live.current;
      // One request at a time; a change meanwhile is asked once it is done.
      if (l.busy || l.timer) {
        l.again = true;
        return;
      }
      const wait = l.at + l.gap - Date.now();
      if (wait > 0) {
        l.timer = setTimeout(() => {
          l.timer = null;
          load();
        }, wait);
        return;
      }
      // This request reads the room as it is now: changes made before it need no other one.
      l.busy = true;
      l.again = false;
      l.at = Date.now();
      const asked = l.scope;
      const [c, i, to, what] = asked.split("|");
      fetch(`/api/rooms/${c}/${what}?lang=${to}&i=${i}`)
        .then((r) => (r.ok ? (r.json() as Promise<Record<string, string>>) : {}))
        .then((m) => l.scope === asked && setMap(m))
        .catch(() => {})
        .finally(() => {
          l.busy = false;
          if (l.again) {
            l.again = false;
            load();
          }
        });
    };
    load();
  }, [scope, ids]);
  // No request left waiting once the page is gone.
  useEffect(() => () => {
    const l = live.current;
    if (l.timer) clearTimeout(l.timer);
  }, []);
  return enabled ? map : {};
}

// A cloud in one language: words that mean the same add up ("joie" and "joy" count together).
export function mergeWords(words: [string, number][], map: Record<string, string>): [string, number][] {
  const merged = new Map<string, number>();
  for (const [w, n] of words) merged.set(map[w] ?? w, (merged.get(map[w] ?? w) ?? 0) + n);
  return [...merged].sort((a, b) => b[1] - a[1]);
}

// Cloud words are stored trimmed and lowercase, without final punctuation: the same here to find one's own.
export const cloudWord = (w: string) => w.trim().replace(/\s+/g, " ").replace(/[.!?,;:]+$/, "").toLocaleLowerCase().slice(0, 25);

// The person's own answer in the presentation's language, shown under it on the phone.
// Nothing when the presentation's language is unknown or the answer is already in it.
export function useEcho(code: string, state: RoomState, kind: "posts" | "words", keys: string[]) {
  const [map, setMap] = useState<Record<string, string>>({});
  const to = state.lang;
  const joined = keys.join("\n");
  useEffect(() => {
    if (!joined || to === "auto") return;
    let gone = false;
    fetch(`/api/rooms/${code}/${kind}?lang=${to}&i=${state.index}`)
      .then((r) => (r.ok ? (r.json() as Promise<Record<string, string>>) : {}))
      .then((m) => !gone && setMap(m))
      .catch(() => {});
    return () => {
      gone = true;
    };
  }, [code, to, state.index, kind, joined]);
  return keys.map((k) => map[k]).filter((t): t is string => !!t);
}

// The posts with their translation in place of the text, the original kept for a tooltip.
export const withTranslations = <T extends { id: string; text: string }>(posts: T[], map: Record<string, string>) =>
  posts.map((a) => (map[a.id] ? { ...a, text: map[a.id], original: a.text } : a));

// Interface text for the participant's language; English strings are their own keys.
const UiContext = createContext<Record<string, string>>({});
export const UiProvider = UiContext.Provider;
export function useT() {
  const map = useContext(UiContext);
  return (en: string) => map[en] ?? en;
}

// Machine-translated interface text, asked once per language and list while the page is open.
// "phone": the participant's screens; "screen": the big screen (it also shows the shared result views, so it holds both).
const uiLoads = new Map<string, Promise<Record<string, string>>>();
const uiLoaded = new Map<string, Record<string, string>>();
export function loadUi(lang: string, set: "phone" | "screen" = "phone") {
  const id = `${set}:${lang}`;
  let load = uiLoads.get(id);
  if (!load) {
    load = fetch(`/api/ui?lang=${lang}${set === "screen" ? "&set=screen" : ""}`)
      .then((r) => (r.ok ? (r.json() as Promise<Record<string, string>>) : {}))
      .catch(() => ({}));
    // A few machine translations read wrong in context: hand-written ones replace them.
    load = load.then((m) => (Object.keys(m).length ? { ...m, ...UI_FIXES[lang] } : m));
    // A failed answer is asked again next time, not kept.
    load.then((m) => (Object.keys(m).length ? uiLoaded.set(id, m) : uiLoads.delete(id)));
    uiLoads.set(id, load);
  }
  return load;
}
export const loadedUi = (lang: string, set: "phone" | "screen" = "phone") => uiLoaded.get(`${set}:${lang}`);

export function useUiStrings(lang: string) {
  const [map, setMap] = useState<Record<string, string>>(() => UI_TRANSLATIONS[lang] ?? loadedUi(lang) ?? {});
  useEffect(() => {
    // Hand-written languages need no request.
    setMap(UI_TRANSLATIONS[lang] ?? loadedUi(lang) ?? {});
    if (lang === SOURCE || UI_TRANSLATIONS[lang]) return;
    let gone = false;
    loadUi(lang).then((m) => !gone && setMap(m));
    return () => {
      gone = true;
    };
  }, [lang]);
  return map;
}
