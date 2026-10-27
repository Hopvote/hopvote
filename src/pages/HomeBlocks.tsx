// The blocks of the app's home page: the session live right now, the presentation to pick up with its join link and
// QR code, the last session question by question, first steps for new accounts, recent presentations with their quick
// actions, the numbers, and kinds of questions not tried yet.
import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { ArrowRight, Check, ChevronRight, Copy, Download, LayoutTemplate, MonitorPlay, Pencil, Plus, Sparkles } from "lucide-react";
import { displayName } from "../api";
import { dateIn, translate, useAppLang, useAppT, type AppLang } from "../app-i18n";
import { copyLink, counted, type DeckRow } from "../decks";
import { KINDS, TOPICS_KIND, type UiKind } from "../questions";
import { navigate } from "../router";
import { shotSrc, useShot } from "../shots";
import { Link } from "../ui";
import { PUBLIC_URL, SITE_HOST } from "../site-config";

const locale = (lang: AppLang) => (lang === "fr" ? "fr-FR" : "en-US");
// Singular for 1 in English, for 0 and 1 in French.
const single = (lang: AppLang, n: number) => (lang === "fr" ? n < 2 : n === 1);
const still = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

// A number that counts up to its value the first time it shows, then follows it when it changes.
export function useCountUp(value: number, ms = 800) {
  const [shown, setShown] = useState(() => (still() ? value : 0));
  const from = useRef(shown);
  useEffect(() => {
    if (still()) {
      from.current = value;
      setShown(value);
      return;
    }
    const start = performance.now();
    const base = from.current;
    let frame = 0;
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / ms);
      const v = Math.round(base + (value - base) * (1 - (1 - p) ** 3));
      from.current = v;
      setShown(v);
      if (p < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value, ms]);
  return shown;
}

export function Count({ value }: { value: number }) {
  const lang = useAppLang();
  return <>{useCountUp(value).toLocaleString(locale(lang))}</>;
}

// "just now", "2 hours ago", "yesterday", then "on Oct 3, 2026".
export function ago(lang: AppLang, at: number) {
  const diff = Math.max(0, Date.now() - at);
  if (diff < 60_000) return translate(lang, "just now");
  const words = new Intl.RelativeTimeFormat(locale(lang), { numeric: "auto" });
  if (diff < 3_600_000) return words.format(-Math.round(diff / 60_000), "minute");
  if (diff < 86_400_000) return words.format(-Math.round(diff / 3_600_000), "hour");
  if (diff < 7 * 86_400_000) return words.format(-Math.round(diff / 86_400_000), "day");
  return translate(lang, "on {date}", { date: dateIn(lang).format(at) });
}

// What happened last to a presentation: on a presenter's screen, edited, or created.
export function lastEvent(d: DeckRow) {
  const shown = d.shownAt ?? 0;
  const edited = d.editedAt ?? 0;
  if (shown && shown >= edited) return { at: shown, text: "Presented {when}" };
  if (edited) return { at: edited, text: "Edited {when}" };
  return { at: d.createdAt, text: "Created {when}" };
}

// Most recently used first.
export const byLastUse = (decks: DeckRow[]) => [...decks].sort((a, b) => lastEvent(b).at - lastEvent(a).at);

// Topic rounds are not in KINDS: found here too.
const kindOf = (id: string) => [...KINDS, TOPICS_KIND].find((k) => k.id === id) ?? KINDS[0];
const mainKind = (d: DeckRow) => (d.kinds?.includes("quiz") ? "quiz" : (d.kinds?.[0] ?? "choice"));

// The share of expected answers that came in: everyone, on each question there is to answer. Audience Q&A and
// contact details are optional by nature, so they don't count.
export function answerRate(d: DeckRow) {
  const people = d.participants ?? 0;
  const counts = (d.answered ?? []).filter((n, i): n is number => n !== null && !["qa", "contact"].includes(d.sequence?.[i] ?? ""));
  if (!people || !counts.length) return null;
  return Math.round((counts.reduce((a, n) => a + Math.min(n, people), 0) / (people * counts.length)) * 100);
}

