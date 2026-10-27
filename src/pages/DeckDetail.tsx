import { Fragment, useEffect, useState } from "react";
import QRCode from "qrcode";
import { ArrowLeft, Check, ChevronDown, Copy, Download, KeyRound, Link2, Lock, MonitorPlay, Pencil, RotateCcw, Share2, Trash2, Users, X } from "lucide-react";
import { api, useUser } from "../api";
import { appStrings, dateIn, useAppLang, useAppT } from "../app-i18n";
import { copyLink, counted, refreshDecks } from "../decks";
import { UiProvider } from "../translate";
import { navigate } from "../router";
import { Link } from "../ui";
import type { Brand } from "../brand";
import { PHONE } from "../phone";
import { AppShell } from "./AppShell";
import { markResultsSeen } from "./HomeBlocks";
import { ChoiceResults, NumberResults, OpenWall, OrderResults, QaList, RankResults, ScaleResults, ScalesResults, WordCloud, average } from "../answers";
import { saveHostKey, type BoardEntry } from "../room";
import { PhoneBoard } from "../podium";
import { kindLabel, type Stored } from "../questions";
import { FillResults, MatchResults, PointsResults, SpotImage } from "../kind-views";
import { parseFill, wordBank } from "../fill";
import { inZone } from "../kinds";
import { mediaOf } from "../media";
import type { Category } from "../templates";
import { ShareForm } from "./Community";
import { PUBLIC_URL, SITE_HOST } from "../site-config";

type Result = Stored & {
  type: "choice" | "scale" | "words" | "open" | "rank" | "qa" | "contact" | "scales" | "number" | "slide" | "link" | "points" | "fill" | "match" | "spot" | "wheel" | "countdown" | "media";
  contacts?: { name?: string; email?: string; phone?: string; company?: string; at: number }[];
  counts: number[];
  words: Record<string, number>;
  answers: { text: string; at: number; votes: number; done: boolean }[];
  answered: number;
  // Number questions: every answer. Rankings with a right order: who found it and each item's place.
  numbers?: number[];
  order?: { right: number; placed: number[] } | null;
  // Spots tapped on an image, the answers typed in each blank, and who the wheel picked.
  spots?: [number, number][];
  fillTop?: [string, number][][];
  picked?: string[];
};

// Spots one per person, grouped like on the big screen (cells of 1% of the image).
function grouped(spots: [number, number][]) {
  const cells = new Map<number, number>();
  for (const [x, y] of spots) {
    const cell = Math.min(99, Math.floor(x / 10)) * 100 + Math.min(99, Math.floor(y / 10));
    cells.set(cell, (cells.get(cell) ?? 0) + 1);
  }
  return [...cells].flatMap(([cell, n]) => [Math.floor(cell / 100) * 10 + 5, (cell % 100) * 10 + 5, n]);
}
type Shared = { id: string; category: Category; description: string; uses: number };
// Topic rounds as played (worker/room.ts results): each topic and its questions, the rounds played in order (how the topic
// was chosen, the vote that chose it, the best players of the round), and the topics never played.
type Ballot = { counts: number[]; n: number; tie: boolean; empty: boolean };
type Played = { topic: number; how: "wheel" | "vote" | "host" | "last"; votes: Ballot | null; best?: { score: number; names: string[] } | null };
type RoundsResult = { how: "wheel" | "vote"; topics: { label: string; indices: number[] }[]; rounds: number; played: Played[]; notPlayed: number[] };
type Detail = {
  code: string;
  title: string;
  createdAt: number;
  participants: number;
  questions: Result[];
  leaderboard: BoardEntry[];
  shared: Shared | null;
  // False for a teammate's presentation (only its author shares it in Community).
  mine?: boolean;
  names?: boolean;
  lang?: string;
  brand?: Brand | null;
  // The launch animation and the quiz leaderboard setting (null: saved before it, the Leaderboard button only).
  intro?: boolean;
  boardMode?: "each" | "round" | "end" | "off" | null;
  rounds?: RoundsResult;
};

// A ranking needs first names: anonymous presentations and those with the leaderboard off never show one, as on the live screens.
const showsBoard = (d: Detail) => d.leaderboard.length > 0 && !!d.names && d.boardMode !== "off";

