// AI writing help in the builder.
// Nothing changes until the presenter picks it: generated questions, improvements and rewordings are previewed first.
// Labels stay in English here and are translated where they show (useAppT).
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ListChecks, PenLine, RotateCcw, Undo2, Wand2, X } from "lucide-react";
import { KINDS, TOPICS_KIND, toDraft, type Draft, type Stored } from "./questions";
import { parseFill } from "./fill";
import { fitRounds, keepRounds, roundsOf, TOPIC_LENGTH } from "./rounds";
import { Popover } from "./menu";
import { useAppLang, useAppT } from "./app-i18n";

// How the builder reaches the AI routes.
export type AiCall = <T>(action: "generate" | "improve" | "rewrite", body: Record<string, unknown>) => Promise<T>;

type Generated = { title: string; questions: Stored[]; cut?: boolean };
type Improved = { questions: { question: string; options: string[] }[] };
type Rewritten = { question: string; suggestions: string[]; options: string[] };

export const TONES = [
  { id: "clearer", label: "Clearer", hint: "Easier to read at a glance" },
  { id: "formal", label: "Formal", hint: "For clients and executives" },
  { id: "friendly", label: "Friendly", hint: "Warm and relaxed" },
  { id: "shorter", label: "Shorter", hint: "Fewer words" },
  { id: "fun", label: "Playful", hint: "Light humor" },
] as const;
type Tone = (typeof TONES)[number]["id"];

const FORMATS = [
  { id: "mixed", label: "Mixed session" },
  { id: "quiz", label: "Quiz" },
  { id: "poll", label: "Opinion poll" },
  { id: "icebreaker", label: "Icebreaker" },
  { id: "feedback", label: "Feedback" },
  // A picker (the wheel or the room's vote among the topics), then each topic's quiz questions (src/rounds.ts).
  { id: "rounds", label: "Topic rounds" },
] as const;
// Topic rounds asked of the AI: up to 4 topics typed (none: it proposes 3 or 4), 2 to 5 questions per topic.
const AI_TOPICS = 4;
const PER_TOPIC = [2, 3, 4, 5];

// A brief that names a format (in English or French) opens with that format picked: the first one named wins.
const FORMAT_WORDS: [Format, RegExp][] = [
  ["quiz", /(?<!\p{L})quizz?(?:es)?(?!\p{L})/iu],
  ["poll", /(?<!\p{L})(?:polls?|sondages?|opinion)(?!\p{L})/iu],
  ["icebreaker", /(?<!\p{L})(?:ice-?breakers?|ice breakers?|brise-glaces?)(?!\p{L})/iu],
  ["feedback", /(?<!\p{L})(?:feedbacks?|satisfaction)(?!\p{L})/iu],
  ["rounds", /(?<!\p{L})(?:topic rounds?|manches? par thèmes?)(?!\p{L})/iu],
];
type Format = (typeof FORMATS)[number]["id"];
function formatOf(brief = ""): Format {
  let best: Format = "mixed";
  let at = Infinity;
  for (const [id, re] of FORMAT_WORDS) {
    const i = brief.search(re);
    if (i >= 0 && i < at) [best, at] = [id, i];
  }
  return best;
}

const errorText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);
const apiLang = (lang: string) => (lang === "auto" ? undefined : lang);
const kindOf = (q: Stored) => toDraft(q).kind;
const filled = (q: Draft) => q.options.some((o) => o.trim());

// Questions that score points (as worker/room.ts counts them): their leaderboard needs the first names.
export const isScored = (q: Stored) =>
  (q.type === "choice" && q.correct !== undefined && q.correct !== null) ||
  (q.type === "number" && typeof q.answer === "number") ||
  (q.type === "rank" && q.ordered === true) ||
  q.type === "fill" ||
  q.type === "match" ||
  (q.type === "spot" && !!q.zone);

