import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowLeftRight, ArrowUp, ChartNoAxesColumn, Check, ChevronDown, CircleOff, Copy, Flag, ImagePlus, Keyboard, Layers, LoaderPinwheel, MousePointerClick, Play, Plus, Repeat, Save, Trash2, Users, Wand2, X } from "lucide-react";
import { api, ApiError, displayName, useUser } from "../api";
import { guardLeave, navigate, rememberPage } from "../router";
import { refreshDecks } from "../decks";
import { saveHostKey } from "../room";
import { CATEGORIES, CONTACT_FIELDS, KINDS, SCALE_STYLES, TIMERS, TIMER_MAX, TIMER_MIN, TOPICS_KIND, emptyDraft, hasImageField, parseNumber, switchKind, toDraft, toStored, type Draft, type ScaleStyle, type Stored, type UiKind } from "../questions";
import { compactTopics, MAX_TOPICS, moveDraft, ordered, pickerAt, removePicker, removeTopic, roundsProblems, topicColor, topicGroups, TOPIC_LENGTH } from "../rounds-draft";
import { FILL_LENGTH, MAX_BLANKS, MAX_DECOYS, parseFill } from "../fill";
import { COUNTDOWN_DEFAULT, COUNTDOWN_MAX, COUNTDOWN_MIN, MAX_PAIRS, MIN_ZONE, type Zone } from "../kinds";
import { mediaOf } from "../media";
import { MAX_ENTRIES } from "../wheel";
import { MediaPlayer } from "../kind-views";
import { uploadImage } from "../upload";
import type { Brand } from "../brand";
import { DesignCard } from "./DesignStudio";
import { addedQuestions, AiPanel, AiRewrite, isScored, mergeQuestions, type AiCall } from "../ai";
import { Popover } from "../menu";
import { LANGUAGES } from "../translate";
import { AppShell } from "./AppShell";
import { useAppT } from "../app-i18n";
import { KindPreview } from "../kind-preview";
import { needsNames, officialTemplate } from "../official-templates";
import { decorOffered, type Decor } from "../decor";
import { Pumpkin } from "../halloween-art";

// The results styles a rating can use, as named in the builder.
const STYLE_LABEL: Record<ScaleStyle, string> = { bars: "Bars", slider: "Slider", gauge: "Gauge", dots: "Dots" };

const MAX_OPTIONS = 10;

const emptyQuestion = () => emptyDraft();

// Starting point: a blank question (a Community presentation is fetched from ?shared=).
// A new presentation starts with one question; the home page's "Not tried yet" cards ask for a kind (?kind=quiz).
// A Hopvote template (?template=team-meeting-en) starts with its questions, its language and first names when it needs them.
const initialDraft = () => {
  const params = new URLSearchParams(location.search);
  const template = officialTemplate(params.get("template"));
  if (template) return { title: template.title, questions: template.questions.map(toDraft), from: template.title as string | null, official: true, lang: template.lang as string, names: needsNames(template.questions) };
  const kind = KINDS.find((k) => k.id === params.get("kind"))?.id;
  return { title: "", questions: [kind ? emptyDraft(kind) : emptyQuestion()], from: null as string | null, official: false, lang: "auto", names: false };
};

