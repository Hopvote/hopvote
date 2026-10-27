// Example screens for the checks and the builder's pictures: the real big screen, or a real phone, for one kind of
// question, filled with example answers (src/demo-states.ts). Photographed by scripts/previews.mjs (optional).
// Optional flags draw other states of the same screen, for the checks (scripts/stage-check.mjs) and the reviews:
// empty=1 (no answers yet), single=1 (a one-question presentation), long=1 (a long question), image=1 (the question's
// picture), state=lobby or lobby=1 (the waiting screen), state=countin or countin=1 (3, 2, 1 before a timed question),
// qr=0 (the join card hidden), host=1 (the presenter's buttons), entries=N and spin=0 (the wheel),
// brand=<names> (example brands of src/brand-presets.ts, merged: brand=light,wideLogo,serif),
// on the waiting screen people=N (that many joined), names=1 (with first names), title=long (140 characters),
// board=podium|standings|list (the quiz leaderboard; tie=1 with equal scores), decor=halloween (the presentation's
// Halloween decor, src/decor.ts, drawn only until its end date like a real one), answered=N (a phone that picked
// option N, on a quiz shown with its right answer: the verdict); for topic rounds (/preview/screen/topics)
// topics=vote|open|long|host|last (src/demo-states.ts demoTopics).
import { useState } from "react";
import { setAppLang } from "../app-i18n";
import { saveLang } from "../translate";
import { demoState, demoTopics, demoVariant } from "../demo-states";
import { presetBrand } from "../brand-presets";
import type { BoardEntry, RoomState } from "../room";
import type { UiKind } from "../questions";
import { Present } from "./Present";
import { Vote } from "./Vote";

// Pictures show where every animation ends: a word already in its box, a bar already grown.
const STILL = "*, *::before, *::after { animation-delay: 0s !important; animation-duration: 0s !important; transition-delay: 0s !important; transition-duration: 0s !important; }";

// The longest title a presentation can have (140 characters, worker/index.ts).
const LONG_TITLE = {
  en: "Annual kickoff of the regional sales, marketing and partnership teams: results of the year, priorities and the plan for next year",
  fr: "Lancement annuel des équipes régionales ventes, marketing et partenariats : bilan de l'année, priorités et plan pour l'année qui vient",
};
const PLAYERS = ["Léa", "Hugo", "Inès", "Malik", "Sarah", "Paul", "Zoé", "Nina", "Yanis", "Chloé", "Lucas", "Jade"];

// The waiting screen with a crowd, and the quiz leaderboard, drawn from flags of the address.
// `right`: the right answer the big screen shows for this example.
function extras(state: RoomState, lang: "en" | "fr", params: URLSearchParams, right: number | null): RoomState {
  let s = state;
  const people = params.get("people");
  if (people !== null) {
    const n = Math.max(0, Math.min(5000, Number(people) || 0));
    const named = params.get("names") === "1";
    s = { ...s, online: n, names: named, people: named ? Array.from({ length: Math.min(n, 300) }, (_, i) => ({ name: `${PLAYERS[i % PLAYERS.length]}${i >= PLAYERS.length ? ` ${Math.floor(i / PLAYERS.length) + 1}` : ""}`, avatar: `b${(i * 5) % 24}` })) : [] };
  }
  if (params.get("title") === "long") s = { ...s, title: LONG_TITLE[lang] };
  if (params.get("decor") === "halloween") s = { ...s, decor: "halloween" };
  const picked = Number(params.get("answered") ?? NaN);
  if (Number.isInteger(picked) && picked >= 0) {
    try {
      // What src/pages/Vote.tsx remembers of this phone's answer to the question on screen.
      localStorage.setItem(`hopvote:vote:${CODE}:${s.round ? `${s.round}:` : ""}${s.index}`, JSON.stringify(picked));
    } catch {
      // The phone shows the question unanswered.
    }
    if (s.quiz) s = { ...s, revealed: true, correct: s.correct ?? right };
  }
  const board = params.get("board");
  if (board === "podium" || board === "standings" || board === "list") {
    const tie = params.get("tie") === "1";
    const scores = tie ? [2400, 2400, 1900, 1900, 1500, 1200, 900, 600] : [2650, 2210, 1980, 1640, 1420, 1100, 860, 540];
    const entries: BoardEntry[] = scores.map((score, i) => ({ name: PLAYERS[i], avatar: `b${(i * 5) % 24}`, score, tag: `p${i}`, gained: Math.round(score / 4), prev: [2, 1, 3, 5, 4, 6, 8, 7][i], rank: 0 }));
    for (const [i, e] of entries.entries()) e.rank = i > 0 && e.score === entries[i - 1].score ? entries[i - 1].rank : i + 1;
    s = { ...s, quiz: true, hasQuiz: true, hasBoard: true, board: entries, boardAt: null, boardFinal: board === "podium", boardMode: board === "list" ? "manual" : board === "podium" ? "end" : "each" };
  }
  return s;
}

// The code on every picture: HELLO, which no presentation can have ("L" and "O" never appear in generated codes), so a
// QR code scanned from a picture never opens someone's presentation.
const CODE = "HELLO";

export function PreviewPage({ view, kind }: { view: "screen" | "phone"; kind: UiKind }) {
  const params = new URLSearchParams(location.search);
  const lang = params.get("lang") === "fr" ? "fr" : "en";
  const on = (name: string) => params.get(name) === "1";
  const host = on("host");
  const brand = presetBrand(params.get("brand"));
  // Set before the screen and the phone read them: their language, and the phone's first name for the quizzes.
  const [state] = useState(() => {
    setAppLang(lang);
    saveLang(lang);
    try {
      localStorage.setItem("hopvote:name", JSON.stringify(lang === "fr" ? "Léa" : "Emma"));
    } catch {
      // The phone asks for a name instead.
    }
    const entries = params.get("entries");
    const flags = {
      empty: on("empty"),
      single: on("single"),
      long: on("long"),
      image: on("image"),
      lobby: on("lobby") || params.get("state") === "lobby",
      countin: on("countin") || params.get("state") === "countin",
      entries: entries === null ? undefined : Number(entries) || 0,
      spin: params.get("spin") === "0" ? false : undefined,
    };
    const base = demoTopics(demoState(kind, lang, view), lang, params.get("topics"));
    // spin=0 is a flag of its own (false means "no spin"); the other flags count when set.
    const any = Object.entries(flags).some(([k, v]) => (k === "spin" ? v === false : v !== undefined && v !== false));
    return extras(any ? demoVariant(base, lang, flags) : base, lang, params, demoState(kind, lang, "screen").correct);
  });
  return (
    <>
      <style>{STILL}</style>
      {view === "screen" ? <Present code={CODE} embed embedKey={host ? "demo" : undefined} demo={state} brand={brand ?? undefined} demoJoinHidden={params.get("qr") === "0"} /> : <Vote code={CODE} demo={state} />}
    </>
  );
}
