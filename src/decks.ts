import { useEffect, useState } from "react";
import { api } from "./api";
import { appLang, translate, type AppLang } from "./app-i18n";
import { PUBLIC_URL } from "./site-config";

// `by`: the teammate who made it (teams); missing for the person's own presentations.
// `sequence`: the kind of each question, `live`: phones connected right now, `current`: the question on screen,
// `shownAt`: last time on a presenter's screen, `answered`: answers per question (null when there is nothing to answer).
export type DeckRow = {
  code: string;
  title: string;
  questions: number;
  createdAt: number;
  votes: number;
  participants?: number;
  kinds?: string[];
  sequence?: string[];
  by?: string;
  live?: number;
  current?: number;
  editedAt?: number | null;
  shownAt?: number | null;
  answered?: (number | null)[];
};
export type Limits = { decks: number | null; questions: number; voters: number };
type Data = { polls: DeckRow[]; limits: Limits };

// The signed-in user's presentations, shared by every page of the app and refreshed on demand.
let cache: Data | null = null;
const listeners = new Set<(d: Data | null) => void>();
// The request on its way: pages that mount together (the sidebar and the page) share it.
let inflight: Promise<Data> | null = null;
let latest = 0;

// Always asks again (after a change, or for the live refresh). Only the newest answer is kept.
export function refreshDecks() {
  const n = ++latest;
  const request = api<Data>("/api/polls")
    .then((d) => {
      if (n === latest) {
        cache = d;
        listeners.forEach((l) => l(d));
      }
      return cache ?? d;
    })
    .finally(() => {
      if (inflight === request) inflight = null;
    });
  inflight = request;
  return request;
}

// The live refresh: asks again only for the presentations with phones connected, and updates those rows.
// A full refresh started meanwhile wins: this answer is dropped.
export function refreshLiveDecks() {
  const codes = cache?.polls.filter((d) => (d.live ?? 0) > 0).map((d) => d.code) ?? [];
  if (!cache || !codes.length) return Promise.resolve(cache);
  const n = latest;
  return api<Data>(`/api/polls?codes=${codes.join(",")}`).then((d) => {
    if (n !== latest || !cache) return cache;
    const fresh = new Map(d.polls.map((p) => [p.code, p]));
    cache = { polls: cache.polls.map((p) => fresh.get(p.code) ?? p), limits: d.limits };
    listeners.forEach((l) => l(cache));
    return cache;
  });
}

export function forgetDecks() {
  cache = null;
  inflight = null;
}

export function useDecks() {
  const [data, setData] = useState(cache);
  const [error, setError] = useState("");
  useEffect(() => {
    listeners.add(setData);
    (inflight ?? refreshDecks()).then(() => setError(""), (e) => setError(e instanceof Error ? e.message : "Couldn't load"));
    return () => void listeners.delete(setData);
  }, []);
  return { decks: data?.polls ?? null, limits: data?.limits ?? null, error };
}

// "{n} answers" in the app's language, from a singular and a plural key. French puts 0 in the singular ("0 réponse").
export function counted(lang: AppLang, n: number, one: string, many: string) {
  const single = lang === "fr" ? n < 2 : n === 1;
  return translate(lang, single ? one : many, { n: n.toLocaleString(lang === "fr" ? "fr-FR" : "en-US") });
}

export async function copyLink(code: string) {
  const link = `${PUBLIC_URL}/${code}`;
  try {
    await navigator.clipboard.writeText(link);
  } catch {
    prompt(translate(appLang(), "Presentation link"), link);
  }
}
