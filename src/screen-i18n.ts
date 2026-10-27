// The big screen (questions, its controls, the waiting screen, the leaderboard) speaks the presentation's language.
// English strings are their own keys. French comes from the app's dictionary, Spanish, German, Italian and Portuguese
// are written by hand (src/screen-translations.ts plus the phones' src/ui-translations.ts), the other languages are
// machine-translated by the server (/api/ui?set=screen), with English while they load or when the AI is unavailable.
import { useEffect, useState } from "react";
import { appStrings, type AppLang } from "./app-i18n";
import { LANG_CODES, RTL } from "./languages";
import { SCREEN_TRANSLATIONS } from "./screen-translations";
import { loadedUi, loadUi } from "./translate";
import { UI_TRANSLATIONS } from "./ui-translations";

// The presentation's language when it is one Hopvote offers; otherwise ("auto", missing, unknown) the presenter's app language.
export function screenLang(deckLang: string | null | undefined, app: AppLang): string {
  return deckLang && LANG_CODES.includes(deckLang) ? deckLang : app;
}

// Numbers on the screen: the usual regional forms for French and English, the language itself otherwise.
export const screenLocale = (lang: string) => (lang === "fr" ? "fr-FR" : lang === "en" ? "en-US" : lang);

// Written by hand: no request.
const writtenCache = new Map<string, Record<string, string>>();
function written(lang: string): Record<string, string> | null {
  if (lang === "en") return {};
  if (lang === "fr") return appStrings("fr");
  if (!SCREEN_TRANSLATIONS[lang]) return null;
  let map = writtenCache.get(lang);
  if (!map) writtenCache.set(lang, (map = { ...UI_TRANSLATIONS[lang], ...SCREEN_TRANSLATIONS[lang] }));
  return map;
}

// Arabic and Hebrew on a screen laid out left to right: each text is isolated as right to left (RLI ... PDI),
// so a sentence that mixes in a Latin word ("QR") keeps its reading order without changing the layout.
const isolated = new WeakMap<Record<string, string>, Record<string, string>>();
function isolate(map: Record<string, string>, lang: string) {
  if (!RTL.includes(lang)) return map;
  let out = isolated.get(map);
  if (!out) isolated.set(map, (out = Object.fromEntries(Object.entries(map).map(([k, v]) => [k, `\u2067${v}\u2069`]))));
  return out;
}

// The strings for `lang`, and whether they are the final ones: false while a machine translation is on its way
// (up to a short moment, after which English shows until it comes), so the screen can hold its labels back.
export function useScreenStrings(lang: string): [Record<string, string>, boolean] {
  const [loaded, setLoaded] = useState<{ lang: string; map: Record<string, string> } | null>(null);
  const [waited, setWaited] = useState("");
  const own = written(lang) ?? loadedUi(lang, "screen") ?? (loaded?.lang === lang ? loaded.map : null);
  useEffect(() => {
    if (written(lang)) return;
    let gone = false;
    const slow = setTimeout(() => !gone && setWaited(lang), 1500);
    loadUi(lang, "screen").then((map) => !gone && setLoaded({ lang, map }));
    return () => {
      gone = true;
      clearTimeout(slow);
    };
  }, [lang]);
  return [isolate(own ?? {}, lang), !!own || waited === lang];
}

// screenText(map, "{n} answers", { n: 3 }); a string with no translation stays in English.
export function screenText(map: Record<string, string>, text: string, vars?: Record<string, string | number>) {
  const found = map[text];
  // A machine translation that lost a {placeholder} would lose the number: English is better then.
  let out = found && (text.match(/\{\w+\}/g) ?? []).every((hole) => found.includes(hole)) ? found : text;
  if (vars) for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, String(v));
  return out;
}