// The quiz answer's place among the options left once the empty ones are removed.
const filledIndex = (options: string[], correct: number | undefined) =>
  correct === undefined || !options[correct]?.trim() ? undefined : options.slice(0, correct).filter((o) => o.trim()).length;

// The generated questions that fit, once added to the presenter's own (or in their place).
export const addedQuestions = (current: Draft[], added: Stored[], max: number, replace: boolean) =>
  replace ? added.slice(0, max) : added.slice(0, Math.max(0, max - current.filter((q) => q.question.trim()).length));

// Adds generated questions: empty ones are replaced, written ones are kept.
export function mergeQuestions(current: Draft[], added: Stored[], max: number) {
  const kept = current.filter((q) => q.question.trim());
  return [...kept, ...added.map(toDraft)].slice(0, Math.max(max, kept.length));
}

function KindTag({ kind }: { kind: Draft["kind"] }) {
  const t = useAppT();
  const k = [...KINDS, TOPICS_KIND].find((x) => x.id === kind)!;
  const Icon = k.icon;
  return (
    <span className="ai-kind">
      <Icon size={13} /> {t(k.label)}
    </span>
  );
}

// What a generated question holds besides its title: the blanks and extra words, the pairs, the number to guess,
// the items in their right order, the timer's length, the slide's text, the link, the scale's ends, or the options.
// Pairs and orders read as one wrapping line, so long items never turn a chip into a blob on a phone.
function Summary({ q }: { q: Stored }) {
  const t = useAppT();
  const lang = useAppLang();
  const kind = kindOf(q);
  // Numbers in the app's language; years stay ungrouped (1889, not 1,889).
  const num = (n: number) => new Intl.NumberFormat(lang === "fr" ? "fr-FR" : "en-US", { useGrouping: Math.abs(n) >= 10000 }).format(n);
  if (kind === "fill" && q.fill) {
    const { pieces, answers } = parseFill(q.fill);
    return (
      <>
        <small>{pieces.join("___").replace(/\s+/g, " ").trim()}</small>
        <span className="aid-opts">
          {answers.map((a, k) => <span key={`a${k}`} className="right" title={t("Right answer")}><Check size={11} strokeWidth={3} aria-hidden />{a[0]}<span className="sr-only">, {t("Right answer")}</span></span>)}
          {(q.decoys ?? []).map((d, k) => <span key={`d${k}`} title={t("Extra words")}>{d}<span className="sr-only">, {t("Extra words")}</span></span>)}
        </span>
      </>
    );
  }
  if (kind === "match") {
    const half = q.options.length / 2;
    return <small>{q.options.slice(0, half).map((left, k) => `${left}\u00a0\u2192 ${q.options[half + k]}`).join("\u00a0\u00b7 ")}</small>;
  }
  if (kind === "number") {
    return typeof q.answer === "number" ? <span className="aid-opts"><span className="right" title={t("Right answer")}><Check size={11} strokeWidth={3} aria-hidden />{num(q.answer)}</span></span> : null;
  }
  if (kind === "order") return <small>{q.options.map((o, k) => `${k + 1}.\u00a0${o}`).join("\u00a0\u00b7 ")}</small>;
  if (kind === "countdown") return <span className="aid-opts"><span>{t("{n} min", { n: num(Math.round((q.duration ?? 300) / 6) / 10) })}</span></span>;
  if (kind === "slide") return q.text ? <small>{q.text}</small> : null;
  if ((kind === "link" || kind === "media") && q.url) return <small title={q.url}>{shortUrl(q.url)}</small>;
  const ends = kind === "scale" || kind === "scales" ? <small>{`1${q.labels?.[0] ? `: ${q.labels[0]}` : ""}  \u2026  ${q.max ?? 5}${q.labels?.[1] ? `: ${q.labels[1]}` : ""}`}</small> : null;
  if (!q.options.length) return ends;
  return (
    <>
      <span className="aid-opts">
        {q.options.map((o, k) => <span key={k} className={q.correct === k ? "right" : ""}>{q.correct === k && <Check size={11} strokeWidth={3} />}{o}</span>)}
      </span>
      {ends}
    </>
  );
}