export function CopyButton({ code, label }: { code: string; label?: boolean }) {
  const t = useAppT();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(id);
  }, [copied]);
  const Icon = copied ? Check : Copy;
  const text = copied ? t("Link copied") : t("Copy link");
  return (
    <button type="button" className={label ? `hb-chip ${copied ? "done" : ""}` : `hb-icon-btn ${copied ? "done" : ""}`} title={label ? undefined : text} aria-label={text} onClick={() => copyLink(code).then(() => setCopied(true))}>
      <Icon size={label ? 15 : 17} /> {label && text}
    </button>
  );
}

// The way in for participants: the QR code shown on the big screen, the link to share before the session.
export function JoinCard({ code }: { code: string }) {
  const t = useAppT();
  const [qr, setQr] = useState("");
  const url = `${PUBLIC_URL}/${code}`;
  useEffect(() => {
    QRCode.toDataURL(url, { margin: 0, width: 240, color: { dark: "#151a3dff", light: "#ffffffff" } })
      .then(setQr)
      .catch(() => setQr(""));
  }, [url]);
  async function download() {
    const png = await QRCode.toDataURL(url, { margin: 2, width: 1200, color: { dark: "#151a3dff", light: "#ffffffff" } });
    const a = document.createElement("a");
    a.href = png;
    a.download = `hopvote-${code}.png`;
    a.click();
  }
  return (
    <div className="hb-join">
      {qr ? <img src={qr} alt={t("QR code to join")} width={120} height={120} /> : <span className="hb-join-qr" aria-hidden />}
      <div className="hb-join-copy">
        <span className="hb-join-label">{t("To join")}</span>
        <strong className="hb-join-link">
          {SITE_HOST}/<b>{code}</b>
        </strong>
        <div className="hb-join-actions">
          <CopyButton code={code} label />
          <button type="button" className="hb-chip" onClick={download}>
            <Download size={15} /> {t("QR code")}
          </button>
        </div>
      </div>
    </div>
  );
}

// The presentation used last, ready to present or to share.
export function Resume({ deck }: { deck: DeckRow }) {
  const t = useAppT();
  const lang = useAppLang();
  const last = lastEvent(deck);
  return (
    <section className="spotlight hb-resume">
      <div className="hb-resume-in">
      <div className="spotlight-copy">
        <p className="spotlight-kicker">{t("Pick up where you left off")}</p>
        <h2>{deck.title}</h2>
        <p className="spotlight-meta">
          {counted(lang, deck.questions, "{n} question", "{n} questions")} · {t(last.text, { when: ago(lang, last.at) })}
          {deck.by && ` · ${t("By {name}", { name: displayName(deck.by) })}`}
        </p>
        <div className="spotlight-cta">
          <Link to={`/present/${deck.code}`} className="primary button with-icon">
            <MonitorPlay size={18} /> {t("Present")}
          </Link>
          <Link to={`/app/p/${deck.code}/edit`} className="button outline-light with-icon">
            <Pencil size={16} /> {t("Edit")}
          </Link>
          {deck.votes > 0 && (
            <Link to={`/app/p/${deck.code}`} className="button outline-light">
              {t("Results")}
            </Link>
          )}
        </div>
      </div>
      <JoinCard code={deck.code} />
      </div>
    </section>
  );
}

// No presentation yet: what a session looks like. The ways to start sit right above it.
export function Welcome() {
  const t = useAppT();
  const lang = useAppLang();
  const shot = useShot();
  return (
    <section className="spotlight hb-resume hb-welcome">
      <div className="hb-resume-in">
        <div className="spotlight-copy">
          <p className="spotlight-kicker">{t("Get started")}</p>
          <h2>{t("Your first session in a few minutes")}</h2>
          <p className="spotlight-meta">{t("Write your questions, show the QR code, the room answers on their phones.")}</p>
        </div>
        {!shot.failed && <img ref={shot.ref} className="hb-welcome-shot" src={shotSrc("words", lang)} width={1280} height={720} alt="" onError={shot.onError} />}
      </div>
    </section>
  );
}