// Excel runs a cell that starts with = + - @ as a formula: a leading quote keeps it as text.
// Phone numbers (+33 6 12 34 56 78) hold only digits and separators, so they stay as typed.
const cell = (c: string) => `"${(/^[=+\-@\t\r]/.test(c) && !PHONE.test(c) ? `'${c}` : c).replace(/"/g, '""')}"`;
// Excel splits columns on the computer's list separator: a semicolon where decimals are written with a comma.
const SEPARATOR = (1.5).toLocaleString().includes(",") ? ";" : ",";
function downloadCsv(rows: string[][], name: string) {
  const csv = rows.map((r) => r.map(cell).join(SEPARATOR)).join("\n");
  const url = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  URL.revokeObjectURL(url);
}

// Shares a copy of the questions in Community. Answers and images stay private.
function ShareTemplate({ code, shared, onChange }: { code: string; shared: Shared | null; onChange: (s: Shared | null) => void }) {
  const lang = useAppLang();
  const t = useAppT();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function stop() {
    if (!shared) return;
    setBusy(true);
    try {
      await api(`/api/templates/${shared.id}`, { method: "DELETE" });
      onChange(null);
    } catch {
      // Still shared: the button stays for another try.
    }
    setBusy(false);
  }

  return (
    <section className="panel actions-panel">
      <h2>{t("Community")}</h2>
      {open ? (
        <>
          <ShareForm code={code} current={shared} onDone={(s) => { onChange(s); setOpen(false); }} />
          <button type="button" className="ghost small" onClick={() => setOpen(false)}>{t("Cancel")}</button>
        </>
      ) : shared ? (
        <>
          <p className="muted side-hint"><Check size={14} /> {t("Shared in {category}", { category: t(shared.category) })} · {counted(lang, shared.uses, "{n} use", "{n} uses")}</p>
          <Link to="/app/community" className="ghost button with-icon full"><Users size={18} /> {t("See it in Community")}</Link>
          <button className="ghost with-icon full" onClick={() => setOpen(true)}><Pencil size={18} /> {t("Update")}</button>
          <button className="ghost with-icon full" onClick={stop} disabled={busy}><X size={18} /> {t("Stop sharing")}</button>
        </>
      ) : (
        <>
          <p className="muted side-hint">{t("Let others reuse your questions. Answers and images stay private.")}</p>
          <button className="ghost with-icon full" onClick={() => setOpen(true)}><Share2 size={18} /> {t("Share to Community")}</button>
        </>
      )}
    </section>
  );
}

const FIELD_NAMES: Record<string, string> = { name: "Name", email: "Email", phone: "Phone", company: "Company" };