// A link as a person reads it: no scheme, no "www.", cut short so it holds on one phone line.
const shortUrl = (url: string) => {
  const text = url.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "");
  return text.length > 34 ? `${text.slice(0, 33)}\u2026` : text;
};

function Loading({ rows, text }: { rows: number; text: string }) {
  return (
    <div className="ai-loading" aria-live="polite">
      <p>{text}</p>
      {Array.from({ length: rows }, (_, i) => <span key={i} className="ai-skel" style={{ width: `${88 - ((i * 17) % 30)}%` }} />)}
    </div>
  );
}

type Props = {
  call: AiCall;
  lang: string;
  title: string;
  questions: Draft[];
  max: number;
  onAdd: (title: string, questions: Stored[], replace: boolean) => void;
  onReplace: (questions: Draft[]) => void;
};

// Entry point in the builder's side column.
export function AiPanel(props: Props & { compact?: boolean; startOpen?: boolean; startBrief?: string }) {
  const t = useAppT();
  // Opened straight away when the person came from "Write with AI" on the home page, with the brief typed there.
  const [open, setOpen] = useState<"" | "generate" | "improve">(props.startOpen ? "generate" : "");
  const written = props.questions.filter((q) => q.question.trim()).length;
  return (
    <section className={`ai-panel ${props.compact ? "compact" : ""}`}>
      <div className="ai-panel-head">
        <span className="ai-panel-icon"><Wand2 size={16} /></span>
        <div>
          <strong>{t("AI assistant")}</strong>
          {!props.compact && <small>{t("Draft questions from a brief, or polish the ones you have.")}</small>}
        </div>
      </div>
      <div className="ai-panel-actions">
        <button type="button" className="ai-action" onClick={() => setOpen("generate")}>
          <PenLine size={15} /> {t("Generate")}
        </button>
        <button type="button" className="ai-action" disabled={!written} title={written ? "" : t("Write a question first")} onClick={() => setOpen("improve")}>
          <ListChecks size={15} /> {t("Improve all")}
        </button>
      </div>
      {open && createPortal(<AiDialog {...props} startBrief={open === "generate" ? props.startBrief : undefined} mode={open} onClose={() => setOpen("")} />, document.body)}
    </section>
  );
}

// "Use 3 questions" or "Add 1 question": one key per form, so each language can phrase it.
const applyLabel = (replace: boolean, n: number) =>
  replace ? (n === 1 ? "Use {n} question" : "Use {n} questions") : n === 1 ? "Add {n} question" : "Add {n} questions";