// Phones connected right now: back to the screen in one click.
export function LiveNow({ decks }: { decks: DeckRow[] }) {
  const t = useAppT();
  const lang = useAppLang();
  const live = decks.filter((d) => (d.live ?? 0) > 0).sort((a, b) => (b.live ?? 0) - (a.live ?? 0));
  const d = live[0];
  if (!d) return null;
  return (
    <section className="hb-live hb-rise" style={{ "--i": 0 } as React.CSSProperties}>
      <span className="hb-dot" aria-hidden />
      <div className="hb-live-copy">
        <p>
          <strong>{t("Live now")}</strong>
          <span className="truncate">{d.title}</span>
        </p>
        <span>
          <b>
            <Count value={d.live ?? 0} />
          </b>{" "}
          {t(single(lang, d.live ?? 0) ? "person connected" : "people connected")} · {t("Question {n} of {m}", { n: (d.current ?? 0) + 1, m: d.questions })}
          {live.length > 1 && ` · ${t("{n} more live", { n: live.length - 1 })}`}
        </span>
      </div>
      <div className="hb-live-cta">
        <Link to={`/present/${d.code}`} className="primary button with-icon">
          <MonitorPlay size={18} /> {t("Open the screen")}
        </Link>
        <Link to={`/app/p/${d.code}`} className="button ghost">
          {t("Live results")}
        </Link>
      </div>
    </section>
  );
}

// The last session on a screen: how many came, how many answered, and question by question where the room dropped.
export function LastSession({ deck }: { deck: DeckRow }) {
  const t = useAppT();
  const lang = useAppLang();
  const people = deck.participants ?? 0;
  const rate = answerRate(deck);
  const answered = deck.answered ?? [];
  const when = deck.shownAt ? t("Presented {when}", { when: ago(lang, deck.shownAt) }) : t(lastEvent(deck).text, { when: ago(lang, lastEvent(deck).at) });
  return (
    <section className="panel hb-last">
      <div className="hb-head">
        <p className="home-label">{t("Last session")}</p>
        <Link to={`/app/p/${deck.code}`} className="sec-link">
          {t("Results")} <ArrowRight size={16} />
        </Link>
      </div>
      <p className="hb-last-title">
        <strong className="truncate">{deck.title}</strong>
        <span>{when}</span>
      </p>
      <div className="hb-kpis">
        <div>
          <strong>
            <Count value={people} />
          </strong>
          <span>{t(single(lang, people) ? "participant" : "participants")}</span>
        </div>
        <div>
          <strong>
            <Count value={deck.votes} />
          </strong>
          <span>{t(single(lang, deck.votes) ? "answer" : "answers")}</span>
        </div>
        {rate !== null && (
          <div>
            <strong className="hot">
              <Count value={rate} />
              {lang === "fr" ? "\u202f%" : "%"}
            </strong>
            <span>{t("answer rate")}</span>
          </div>
        )}
      </div>
      {answered.length > 1 && (
        <div className="hb-chart">
        <span className="hb-chart-label">{t("Answers question by question")}</span>
        <div className="hb-bars">
          {answered.map((n, i) => {
            const kind = kindOf(deck.sequence?.[i] ?? "choice");
            const label = n === null ? t("Question {n}: {kind}", { n: i + 1, kind: t(kind.label) }) : t("Question {n}: {count}", { n: i + 1, count: counted(lang, n, "{n} answer", "{n} answers") });
            const h = n === null || !people ? 0 : Math.max(0.04, Math.min(n, people) / people);
            return (
              <span key={i} className={`hb-bar ${n === null ? "none" : ""}`} title={label} aria-label={label} style={{ "--h": h, "--i": i } as React.CSSProperties}>
                <i />
                <small>{i + 1}</small>
              </span>
            );
          })}
        </div>
        </div>
      )}
    </section>
  );
}

const SEEN_RESULTS = "hopvote:seen-results";
const HIDE_STEPS = "hopvote:first-steps";
const stored = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
export const markResultsSeen = () => {
  try {
    localStorage.setItem(SEEN_RESULTS, "1");
  } catch {
    // Only the first steps card notices.
  }
};