// Contact details left by participants: private to the owner, with a copy-all for emails.
function ContactTable({ contacts, fields, onExport }: { contacts: NonNullable<Result["contacts"]>; fields: string[]; onExport?: () => void }) {
  const t = useAppT();
  const [copied, setCopied] = useState(false);
  if (!contacts.length) return <p className="muted">{t("Nobody has left their details yet.")}</p>;
  const emails = contacts.map((c) => c.email).filter(Boolean).join(", ");
  return (
    <div className="contact-table">
      <div className="contact-tools">
        <span className="muted"><Lock size={14} /> {t("Only visible to you")}</span>
        {emails && (
          <button className="ghost small" onClick={() => navigator.clipboard.writeText(emails).then(() => (setCopied(true), setTimeout(() => setCopied(false), 1500)))}>
            {copied ? t("Emails copied") : t("Copy emails")}
          </button>
        )}
        {onExport && (
          <button className="ghost small" onClick={onExport}>
            {t("Download CSV")}
          </button>
        )}
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>{fields.map((f) => <th key={f}>{t(FIELD_NAMES[f])}</th>)}</tr>
          </thead>
          <tbody>
            {contacts.map((c, i) => (
              <tr key={i}>{fields.map((f) => <td key={f}>{(c as Record<string, string | number | undefined>)[f] ?? ""}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// How a round's topic was chosen, as the results say it.
function howText(lang: ReturnType<typeof useAppLang>, t: ReturnType<typeof useAppT>, p: Played) {
  if (p.how === "wheel") return t("Wheel");
  if (p.how === "last") return t("Last topic left");
  if (p.how === "host") return t("Chosen by the presenter");
  if (!p.votes || p.votes.empty) return t("No votes, drawn");
  const votes = counted(lang, p.votes.n, "Room vote, {n} vote", "Room vote, {n} votes");
  return p.votes.tie ? `${votes} · ${t("tie drawn")}` : votes;
}

// Topic rounds: the questions before the rounds, the rounds played (how each topic was chosen, the vote behind it, the best
// players of each round), each round's questions in the order played, the questions after, then the topics never played, folded.
function RoundsResults({ deck, card, board }: { deck: Detail & { rounds: RoundsResult }; card: (q: Result, qi: number) => React.ReactNode; board: boolean }) {
  const t = useAppT();
  const lang = useAppLang();
  const r = deck.rounds;
  const picker = deck.questions.findIndex((q) => q.topics);
  const label = (i: number) => r.topics[i]?.label ?? "";
  const inTopic = new Set(r.topics.flatMap((x) => x.indices));
  const all = deck.questions.map((_, i) => i);
  const before = all.filter((i) => i < picker);
  const after = all.filter((i) => i > picker && !inTopic.has(i));
  const pq = deck.questions[picker];
  const best = board ? r.played.filter((p) => p.best) : [];
  const locale = lang === "fr" ? "fr-FR" : "en-US";
  return (
    <>
      {before.map((i) => card(deck.questions[i], i))}
      {pq && (
        <section className="panel result rounds-result">
          <div className="result-head">
            <span className="question-n">{t("Question {n} · {kind}", { n: picker + 1, kind: t("Topic rounds") })}</span>
            <span className="muted">{t("Rounds played: {n} of {m}", { n: r.played.length, m: r.rounds })}</span>
          </div>
          <h2>{pq.question}</h2>
          {r.played.length ? (
            <ol className="rounds-played">
              {r.played.map((p, k) => {
                // The vote as the room saw it: the topics still to play at that round.
                const open = r.topics.map((_, i) => i).filter((i) => !r.played.slice(0, k).some((x) => x.topic === i));
                return (
                  <li key={k}>
                    <div className="rounds-line">
                      <span className="rounds-k">{k + 1}</span>
                      <strong className="truncate">{label(p.topic)}</strong>
                      <span className="muted">{howText(lang, t, p)}</span>
                    </div>
                    {p.votes && p.votes.n > 0 && (
                      <ChoiceResults options={open.map(label)} counts={open.map((i) => p.votes!.counts[i] ?? 0)} chosen={open.indexOf(p.topic)} />
                    )}
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="muted">{t("No round played yet.")}</p>
          )}
          {r.notPlayed.length > 0 && <p className="muted rounds-not">{t(r.notPlayed.length === 1 ? "Not played: {topics}" : "Topics not played: {topics}", { topics: r.notPlayed.map(label).join(", ") })}</p>}
          {best.length > 0 && (
            <>
              <h3 className="rounds-sub">{t("Best per round")}</h3>
              <div className="table-scroll">
                <table className="rounds-best">
                  <thead>
                    <tr><th>{t("Topic")}</th><th>{t("Best")}</th><th>{t("Points")}</th></tr>
                  </thead>
                  <tbody>
                    {best.map((p) => (
                      <tr key={p.topic}>
                        <td>{r.played.indexOf(p) + 1}. {label(p.topic)}</td>
                        <td>{p.best!.names.join(", ")}</td>
                        <td>{p.best!.score.toLocaleString(locale)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      )}
      {r.played.map((p, k) => (
        <Fragment key={`r${k}`}>
          <p className="result-sep"><span className="truncate">{t("Round {n} · {topic}", { n: k + 1, topic: label(p.topic) })}</span></p>
          {r.topics[p.topic]?.indices.map((i) => card(deck.questions[i], i))}
        </Fragment>
      ))}
      {after.length > 0 && r.played.length > 0 && <p className="result-sep"><span>{t("After the rounds")}</span></p>}
      {after.map((i) => card(deck.questions[i], i))}
      {r.notPlayed.map((ti) => (
        <details key={`u${ti}`} className="panel rounds-unplayed">
          <summary>
            <ChevronDown size={18} aria-hidden />
            <strong className="truncate">{label(ti)}</strong>
            <span className="muted">{t("Not played")} · {counted(lang, r.topics[ti].indices.length, "{n} question", "{n} questions")}</span>
          </summary>
          <div className="rounds-unplayed-body">{r.topics[ti].indices.map((i) => card(deck.questions[i], i))}</div>
        </details>
      ))}
    </>
  );
}

// A presentation's page: every question's results, sharing tools and actions.
export function DeckDetail({ code }: { code: string }) {
  // The home page's first steps tick "Look at the results" once this page has been opened.
  useEffect(markResultsSeen, []);
  const lang = useAppLang();
  const t = useAppT();
  const user = useUser();
  const [deck, setDeck] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [qr, setQr] = useState("");
  const [copied, setCopied] = useState(false);
  const [confirm, setConfirm] = useState<"delete" | "reset" | "keys" | null>(null);
  const [rekeyed, setRekeyed] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = () => api<Detail>(`/api/polls/${code}`).then(setDeck, (e) => setError(e.message));

  useEffect(() => {
    if (!user) return;
    load();
    QRCode.toString(`${PUBLIC_URL}/${code}`, { type: "svg", margin: 0, color: { dark: "#2a2a40", light: "#00000000" } }).then(setQr);
    // Results keep up while a session runs in another tab, only while this page is in view: every 10 seconds while
    // answers come in, every 30 once quiet, and no more after 10 quiet minutes, so a tab left open does not keep
    // the room awake all day. Coming back to the tab starts again; an error (deleted, signed out) stops it.
    let timer: ReturnType<typeof setTimeout> | undefined;
    let last = "";
    let quietSince = Date.now();
    let failed = false;
    const next = () => {
      const quiet = Date.now() - quietSince;
      if (!failed && quiet < 600_000) timer = setTimeout(tick, quiet < 60_000 ? 10_000 : 30_000);
    };
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      api<Detail>(`/api/polls/${code}`).then(
        (fresh) => {
          const seen = JSON.stringify(fresh);
          if (seen !== last) quietSince = Date.now();
          last = seen;
          setDeck(fresh);
          next();
        },
        () => void (failed = true),
      );
    };
    const back = () => {
      if (document.visibilityState !== "visible" || failed) return;
      clearTimeout(timer);
      quietSince = Date.now();
      tick();
    };
    next();
    document.addEventListener("visibilitychange", back);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", back);
    };
  }, [user, code]);

  async function duplicate() {
    if (!deck) return;
    setBusy(true);
    try {
      const made = await api<{ code: string }>("/api/rooms", {
        body: {
          title: t("Copy of {title}", { title: deck.title }).slice(0, 140),
          names: deck.names,
          intro: deck.intro,
          ...(deck.boardMode ? { boardMode: deck.boardMode } : {}),
          lang: deck.lang,
          brand: deck.brand ?? undefined,
          questions: deck.questions.map(({ type, question, options, image, correct, multi, timer, max, labels, fields, style, text, url, answer, ordered, fill, fillMode, decoys, zone, duration, topics, rounds, topic }) => ({ type, question, options, image, correct, multi, timer, max, labels, fields, style, text, url, answer, ordered, fill, fillMode, decoys, zone, duration, topics, rounds, topic })),
        },
      });
      await refreshDecks();
      navigate(`/app/p/${made.code}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Couldn't duplicate"));
    } finally {
      setBusy(false);
    }
  }

  // Same questions, same code: clears the answers for the next session.
  async function reset() {
    setBusy(true);
    try {
      await api(`/api/polls/${code}/reset`, { method: "POST" });
      setConfirm(null);
      await load();
      refreshDecks().catch(() => {});
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Couldn't reset"));
    } finally {
      setBusy(false);
    }
  }

  // New presenter and slide keys: a screen, slide or tool given the old ones stops presenting.
  async function newKeys() {
    setBusy(true);
    try {
      const { hostKey } = await api<{ hostKey: string }>(`/api/polls/${code}/keys`, { method: "POST" });
      saveHostKey(code, hostKey);
      setConfirm(null);
      setRekeyed(true);
      setTimeout(() => setRekeyed(false), 1800);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("No connection"));
    }
    setBusy(false);
  }

  async function remove() {
    try {
      await api(`/api/polls/${code}`, { method: "DELETE" });
      await refreshDecks();
      navigate("/app/presentations");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Couldn't delete"));
    }
  }

  function exportCsv() {
    if (!deck) return;
    const rows = [[t("Question"), t("Type"), t("Answer"), t("Count"), t("Percent")]];
    const pct = (n: number, total: number) => (total ? `${Math.round((n / total) * 100)}%` : "0%");
    // Topic rounds: a Topic column after the question (each topic's questions name it), and a line per round.
    const r = deck.rounds;
    const topicOf = (qi: number) => (r ? (r.topics.find((x) => x.indices.includes(qi))?.label ?? "") : "");
    const owner: number[] = [];
    for (const [qi, q] of deck.questions.entries()) {
      owner[rows.length] = qi;
      const type = t(kindLabel(q));
      if (q.type === "words") {
        for (const [w, n] of Object.entries(q.words).sort((a, b) => b[1] - a[1])) rows.push([q.question, type, w, String(n), pct(n, q.answered)]);
      } else if (q.type === "open") {
        for (const a of q.answers) rows.push([q.question, type, a.text, "1", ""]);
      } else if (q.type === "contact") {
        for (const c of q.contacts ?? []) rows.push([q.question, type, [c.name, c.email, c.phone, c.company].filter(Boolean).join(" · "), "", ""]);
      } else if (q.type === "qa") {
        for (const a of [...q.answers].sort((x, y) => y.votes - x.votes)) rows.push([q.question, type, a.text, String(a.votes), a.done ? t("answered") : ""]);
      } else if (q.type === "rank" && q.ordered) {
        const result = q.order ?? { right: 0, placed: [] };
        rows.push([q.question, type, t("found the right order"), String(result.right), pct(result.right, q.answered)]);
        q.options.forEach((o, i) => rows.push([q.question, type, `${i + 1}. ${o}`, String(result.placed[i] ?? 0), pct(result.placed[i] ?? 0, q.answered)]));
      } else if (q.type === "rank") {
        const order = q.options.map((o, i) => [o, q.counts[i] ?? 0] as const).sort((a, b) => b[1] - a[1]);
        order.forEach(([o, score], pos) => rows.push([q.question, type, `${pos + 1}. ${o}`, String(score), ""]));
      } else if (q.type === "scales") {
        const max = q.max ?? 5;
        q.options.forEach((o, i) => {
          const row = Array.from({ length: max }, (_, v) => q.counts[i * max + v] ?? 0);
          rows.push([q.question, type, o, String(row.reduce((a, b) => a + b, 0)), average(row).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })]);
        });
      } else if (q.type === "number") {
        if (typeof q.answer === "number") rows.push([q.question, type, `${t("Right answer:")} ${q.answer}`, "", ""]);
        for (const n of q.numbers ?? []) rows.push([q.question, type, String(n), "1", ""]);
      } else if (q.type === "link" || q.type === "media") {
        rows.push([q.question, type, q.url ?? "", q.type === "link" ? String(q.answered) : "", ""]);
      } else if (q.type === "slide" || q.type === "countdown") {
        continue;
      } else if (q.type === "points") {
        q.options.forEach((o, i) => rows.push([q.question, type, o, String(q.counts[i] ?? 0), q.answered ? (Math.round(((q.counts[i] ?? 0) / q.answered) * 10) / 10).toLocaleString() : "0"]));
      } else if (q.type === "fill") {
        const result = q.order ?? { right: 0, placed: [] };
        rows.push([q.question, type, t("filled every blank"), String(result.right), pct(result.right, q.answered)]);
        parseFill(q.fill ?? "").answers.forEach((accepted, i) => {
          rows.push([q.question, type, `${i + 1}. ${accepted.join(" / ")}`, String(result.placed[i] ?? 0), pct(result.placed[i] ?? 0, q.answered)]);
          for (const [word, n] of q.fillTop?.[i] ?? []) rows.push([q.question, type, `${i + 1}. ${word}`, String(n), pct(n, q.answered)]);
        });
      } else if (q.type === "match") {
        const result = q.order ?? { right: 0, placed: [] };
        const half = q.options.length / 2;
        rows.push([q.question, type, t("matched every pair"), String(result.right), pct(result.right, q.answered)]);
        q.options.slice(0, half).forEach((o, i) => rows.push([q.question, type, `${o} ↔ ${q.options[half + i]}`, String(result.placed[i] ?? 0), pct(result.placed[i] ?? 0, q.answered)]));
      } else if (q.type === "spot") {
        const zone = q.zone;
        if (zone) {
          const found = (q.spots ?? []).filter(([x, y]) => inZone(x, y, zone)).length;
          rows.push([q.question, type, t("found the right spot"), String(found), pct(found, q.answered)]);
        }
        // Each spot in percent of the image, from its top left corner.
        for (const [x, y] of q.spots ?? []) rows.push([q.question, type, `x ${x / 10}% · y ${y / 10}%`, "1", ""]);
      } else if (q.type === "wheel") {
        (q.picked ?? []).forEach((name, i) => rows.push([q.question, type, `${i + 1}. ${name}`, "", ""]));
      } else {
        const total = q.multi ? q.answered : q.counts.reduce((a, b) => a + b, 0);
        const labels = q.type === "scale" ? q.counts.map((_, i) => String(i + 1)) : q.options;
        labels.forEach((o, i) => rows.push([q.question, type, o + (q.correct === i ? ` ${t("(right answer)")}` : ""), String(q.counts[i]), pct(q.counts[i], total)]));
        if (q.type === "scale") rows.push([q.question, type, t("Average"), average(q.counts).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }), ""]);
      }
    }
    // Anonymous or with the leaderboard off, the results keep the answers but no ranking.
    const questionRows = rows.length;
    if (showsBoard(deck)) deck.leaderboard.forEach((e, i) => rows.push([t("Quiz leaderboard"), t("Quiz"), `${e.rank ?? i + 1}. ${e.name}`, String(e.score), ""]));
    if (r) {
      const picker = deck.questions.find((q) => q.topics)?.question ?? t("Topic rounds");
      const kind = t("Topic rounds");
      r.played.forEach((p, k) => {
        rows.push([picker, kind, `${t("Round {n} · {topic}", { n: k + 1, topic: r.topics[p.topic]?.label ?? "" })} (${howText(lang, t, p)})`, p.votes && p.votes.n > 0 ? String(p.votes.n) : "", ""]);
        if (showsBoard(deck) && p.best) rows.push([picker, kind, t("Best: {names}", { names: p.best.names.join(", ") }), String(p.best.score), ""]);
      });
      for (const ti of r.notPlayed) rows.push([picker, kind, t("Not played: {topics}", { topics: r.topics[ti]?.label ?? "" }), "", ""]);
      // The Topic column: each row of a topic's question names its topic.
      let qi = -1;
      rows.forEach((row, i) => {
        if (i === 0) return void row.splice(1, 0, t("Topic"));
        if (owner[i] !== undefined) qi = owner[i];
        row.splice(1, 0, i < questionRows ? topicOf(qi) : "");
      });
    }
    downloadCsv(rows, `hopvote-${code}.csv`);
  }

  // One column per detail, ready to import into a contact list.
  function exportContacts(q: Result) {
    const rows = [[t("Name"), t("Email"), t("Phone"), t("Company"), t("Date")]];
    for (const c of q.contacts ?? []) rows.push([c.name ?? "", c.email ?? "", c.phone ?? "", c.company ?? "", new Date(c.at).toLocaleString()]);
    downloadCsv(rows, `hopvote-${code}-contacts.csv`);
  }

  // One question's results.
  const card = (q: Result, qi: number) => (
              <section key={qi} className="panel result">
                <div className="result-head">
                  <span className="question-n">{t("Question {n} · {kind}", { n: qi + 1, kind: t(kindLabel(q)) })}</span>
                  {!["slide", "wheel", "countdown", "media"].includes(q.type) && <span className="muted">{counted(lang, q.answered, "{n} answer", "{n} answers")}</span>}
                </div>
                <h2>{q.question}</h2>
                {q.image && q.type !== "spot" && <img className="result-image" src={q.image} alt="" />}
                {q.type === "choice" && <ChoiceResults options={q.options} counts={q.counts} correct={q.correct} voters={q.multi ? q.answered : undefined} />}
                {q.type === "contact" && <ContactTable contacts={q.contacts ?? []} fields={q.fields ?? ["email"]} onExport={() => exportContacts(q)} />}
                {q.type === "rank" && (q.ordered ? <OrderResults options={q.options} result={q.order ?? null} voters={q.answered} locale={lang === "fr" ? "fr-FR" : "en-US"} /> : <RankResults options={q.options} counts={q.counts} voters={q.answered} />)}
                {q.type === "scales" && <ScalesResults options={q.options} counts={q.counts} max={q.max ?? 5} labels={q.labels ?? null} locale={lang === "fr" ? "fr-FR" : "en-US"} />}
                {q.type === "number" && <NumberResults numbers={q.numbers ?? []} answer={typeof q.answer === "number" ? q.answer : null} locale={lang === "fr" ? "fr-FR" : "en-US"} />}
                {q.type === "slide" && (q.text ? <p className="slide-text">{q.text}</p> : <p className="muted">{t("Nothing to answer on a slide.")}</p>)}
                {q.type === "link" && q.url && (
                  <p className="result-link">
                    <a href={/^https?:\/\//i.test(q.url) ? q.url : undefined} target="_blank" rel="noopener noreferrer">{q.url}</a>
                    <span className="muted">{t("Opened by {n}", { n: q.answered })}</span>
                  </p>
                )}
                {q.type === "qa" && (
                  <QaList items={q.answers.map((a, i) => ({ id: String(i), ...a })).sort((a, b) => b.votes - a.votes)} empty={t("No questions yet.")} />
                )}
                {q.type === "scale" && <ScaleResults counts={q.counts} max={q.max ?? 5} labels={q.labels ?? null} locale={lang === "fr" ? "fr-FR" : "en-US"} style={q.style} />}
                {q.type === "points" && <PointsResults options={q.options} counts={q.counts} voters={q.answered} locale={lang === "fr" ? "fr-FR" : "en-US"} />}
                {q.type === "fill" && (
                  <FillResults
                    gaps={parseFill(q.fill ?? "").pieces}
                    blanks={parseFill(q.fill ?? "").answers}
                    bank={q.fillMode === "words" ? wordBank(parseFill(q.fill ?? "").answers, q.decoys ?? [], q.fill ?? "") : []}
                    result={q.order ?? null}
                    top={q.fillTop ?? []}
                    voters={q.answered}
                    locale={lang === "fr" ? "fr-FR" : "en-US"}
                  />
                )}
                {q.type === "match" && <MatchResults options={q.options} result={q.order ?? null} voters={q.answered} locale={lang === "fr" ? "fr-FR" : "en-US"} />}
                {q.type === "spot" && q.image && (
                  <div className="spot-result">
                    <SpotImage image={q.image} spots={grouped(q.spots ?? [])} zone={q.zone ?? null} />
                    {q.zone && (
                      <p className="muted">
                        {t("{n}% found the right spot", { n: q.answered ? Math.round(((q.spots ?? []).filter(([x, y]) => inZone(x, y, q.zone!)).length / q.answered) * 100) : 0 })}
                      </p>
                    )}
                  </div>
                )}
                {q.type === "wheel" &&
                  (q.picked?.length ? (
                    <>
                      <p className="muted">{t("Picked by the wheel, in order")}</p>
                      <ol className="wheel-history">{q.picked.map((name, i) => <li key={i}>{name}</li>)}</ol>
                    </>
                  ) : (
                    <p className="muted">{q.options.length ? t("The wheel holds {n} entries.", { n: q.options.length }) : t("The wheel spins among the first names of the people connected.")}</p>
                  ))}
                {q.type === "countdown" && <p className="muted">{t("A timer of {time}.", { time: `${Math.floor((q.duration ?? 300) / 60)}:${String((q.duration ?? 300) % 60).padStart(2, "0")}` })}</p>}
                {q.type === "media" && q.url && (
                  <p className="result-link">
                    <a href={/^https?:\/\//i.test(q.url) ? q.url : undefined} target="_blank" rel="noopener noreferrer">{q.url}</a>
                    <span className="muted">{t(mediaOf(q.url)?.label ?? "")}</span>
                  </p>
                )}
                {q.type === "words" && <WordCloud words={Object.entries(q.words).sort((a, b) => b[1] - a[1])} empty={t("No words yet.")} />}
                {q.type === "open" && (
                  <OpenWall answers={q.answers.map((a, i) => ({ id: String(i), ...a })).reverse()} empty={t("No answers yet.")} />
                )}
              </section>
  );

  const totalAnswers = deck?.questions.reduce((a, q) => a + q.answered, 0) ?? 0;

  return (
    <AppShell
      title={deck?.title ?? t("Presentation")}
      subtitle={deck ? t("Code {code} · created {date}", { code: deck.code, date: dateIn(lang).format(deck.createdAt) }) : undefined}
      action={
        <div className="detail-actions">
          {/* Icon only on phones, so a long title keeps its words whole. */}
          <Link to={`/app/p/${code}/edit`} className="ghost button with-icon">
            <Pencil size={18} role="img" aria-label={t("Edit")} /><span className="only-wide" aria-hidden>{t("Edit")}</span>
          </Link>
          <Link to={`/present/${code}`} className="primary button with-icon">
            <MonitorPlay size={18} /> {t("Present")}
          </Link>
        </div>
      }
    >
      <Link to="/app/presentations" className="back-link"><ArrowLeft size={16} /> {t("All presentations")}</Link>
      {error && <p className="error">{error}</p>}

      {deck && (
        <UiProvider value={appStrings(lang)}>
        <div className="detail">
          <div className="detail-main">
            <div className="stats-row compact">
              <div className="stat-card">
                <span className="stat-icon"><Users size={20} /></span>
                <strong>{deck.participants}</strong>
                <span>{t("participants")}</span>
              </div>
              <div className="stat-card hot">
                <span className="stat-icon"><Check size={20} /></span>
                <strong>{totalAnswers}</strong>
                <span>{t("answers")}</span>
              </div>
            </div>

            {showsBoard(deck) && (
              <section className="panel result">
                <div className="result-head">
                  <span className="question-n">{t("Quiz")}</span>
                  <span className="muted">{t("Top {n}", { n: deck.leaderboard.length })}</span>
                </div>
                <h2>{t("Leaderboard")}</h2>
                <PhoneBoard entries={deck.leaderboard} mine="" locale={lang === "fr" ? "fr-FR" : "en-US"} t={t} />
              </section>
            )}
            {deck.rounds ? <RoundsResults deck={deck as Detail & { rounds: RoundsResult }} card={card} board={showsBoard(deck)} /> : deck.questions.map((q, qi) => card(q, qi))}
          </div>

          {/* Side: invite the room, then the results, then the presentation itself; other tools last. */}
          <aside className="detail-side">
            <section className="panel share">
              <h2>{t("Invite the room")}</h2>
              <div className="share-qr" dangerouslySetInnerHTML={{ __html: qr }} />
              <p className="share-url">{SITE_HOST}/{code}</p>
              <button className="ghost with-icon full" onClick={() => copyLink(code).then(() => (setCopied(true), setTimeout(() => setCopied(false), 1500)))}>
                {copied ? <Check size={18} /> : <Link2 size={18} />} {copied ? t("Link copied") : t("Copy link")}
              </button>
            </section>

            <section className="panel actions-panel">
              <h2>{t("Results")}</h2>
              <button className="ghost with-icon full" onClick={exportCsv}>
                <Download size={18} /> {t("Export as CSV")}
              </button>
              {confirm === "reset" ? (
                <div className="confirm-row">
                  <span>{counted(lang, totalAnswers, "Clear {n} answer and contacts?", "Clear {n} answers and contacts?")}</span>
                  <button className="danger small" onClick={reset} disabled={busy}>{t("Yes")}</button>
                  <button className="ghost small" onClick={() => setConfirm(null)}>{t("No")}</button>
                </div>
              ) : (
                <button className="ghost with-icon full" onClick={() => setConfirm("reset")} disabled={totalAnswers === 0}>
                  <RotateCcw size={18} /> {t("Reset answers")}
                </button>
              )}
            </section>

            <section className="panel actions-panel">
              <h2>{t("Presentation")}</h2>
              <Link to={`/app/p/${code}/edit`} className="button ghost with-icon full">
                <Pencil size={18} /> {t("Edit questions")}
              </Link>
              <button className="ghost with-icon full" onClick={duplicate} disabled={busy}>
                <Copy size={18} /> {t("Duplicate")}
              </button>
              {(deck.mine !== false || user?.teamRole === "owner") && (confirm === "keys" ? (
                <div className="confirm-row">
                  <span>{t("Stop old screens from presenting?")}</span>
                  <button className="danger small" onClick={newKeys} disabled={busy}>{t("Yes")}</button>
                  <button className="ghost small" onClick={() => setConfirm(null)}>{t("No")}</button>
                </div>
              ) : (
                <button className="ghost with-icon full" onClick={() => setConfirm("keys")} title={t("Screens not signed in to your account stop presenting")}>
                  {rekeyed ? <Check size={18} /> : <KeyRound size={18} />} {rekeyed ? t("New keys made") : t("New presenter keys")}
                </button>
              ))}
              {confirm === "delete" ? (
                <div className="confirm-row">
                  <span>{t("Delete for good?")}</span>
                  <button className="danger small" onClick={remove}>{t("Yes")}</button>
                  <button className="ghost small" onClick={() => setConfirm(null)}>{t("No")}</button>
                </div>
              ) : (
                <button className="ghost with-icon full danger-text" onClick={() => setConfirm("delete")}>
                  <Trash2 size={18} /> {t("Delete")}
                </button>
              )}
            </section>

            {deck.mine !== false && <ShareTemplate code={code} shared={deck.shared} onChange={(shared) => setDeck({ ...deck, shared })} />}
          </aside>
        </div>
        </UiProvider>
      )}
    </AppShell>
  );
}