function AiDialog({ call, lang, title, questions, max, onAdd, onReplace, mode, onClose, startBrief }: Props & { mode: "generate" | "improve"; onClose: () => void; startBrief?: string }) {
  const t = useAppT();
  // Generate
  const [brief, setBrief] = useState(startBrief ?? "");
  const [audience, setAudience] = useState("");
  const [format, setFormat] = useState<Format>(() => formatOf(startBrief));
  const [count, setCount] = useState(5);
  // Topic rounds: the topics typed, who picks them, the questions per topic.
  const [topicsIn, setTopicsIn] = useState(["", "", ""]);
  const [how, setHow] = useState<"wheel" | "vote">("wheel");
  const [perTopic, setPerTopic] = useState(3);
  // Both
  const [tone, setTone] = useState<Tone>(mode === "improve" ? "clearer" : "friendly");
  // Improve
  const [scope, setScope] = useState<"both" | "questions" | "options">("both");
  const [note, setNote] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<Generated | null>(null);
  const [changes, setChanges] = useState<Improved["questions"] | null>(null);
  const [picked, setPicked] = useState<boolean[]>([]);
  const [replace, setReplace] = useState(false);

  const room = Math.max(0, max - questions.filter((q) => q.question.trim()).length);
  const rounds = format === "rounds";
  // Rounds already in the presentation: new ones take their place (one picker per presentation).
  const hasPicker = questions.some((q) => q.kind === "topics");

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    addEventListener("keydown", esc);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      removeEventListener("keydown", esc);
      document.body.style.overflow = overflow;
    };
  }, [busy, onClose]);

  async function run() {
    if (mode === "generate" && brief.trim().length < 3) return setError(t("Describe your session in a few words"));
    setBusy(true);
    setError("");
    try {
      if (mode === "generate") {
        const typed = topicsIn.map((x) => x.trim()).filter(Boolean);
        const out = rounds
          ? await call<Generated>("generate", { mode: "rounds", topic: brief, audience, topics: typed.length >= 2 ? typed : [], perTopic, how, tone, max, lang: apiLang(lang) })
          : await call<Generated>("generate", { topic: brief, audience, style: format, count, tone, lang: apiLang(lang) });
        setDraft(out);
        setPicked(out.questions.map(() => true));
        // Questions already written are kept unless the person chooses to replace them (new rounds replace the old ones).
        const generatedRounds = out.questions.some((q) => q.topics);
        setReplace(room === 0 || !questions.some((q) => q.question.trim()) || (generatedRounds && hasPicker));
      } else {
        const out = await call<Improved>("improve", {
          title,
          questions: questions.map((q) => ({ question: q.question, options: q.options, kind: q.kind })),
          tone,
          scope,
          note,
          lang: apiLang(lang),
        });
        setChanges(out.questions);
        setPicked(questions.map((q, i) => isChanged(q, out.questions[i])));
      }
    } catch (e) {
      setError(errorText(e, t("The AI is busy. Try again in a moment.")));
    } finally {
      setBusy(false);
    }
  }

  const isChanged = (q: Draft, c?: { question: string; options: string[] }) =>
    !!c && (c.question !== q.question || c.options.join("\n") !== q.options.join("\n"));
  const chosen = picked.filter(Boolean).length;
  // Topic rounds generated: the questions ticked, a topic left empty dropped, then cut to the room left (topic by topic).
  const draftRounds = !!draft && draft.questions.some((q) => q.topics);
  const keptRounds = draftRounds && draft ? keepRounds(draft.questions, picked) : null;
  const roundsOk = !keptRounds || !!roundsOf(keptRounds);
  const fittedRounds = keptRounds && roundsOk ? fitRounds(keptRounds, replace ? max : room) : null;
  const applying = keptRounds ? (fittedRounds?.length ?? 0) : Math.min(chosen, replace ? max : room);

  function apply() {
    if (mode === "generate" && draft && keptRounds) {
      if (fittedRounds) onAdd(draft.title, fittedRounds, replace);
    } else if (mode === "generate" && draft) onAdd(draft.title, draft.questions.filter((_, i) => picked[i]), replace);
    if (mode === "improve" && changes) onReplace(questions.map((q, i) => (picked[i] && changes[i] ? { ...q, question: changes[i].question, options: changes[i].options } : q)));
    onClose();
  }

  const reviewing = mode === "generate" ? !!draft : !!changes;
  const toggle = (i: number) => setPicked((p) => p.map((v, j) => (j === i ? !v : v)));

  return (
    <div className="aid" role="dialog" aria-modal="true" aria-label={t("AI assistant")} onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="aid-box">
        <header className="aid-head">
          <div>
            <strong>{mode === "generate" ? t("Generate questions") : t("Improve all questions")}</strong>
            <span>{reviewing ? t("Review, untick what you don't want, then apply.") : mode === "generate" ? t("The more context you give, the better the questions.") : t("Every question is rewritten, then you choose what to keep.")}</span>
          </div>
          <button type="button" className="aid-close" aria-label={t("Close")} onClick={onClose} disabled={busy}><X size={18} /></button>
        </header>

        <div className="aid-body">
          {busy ? (
            <Loading rows={mode === "generate" ? (rounds ? Math.min(8, perTopic * 2 + 1) : count) : Math.min(questions.length, 6)} text={mode === "generate" ? t("Writing your questions…") : t("Rewriting your questions…")} />
          ) : !reviewing ? (
            mode === "generate" ? (
              <div className="aid-form">
                <label className="aid-field">
                  <span>{t("What is your session about?")}</span>
                  <textarea
                    autoFocus
                    rows={4}
                    maxLength={600}
                    value={brief}
                    onChange={(e) => setBrief(e.target.value)}
                    placeholder={t("e.g. Onboarding for new hires at a design agency in Lyon, founded in 2015, 40 people. We want them to learn our values and meet the team.")}
                  />
                  <small>{t("Add facts if you want a quiz: the AI never invents details about your organization.")}</small>
                </label>
                <label className="aid-field">
                  <span>{t("Audience")} <em>{t("optional")}</em></span>
                  <input maxLength={120} value={audience} onChange={(e) => setAudience(e.target.value)} placeholder={t("e.g. 40 new hires, mostly remote")} />
                </label>
                <div className="aid-grid">
                  <label className="aid-field">
                    <span>{t("Format")}</span>
                    <select value={format} onChange={(e) => setFormat(e.target.value as typeof format)}>
                      {FORMATS.map((f) => <option key={f.id} value={f.id}>{t(f.label)}</option>)}
                    </select>
                  </label>
                  {rounds ? (
                    <label className="aid-field">
                      <span>{t("Per topic")}</span>
                      <select value={perTopic} onChange={(e) => setPerTopic(Number(e.target.value))} aria-label={t("Questions per topic")}>
                        {PER_TOPIC.map((n) => <option key={n} value={n}>{t("{n} questions", { n })}</option>)}
                      </select>
                    </label>
                  ) : (
                    <label className="aid-field">
                      <span>{t("Questions")}</span>
                      <select value={count} onChange={(e) => setCount(Number(e.target.value))}>
                        {[3, 5, 8, 10].map((n) => <option key={n} value={n}>{n}</option>)}
                      </select>
                    </label>
                  )}
                  <label className="aid-field">
                    <span>{t("Tone")}</span>
                    <select value={tone} onChange={(e) => setTone(e.target.value as Tone)}>
                      {TONES.map((x) => <option key={x.id} value={x.id}>{t(x.label)}</option>)}
                    </select>
                  </label>
                </div>
                {rounds && (
                  <>
                    <div className="aid-field">
                      <span>{t("Picked by")}</span>
                      <div className="aid-seg aid-how" role="radiogroup" aria-label={t("Picked by")}>
                        <button type="button" role="radio" aria-checked={how === "wheel"} className={how === "wheel" ? "on" : ""} onClick={() => setHow("wheel")}>{t("Wheel")}</button>
                        <button type="button" role="radio" aria-checked={how === "vote"} className={how === "vote" ? "on" : ""} onClick={() => setHow("vote")}>{t("Room vote")}</button>
                      </div>
                    </div>
                    <div className="aid-field">
                      <span>{t("Topics")} <em>{t("optional")}</em></span>
                      <div className="aid-topics">
                        {topicsIn.map((x, i) => (
                          <input key={i} maxLength={TOPIC_LENGTH} value={x} aria-label={t("Topic {n}", { n: i + 1 })} placeholder={t("Topic {n}", { n: i + 1 })} onChange={(e) => setTopicsIn((list) => list.map((y, j) => (j === i ? e.target.value : y)))} />
                        ))}
                        {topicsIn.length < AI_TOPICS && <button type="button" className="aid-ghost small" onClick={() => setTopicsIn((list) => [...list, ""])}>{t("+ Add a topic")}</button>}
                      </div>
                      <small>{t("Leave them empty and the AI proposes 3 or 4 topics.")}</small>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className="aid-form">
                <div className="aid-field">
                  <span>{t("Tone")}</span>
                  <div className="aid-tones" role="radiogroup" aria-label={t("Tone")}>
                    {TONES.map((x) => (
                      <button key={x.id} type="button" role="radio" aria-checked={tone === x.id} className={tone === x.id ? "on" : ""} onClick={() => setTone(x.id)}>
                        <strong>{t(x.label)}</strong>
                        <small>{t(x.hint)}</small>
                      </button>
                    ))}
                  </div>
                </div>
                <label className="aid-field">
                  <span>{t("Rewrite")}</span>
                  <select value={scope} onChange={(e) => setScope(e.target.value as typeof scope)}>
                    <option value="both">{t("Questions and options")}</option>
                    <option value="questions">{t("Questions only")}</option>
                    <option value="options">{t("Options only")}</option>
                  </select>
                </label>
                <label className="aid-field">
                  <span>{t("Instructions")} <em>{t("optional")}</em></span>
                  <input maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("e.g. Address people informally, avoid jargon")} />
                </label>
              </div>
            )
          ) : mode === "generate" && draft && draftRounds ? (
            <RoundsReview questions={draft.questions} picked={picked} onToggle={toggle} />
          ) : mode === "generate" && draft ? (
            <ul className="aid-review">
              {draft.questions.map((q, i) => (
                <li key={i} className={picked[i] ? "on" : ""}>
                  <label>
                    <input type="checkbox" checked={!!picked[i]} onChange={() => toggle(i)} />
                    <span className="aid-check"><Check size={13} strokeWidth={3} /></span>
                    <span className="aid-q">
                      <KindTag kind={kindOf(q)} />
                      <strong>{q.question}</strong>
                      <Summary q={q} />
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          ) : changes ? (
            <ul className="aid-review">
              {questions.map((q, i) => {
                const c = changes[i];
                const changed = isChanged(q, c);
                return (
                  <li key={i} className={`${picked[i] ? "on" : ""} ${changed ? "" : "same"}`}>
                    <label>
                      <input type="checkbox" checked={!!picked[i]} disabled={!changed} onChange={() => toggle(i)} />
                      <span className="aid-check"><Check size={13} strokeWidth={3} /></span>
                      <span className="aid-q">
                        <KindTag kind={q.kind} />
                        {changed && c ? (
                          <>
                            {c.question !== q.question ? (
                              <>
                                <s>{q.question}</s>
                                <strong>{c.question}</strong>
                              </>
                            ) : (
                              <strong>{q.question}</strong>
                            )}
                            {c.options.join("\n") !== q.options.join("\n") && (
                              <span className="aid-opts">
                                {c.options.map((o, k) => <span key={k} className={o !== q.options[k] ? "new" : ""}>{o}</span>)}
                              </span>
                            )}
                          </>
                        ) : (
                          <>
                            <strong>{q.question || t("Empty question")}</strong>
                            <small>{t("Already good, no change")}</small>
                          </>
                        )}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          ) : null}
          {error && <p className="error aid-error">{error}</p>}
        </div>

        <footer className="aid-foot">
          {reviewing ? (
            <>
              <button type="button" className="aid-ghost" disabled={busy} onClick={() => { setDraft(null); setChanges(null); }}>{t("Back")}</button>
              <button type="button" className="aid-ghost" disabled={busy} onClick={run}><RotateCcw size={14} /> {t("Try again")}</button>
              <button type="button" className="aid-primary" disabled={busy || !chosen || (draftRounds && !fittedRounds)} onClick={apply}>
                {mode === "generate" ? t(applyLabel(replace, applying), { n: applying }) : t(chosen === 1 ? "Apply {n} change" : "Apply {n} changes", { n: chosen })}
              </button>
            </>
          ) : (
            <>
              <button type="button" className="aid-ghost" onClick={onClose} disabled={busy}>{t("Cancel")}</button>
              <button type="button" className="aid-primary" disabled={busy} onClick={run}>{busy ? t("Working…") : mode === "generate" ? t("Generate") : t("Preview changes")}</button>
            </>
          )}
        </footer>
        {mode === "generate" && draft && !busy && (
          <div className="aid-place">
            <div className="aid-seg" role="radiogroup" aria-label={t("Where to put them")}>
              <button type="button" role="radio" aria-checked={!replace} className={!replace ? "on" : ""} disabled={!room || (draftRounds && hasPicker)} onClick={() => setReplace(false)}>{t("Add to my questions")}</button>
              <button type="button" role="radio" aria-checked={replace} className={replace ? "on" : ""} onClick={() => setReplace(true)}>{t("Replace my questions")}</button>
            </div>
            {draftRounds ? (
              !roundsOk ? <span>{t("Keep questions in at least 2 topics.")}</span>
                : !fittedRounds ? <span>{t("Not enough room left for topic rounds: replace your questions.")}</span>
                : draft.cut || fittedRounds.length < (keptRounds?.length ?? 0) ? <span>{t("Up to {max} questions: the rounds are cut to {n}.", { max, n: fittedRounds.length })}</span>
                : hasPicker && replace ? <span>{t("They replace your topic rounds.")}</span>
                : null
            ) : chosen > (replace ? max : room) && <span>{t("Up to {max} questions: the first {n} are kept.", { max, n: replace ? max : room })}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

// Topic rounds generated: the picker (always kept), then each topic's questions under its name, each to tick.
// A topic left with no question ticked is dropped.
function RoundsReview({ questions, picked, onToggle }: { questions: Stored[]; picked: boolean[]; onToggle: (i: number) => void }) {
  const t = useAppT();
  const p = questions.findIndex((q) => q.topics);
  const picker = questions[p];
  const r = roundsOf(questions);
  const item = (q: Stored, i: number) => (
    <li key={i} className={picked[i] ? "on" : ""}>
      <label>
        <input type="checkbox" checked={!!picked[i]} onChange={() => onToggle(i)} />
        <span className="aid-check"><Check size={13} strokeWidth={3} /></span>
        <span className="aid-q">
          <KindTag kind={kindOf(q)} />
          <strong>{q.question}</strong>
          <Summary q={q} />
        </span>
      </label>
    </li>
  );
  return (
    <ul className="aid-review">
      {questions.map((q, i) => (i < p ? item(q, i) : null))}
      {picker && (
        <li className="on aid-picker">
          <label>
            <span className="aid-check"><Check size={13} strokeWidth={3} /></span>
            <span className="aid-q">
              <KindTag kind="topics" />
              <strong>{picker.question}</strong>
              <span className="aid-opts">{picker.options.map((o, k) => <span key={k}>{o}</span>)}</span>
              <small>{picker.type === "wheel" ? t("Picked by the wheel") : t("Picked by a room vote")}</small>
            </span>
          </label>
        </li>
      )}
      {r?.topics.map((topic, ti) => {
        const on = topic.indices.filter((i) => picked[i]).length;
        return [
          <li key={`t${ti}`} className={`aid-topic ${on ? "" : "off"}`}>
            <strong className="truncate">{topic.label}</strong>
            <span>{on ? t(on === 1 ? "{n} question" : "{n} questions", { n: on }) : t("Left out")}</span>
          </li>,
          ...topic.indices.map((i) => item(questions[i], i)),
        ];
      })}
      {r?.after.map((i) => item(questions[i], i))}
    </ul>
  );
}

// Inline on a question. "question": three rewordings to pick from. "options": a better set, previewed before applying.
export function AiRewrite({
  q,
  mode,
  call,
  lang,
  title = "",
  onChange,
  className = "",
  label: ownLabel,
}: {
  q: Draft;
  mode: "question" | "options";
  // Another name for the button (topic rounds: "Suggest topics").
  label?: string;
  call: AiCall;
  lang: string;
  title?: string;
  onChange: (change: (d: Draft) => Draft) => void;
  className?: string;
}) {
  const t = useAppT();
  const [tone, setTone] = useState<Tone>("clearer");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Rewritten | null>(null);
  const [undo, setUndo] = useState<Pick<Draft, "question" | "options" | "correct"> | null>(null);
  const ready = q.question.trim().length > 0;
  const hasOptions = filled(q);

  async function load(next: Tone) {
    setTone(next);
    setBusy(true);
    setError("");
    setResult(null);
    try {
      setResult(
        await call<Rewritten>("rewrite", {
          title,
          question: q.question,
          options: q.options.filter((o) => o.trim()),
          kind: q.kind,
          // The right answer's place among the options sent, not among the rows on screen.
          correct: q.kind === "quiz" ? filledIndex(q.options, q.correct) : undefined,
          mode,
          tone: next,
          lang: apiLang(lang),
        }),
      );
    } catch (e) {
      setError(errorText(e, t("The AI is busy. Try again in a moment.")));
    } finally {
      setBusy(false);
    }
  }

  function take(change: (d: Draft) => Draft, close: () => void) {
    setUndo({ question: q.question, options: q.options, correct: q.correct });
    onChange(change);
    close();
  }

  const label = ownLabel ?? (mode === "question" ? t("Rephrase") : hasOptions ? t("Improve options") : t("Suggest options"));
  return (
    <div className={`air ${className}`}>
      <Popover
        align="right"
        className="air-pop"
        trigger={(open, toggle) => (
          <button
            type="button"
            className={`air-btn ${open ? "on" : ""}`}
            disabled={!ready}
            title={ready ? label : t("Write the question first")}
            aria-haspopup="dialog"
            aria-expanded={open}
            onClick={() => {
              if (!open) load(tone);
              toggle();
            }}
          >
            <Wand2 size={14} /> <span>{label}</span>
          </button>
        )}
      >
        {(close) => (
          <div className="air-menu">
            <div className="air-tones" role="radiogroup" aria-label={t("Tone")}>
              {TONES.map((x) => (
                <button key={x.id} type="button" role="radio" aria-checked={tone === x.id} className={tone === x.id ? "on" : ""} disabled={busy} onClick={() => load(x.id)}>
                  {t(x.label)}
                </button>
              ))}
            </div>
            {busy ? (
              <Loading rows={mode === "question" ? 3 : Math.max(q.options.filter((o) => o.trim()).length, 3)} text={t("Writing…")} />
            ) : error ? (
              <p className="air-error">{error}</p>
            ) : result && mode === "question" ? (
              <div className="air-list">
                {result.suggestions.map((s, i) => (
                  <button key={i} type="button" className="air-pick" onClick={() => take((d) => ({ ...d, question: s }), close)}>
                    {s}
                  </button>
                ))}
              </div>
            ) : result ? (
              <div className="air-options">
                <ul>
                  {result.options.map((o, k) => {
                    const before = q.options.filter((x) => x.trim())[k];
                    return (
                      <li key={k} className={before === o ? "" : "new"}>
                        {before && before !== o && <s>{before}</s>}
                        <span>{o}</span>
                      </li>
                    );
                  })}
                </ul>
                <button
                  type="button"
                  className="aid-primary small"
                  onClick={() => take((d) => ({ ...d, options: result.options, correct: d.kind === "quiz" ? Math.min(filledIndex(d.options, d.correct) ?? 0, Math.max(0, result.options.length - 1)) : d.correct }), close)}
                >
                  {t("Use these options")}
                </button>
              </div>
            ) : null}
            <div className="air-foot">
              <button type="button" className="aid-ghost small" disabled={busy} onClick={() => load(tone)}><RotateCcw size={13} /> {t("More ideas")}</button>
            </div>
          </div>
        )}
      </Popover>
      {undo && (
        <button type="button" className="air-undo" title={t("Undo")} aria-label={t("Undo the AI change")} onClick={() => { onChange((d) => ({ ...d, ...undo })); setUndo(null); }}>
          <Undo2 size={14} />
        </button>
      )}
    </div>
  );
}