// Shown to new accounts until they have run a session with a group: what to do next, one step at a time.
export function FirstSteps({ decks, onHide }: { decks: DeckRow[]; onHide: () => void }) {
  const t = useAppT();
  const first = byLastUse(decks)[0];
  const steps = [
    { done: decks.length > 0, label: "Create a presentation", to: "/app/new", cta: "Create" },
    { done: decks.some((d) => (d.participants ?? 0) > 0), label: "Try it on your phone", to: first && `/present/${first.code}`, cta: "Open" },
    { done: decks.some((d) => (d.participants ?? 0) >= 3), label: "Present it to your group", to: first && `/present/${first.code}`, cta: "Present" },
    { done: stored(SEEN_RESULTS) === "1" && decks.some((d) => d.votes > 0), label: "Look at the results", to: first && `/app/p/${first.code}`, cta: "See" },
  ];
  const done = steps.filter((s) => s.done).length;
  const next = steps.findIndex((s) => !s.done);
  const R = 17;
  const C = 2 * Math.PI * R;
  return (
    <section className="panel hb-steps">
      <div className="hb-head">
        <p className="home-label">{t("First steps")}</p>
        <span className="hb-ring" aria-label={t("{done} of {total}", { done, total: steps.length })}>
          <svg viewBox="0 0 40 40" width="40" height="40" aria-hidden>
            <circle cx="20" cy="20" r={R} />
            <circle cx="20" cy="20" r={R} className="on" style={{ strokeDasharray: C, strokeDashoffset: C * (1 - done / steps.length) }} />
          </svg>
          <b>
            {done}/{steps.length}
          </b>
        </span>
      </div>
      <ol>
        {steps.map((s, i) => (
          <li key={s.label} className={`hb-step ${s.done ? "done" : ""} ${i === next ? "next" : ""}`}>
            <span className="hb-step-mark">{s.done ? <Check size={14} strokeWidth={3} /> : i + 1}</span>
            <span className="hb-step-label">{t(s.label)}</span>
            {!s.done && s.to && i === next && (
              <Link to={s.to} className="hb-chip strong">
                {t(s.cta)} <ChevronRight size={15} />
              </Link>
            )}
          </li>
        ))}
      </ol>
      <button type="button" className="hb-hide" onClick={onHide}>
        {t("Hide")}
      </button>
    </section>
  );
}

export const stepsHidden = () => stored(HIDE_STEPS) === "hidden";
export const hideSteps = () => {
  try {
    localStorage.setItem(HIDE_STEPS, "hidden");
  } catch {
    // Shown again next time.
  }
};

