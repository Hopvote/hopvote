// The app (dashboard, builder, settings, sign-in, presenter screen) in English or French.
// English strings are their own keys; the French ones live in src/i18n/. A string with no French yet stays in English.
import { useEffect, useState } from "react";
import { FR_ACCOUNT } from "./i18n/fr-account";
import { FR_BUILDER } from "./i18n/fr-builder";
import { FR_DASHBOARD } from "./i18n/fr-dashboard";
import { FR_TYPES } from "./i18n/fr-types";
import { FR_SCREEN } from "./i18n/fr-screen";

export type AppLang = "en" | "fr";
const KEY = "hopvote:app-lang";
const FR: Record<string, string> = { ...FR_DASHBOARD, ...FR_BUILDER, ...FR_ACCOUNT, ...FR_TYPES, ...FR_SCREEN };

// The person's choice (Settings), else the browser's language.
function initial(): AppLang {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "en" || saved === "fr") return saved;
  } catch {
    // Storage blocked: the browser's language decides.
  }
  return typeof navigator !== "undefined" && (navigator.language || "en").toLowerCase().startsWith("fr") ? "fr" : "en";
}

let current: AppLang = initial();
const listeners = new Set<(lang: AppLang) => void>();
export const appLang = () => current;

// A page shown in another language than the app's (the big screen follows the presentation's language, a phone
// the language its question is shown in) says so here: app components drawn on it then leave <html lang> alone.
let pinned: string | null = null;
export function usePageLang(lang: string) {
  useEffect(() => {
    pinned = lang;
    document.documentElement.lang = lang;
    return () => {
      pinned = null;
      document.documentElement.lang = current;
    };
  }, [lang]);
}

export function setAppLang(lang: AppLang) {
  current = lang;
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    // Kept for this visit only.
  }
  document.documentElement.lang = pinned ?? lang;
  listeners.forEach((l) => l(lang));
}

// translate("fr", "{n} answers", { n: 3 }) gives "3 réponses".
export function translate(lang: AppLang, text: string, vars?: Record<string, string | number>) {
  let out = lang === "fr" ? (FR[text] ?? text) : text;
  if (vars) for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, String(v));
  return out;
}

export function useAppLang() {
  const [lang, set] = useState(current);
  useEffect(() => {
    listeners.add(set);
    return () => void listeners.delete(set);
  }, []);
  // App pages say which language they are in, so the browser does not offer to translate a French screen.
  useEffect(() => {
    document.documentElement.lang = pinned ?? lang;
  }, [lang]);
  return lang;
}

// In a component: const t = useAppT(); then t("Save") or t("{n} answers", { n }).
export function useAppT() {
  const lang = useAppLang();
  return (text: string, vars?: Record<string, string | number>) => translate(lang, text, vars);
}

// Every French string, for components that read their text from the phone's interface provider (answers.tsx).
export const appStrings = (lang: AppLang): Record<string, string> => (lang === "fr" ? FR : {});

// Dates in the app's language.
export const dateIn = (lang: AppLang) => new Intl.DateTimeFormat(lang === "fr" ? "fr-FR" : "en-US", { day: "numeric", month: "short", year: "numeric" });