export function ImageField({ image, onChange }: { image?: string; onChange: (url?: string) => void }) {
  const t = useAppT();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function pick(file?: File) {
    if (!file) return;
    setError("");
    setBusy(true);
    try {
      onChange(await uploadImage(file));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Couldn't upload the image"));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="image-field">
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => pick(e.target.files?.[0])} />
      {image ? (
        <div className="image-preview">
          <img src={image} alt="" />
          <div className="image-tools">
            <button type="button" className="ghost small" onClick={() => input.current?.click()} disabled={busy}>{t("Replace")}</button>
            <button type="button" className="ghost small" onClick={() => onChange(undefined)}>{t("Remove")}</button>
          </div>
        </div>
      ) : (
        <button type="button" className="ghost add icon-text" onClick={() => input.current?.click()} disabled={busy}>
          <ImagePlus size={18} /> {busy ? t("Uploading…") : t("Add an image")}
        </button>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}

export function KindPicker({ value, onChange }: { value: Draft["kind"]; onChange: (k: Draft["kind"]) => void }) {
  const t = useAppT();
  return (
    <div className="kind-picker" role="radiogroup" aria-label={t("Question type")}>
      {CATEGORIES.map((cat) => (
        <div className="kind-group" key={cat}>
          <span className="kind-cat">{t(cat)}</span>
          <div className="kind-row">
            {KINDS.filter((k) => k.category === cat).map(({ id, label, icon: Icon }) => (
              <button type="button" key={id} role="radio" aria-checked={value === id} className={value === id ? "on" : ""} onClick={() => onChange(id)}>
                <Icon size={16} /> {t(label)}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// The time to answer a game: none, a usual length, or a time of one's own in seconds.
// The text with blanks as words to click: a word becomes a blank (between brackets), a blank becomes a word again.
const FILL_PARTS = /\[([^\[\]]*)\]|[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*|[^\[\]\p{L}\p{N}]+|[\[\]]/gu;
function FillPicker({ text, onChange }: { text: string; onChange: (text: string) => void }) {
  const t = useAppT();
  const parts = useMemo(() => {
    let n = 0;
    return [...text.matchAll(FILL_PARTS)].map((m) => {
      const start = m.index ?? 0;
      const end = start + m[0].length;
      if (m[1] !== undefined) return { kind: "blank" as const, text: m[1], start, end, n: ++n };
      return { kind: /^[\p{L}\p{N}]/u.test(m[0]) ? ("word" as const) : ("other" as const), text: m[0], start, end, n: 0 };
    });
  }, [text]);
  const full = parts.filter((p) => p.kind === "blank").length >= MAX_BLANKS;
  return (
    <div className="fill-pick">
      <p>
        {parts.map((p, i) =>
          p.kind === "blank" ? (
            <button type="button" key={i} className="fill-pick-blank" aria-label={t("Blank {n}: {word}. Click to make it a word again", { n: p.n, word: p.text })} onClick={() => onChange(text.slice(0, p.start) + p.text + text.slice(p.end))}>
              <b>{p.n}</b>
              {p.text || "…"}
            </button>
          ) : p.kind === "word" ? (
            <button type="button" key={i} className="fill-pick-word" disabled={full} onClick={() => onChange(`${text.slice(0, p.start)}[${p.text}]${text.slice(p.end)}`)}>
              {p.text}
            </button>
          ) : (
            <span key={i}>{p.text}</span>
          ),
        )}
      </p>
      <small>{full ? t("Up to 6 blanks.") : t("Click a word to make it a blank. Several right answers: [colour/color].")}</small>
    </div>
  );
}

// Extra words to place beside the answers, to make it harder.
function DecoyPick({ value, onChange }: { value: string[]; onChange: (words: string[]) => void }) {
  const t = useAppT();
  const [draft, setDraft] = useState("");
  function add(text = draft) {
    const words = text.split(",").map((w) => w.trim().slice(0, 60)).filter(Boolean);
    setDraft("");
    if (words.length) onChange([...new Set([...value, ...words])].slice(0, MAX_DECOYS));
  }
  return (
    <div className="field">
      <span>{t("Extra words (optional)")}</span>
      <div className="decoys">
        {value.map((word) => (
          <span key={word} className="decoy">
            {word}
            <button type="button" aria-label={t("Remove {word}", { word })} onClick={() => onChange(value.filter((w) => w !== word))}>
              <X size={14} />
            </button>
          </span>
        ))}
        {value.length < MAX_DECOYS && (
          <input
            value={draft}
            maxLength={60}
            placeholder={t("Add a word")}
            aria-label={t("Add a word")}
            // A comma adds the word at once.
            onChange={(e) => (e.target.value.includes(",") ? add(e.target.value) : setDraft(e.target.value))}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              } else if (e.key === "Backspace" && !draft && value.length) onChange(value.slice(0, -1));
            }}
            onBlur={() => add()}
          />
        )}
      </div>
      <p className="kind-hint">{t("Up to 6, mixed with the answers.")}</p>
    </div>
  );
}

function TimerPick({ value, onChange }: { value: number; onChange: (seconds: number) => void }) {
  const t = useAppT();
  const own = value > 0 && !TIMERS.includes(value);
  const [custom, setCustom] = useState(own);
  const [text, setText] = useState(own ? String(value) : "");
  const apply = (raw: string) => {
    setText(raw);
    const s = Number(raw);
    if (Number.isInteger(s) && s >= TIMER_MIN && s <= TIMER_MAX) onChange(s);
  };
  const ownBad = custom && text !== "" && !(Number.isInteger(Number(text)) && Number(text) >= TIMER_MIN && Number(text) <= TIMER_MAX);
  return (
    <div className="field">
      <span>{t("Time to answer")}</span>
      <div className="timer-pick">
        <div className="segmented" role="group" aria-label={t("Time to answer")}>
          {TIMERS.map((s) => (
            <button type="button" key={s} className={!custom && value === s ? "on" : ""} aria-pressed={!custom && value === s} onClick={() => (setCustom(false), onChange(s))}>
              {s ? t("{n}s", { n: s }) : t("None")}
            </button>
          ))}
          <button type="button" className={custom ? "on" : ""} aria-pressed={custom} onClick={() => (setCustom(true), text ? apply(text) : undefined)}>
            {t("Custom")}
          </button>
        </div>
        {custom && (
          <label className="timer-own">
            <input
              inputMode="numeric"
              aria-label={t("Seconds")}
              placeholder="45"
              value={text}
              onChange={(e) => apply(e.target.value.replace(/[^0-9]/g, "").slice(0, 3))}
            />
            <span>{t("seconds")}</span>
          </label>
        )}
      </div>
      {ownBad && <p className="error">{t("Between {a} and {b} seconds.", { a: TIMER_MIN, b: TIMER_MAX })}</p>}
    </div>
  );
}

// A list of short texts (options, items, statements) with a remove button each and one to add more.
function TextList({ q, onChange, label, item, add, numbered, tools }: { q: Draft; onChange: (change: (d: Draft) => Draft) => void; label: string; item: (n: number) => string; add: string; numbered?: boolean; tools?: React.ReactNode }) {
  const t = useAppT();
  return (
    <div className="field">
      <span>{label}</span>
      {q.options.map((option, oi) => (
        <div className="option-row" key={oi}>
          {numbered && <b className="order-n" aria-hidden>{oi + 1}</b>}
          <input maxLength={140} aria-label={item(oi + 1)} placeholder={item(oi + 1)} value={option} onChange={(e) => onChange((d) => ({ ...d, options: d.options.map((o, j) => (j === oi ? e.target.value : o)) }))} />
          {q.options.length > 2 && (
            <button type="button" className="icon" aria-label={t("Remove option {n}", { n: oi + 1 })} onClick={() => onChange((d) => ({ ...d, options: d.options.filter((_, j) => j !== oi) }))}>
              <X size={18} />
            </button>
          )}
        </div>
      ))}
      <div className="options-foot">
        {q.options.length < MAX_OPTIONS && (
          <button type="button" className="ghost add" onClick={() => onChange((d) => ({ ...d, options: [...d.options, ""] }))}>
            {add}
          </button>
        )}
        {tools}
      </div>
    </div>
  );
}

// The part of a question that depends on its type.
export function QuestionBody({ q, onChange, optionsTools }: { q: Draft; onChange: (change: (d: Draft) => Draft) => void; optionsTools?: React.ReactNode }) {
  const t = useAppT();
  const hint = t([...KINDS, TOPICS_KIND].find((k) => k.id === q.kind)!.hint);
  if (q.kind === "words" || q.kind === "open" || q.kind === "qa") return <p className="kind-hint">{hint}</p>;

  if (q.kind === "slide") {
    return (
      <div className="stack">
        <label className="field">
          <span>{t("Text (optional)")}</span>
          <textarea className="slide-input" maxLength={600} rows={3} placeholder={t("A break, an instruction, a key figure…")} value={q.text ?? ""} onChange={(e) => onChange((d) => ({ ...d, text: e.target.value }))} />
        </label>
        <p className="kind-hint">{t("Nothing to answer: phones show the same title, text and image.")}</p>
      </div>
    );
  }

  if (q.kind === "link") {
    return (
      <div className="stack">
        <label className="field">
          <span>{t("Link")}</span>
          <input type="url" inputMode="url" maxLength={500} placeholder="https://www.linkedin.com/in/…" value={q.url ?? ""} onChange={(e) => onChange((d) => ({ ...d, url: e.target.value }))} />
        </label>
        <p className="kind-hint">{t("The big screen shows a QR code to this link, and phones a button to open it. Add your own visual with the image if you like.")}</p>
      </div>
    );
  }

  if (q.kind === "number") {
    return (
      <div className="stack">
        <label className="field">
          <span>{t("Right answer (optional)")}</span>
          <input inputMode="decimal" maxLength={24} placeholder="1889" value={q.answer ?? ""} onChange={(e) => onChange((d) => ({ ...d, answer: e.target.value }))} />
        </label>
        {q.answer?.trim() && parseNumber(q.answer) === undefined && <p className="error">{t("The right answer must be a number.")}</p>}
        <p className="kind-hint">{parseNumber(q.answer) !== undefined ? t("The closest answers win points. The answer shows when you choose.") : t("Without a right answer, it's a poll: the screen shows the spread and the average.")}</p>
        {parseNumber(q.answer) !== undefined && <TimerPick value={q.timer ?? 0} onChange={(s) => onChange((d) => ({ ...d, timer: s }))} />}
      </div>
    );
  }

  if (q.kind === "order") {
    return (
      <div className="stack">
        <TextList q={q} onChange={onChange} label={t("Items, in the right order")} item={(n) => t("Item {n}", { n })} add={t("+ Add an item")} numbered tools={optionsTools} />
        <p className="kind-hint">{t("Phones get them shuffled. Those who find the order win points.")}</p>
        <TimerPick value={q.timer ?? 0} onChange={(s) => onChange((d) => ({ ...d, timer: s }))} />
      </div>
    );
  }

  if (q.kind === "scales") {
    const labels = q.labels ?? ["", ""];
    return (
      <div className="stack">
        <p className="kind-hint">{hint}</p>
        <TextList q={q} onChange={onChange} label={t("Statements to rate")} item={(n) => t("Statement {n}", { n })} add={t("+ Add a statement")} tools={optionsTools} />
        <div className="segmented" role="group" aria-label={t("Scale")}>
          {[5, 10].map((m) => (
            <button type="button" key={m} className={(q.max ?? 5) === m ? "on" : ""} aria-pressed={(q.max ?? 5) === m} onClick={() => onChange((d) => ({ ...d, max: m }))}>
              {t("1 to {n}", { n: m })}
            </button>
          ))}
        </div>
        <div className="scale-labels">
          <label className="field">
            <span>{t("Label for 1 (optional)")}</span>
            <input maxLength={40} placeholder={t("Not at all")} value={labels[0]} onChange={(e) => onChange((d) => ({ ...d, labels: [e.target.value, labels[1]] }))} />
          </label>
          <label className="field">
            <span>{t("Label for {n} (optional)", { n: q.max ?? 5 })}</span>
            <input maxLength={40} placeholder={t("Completely")} value={labels[1]} onChange={(e) => onChange((d) => ({ ...d, labels: [labels[0], e.target.value] }))} />
          </label>
        </div>
      </div>
    );
  }

  if (q.kind === "points") {
    return (
      <div className="stack">
        <p className="kind-hint">{hint}</p>
        <TextList q={q} onChange={onChange} label={t("Items to prioritize")} item={(n) => t("Item {n}", { n })} add={t("+ Add an item")} tools={optionsTools} />
      </div>
    );
  }

  if (q.kind === "fill") {
    const placing = q.fillMode !== "type";
    const setText = (fill: string) => onChange((d) => ({ ...d, fill: fill.slice(0, FILL_LENGTH) }));
    return (
      <div className="stack">
        <div className="field">
          <span>{t("How people answer")}</span>
          <div className="segmented fill-mode" role="group" aria-label={t("How people answer")}>
            <button type="button" className={placing ? "on" : ""} aria-pressed={placing} onClick={() => onChange((d) => ({ ...d, fillMode: "words" }))}>
              <MousePointerClick size={16} /> {t("Words to place")}
            </button>
            <button type="button" className={placing ? "" : "on"} aria-pressed={!placing} onClick={() => onChange((d) => ({ ...d, fillMode: "type" }))}>
              <Keyboard size={16} /> {t("Words to type")}
            </button>
          </div>
          <p className="kind-hint">{placing ? t("Phones show the answers and your extra words, to place in the blanks.") : t("People type each answer. One typo is forgiven in long words.")}</p>
        </div>
        <label className="field">
          <span>{t("Text with blanks")}</span>
          <textarea className="slide-input" maxLength={FILL_LENGTH} rows={3} placeholder={t("The capital of Australia is [Canberra].")} value={q.fill ?? ""} onChange={(e) => setText(e.target.value)} />
        </label>
        {(q.fill ?? "").trim() ? <FillPicker text={q.fill ?? ""} onChange={setText} /> : <p className="kind-hint">{t("Put each answer between brackets. Several right answers: [colour/color].")}</p>}
        {placing && <DecoyPick value={q.decoys ?? []} onChange={(decoys) => onChange((d) => ({ ...d, decoys }))} />}
        <TimerPick value={q.timer ?? 0} onChange={(s) => onChange((d) => ({ ...d, timer: s }))} />
      </div>
    );
  }

  if (q.kind === "match") {
    const pairs = q.pairs ?? [];
    const setPair = (i: number, side: 0 | 1, value: string) => onChange((d) => ({ ...d, pairs: (d.pairs ?? []).map((p, j) => (j === i ? (side ? [p[0], value] : [value, p[1]]) : p)) as [string, string][] }));
    return (
      <div className="stack">
        <div className="field">
          <span>{t("Pairs to match")}</span>
          {pairs.map(([a, b], i) => (
            <div className="pair-row" key={i}>
              <input maxLength={140} aria-label={t("Item {n}", { n: i + 1 })} placeholder={t("Item {n}", { n: i + 1 })} value={a} onChange={(e) => setPair(i, 0, e.target.value)} />
              <span className="pair-link" aria-hidden><ArrowLeftRight size={16} /></span>
              <input maxLength={140} aria-label={t("Its pair")} placeholder={t("Its pair")} value={b} onChange={(e) => setPair(i, 1, e.target.value)} />
              {pairs.length > 2 && (
                <button type="button" className="icon" aria-label={t("Remove pair {n}", { n: i + 1 })} onClick={() => onChange((d) => ({ ...d, pairs: (d.pairs ?? []).filter((_, j) => j !== i) }))}>
                  <X size={18} />
                </button>
              )}
            </div>
          ))}
          {pairs.length < MAX_PAIRS && (
            <div className="options-foot">
              <button type="button" className="ghost add" onClick={() => onChange((d) => ({ ...d, pairs: [...(d.pairs ?? []), ["", ""]] }))}>{t("+ Add a pair")}</button>
            </div>
          )}
        </div>
        <p className="kind-hint">{t("Phones get the right column shuffled. Each right pair earns points.")}</p>
        <TimerPick value={q.timer ?? 0} onChange={(s) => onChange((d) => ({ ...d, timer: s }))} />
      </div>
    );
  }

  if (q.kind === "spot") return <SpotEditor q={q} onChange={onChange} />;

  if (q.kind === "wheel") {
    const filled = q.options.filter((o) => o.trim()).length;
    return (
      <div className="stack">
        <label className="field">
          <span>{t("Entries, one per line (optional)")}</span>
          <textarea
            className="slide-input"
            rows={Math.min(10, Math.max(4, q.options.length + 1))}
            placeholder={t("Leave empty to spin among the first names")}
            value={q.options.join("\n")}
            onChange={(e) => onChange((d) => ({ ...d, options: e.target.value.split("\n").slice(0, MAX_ENTRIES).map((o) => o.slice(0, 60)) }))}
          />
        </label>
        <p className="kind-hint">{filled ? t("Each spin picks one at random, then takes it off the wheel.") : t("Empty, it spins among the first names of the people connected. Ask for first names in the settings.")}</p>
      </div>
    );
  }

  if (q.kind === "countdown") return <DurationPick value={q.duration ?? COUNTDOWN_DEFAULT} onChange={(s) => onChange((d) => ({ ...d, duration: s }))} />;

  if (q.kind === "media") {
    const media = q.url?.trim() ? mediaOf(q.url) : null;
    return (
      <div className="stack">
        <label className="field">
          <span>{t("Video or audio link")}</span>
          <input type="url" inputMode="url" maxLength={500} placeholder="https://www.youtube.com/watch?v=…" value={q.url ?? ""} onChange={(e) => onChange((d) => ({ ...d, url: e.target.value }))} />
        </label>
        {q.url?.trim() && !media && <p className="error">{t("This link can't be played. Use YouTube, Vimeo, SoundCloud, Spotify, Google Drive, or a video or audio file.")}</p>}
        {media && (
          <div className="media-preview">
            <MediaPlayer url={q.url!} />
          </div>
        )}
        <p className="kind-hint">{t("It plays on the big screen. Phones can play it too, for people following from afar.")}</p>
      </div>
    );
  }

  if (q.kind === "contact") {
    const fields = q.fields ?? [];
    return (
      <div className="stack">
        <p className="kind-hint">{hint}</p>
        <div className="field">
          <span>{t("Details to ask for")}</span>
          <div className="contact-fields">
            {CONTACT_FIELDS.map((f) => (
              <label key={f.id} className={`check-pill ${fields.includes(f.id) ? "on" : ""}`}>
                <input
                  type="checkbox"
                  checked={fields.includes(f.id)}
                  onChange={(e) =>
                    onChange((d) => ({
                      ...d,
                      fields: e.target.checked ? [...(d.fields ?? []), f.id] : (d.fields ?? []).filter((x) => x !== f.id),
                    }))
                  }
                />
                {t(f.label)}
              </label>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (q.kind === "scale") {
    const labels = q.labels ?? ["", ""];
    return (
      <div className="stack">
        <p className="kind-hint">{hint}</p>
        <div className="segmented" role="group" aria-label={t("Scale")}>
          {[5, 10].map((m) => (
            <button type="button" key={m} className={(q.max ?? 5) === m ? "on" : ""} aria-pressed={(q.max ?? 5) === m} onClick={() => onChange((d) => ({ ...d, max: m }))}>
              {t("1 to {n}", { n: m })}
            </button>
          ))}
        </div>
        {/* How the results show on the big screen and the phones. */}
        <div className="field">
          <span>{t("Results style")}</span>
          <div className="segmented style-pick" role="group" aria-label={t("Results style")}>
            {SCALE_STYLES.map((s) => (
              <button type="button" key={s} className={(q.style ?? "bars") === s ? "on" : ""} aria-pressed={(q.style ?? "bars") === s} onClick={() => onChange((d) => ({ ...d, style: s }))}>
                {t(STYLE_LABEL[s])}
              </button>
            ))}
          </div>
        </div>
        <div className="scale-labels">
          <label className="field">
            <span>{t("Label for 1 (optional)")}</span>
            <input maxLength={40} placeholder={t("Not at all")} value={labels[0]} onChange={(e) => onChange((d) => ({ ...d, labels: [e.target.value, labels[1]] }))} />
          </label>
          <label className="field">
            <span>{t("Label for {n} (optional)", { n: q.max ?? 5 })}</span>
            <input maxLength={40} placeholder={t("Completely")} value={labels[1]} onChange={(e) => onChange((d) => ({ ...d, labels: [labels[0], e.target.value] }))} />
          </label>
        </div>
      </div>
    );
  }

  const quiz = q.kind === "quiz";
  const rank = q.kind === "rank";
  return (
    <div className="stack">
      {rank && <p className="kind-hint">{hint}</p>}
      {quiz && (
        <div className="quiz-settings">
          <TimerPick value={q.timer ?? 0} onChange={(s) => onChange((d) => ({ ...d, timer: s }))} />
          <button type="button" className="ghost small" onClick={() => onChange((d) => ({ ...d, options: [t("True"), t("False")], correct: 0 }))}>
            {t("True / False")}
          </button>
        </div>
      )}
      <div className="field">
        <span>{quiz ? t("Options, tick the right answer") : rank ? t("Items to rank") : t("Options")}</span>
        {q.options.map((option, oi) => (
          <div className="option-row" key={oi}>
            {quiz && (
              <button
                type="button"
                className={`right-pick ${q.correct === oi ? "on" : ""}`}
                aria-label={t("Right answer")}
                aria-pressed={q.correct === oi}
                onClick={() => onChange((d) => ({ ...d, correct: oi }))}
              >
                <Check size={16} strokeWidth={3} />
              </button>
            )}
            <input
              maxLength={140}
              aria-label={rank ? t("Item {n}", { n: oi + 1 }) : t("Option {n}", { n: oi + 1 })}
              placeholder={rank ? t("Item {n}", { n: oi + 1 }) : t("Option {n}", { n: oi + 1 })}
              value={option}
              onChange={(e) => onChange((d) => ({ ...d, options: d.options.map((o, j) => (j === oi ? e.target.value : o)) }))}
            />
            {q.options.length > 2 && (
              <button
                type="button"
                className="icon"
                aria-label={t("Remove option {n}", { n: oi + 1 })}
                onClick={() =>
                  onChange((d) => ({
                    ...d,
                    options: d.options.filter((_, j) => j !== oi),
                    correct: d.correct === undefined ? undefined : d.correct === oi ? 0 : d.correct > oi ? d.correct - 1 : d.correct,
                  }))
                }
              >
                <X size={18} />
              </button>
            )}
          </div>
        ))}
        <div className="options-foot">
          {q.options.length < MAX_OPTIONS && (
            <button type="button" className="ghost add" onClick={() => onChange((d) => ({ ...d, options: [...d.options, ""] }))}>
              {rank ? t("+ Add an item") : t("+ Add an option")}
            </button>
          )}
          {optionsTools}
        </div>
      </div>
      {q.kind === "choice" && (
        <label className="toggle">
          <input type="checkbox" checked={!!q.multi} onChange={(e) => onChange((d) => ({ ...d, multi: e.target.checked }))} />
          <span className="toggle-ui" />
          {t("Allow several answers")}
        </label>
      )}
      {quiz && <p className="kind-hint">{q.timer ? t("Faster answers earn more points.") : t("1,000 points per right answer.")}</p>}
    </div>
  );
}

// Find on the image: the image to tap, and the right zone drawn on it with the mouse or a finger (optional).
function SpotEditor({ q, onChange }: { q: Draft; onChange: (change: (d: Draft) => Draft) => void }) {
  const t = useAppT();
  const box = useRef<HTMLDivElement>(null);
  const from = useRef<[number, number] | null>(null);
  const [draft, setDraft] = useState<Zone | null>(null);
  const zone = draft ?? q.zone ?? null;
  const at = (e: React.PointerEvent): [number, number] => {
    const r = box.current!.getBoundingClientRect();
    return [Math.round(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * 1000), Math.round(Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) * 1000)];
  };
  const rect = (a: [number, number], b: [number, number]): Zone => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1])];
  if (!q.image) {
    return (
      <div className="stack">
        <p className="kind-hint">{t("Add the image people tap: a map, a diagram, a photo.")}</p>
        <ImageField image={q.image} onChange={(image) => onChange((d) => ({ ...d, image }))} />
      </div>
    );
  }
  return (
    <div className="stack">
      <div className="field">
        <span>{t("Right zone (optional)")}</span>
        <div
          ref={box}
          className="spot-edit"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            from.current = at(e);
            setDraft([...from.current, 0, 0]);
          }}
          onPointerMove={(e) => from.current && setDraft(rect(from.current, at(e)))}
          onPointerUp={(e) => {
            if (!from.current) return;
            const z = rect(from.current, at(e));
            from.current = null;
            setDraft(null);
            if (z[2] >= MIN_ZONE && z[3] >= MIN_ZONE) onChange((d) => ({ ...d, zone: z }));
          }}
        >
          <img src={q.image} alt="" draggable={false} />
          {zone && zone[2] > 0 && <span className="spot-zone" style={{ left: `${zone[0] / 10}%`, top: `${zone[1] / 10}%`, width: `${zone[2] / 10}%`, height: `${zone[3] / 10}%` }} />}
        </div>
      </div>
      <div className="row-actions spot-tools">
        {q.zone && <button type="button" className="ghost small" onClick={() => onChange((d) => ({ ...d, zone: undefined }))}>{t("Clear the zone")}</button>}
        <button type="button" className="ghost small" onClick={() => onChange((d) => ({ ...d, image: undefined, zone: undefined }))}>{t("Change the image")}</button>
      </div>
      <p className="kind-hint">{q.zone ? t("A game: those who tap inside the zone win points. The zone shows when you choose.") : t("Drag on the image to mark the right zone. Without one, it's a poll: the screen shows where everyone tapped.")}</p>
      {q.zone && <TimerPick value={q.timer ?? 0} onChange={(s) => onChange((d) => ({ ...d, timer: s }))} />}
    </div>
  );
}

// A timer's length: a usual one, or minutes and seconds of one's own.
const DURATIONS = [60, 180, 300, 600, 900];
function DurationPick({ value, onChange }: { value: number; onChange: (seconds: number) => void }) {
  const t = useAppT();
  const [custom, setCustom] = useState(!DURATIONS.includes(value));
  const [min, setMin] = useState(String(Math.floor(value / 60)));
  const [sec, setSec] = useState(String(value % 60).padStart(2, "0"));
  const apply = (m: string, s: string) => {
    setMin(m);
    setSec(s);
    const total = Number(m || 0) * 60 + Number(s || 0);
    if (total >= COUNTDOWN_MIN && total <= COUNTDOWN_MAX) onChange(total);
  };
  const total = Number(min || 0) * 60 + Number(sec || 0);
  return (
    <div className="stack">
      <div className="field">
        <span>{t("Length")}</span>
        <div className="timer-pick">
          <div className="segmented" role="group" aria-label={t("Length")}>
            {DURATIONS.map((s) => (
              <button type="button" key={s} className={!custom && value === s ? "on" : ""} aria-pressed={!custom && value === s} onClick={() => (setCustom(false), onChange(s))}>
                {t("{n} min", { n: s / 60 })}
              </button>
            ))}
            <button type="button" className={custom ? "on" : ""} aria-pressed={custom} onClick={() => setCustom(true)}>{t("Custom")}</button>
          </div>
          {custom && (
            <label className="timer-own duration-own">
              <input inputMode="numeric" aria-label={t("Minutes")} value={min} onChange={(e) => apply(e.target.value.replace(/[^0-9]/g, "").slice(0, 2), sec)} />
              <span>:</span>
              <input inputMode="numeric" aria-label={t("Seconds")} value={sec} onChange={(e) => apply(min, e.target.value.replace(/[^0-9]/g, "").slice(0, 2))} />
            </label>
          )}
        </div>
        {custom && (total < COUNTDOWN_MIN || total > COUNTDOWN_MAX || Number(sec) > 59) && <p className="error">{t("From 10 seconds to 60 minutes.")}</p>}
      </div>
      <p className="kind-hint">{t("A big countdown on the screen and the phones. You start, pause and add a minute while presenting.")}</p>
    </div>
  );
}

// What keeps a question from being saved, said before the server is asked (the server checks it again).
const validLink = (url: string | undefined) => {
  const text = (url ?? "").trim();
  if (!text) return false;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`);
    return (u.protocol === "https:" || u.protocol === "http:") && u.hostname.includes(".");
  } catch {
    return false;
  }
};
// `names`: the presentation asks for first names (a wheel without entries spins among them).
function draftProblem(q: Draft, names: boolean) {
  const filled = q.options.filter((o) => o.trim()).length;
  if (q.kind === "points" && filled < 2) return "Question {n}: add at least 2 items";
  if (q.kind === "fill") {
    const { answers } = parseFill(q.fill ?? "");
    if (!answers.length) return "Question {n}: put the answers between brackets";
    if (answers.length > MAX_BLANKS) return "Question {n}: up to 6 blanks";
    if (answers.some((a) => !a.length)) return "Question {n}: each blank needs its answer";
  }
  if (q.kind === "match") {
    const pairs = (q.pairs ?? []).filter(([a, b]) => a.trim() || b.trim());
    if (pairs.some(([a, b]) => !a.trim() || !b.trim())) return "Question {n}: each pair needs both sides";
    if (pairs.length < 2) return "Question {n}: add at least 2 pairs";
  }
  if (q.kind === "spot" && !q.image) return "Question {n}: add the image";
  if (q.kind === "wheel" && filled === 1) return "Question {n}: add at least 2 entries";
  if (q.kind === "wheel" && filled === 0 && !names) return "Question {n}: add entries, or ask for first names";
  if (q.kind === "media" && !mediaOf(q.url ?? "")) return "Question {n}: add a video or audio link";
  if ((q.kind === "choice" || q.kind === "quiz" || q.kind === "rank") && filled < 2) return "Question {n}: add at least 2 options";
  if (q.kind === "quiz" && !(q.options[q.correct ?? 0] ?? "").trim()) return "Question {n}: the right answer is an empty option";
  if (q.kind === "link" && !validLink(q.url)) return "Question {n}: add a valid link";
  if (q.kind === "scales" && filled < 2) return "Question {n}: add at least 2 statements";
  if (q.kind === "order" && filled < 2) return "Question {n}: add at least 2 items";
  if (q.kind === "number" && q.answer?.trim() && parseNumber(q.answer) === undefined) return "Question {n}: the right answer must be a number";
  return null;
}

// The quiz leaderboard setting (src/board.ts), with its hint once chosen.
// "round": with topic rounds only, the standings at the end of each round.
type BoardChoice = "each" | "round" | "end" | "off";
const BOARD_CHOICES: { id: BoardChoice; label: string; hint: string; icon: typeof Flag }[] = [
  { id: "each", label: "After each question", hint: "Standings, then the podium at the end", icon: Repeat },
  { id: "round", label: "After each round", hint: "Standings at the end of each round, then the podium", icon: Layers },
  { id: "end", label: "At the end", hint: "Podium after the last question", icon: Flag },
  { id: "off", label: "Off", hint: "Right answers only, no ranking", icon: CircleOff },
];

type Saved = { title: string; questions: Stored[]; participants: number; names?: boolean; intro?: boolean; boardMode?: BoardChoice | null; decor?: Decor | null; brand?: Brand | null; lang?: string; detected?: string; edited?: { at: number; name: string } | null };

// Builds a new presentation, or edits an existing one when `edit` holds its code.
export function Create({ edit }: { edit?: string }) {
  const t = useAppT();
  const user = useUser();
  const [start] = useState(initialDraft);
  const [title, setTitle] = useState(edit ? "" : start.title);
  // Kept in the order topic rounds need (src/rounds-draft.ts): a list without them is left exactly as it is.
  const [questions, setQuestionsRaw] = useState<Draft[]>(edit ? [] : start.questions);
  const setQuestions = (next: Draft[] | ((list: Draft[]) => Draft[])) => setQuestionsRaw((list) => ordered(typeof next === "function" ? next(list) : next));
  const [answered, setAnswered] = useState(0);
  const [names, setNames] = useState(!edit && start.names);
  // The launch animation: a curtain and "Here we go!" when the presenter starts.
  const [intro, setIntro] = useState(false);
  // The quiz leaderboard: a new presentation shows the podium at the end; one saved before the setting has none
  // (the Leaderboard button only) until a choice is made, and saves without it.
  // A template with topic rounds starts with the standings after each round.
  const [boardMode, setBoardMode] = useState<BoardChoice | null>(edit ? null : start.questions.some((q) => q.kind === "topics") ? "round" : "end");
  const [brand, setBrand] = useState<Brand>({});
  // The seasonal decor: offered until its end date (src/decor.ts), then the choice goes away.
  const [decor, setDecor] = useState<Decor | null>(null);
  const [halloween] = useState(() => decorOffered("halloween"));
  // Teams: teammates editing the same presentation now, and a save of theirs since this page opened.
  const [others, setOthers] = useState<string[]>([]);
  const [conflict, setConflict] = useState("");
  const base = useRef(0);
  // The language the questions are written in; phones translate from it. "auto" lets the server detect it.
  const [lang, setLang] = useState(edit ? "auto" : start.lang);
  // A community template is fetched before the builder shows.
  const [shared] = useState(() => (edit ? null : new URLSearchParams(location.search).get("shared")));
  const [from, setFrom] = useState(start.from);
  const [loaded, setLoaded] = useState(!edit && !shared);
  const [trimmed, setTrimmed] = useState(false);
  const [maxQuestions, setMaxQuestions] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // Something typed or changed: leaving asks first, so work is never lost by a stray click.
  const [dirty, setDirty] = useState(false);
  const saving = useRef(false);
  // "Save" keeps the builder open; launching saves then opens the presentation. A new one saved this way gets its code
  // here, and every later save updates it instead of making another.
  const [created, setCreated] = useState<string | null>(null);
  const code = edit ?? created ?? undefined;
  const intent = useRef<"stay" | "open">("open");
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => {
    if (!user) return;
    api<{ polls: unknown[]; limits: { questions: number; decks: number | null } }>("/api/polls").then(
      (d) => {
        setMaxQuestions(d.limits.questions);
      },
      () => {},
    );
  }, [user]);

  useEffect(() => {
    if (!dirty) return;
    setJustSaved(false);
    const question = code ? t("Leave without saving your changes?") : t("Leave without creating your presentation? Your questions will be lost.");
    guardLeave(question);
    const onUnload = (e: BeforeUnloadEvent) => {
      if (!saving.current) e.preventDefault();
    };
    // A move that keeps this page on screen (New presentation clicked here) clears the question: ask it again next time.
    const rearm = () => {
      if (!saving.current) guardLeave(question);
    };
    addEventListener("beforeunload", onUnload);
    addEventListener("popstate", rearm);
    return () => {
      guardLeave(null);
      removeEventListener("beforeunload", onUnload);
      removeEventListener("popstate", rearm);
    };
  }, [dirty, code]);

  // A template can have more questions than a presentation allows: keep the first ones.
  useEffect(() => {
    if (edit || maxQuestions === null || !loaded || questions.length <= maxQuestions) return;
    setTrimmed(true);
    setQuestions((list) => list.slice(0, maxQuestions));
  }, [maxQuestions, loaded]);

  // A new presentation starts with the last brand used.
  useEffect(() => {
    if (!user || edit) return;
    api<{ brand: Brand | null }>("/api/account").then((a) => a.brand && setBrand((b) => (Object.keys(b).length ? b : a.brand!)), () => {});
  }, [user, edit]);

  useEffect(() => {
    if (!user || !shared) return;
    api<{ template: { title: string; questions: Stored[] } }>(`/api/templates/${shared}/use`, { method: "POST" }).then(
      ({ template }) => {
        setTitle(template.title);
        setQuestions(template.questions.map(toDraft));
        if (template.questions.some((q) => q.topics)) setBoardMode("round");
        // Games that score points need first names for their leaderboard.
        if (template.questions.some(isScored)) setNames(true);
        setFrom(template.title);
        setLoaded(true);
      },
      (e) => setError(e.message),
    );
  }, [user, shared]);

  useEffect(() => {
    if (!user || !edit) return;
    api<Saved>(`/api/polls/${edit}`).then(
      (d) => {
        setTitle(d.title);
        const drafts = d.questions.map(toDraft);
        setQuestions(drafts);
        // A saved presentation with topic rounds opens with its first topic unfolded, the others folded.
        const p = pickerAt(drafts);
        if (p >= 0) setFolded(Object.fromEntries(drafts[p].options.map((_, i) => [i, i > 0])));
        setAnswered(d.participants);
        setNames(!!d.names);
        setIntro(!!d.intro);
        setBoardMode(d.boardMode ?? null);
        setDecor(d.decor ?? null);
        base.current = d.edited?.at ?? 0;
        setBrand(d.brand ?? {});
        // A language that only came from detection shows as "Detect": the next save detects again.
        if (d.lang && d.lang !== d.detected) setLang(d.lang);
        setLoaded(true);
      },
      (e) => setError(e.message),
    );
  }, [user, edit]);

  // Says every 20 seconds that this person is editing, and learns who else is (teams).
  useEffect(() => {
    if (!code || !loaded) return;
    const ping = () => {
      if (document.visibilityState !== "visible") return;
      api<{ others: string[] }>(`/api/polls/${code}/editing`, { method: "POST" }).then((d) => setOthers(d.others), () => {});
    };
    ping();
    const timer = setInterval(ping, 20_000);
    document.addEventListener("visibilitychange", ping);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", ping);
    };
  }, [code, loaded]);

  const update = (qi: number, change: (q: Draft) => Draft) => setQuestions((list) => list.map((q, i) => (i === qi ? change(q) : q)));
  // Topic rounds: the picker, each topic's questions, the topics folded, and the deletions waiting for a yes.
  const [folded, setFolded] = useState<Record<number, boolean>>({});
  const [confirmTopic, setConfirmTopic] = useState<number | null>(null);
  const [dropRounds, setDropRounds] = useState<UiKind | "delete" | null>(null);
  const p = pickerAt(questions);
  const hasRounds = p >= 0;
  const groups = topicGroups(questions);
  // Said on the cards once a save was tried: an empty topic is normal while building.
  const [showProblems, setShowProblems] = useState(false);
  const problems = showProblems ? roundsProblems(questions) : [];
  // The leaderboard after each round becomes the default when rounds arrive while it is still "at the end",
  // and goes back to "at the end" when they leave. A presentation opened with its own setting keeps it.
  const hadRounds = useRef<boolean | null>(null);
  useEffect(() => {
    if (!loaded) return;
    if (hadRounds.current === null) return void (hadRounds.current = hasRounds);
    if (hasRounds && !hadRounds.current && boardMode === "end") setBoardMode("round");
    if (!hasRounds && hadRounds.current && boardMode === "round") setBoardMode("end");
    hadRounds.current = hasRounds;
  }, [hasRounds, loaded]);
  const aiCall: AiCall = (action, body) => api(`/api/ai/${action}`, { body });
  const canAddQuestion = maxQuestions === null || questions.length < maxQuestions;
  // Some question earns points (a quiz, a number to find, a right order, blanks, pairs, a spot): it has a leaderboard.
  const scored = questions.some((q) => isScored(toStored(q)));
  // A new presentation's first game turns first names on, once, for the leaderboard chosen by default.
  const namesForBoard = useRef(false);
  useEffect(() => {
    if (edit || !scored || namesForBoard.current || (boardMode !== "each" && boardMode !== "round" && boardMode !== "end")) return;
    namesForBoard.current = true;
    setNames(true);
  }, [scored]);

  async function launch(e: React.FormEvent) {
    e.preventDefault();
    intent.current = "open";
    await save(false);
  }

  // `force`: a teammate saved in between and this person keeps their own version.
  async function save(force: boolean) {
    setError("");
    setConflict("");
    const empty = questions.findIndex((q) => !q.question.trim());
    if (empty >= 0) {
      setError(t("Question {n} has no text yet", { n: empty + 1 }));
      document.getElementById(`q-${empty}`)?.focus();
      return;
    }
    const problem = questions.map((q) => draftProblem(q, names)).findIndex(Boolean);
    if (problem >= 0) {
      setError(t(draftProblem(questions[problem], names)!, { n: problem + 1 }));
      document.getElementById(`q-${problem}`)?.focus();
      return;
    }
    // Topic rounds: named topics, each with its questions (said on the picker and the topics too).
    const rounds = roundsProblems(compactTopics(questions))[0];
    if (rounds) {
      setShowProblems(true);
      setError(t("Question {n}: {problem}", { n: rounds.vars.n, problem: t(rounds.text, rounds.vars) }));
      if (typeof rounds.where === "number") {
        // The problem is a topic's (counted among the topics saved): its section opens, its "Add a question" button takes
        // the focus, next to the message.
        const all = topicGroups(questions);
        const kept = questions[p].options.flatMap((o, i) => (o.trim() || all[i].length ? [i] : []));
        const ti = kept[rounds.where] ?? rounds.where;
        setFolded((f) => ({ ...f, [ti]: false }));
        requestAnimationFrame(() => {
          const add = document.getElementById(`topic-add-${ti}`);
          add?.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
          add?.focus({ preventScroll: true });
        });
      } else document.getElementById(`q-${p}`)?.focus();
      return;
    }
    const stored = compactTopics(questions).map(toStored);
    const stay = intent.current === "stay";
    setBusy(true);
    setJustSaved(false);
    saving.current = true;
    guardLeave(null);
    try {
      let at = code;
      if (code) {
        await api(`/api/polls/${code}`, { method: "PUT", body: { title, names, intro, ...(boardMode ? { boardMode } : {}), ...(halloween ? { decor } : {}), brand, lang: lang === "auto" ? undefined : lang, questions: stored, base: base.current, force } });
        refreshDecks().catch(() => {});
      } else {
        const data = await api<{ code: string; hostKey: string }>("/api/rooms", { body: { title, names, intro, ...(boardMode ? { boardMode } : {}), ...(halloween ? { decor } : {}), brand, lang: lang === "auto" ? undefined : lang, questions: stored } });
        saveHostKey(data.code, data.hostKey);
        refreshDecks().catch(() => {});
        at = data.code;
      }
      if (stay) {
        // Still in the builder: a reload or the Back button opens this presentation, not a blank one.
        if (!code) {
          setCreated(at!);
          history.replaceState(null, "", `/app/p/${at}/edit`);
          rememberPage();
        }
        saving.current = false;
        setDirty(false);
        setBusy(false);
        setJustSaved(true);
        return;
      }
      navigate(`/present/${at}`);
    } catch (err) {
      if (err instanceof ApiError && err.data.code === "conflict") setConflict(String(err.data.by ?? ""));
      else setError(err instanceof Error ? err.message : t("No connection"));
      setBusy(false);
      saving.current = false;
      if (dirty) guardLeave(code ? t("Leave without saving your changes?") : t("Leave without creating your presentation? Your questions will be lost."));
    }
  }

  // ↑ and ↓: with topic rounds a question can cross into the next topic (src/rounds-draft.ts); otherwise a plain swap.
  const move = (qi: number, by: -1 | 1) =>
    setQuestions((list) => {
      const next = moveDraft(list, qi, by);
      // The topic it lands in unfolds, so it stays in sight.
      const moved = next.find((q) => q === list[qi]) ?? next.find((q, i) => q !== list[i] && q.question === list[qi].question);
      if (moved?.topic !== undefined) setFolded((f) => ({ ...f, [moved.topic!]: false }));
      return next;
    });
  // A new topic rounds card: its title written, the rounds chosen by the wheel.
  const addKind = (k: UiKind, topic?: number) => {
    const draft = k === "topics" ? { ...emptyDraft("topics"), question: t("What will the next topic be?") } : emptyDraft(k);
    setQuestions((list) => [...list, topic === undefined ? draft : { ...draft, topic }]);
  };
  // A question changing kind; the picker changing kind loses its topics (asked first).
  const switchTo = (qi: number, k: UiKind) => {
    if (questions[qi].kind === "topics" && k !== "topics") return setDropRounds(k);
    update(qi, (d) => (k === "topics" ? { ...switchKind(d, k), pickedBy: "wheel", topic: undefined, options: d.options.some((o) => o.trim()) ? d.options.slice(0, MAX_TOPICS) : ["", "", ""] } : switchKind(d, k)));
  };
  const written = questions.filter((q) => q.question.trim()).length;

  // An ordinary question's card.
  const questionCard = (qi: number) => {
    const q = questions[qi];
    const kind = KINDS.find((k) => k.id === q.kind)!;
    return (
              <section key={qi} className="qc">
        <header className="qc-head">
          <span className="qc-n">{qi + 1}</span>
          <TypeMenu value={q.kind} topics={!hasRounds && q.topic === undefined} onChange={(k) => switchTo(qi, k)} />
          <div className="qc-tools">
            <button type="button" className="qc-icon" aria-label={t("Move up")} title={t("Move up")} disabled={qi === 0} onClick={() => move(qi, -1)}><ArrowUp size={16} /></button>
            <button type="button" className="qc-icon" aria-label={t("Move down")} title={t("Move down")} disabled={qi === questions.length - 1 && q.topic === undefined} onClick={() => move(qi, 1)}><ArrowDown size={16} /></button>
            <button type="button" className="qc-icon" aria-label={t("Duplicate")} title={t("Duplicate")} disabled={!canAddQuestion} onClick={() => setQuestions((list) => [...list.slice(0, qi + 1), structuredClone(q), ...list.slice(qi + 1)])}><Copy size={16} /></button>
            {questions.length > 1 && (
              <button type="button" className="qc-icon danger-hover" aria-label={t("Delete")} title={t("Delete")} onClick={() => setQuestions((list) => list.filter((_, i) => i !== qi))}><Trash2 size={16} /></button>
            )}
          </div>
        </header>
        <div className="qc-question">
          <input
            id={`q-${qi}`}
            aria-label={t("Question {n}", { n: qi + 1 })}
            autoFocus={qi === 0 && !edit && !q.question}
            maxLength={140}
            placeholder={
              kind.id === "qa" ? t("Your questions for the speaker")
                : kind.id === "slide" ? t("Slide title")
                : kind.id === "link" ? t("Title shown with the QR code")
                : kind.id === "points" ? t("Share 100 points between your priorities")
                : kind.id === "fill" ? t("Complete the sentence")
                : kind.id === "match" ? t("Match each country to its capital")
                : kind.id === "spot" ? t("Where is Lyon on this map?")
                : kind.id === "wheel" ? t("Who answers the next question?")
                : kind.id === "countdown" ? t("Group work")
                : kind.id === "media" ? t("Title shown above the video")
                : qi === 0 ? t("What format for the June offsite?") : t("Type your question")
            }
            value={q.question}
            onChange={(e) => update(qi, (d) => ({ ...d, question: e.target.value }))}
          />
          <AiRewrite q={q} mode="question" call={aiCall} lang={lang} title={title} onChange={(change) => update(qi, change)} />
        </div>
        <QuestionBody
          q={q}
          onChange={(change) => update(qi, change)}
          optionsTools={<AiRewrite q={q} mode="options" call={aiCall} lang={lang} title={title} onChange={(change) => update(qi, change)} />}
        />
        {hasImageField(q.kind) && <ImageField image={q.image} onChange={(image) => update(qi, (d) => ({ ...d, image }))} />}
      </section>
    );
  };

  // Topic rounds: the picker's card (who chooses, the topics, how many rounds), then each topic's section.
  const pickerCard = (qi: number) => {
    const q = questions[qi];
    const wheel = q.pickedBy !== "vote";
    const n = q.options.length;
    // The topics saved (named, or holding questions: compactTopics drops the empty rows): the rounds count those.
    const kept = q.options.filter((o, i) => o.trim() || (groups[i]?.length ?? 0) > 0).length;
    const rounds = q.rounds && q.rounds < kept ? q.rounds : undefined;
    const sizes = groups.filter((g, i) => g.length && q.options[i]?.trim()).map((g) => g.length);
    const own = problems.filter((x) => x.where === "picker");
    const after = questions.findIndex((x, i) => i > qi && x.topic === undefined);
    const setTopic = (i: number, value: string) => update(qi, (d) => ({ ...d, options: d.options.map((o, j) => (j === i ? value : o)) }));
    return (
      <div key={qi} className="rounds-block">
        <section className="qc qc-rounds">
          <header className="qc-head">
            <span className="qc-n">{qi + 1}</span>
            <TypeMenu value="topics" topics onChange={(k) => switchTo(qi, k)} />
            <div className="qc-tools">
              <button type="button" className="qc-icon" aria-label={t("Move up")} title={t("Move up")} disabled={qi === 0} onClick={() => move(qi, -1)}><ArrowUp size={16} /></button>
              <button type="button" className="qc-icon" aria-label={t("Move down")} title={t("Move down")} disabled={after < 0} onClick={() => move(qi, 1)}><ArrowDown size={16} /></button>
              <button type="button" className="qc-icon danger-hover" aria-label={t("Delete")} title={t("Delete")} onClick={() => setDropRounds("delete")}><Trash2 size={16} /></button>
            </div>
          </header>
          {dropRounds && (
            <div className="confirm-row rounds-confirm" role="alert">
              <span>{t("Remove the topic rounds? Their questions stay in the list.")}</span>
              <button
                type="button"
                className="danger small"
                onClick={() => {
                  const k = dropRounds;
                  setDropRounds(null);
                  if (k === "delete") setQuestions((list) => (list.length > 1 ? removePicker(list) : list));
                  else update(qi, (d) => ({ ...switchKind(d, k), pickedBy: undefined, rounds: undefined }));
                }}
              >
                {t("Yes")}
              </button>
              <button type="button" className="ghost small" onClick={() => setDropRounds(null)}>{t("No")}</button>
            </div>
          )}
          <div className="qc-question">
            <input id={`q-${qi}`} aria-label={t("Question {n}", { n: qi + 1 })} maxLength={140} placeholder={t("What will the next topic be?")} value={q.question} onChange={(e) => update(qi, (d) => ({ ...d, question: e.target.value }))} />
            <AiRewrite q={q} mode="question" call={aiCall} lang={lang} title={title} onChange={(change) => update(qi, change)} />
          </div>
          <div className="stack">
            <div className="field">
              <span>{t("Picked by")}</span>
              <div className="segmented rounds-how" role="group" aria-label={t("Picked by")}>
                <button type="button" className={wheel ? "on" : ""} aria-pressed={wheel} onClick={() => update(qi, (d) => ({ ...d, pickedBy: "wheel" }))}>
                  <LoaderPinwheel size={16} /> {t("Wheel")}
                </button>
                <button type="button" className={wheel ? "" : "on"} aria-pressed={!wheel} onClick={() => update(qi, (d) => ({ ...d, pickedBy: "vote" }))}>
                  <ChartNoAxesColumn size={16} /> {t("Room vote")}
                </button>
              </div>
            </div>
            <div className="field">
              <span>{t("Topics")}</span>
              {q.options.map((o, i) =>
                confirmTopic === i ? (
                  <div className="confirm-row topic-confirm" role="alert" key={i}>
                    <span>{groups[i].length === 1 ? t("Delete {topic} and its question?", { topic: o.trim() || t("Topic {n}", { n: i + 1 }) }) : t("Delete {topic} and its {n} questions?", { topic: o.trim() || t("Topic {n}", { n: i + 1 }), n: groups[i].length })}</span>
                    <button type="button" className="danger small" onClick={() => (setConfirmTopic(null), setFolded({}), setQuestions((list) => removeTopic(list, i)))}>{t("Yes")}</button>
                    <button type="button" className="ghost small" onClick={() => setConfirmTopic(null)}>{t("No")}</button>
                  </div>
                ) : (
                  <div className="option-row" key={i}>
                    {/* The slice's color on the wheel: a vote shows none. */}
                    {wheel && <span className="topic-sw" style={{ "--sw": topicColor(i) } as React.CSSProperties} aria-hidden />}
                    <input maxLength={TOPIC_LENGTH} aria-label={t("Topic {n}", { n: i + 1 })} placeholder={t("Topic {n}", { n: i + 1 })} value={o} onChange={(e) => setTopic(i, e.target.value)} />
                    {n > 2 && (
                      <button type="button" className="icon" aria-label={t("Remove {topic}", { topic: o.trim() || t("Topic {n}", { n: i + 1 }) })} onClick={() => (groups[i].length ? setConfirmTopic(i) : (setFolded({}), setQuestions((list) => removeTopic(list, i))))}>
                        <X size={18} />
                      </button>
                    )}
                  </div>
                ),
              )}
              <div className="options-foot">
                {n < MAX_TOPICS && (
                  <button type="button" className="ghost add" onClick={() => update(qi, (d) => ({ ...d, options: [...d.options, ""] }))}>
                    {t("+ Add a topic")}
                  </button>
                )}
                <AiRewrite
                  q={{ ...q, kind: "choice" }}
                  mode="options"
                  label={t("Suggest topics")}
                  call={aiCall}
                  lang={lang}
                  title={title}
                  onChange={(change) =>
                    update(qi, (d) => {
                      // New names for the topics in place: a topic keeps its questions; never more than 8.
                      const fresh = change({ ...d, kind: "choice" }).options.map((o) => o.slice(0, TOPIC_LENGTH)).slice(0, MAX_TOPICS);
                      return { ...d, options: fresh.length >= d.options.length ? fresh : [...fresh, ...d.options.slice(fresh.length)] };
                    })
                  }
                />
              </div>
            </div>
            <div className="field">
              <span>{t("Rounds to play")}</span>
              <div className="segmented" role="group" aria-label={t("Rounds to play")}>
                {Array.from({ length: Math.max(0, kept - 1) }, (_, k) => k + 1).map((r) => (
                  <button type="button" key={r} className={rounds === r ? "on" : ""} aria-pressed={rounds === r} onClick={() => update(qi, (d) => ({ ...d, rounds: r }))}>
                    {r}
                  </button>
                ))}
                <button type="button" className={rounds ? "" : "on"} aria-pressed={!rounds} onClick={() => update(qi, (d) => ({ ...d, rounds: undefined }))}>
                  {t("All topics")}
                </button>
              </div>
              <p className="kind-hint">
                {!rounds
                  ? wheel ? t("Every topic is played, in the order the wheel picks.") : t("Every topic is played, in the order the room picks.")
                  : rounds === 1 ? t("1 round out of {n} topics.", { n: kept }) : kept - rounds === 1 ? t("{r} rounds out of {n} topics: one topic stays aside.", { r: rounds, n: kept }) : t("{r} rounds out of {n} topics: {k} topics stay aside.", { r: rounds, n: kept, k: kept - rounds })}
              </p>
              {!!rounds && new Set(sizes).size > 1 && <p className="kind-hint">{t("The topics don't all have the same number of questions.")}</p>}
            </div>
            {own.map((x, i) => <p key={i} className="error">{t(x.text, x.vars)}</p>)}
          </div>
        </section>
        {q.options.map((name, ti) => {
          const list = groups[ti] ?? [];
          if (!name.trim() && !list.length) return null;
          const label = name.trim() || t("Topic {n}", { n: ti + 1 });
          const open = !folded[ti] || !list.length;
          const problem = problems.find((x) => x.where === ti);
          return (
            <section key={`t${ti}`} className={`topic-sec ${open ? "open" : ""}`}>
              <header className="topic-head">
                <button type="button" className="topic-fold" aria-expanded={open} aria-label={open ? t("Fold {topic}", { topic: label }) : t("Unfold {topic}", { topic: label })} disabled={!list.length} onClick={() => setFolded((f) => ({ ...f, [ti]: open }))}>
                  <ChevronDown size={18} />
                </button>
                {wheel && <span className="topic-sw sm" style={{ "--sw": topicColor(ti) } as React.CSSProperties} aria-hidden />}
                <strong className="truncate">{label}</strong>
                <span className="topic-n">{!list.length ? t("No questions yet") : list.length === 1 ? t("1 question") : t("{n} questions", { n: list.length })}</span>
                <span className="topic-tools">
                  <TopicAi
                    topic={name.trim()}
                    disabled={!canAddQuestion}
                    call={aiCall}
                    lang={lang}
                    title={title}
                    onAdd={(added) => {
                      setQuestions((current) => [...current, ...added.slice(0, Math.max(0, (maxQuestions ?? 50) - current.length)).map((x) => ({ ...toDraft(x), topic: ti }))]);
                      setFolded((f) => ({ ...f, [ti]: false }));
                      if (added.some(isScored)) setNames(true);
                    }}
                  />
                </span>
              </header>
              {open ? (
                <div className="topic-body">
                  {list.map((i) => questionCard(i))}
                  {problem && <p className="error topic-problem">{t(problem.text, problem.vars)}</p>}
                  <button type="button" id={`topic-add-${ti}`} className="add-q topic-add" disabled={!canAddQuestion} onClick={() => (addKind("quiz", ti), setDirty(true))}>
                    <Plus size={18} /> {t("Add a question to {topic}", { topic: label })}
                  </button>
                </div>
              ) : (
                <ol className="topic-peek">
                  {list.map((i) => (
                    <li key={i}><b>{i + 1}</b>{questions[i].question || t("Untitled question")}</li>
                  ))}
                </ol>
              )}
            </section>
          );
        })}
        {after >= 0 && <p className="bld-sep"><span>{t("After the rounds")}</span></p>}
      </div>
    );
  };
  const opening = busy && intent.current === "open";
  const launchLabel = opening ? (code ? t("Saving…") : t("Creating…")) : t("Launch presentation");

  return (
    <AppShell
      title={code ? t("Edit presentation") : t("New presentation")}
      subtitle={code ? t("Code {code}. The link and QR code stay the same.", { code }) : from ? (start.official && from === start.from ? t("From the \"{title}\" template", { title: from }) : t("From \"{title}\", shared in Community", { title: from })) : t("Your questions, then you're live.")}
    >
      {!loaded ? (
        error ? <p className="error" role="alert">{error}</p> : <p className="muted center-load" role="status" aria-live="polite"><span className="spinner" aria-hidden />{t("Loading…")}</p>
      ) : (
      <form
        className="bld"
        onSubmit={launch}
        onChange={() => setDirty(true)}
        onClick={(e) => (e.target as HTMLElement).closest(".bld-main button") && setDirty(true)}
        // Enter in a field must not launch a half-written presentation (fields in their own form, like the AI dialog, keep it).
        onKeyDown={(e) => {
          if (e.key === "Enter" && e.target instanceof HTMLInputElement && e.target.closest("form") === e.currentTarget) e.preventDefault();
        }}
      >
        <div className="bld-main">
          {others.length > 0 && (
            <p className="bld-presence" role="status">
              <Users size={17} /> {t("{name} is editing this presentation too", { name: others.map(displayName).join(", ") })}
            </p>
          )}
          {answered > 0 && (
            <p className="limit-note">
              {answered === 1
                ? t("Changing the questions clears the answers and contact details ({n} participant so far).", { n: answered })
                : t("Changing the questions clears the answers and contact details ({n} participants so far).", { n: answered })}
            </p>
          )}
          {trimmed && <p className="limit-note">{t("Only the first {n} questions are kept.", { n: maxQuestions ?? 0 })}</p>}

          <div className="bld-name">
            <input id="deck-title" aria-label={t("Presentation name")} maxLength={140} placeholder={t("Untitled presentation")} value={title} onChange={(e) => setTitle(e.target.value)} />
            <span>
              {maxQuestions !== null && maxQuestions <= 5
                ? t(questions.length === 1 ? "{n} question of {max}" : "{n} questions of {max}", { n: questions.length, max: maxQuestions })
                : t(questions.length === 1 ? "{n} question" : "{n} questions", { n: questions.length })}
            </span>
          </div>

          {/* Each question as a card; with topic rounds, the picker's card, then a section per topic holding its questions. */}
          {questions.map((q, qi) => {
            if (hasRounds && q.topic !== undefined) return null;
            if (q.kind === "topics") return pickerCard(qi);
            return questionCard(qi);
          })}

          {canAddQuestion ? (
            <AddQuestion topics={!hasRounds} onAdd={(k) => addKind(k)} />
          ) : trimmed ? null : (
            <p className="limit-note">
              {t("{n} questions max per presentation.", { n: maxQuestions ?? 0 })}
            </p>
          )}
        </div>

        <aside className="bld-side">
          <AiPanel
            startOpen={!edit && new URLSearchParams(location.search).get("ai") === "1"}
            startBrief={edit ? undefined : (new URLSearchParams(location.search).get("brief") ?? undefined)}
            call={aiCall}
            lang={lang}
            title={title}
            questions={questions}
            max={maxQuestions ?? 50}
            onReplace={setQuestions}
            onAdd={(generated, list, replace) => {
              if (!title.trim()) setTitle(generated);
              setQuestions((current) => (replace ? list.map(toDraft).slice(0, maxQuestions ?? 50) : mergeQuestions(current, list, maxQuestions ?? 50)));
              // Games that score points get their leaderboard, as with templates: it needs the first names.
              if (addedQuestions(questions, list, maxQuestions ?? 50, replace).some(isScored)) setNames(true);
            }}
          />

          <DesignCard brand={brand} onChange={setBrand} title={title}>
            {/* Until the decor's end date: the normal look or the Halloween night (src/decor.ts). */}
            {halloween && (
              <div className="bld-row bld-decor" role="group" aria-label={t("Decor")}>
                <span>
                  <strong>{t("Decor")}</strong>
                  <small>{decor === "halloween" ? t("Night look until October 31") : t("Hopvote's usual look")}</small>
                </span>
                <div className="segmented">
                  <button type="button" className={decor !== "halloween" ? "on" : ""} aria-pressed={decor !== "halloween"} onClick={() => setDecor(null)}>
                    {t("Normal")}
                  </button>
                  <button type="button" className={decor === "halloween" ? "on" : ""} aria-pressed={decor === "halloween"} onClick={() => setDecor("halloween")}>
                    <Pumpkin shape="round" face className="bld-pumpkin" /> {t("Halloween")}
                  </button>
                </div>
              </div>
            )}
          </DesignCard>

          <div className="bld-panel bld-settings">
            <label className="bld-row">
              <span>
                <strong>{t("Language")}</strong>
                <small>{t("Screen and translations")}</small>
              </span>
              <select value={lang} onChange={(e) => setLang(e.target.value)} aria-label={t("Language of the questions")}>
                <option value="auto">{t("Detect")}</option>
                {LANGUAGES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
              </select>
            </label>
            <label className="bld-row toggle">
              <span>
                <strong>{t("Ask for first names")}</strong>
                <small>
                  {names
                    ? scored && boardMode !== "off"
                      ? t("Shown on the waiting screen and the leaderboard")
                      : t("Shown on the waiting screen")
                    : scored
                      ? t("Anonymous: no quiz leaderboard")
                      : t("Everyone stays anonymous")}
                </small>
              </span>
              <input
                type="checkbox"
                checked={names}
                onChange={(e) => {
                  setNames(e.target.checked);
                  // No first names, no leaderboard: the setting says so instead of promising one.
                  if (!e.target.checked && (boardMode === "each" || boardMode === "round" || boardMode === "end")) setBoardMode("off");
                }}
              />
              <span className="toggle-ui" />
            </label>
            {/* Games that score points: when the leaderboard shows. It needs first names, so picking one asks for them. */}
            {scored && (
              <div className="bld-row bld-board" role="group" aria-label={t("Leaderboard")}>
                <span>
                  <strong>{t("Leaderboard")}</strong>
                  <small>{t(BOARD_CHOICES.find((c) => c.id === boardMode)?.hint ?? "With the button while presenting")}</small>
                </span>
                <div className="segmented bld-choices">
                  {BOARD_CHOICES.filter((c) => c.id !== "round" || hasRounds || boardMode === "round").map(({ id, label, icon: Icon }) => (
                    <button
                      type="button"
                      key={id}
                      className={boardMode === id ? "on" : ""}
                      aria-pressed={boardMode === id}
                      onClick={() => {
                        setBoardMode(id);
                        if (id !== "off") setNames(true);
                      }}
                    >
                      <Icon size={16} aria-hidden /> {t(label)}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <label className="bld-row toggle">
              <span>
                <strong>{t("Launch animation")}</strong>
                <small>{intro ? t("Curtain at the start, then no way back") : t("Starts straight on question 1")}</small>
              </span>
              <input type="checkbox" checked={intro} onChange={(e) => setIntro(e.target.checked)} />
              <span className="toggle-ui" />
            </label>
          </div>

          {error && <p className="error">{error}</p>}
          {conflict && (
            <div className="bld-conflict" role="alert">
              <p className="error">{t("{name} saved this presentation while you were editing it.", { name: displayName(conflict) })}</p>
              <div className="row-actions">
                <button
                  type="button"
                  className="ghost small"
                  onClick={() => {
                    // Their version, without the "leave?" question: this person chose to drop their changes.
                    saving.current = true;
                    guardLeave(null);
                    location.reload();
                  }}
                >
                  {t("See their version")}
                </button>
                <button type="button" className="primary small" disabled={busy} onClick={() => save(true)}>{t("Keep mine")}</button>
              </div>
            </div>
          )}
          <button
            type="button"
            className="ghost bld-save"
            disabled={busy || !written}
            onClick={() => {
              intent.current = "stay";
              save(false);
            }}
          >
            {justSaved ? <Check size={17} /> : <Save size={17} />}
            {busy && !opening ? t("Saving…") : justSaved ? t("Saved") : t("Save")}
          </button>
          <button className="primary bld-launch" disabled={busy || !written}>
            {!opening && <Play size={17} fill="currentColor" />} {launchLabel}
          </button>
          {!written && <p className="bld-hint">{t("Write at least one question.")}</p>}
        </aside>
      </form>
      )}
    </AppShell>
  );
}

// The question type, as a compact menu instead of a wall of buttons.
// `topics`: the menu offers topic rounds (one per presentation, never on a topic's own question).
function TypeMenu({ value, onChange, topics }: { value: Draft["kind"]; onChange: (k: Draft["kind"]) => void; topics?: boolean }) {
  const t = useAppT();
  const current = [...KINDS, TOPICS_KIND].find((k) => k.id === value)!;
  const Icon = current.icon;
  return (
    <Popover
      className="type-pop"
      trigger={(open, toggle) => (
        <button type="button" className={`type-btn ${open ? "on" : ""}`} aria-haspopup="menu" aria-expanded={open} onClick={toggle}>
          <Icon size={16} /> {t(current.label)} <ChevronDown size={15} className="type-chev" />
        </button>
      )}
    >
      {(close) => <KindList value={value} topics={topics} onPick={(k) => { onChange(k); close(); }} />}
    </Popover>
  );
}

// The kinds of questions, with an example of the one under the pointer (or the current one) on the side.
function KindList({ value, onPick, topics }: { value?: Draft["kind"]; onPick: (k: Draft["kind"]) => void; topics?: boolean }) {
  const t = useAppT();
  const [shown, setShown] = useState<Draft["kind"]>(value ?? "choice");
  return (
    <div className="kind-pick">
      <div className="kind-list">
        {CATEGORIES.map((cat) => (
          <div key={cat} className="kind-list-group">
            <p className="pop-title">{t(cat)}</p>
            {(topics ? [...KINDS, TOPICS_KIND] : KINDS).filter((k) => k.category === cat).map(({ id, label, hint, icon: KIcon }) => (
              <button
                key={id}
                type="button"
                role="menuitem"
                className={`pop-item with-icon-row ${value === id ? "on" : ""} ${shown === id ? "shown" : ""}`}
                onClick={() => onPick(id)}
                onMouseEnter={() => setShown(id)}
                onFocus={() => setShown(id)}
              >
                <span className="kind-ico"><KIcon size={16} /></span>
                <span>
                  <strong>{t(label)}</strong>
                  <small>{t(hint)}</small>
                </span>
              </button>
            ))}
          </div>
        ))}
      </div>
      <KindPreview kind={shown} />
    </div>
  );
}

function AddQuestion({ onAdd, topics }: { onAdd: (k: Draft["kind"]) => void; topics?: boolean }) {
  const t = useAppT();
  return (
    <Popover
      className="add-pop"
      trigger={(open, toggle) => (
        <button type="button" className={`add-q ${open ? "on" : ""}`} aria-haspopup="menu" aria-expanded={open} onClick={toggle}>
          <Plus size={18} /> {t("Add a question")}
        </button>
      )}
    >
      {(close) => <KindList topics={topics} onPick={(k) => { onAdd(k); close(); }} />}
    </Popover>
  );
}

// A topic's "Write with AI": three quiz questions on it, added to its section (one AI request, under the usual daily AI limit).
function TopicAi({ topic, disabled, call, lang, title, onAdd }: { topic: string; disabled: boolean; call: AiCall; lang: string; title: string; onAdd: (questions: Stored[]) => void }) {
  const t = useAppT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function run() {
    setBusy(true);
    setError("");
    try {
      const brief = `${t("Quiz questions about {topic}", { topic })}${title.trim() ? ` (${title.trim()})` : ""}`;
      const out = await call<{ questions: Stored[] }>("generate", { topic: brief, style: "quiz", count: 3, lang: lang === "auto" ? undefined : lang });
      onAdd(out.questions ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("The AI is busy. Try again in a moment."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="air">
      <button type="button" className="air-btn" disabled={disabled || busy || !topic} title={error || t("Write with AI")} onClick={run}>
        <Wand2 size={14} /> <span>{busy ? t("Writing…") : error ? t("Try again") : t("Write with AI")}</span>
      </button>
    </div>
  );
}