// Recent presentations, each with Present, Copy link and Edit at hand.
export function RecentList({ decks }: { decks: DeckRow[] }) {
  const t = useAppT();
  const lang = useAppLang();
  return (
    <ul className="recent hb-recent">
      {decks.map((d, i) => {
        const kind = kindOf(mainKind(d));
        const Icon = kind.icon;
        const last = lastEvent(d);
        return (
          <li key={d.code} className="hb-rise" style={{ "--i": i + 2 } as React.CSSProperties}>
            <div className="hb-row">
              <Link to={`/app/p/${d.code}`} className="hb-row-main">
                <span className="hb-row-icon" title={t(kind.label)}>
                  <Icon size={19} />
                </span>
                <span className="hb-row-text">
                  <strong className="truncate">
                    {d.title}
                    {d.by && <span className="home-tag">{t("By {name}", { name: displayName(d.by) })}</span>}
                  </strong>
                  <span className="truncate">
                    {counted(lang, d.questions, "{n} question", "{n} questions")} · {counted(lang, d.participants ?? 0, "{n} participant", "{n} participants")}
                  </span>
                </span>
                <span className={`hb-row-when ${d.live ? "live" : ""}`}>
                  {d.live ? (
                    <>
                      <i className="hb-dot small" aria-hidden /> {t("Live")}
                    </>
                  ) : (
                    t(last.text, { when: ago(lang, last.at) })
                  )}
                </span>
              </Link>
              <div className="hb-row-actions">
                <Link to={`/present/${d.code}`} className="hb-icon-btn" title={t("Present")} label={t("Present")}>
                  <MonitorPlay size={17} />
                </Link>
                <CopyButton code={d.code} />
                <Link to={`/app/p/${d.code}/edit`} className="hb-icon-btn" title={t("Edit")} label={t("Edit")}>
                  <Pencil size={16} />
                </Link>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// Totals since the account was created: a card, or a row inside another one.
export function Totals({ decks }: { decks: DeckRow[] }) {
  const t = useAppT();
  const lang = useAppLang();
  const people = decks.reduce((a, d) => a + (d.participants ?? 0), 0);
  const answers = decks.reduce((a, d) => a + d.votes, 0);
  const one = (n: number) => single(lang, n);
  return (
    <div className="hb-kpis">
      <div>
        <strong>
          <Count value={decks.length} />
        </strong>
        <span>{t(one(decks.length) ? "presentation" : "presentations")}</span>
      </div>
      <div>
        <strong>
          <Count value={people} />
        </strong>
        <span>{t(one(people) ? "participant" : "participants")}</span>
      </div>
      <div>
        <strong className="hot">
          <Count value={answers} />
        </strong>
        <span>{t(one(answers) ? "answer" : "answers")}</span>
      </div>
    </div>
  );
}

export function Numbers({ decks }: { decks: DeckRow[] }) {
  const t = useAppT();
  return (
    <section className="panel hb-numbers">
      <p className="home-label">{t("Your numbers")}</p>
      <Totals decks={decks} />
    </section>
  );
}

// Phones get the short placeholder: the long one would be cut mid-sentence next to the button.
function useNarrow(query = "(max-width: 640px)") {
  const [narrow, setNarrow] = useState(() => typeof matchMedia === "function" && matchMedia(query).matches);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const m = matchMedia(query);
    const on = () => setNarrow(m.matches);
    on();
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, [query]);
  return narrow;
}

// One brief, and the AI writes the questions. Or start from scratch, or from a template.
export function CreateBar() {
  const t = useAppT();
  const narrow = useNarrow();
  const [brief, setBrief] = useState("");
  function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = brief.trim();
    navigate(`/app/new?ai=1${text ? `&brief=${encodeURIComponent(text)}` : ""}`);
  }
  return (
    <form className="hb-create hb-rise" style={{ "--i": 0 } as React.CSSProperties} onSubmit={submit}>
      <label className="hb-create-field">
        <Sparkles size={20} aria-hidden />
        <span className="sr-only">{t("Describe your session")}</span>
        <input value={brief} maxLength={300} placeholder={t(narrow ? "Describe your session" : "Describe your session, the AI writes the questions")} onChange={(e) => setBrief(e.target.value)} />
        <button type="submit" className="primary button">
          {t("Write with AI")}
        </button>
      </label>
      <div className="hb-create-more">
        <Link to="/app/new" className="hb-chip">
          <Plus size={15} strokeWidth={2.6} /> {t("Start from scratch")}
        </Link>
        <Link to="/app/community" className="hb-chip">
          <LayoutTemplate size={15} /> {t("Pick a template")}
        </Link>
      </div>
    </form>
  );
}

// Kinds of questions not used yet, with the real big screen of each.
const TRY_ORDER: UiKind[] = ["quiz", "words", "qa", "fill", "wheel", "points", "match", "scales", "rank", "number", "order", "spot", "countdown", "media", "open", "scale", "slide", "link", "choice", "contact"];

function TryCard({ kind }: { kind: UiKind }) {
  const t = useAppT();
  const lang = useAppLang();
  const shot = useShot();
  const k = kindOf(kind);
  return (
    <Link to={`/app/new?kind=${kind}`} className="hb-try-card">
      {/* Without its picture (npm run previews makes them), the kind's icon. */}
      {shot.failed ? (
        <span className="hb-try-shot hb-try-icon" aria-hidden>
          <k.icon size={34} />
        </span>
      ) : <img ref={shot.ref} className="hb-try-shot" src={shotSrc(kind, lang)} width={1280} height={720} alt="" loading="lazy" onError={shot.onError} />}
      <strong>{t(k.label)}</strong>
      <span className="hb-try-go">
        {t("Try it")} <ArrowRight size={13} />
      </span>
    </Link>
  );
}

export function TryKinds({ decks }: { decks: DeckRow[] }) {
  const t = useAppT();
  const used = new Set(decks.flatMap((d) => d.kinds ?? []));
  const picks = TRY_ORDER.filter((k) => !used.has(k)).slice(0, 3);
  if (!picks.length) return null;
  return (
    <section className="panel hb-try">
      <div className="hb-head">
        <p className="home-label">{t("Not tried yet")}</p>
        <span className="hb-head-note">{t("20 kinds of questions")}</span>
      </div>
      <div className="hb-try-grid">
        {picks.map((k) => (
          <TryCard key={k} kind={k} />
        ))}
      </div>
    </section>
  );
}
