// Result views for each question type, shared by the big screen, the phones and the results page.
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Check, ChevronUp, CircleCheck, Cloud, Eye, EyeOff, Lock, MessageCircleQuestion, MessageSquareText, Users } from "lucide-react";
import { Buddy } from "./buddies";
import type { BoardEntry, OpenAnswer, RoomState } from "./room";
import { useT } from "./translate";

// ChoiceResults and keepMarks live in choice-results.tsx, so they load without the translation tables.
export { ChoiceResults, keepMarks } from "./choice-results";

export const average = (counts: number[]) => {
  const total = counts.reduce((a, b) => a + b, 0);
  return total ? counts.reduce((a, c, i) => a + c * (i + 1), 0) / total : 0;
};
const fmt = (n: number, locale: string) => n.toLocaleString(locale, { maximumFractionDigits: 1, minimumFractionDigits: 1 });

// `locale` writes numbers the reader's way ("3,5" in French).
// The soft shape of where the votes are, for the slider: a smooth curve through each rating's count.
function shapePath(counts: number[], top: number) {
  const pts = counts.map((c, i) => [(i / Math.max(1, counts.length - 1)) * 1000, 100 - (c / top) * 92] as const);
  let d = `M0 100 L${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[Math.max(0, i - 1)];
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[i + 1];
    const [x3, y3] = pts[Math.min(pts.length - 1, i + 2)];
    d += ` C${x1 + (x2 - x0) / 6} ${y1 + (y2 - y0) / 6} ${x2 - (x3 - x1) / 6} ${y2 - (y3 - y1) / 6} ${x2} ${y2}`;
  }
  return `${d} L1000 100 Z`;
}

// `style` is chosen per question in the builder: bars (default), a slider, a gauge, or a dot per vote.
// On phones the page's language (set by the voting page) writes the numbers; screens pass theirs.
const pageLocale = () => (typeof document !== "undefined" && document.documentElement.lang) || "en-US";

export function ScaleResults({ counts, max, labels, mine, locale = pageLocale(), style = "bars" }: { counts: number[]; max: number; labels: [string, string] | null; mine?: number; locale?: string; style?: string }) {
  const t = useT();
  const total = counts.reduce((a, b) => a + b, 0);
  const avg = average(counts);
  const top = Math.max(1, ...counts);
  const pct = (n: number) => Math.round((n / Math.max(1, total)) * 100);
  // Where the average sits on the scale, from 0 (all 1s) to 100 (all top ratings).
  const pos = avg ? ((avg - 1) / Math.max(1, max - 1)) * 100 : 0;
  const ends = labels && (labels[0] || labels[1]) ? labels : null;
  const endsRow = (
    <div className="sc-ends">
      <span>{ends?.[0] || "1"}</span>
      <span>{ends?.[1] || String(max)}</span>
    </div>
  );
  const head = (
    <p className="sc-head">
      {avg ? (
        <>
          <strong>{fmt(avg, locale)}</strong>
          <span>/ {max} · {t("on average")}</span>
        </>
      ) : (
        <span>{t("No ratings yet")}</span>
      )}
    </p>
  );
  const size = max > 5 ? "sc-10" : "sc-5";

  if (style === "gauge") {
    return (
      <div className={`sc sc-gauge ${size}`}>
        <p className="sc-big">
          {avg ? (
            <>
              <strong>{fmt(avg, locale)}</strong>
              <span>/ {max}</span>
            </>
          ) : (
            <span>{t("No ratings yet")}</span>
          )}
        </p>
        <div className="sc-rail"><i style={{ width: `${pos}%` }} /></div>
        {endsRow}
      </div>
    );
  }

  if (style === "slider") {
    return (
      // Left to right in every language: the curve and the thumb are drawn that way.
      <div className={`sc sc-slider ${size}`} dir="ltr">
        <div className="sc-slide">
          {total > 0 && (
            <svg className="sc-shape" viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden>
              <path d={shapePath(counts, top)} />
            </svg>
          )}
          <div className="sc-rail"><i style={{ width: `${pos}%` }} /></div>
          {avg > 0 && (
            <span className="sc-thumb" style={{ left: `${pos}%` }}>
              {/* Slides along with the thumb, so it never runs past either end. */}
              <b style={{ transform: `translateX(-${pos}%)` }}>{fmt(avg, locale)}</b>
            </span>
          )}
        </div>
        {endsRow}
        {!avg && <p className="sc-none">{t("No ratings yet")}</p>}
      </div>
    );
  }

  if (style === "dots") {
    // One dot per vote, or per few votes in a big room, so a column never grows past ten dots.
    const unit = Math.max(1, Math.ceil(top / 10));
    return (
      <div className={`sc sc-dots ${size}`}>
        {head}
        <div className="sc-chart">
          <div className="sc-cols">
            {counts.map((c, i) => (
              <div key={i} className={["sc-col", c > 0 && c === top && "lead", mine === i && "mine"].filter(Boolean).join(" ")} title={`${c}`} aria-label={`${i + 1}: ${c}`}>
                <div className="sc-dotstack" aria-hidden>
                  {Array.from({ length: Math.ceil(c / unit) }, (_, k) => <i key={k} />)}
                </div>
                <span className="sc-num">{i + 1}</span>
              </div>
            ))}
          </div>
          {ends && endsRow}
        </div>
      </div>
    );
  }

  // Bars: one column per rating, the most chosen in the accent colour, its share above it.
  return (
    // --n: the number of columns, so the end labels line up under the first and the last one on the big screen.
    <div className={`sc sc-bars ${size}`} style={{ "--n": counts.length } as CSSProperties}>
      {head}
      <div className="sc-chart">
        <div className="sc-cols">
          {counts.map((c, i) => (
            <div key={i} className={["sc-col", c > 0 && c === top && "lead", mine === i && "mine"].filter(Boolean).join(" ")}>
              <span className="sc-n">{c ? `${pct(c)}%` : ""}</span>
              <div className="sc-track"><i style={{ height: `${(c / top) * 100}%` }} /></div>
              <span className="sc-num">{i + 1}</span>
            </div>
          ))}
        </div>
        {ends && endsRow}
      </div>
    </div>
  );
}

const CLOUD_FONT = "Figtree, system-ui, sans-serif";
const PALETTE = 10;
let measureCtx: CanvasRenderingContext2D | null = null;
// Words are measured in the font they are drawn with: Figtree, or a brand's heading font (--font-head).
function textWidth(text: string, px: number, family = CLOUD_FONT) {
  measureCtx ??= document.createElement("canvas").getContext("2d");
  if (!measureCtx) return text.length * px * 0.55;
  measureCtx.font = `800 ${px}px ${family}`;
  return measureCtx.measureText(text).width;
}

// Same word, same colour, from one render to the next.
function hue(word: string) {
  let h = 0;
  for (const c of word) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % PALETTE;
}

type Placed = { word: string; size: number; x: number; y: number; w: number; h: number; color?: number; rare?: boolean };

// Packs words along a spiral from the centre, biggest first, so the cloud stays tight like a real one.
// Sizes are in units where a word said once is 100 tall.
function layoutCloud(words: [string, number][], aspect: number, limit: number, family?: string) {
  const top = Math.max(...words.map(([, n]) => n));
  // The most cited words only: a crowded cloud hides what the room thinks.
  const sorted = [...words].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit);
  const placed: Placed[] = [];
  const hit = (r: Placed) =>
    placed.some((p) => Math.abs(p.x - r.x) * 2 < p.w + r.w && Math.abs(p.y - r.y) * 2 < p.h + r.h);
  for (const [word, n] of sorted) {
    // Said once: normal size. Each repeat makes it grow, up to 5 times for the most cited word,
    // so the words the room agrees on stand out at a glance.
    const size = top > 1 ? 1 + 4 * Math.pow((n - 1) / (top - 1), 0.7) : 1;
    const px = size * 100;
    const r: Placed = { word, size, x: 0, y: 0, w: textWidth(word, px, family) + px * 0.16 + 8, h: px * 0.9 + 4 };
    for (let t = 0; t < 6000; t++) {
      const angle = t * 0.09;
      const radius = 3.2 * angle;
      // The spiral follows the shape of the box, so the cloud fills a wide screen instead of stacking up.
      r.x = radius * Math.cos(angle) * aspect;
      r.y = radius * Math.sin(angle);
      if (!hit(r)) break;
    }
    placed.push({ ...r, rare: top > 2 && n === 1 });
  }
  // The biggest words sit side by side: give each of the top ones its own colour.
  const used: number[] = [];
  placed.forEach((p, i) => {
    let c = hue(p.word);
    // Every word visible at a glance gets its own colour; only very long clouds repeat some.
    if (i < PALETTE) while (used.includes(c)) c = (c + 1) % PALETTE;
    used.push(c);
    p.color = c;
  });
  const minX = Math.min(...placed.map((p) => p.x - p.w / 2));
  const maxX = Math.max(...placed.map((p) => p.x + p.w / 2));
  const minY = Math.min(...placed.map((p) => p.y - p.h / 2));
  const maxY = Math.max(...placed.map((p) => p.y + p.h / 2));
  return { placed, width: maxX - minX, height: maxY - minY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}

// A word said once keeps a readable size (`base` px at most); repeated words grow around it.
export function WordCloud({ words, empty = "Words will appear here.", base = 30, limit = 60, onRemove }: { words: [string, number][]; empty?: string; base?: number; limit?: number; onRemove?: (word: string) => void }) {
  const t = useT();
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  // Counts the fonts loaded so far: a brand font that arrives later lays the cloud out again.
  const [fontsReady, setFontsReady] = useState(0);
  useEffect(() => {
    const done = () => setFontsReady((n) => n + 1);
    document.fonts?.ready.then(done);
    document.fonts?.addEventListener("loadingdone", done);
    return () => document.fonts?.removeEventListener("loadingdone", done);
  }, []);
  // A branded screen draws the words in its heading font (styles.css, .branded .cloud span).
  const family = (box && box.closest(".branded") && getComputedStyle(box).getPropertyValue("--font-head").trim()) || CLOUD_FONT;
  useEffect(() => {
    if (!box) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(box);
    return () => ro.disconnect();
  }, [box]);

  const aspect = size.h ? Math.round(Math.min(3.2, Math.max(1, size.w / size.h)) * 10) / 10 : 2;
  const layout = useMemo(() => (words.length ? layoutCloud(words, aspect, limit, family) : null), [words, fontsReady, aspect, limit, family]);

  if (!words.length) return <p className="cloud-empty">{t(empty)}</p>;
  const scale = layout && size.w ? Math.min((size.w * 0.96) / layout.width, (size.h * 0.94) / layout.height, base / 100) : 0;
  return (
    <div className="cloud" ref={setBox} aria-label={t("Word cloud")} role="img">
      {layout &&
        scale > 0 &&
        layout.placed.map((p) => (
          <span
            key={p.word}
            className={`w${p.color}${p.rare ? " rare" : ""}${onRemove ? " removable" : ""}`}
            onClick={onRemove ? () => onRemove(p.word) : undefined}
            title={onRemove ? t("Click to remove this word") : undefined}
            style={{
              fontSize: `${p.size * 100 * scale}px`,
              transform: `translate(${(p.x - layout.cx) * scale}px, ${(p.y - layout.cy) * scale}px) translate(-50%, -50%)`,
            }}
          >
            {p.word}
          </span>
        ))}
    </div>
  );
}

export function OpenWall({ answers, onHide, empty = "Answers will appear here." }: { answers: OpenAnswer[]; onHide?: (id: string) => void; empty?: string }) {
  const t = useT();
  if (!answers.length) return <p className="cloud-empty">{t(empty)}</p>;
  return (
    <ul className="wall">
      {answers.map((a) => (
        <li key={a.id} className={a.hidden ? "hidden-answer" : ""}>
          <p title={a.original}>{a.text}</p>
          {onHide && (
            <button className="wall-hide" onClick={() => onHide(a.id)} aria-label={a.hidden ? t("Show") : t("Hide")} title={a.hidden ? t("Show") : t("Hide")}>
              {a.hidden ? <Eye size={16} /> : <EyeOff size={16} />}
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

// Items by score: first place in a ballot is worth the most points.
export function RankResults({ options, counts, voters }: { options: string[]; counts: number[]; voters: number }) {
  const top = Math.max(1, ...counts);
  const order = options.map((label, i) => ({ label, score: counts[i] ?? 0 })).sort((a, b) => b.score - a.score);
  return (
    <ol className="results rank-results">
      {order.map(({ label, score }, pos) => (
        <li key={label} className={voters > 0 && pos === 0 ? "win" : ""}>
          <div className="result-label">
            <span className="truncate"><b className="rank-pos">{pos + 1}</b>{label}</span>
          </div>
          <div className="bar">
            <div style={{ width: `${voters ? (score / top) * 100 : 0}%` }} />
          </div>
        </li>
      ))}
    </ol>
  );
}

// Questions from the room, most wanted first. The host marks them answered or hides them; voters upvote.
export function QaList({
  items,
  onDone,
  onHide,
  onUpvote,
  mine = [],
  empty = "Questions from the room will appear here.",
}: {
  items: OpenAnswer[];
  onDone?: (id: string) => void;
  onHide?: (id: string) => void;
  onUpvote?: (id: string) => void;
  mine?: string[];
  empty?: string;
}) {
  const t = useT();
  if (!items.length) return <p className="cloud-empty">{t(empty)}</p>;
  return (
    <ul className="qa">
      {items.map((q, i) => (
        // The most upvoted open question leads (the big screen marks its votes).
        <li key={q.id} className={[q.done && "done", q.hidden && "hidden-answer", i === 0 && !q.done && (q.votes ?? 0) > 0 && "lead"].filter(Boolean).join(" ")}>
          {onUpvote ? (
            <button className={`qa-votes ${mine.includes(q.id) ? "on" : ""}`} onClick={() => onUpvote(q.id)} aria-pressed={mine.includes(q.id)} aria-label={t("Upvote this question")}>
              <ChevronUp size={18} strokeWidth={3} />
              <strong>{q.votes ?? 0}</strong>
            </button>
          ) : (
            <span className="qa-votes">
              <ChevronUp size={18} strokeWidth={3} />
              <strong>{q.votes ?? 0}</strong>
            </span>
          )}
          <p title={q.original}>{q.text}</p>
          {q.done && !onDone && <span className="qa-done"><CircleCheck size={16} /> {t("Answered")}</span>}
          {(onDone || onHide) && (
            <div className="qa-tools">
              {onDone && (
                <button className={`ghost small ${q.done ? "on" : ""}`} onClick={() => onDone(q.id)}>
                  <CircleCheck size={16} /> {q.done ? t("Answered") : t("Mark answered")}
                </button>
              )}
              {onHide && (
                <button className="ghost small" onClick={() => onHide(q.id)} aria-label={q.hidden ? t("Show") : t("Hide")} title={q.hidden ? t("Show") : t("Hide")}>
                  {q.hidden ? <Eye size={16} /> : <EyeOff size={16} />}
                </button>
              )}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

// `mine` is this phone's tag: when the room tags its rows, only that row is highlighted, never everyone sharing a name.
export function Leaderboard({ entries, me, mine, locale = "en-US" }: { entries: BoardEntry[]; me?: string; mine?: string; locale?: string }) {
  const t = useT();
  if (!entries.length) return <p className="cloud-empty">{t("Nobody has points yet.")}</p>;
  const tagged = entries.some((e) => e.tag);
  return (
    <ol className="board">
      {/* Equal scores share a rank (1, 2, 2, 4), as on the other leaderboards. */}
      {entries.map((e, i) => (
        <li key={`${e.name}-${i}`} className={[(e.rank ?? i + 1) <= 3 && `podium p${e.rank ?? i + 1}`, (tagged ? !!mine && e.tag === mine : !!me && e.name === me) && "me"].filter(Boolean).join(" ")}>
          <span className="board-pos">{e.rank ?? i + 1}</span>
          <Buddy id={e.avatar} size={34} className="board-buddy" />
          <span className="board-name truncate">{e.name}</span>
          <strong>{e.score.toLocaleString(locale)}</strong>
        </li>
      ))}
    </ol>
  );
}

// Seconds left on a timed quiz, ticking locally from the server's start time.
export function useCountdown(state: RoomState | null) {
  const [, tick] = useState(0);
  const running = !!state?.timer && !!state.startedAt && !state.revealed;
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => tick((n) => n + 1), 200);
    return () => clearInterval(id);
  }, [running]);
  if (!state?.timer || !state.startedAt) return null;
  const serverNow = state.now + (Date.now() - state.receivedAt);
  // `pre`: milliseconds of count-in left (3, 2, 1, here we go) before the clock runs and the question shows.
  const pre = Math.max(0, state.startedAt - serverNow);
  const left = Math.max(0, Math.min(state.timer * 1000, state.startedAt + state.timer * 1000 - serverNow));
  return { left: Math.ceil(left / 1000), ratio: left / (state.timer * 1000), over: left <= 0, pre };
}

// How long the count-in lasts: 3, 2, 1, then "Here we go!" for the last second.
export const COUNT_IN_MS = 4000;

// The count-in before a timed question, on the big screen and on phones alike.
export function CountIn({ pre, big }: { pre: number; big?: boolean }) {
  const t = useT();
  const step = pre > 3000 ? "3" : pre > 2000 ? "2" : pre > 1000 ? "1" : "";
  return (
    <div className={`count-in ${big ? "big" : ""}`} role="timer" aria-live="assertive">
      {step ? <strong key={step}>{step}</strong> : <em key="go">{t("Here we go!")}</em>}
    </div>
  );
}

export function Countdown({ left, ratio }: { left: number; ratio: number }) {
  const t = useT();
  return (
    <div className={`countdown ${left <= 5 ? "hurry" : ""}`} role="timer" aria-label={t("{n} seconds").replace("{n}", String(left))}>
      <strong>{left}</strong>
      <span className="countdown-track"><i style={{ width: `${ratio * 100}%` }} /></span>
    </div>
  );
}

// Several statements rated at once: one gauge per statement, filled up to its average, the average at its end.
// On a phone that answered, a ring marks its own rating.
export function ScalesResults({ options, counts, max, labels = null, mine, locale = pageLocale() }: { options: string[]; counts: number[]; max: number; labels?: [string, string] | null; mine?: number[]; locale?: string }) {
  const t = useT();
  const span = Math.max(1, max - 1);
  // Thin gaps at each step of the scale, cut out of the track so any background shows through.
  const gaps = Array.from({ length: Math.max(0, max - 2) }, (_, k) => ((k + 1) / span) * 100)
    .map((x) => `#000 calc(${x}% - 1px), transparent calc(${x}% - 1px) calc(${x}% + 1px), #000 calc(${x}% + 1px)`)
    .join(", ");
  const mask = gaps ? `linear-gradient(90deg, ${gaps})` : undefined;
  return (
    <div className="scales-results">
      <p className="ssr-ends" dir="ltr" aria-hidden>
        <span>{labels?.[0] ? `1 · ${labels[0]}` : "1"}</span>
        <span>{labels?.[1] ? `${labels[1]} · ${max}` : String(max)}</span>
      </p>
      <ol>
        {options.map((label, i) => {
          const row = Array.from({ length: max }, (_, v) => counts[i * max + v] ?? 0);
          const total = row.reduce((a, b) => a + b, 0);
          const avg = average(row);
          const at = total ? Math.max(2, ((avg - 1) / span) * 100) : 0;
          return (
            <li key={i}>
              <span className="ssr-label">{label}</span>
              <span className="ssr-gauge" dir="ltr" aria-hidden>
                <span className="ssr-track" style={{ maskImage: mask, WebkitMaskImage: mask }}>
                  <i style={{ width: `${at}%` }} />
                </span>
                {mine?.[i] !== undefined && <b className="ssr-mine" style={{ left: `${(mine[i] / span) * 100}%` }} />}
              </span>
              {/* Before the first rating the badge stays empty: no sign that could pass for a result. */}
              <strong className={`ssr-avg ${total ? "" : "none"}`} title={total ? `${fmt(avg, locale)} / ${max} ${t("on average")}` : t("No ratings yet")}>
                {total ? fmt(avg, locale) : null}
              </strong>
            </li>
          );
        })}
      </ol>
      {mine && <p className="ssr-key"><b className="ssr-mine" aria-hidden /> {t("Your answer")}</p>}
    </div>
  );
}

const median = (values: number[]) => {
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
// Years and small counts read without a thousands space ("1889", not "1 889").
const num = (n: number, locale: string) => n.toLocaleString(locale, { maximumFractionDigits: 2, useGrouping: Math.abs(n) >= 10000 });

// Number answers: how they spread, with the average and median. Once a game's answer shows, a line marks it.
export function NumberResults({ numbers, answer = null, closest = null, mine, locale = pageLocale() }: { numbers: number[]; answer?: number | null; closest?: { value: number; name: string } | null; mine?: number; locale?: string }) {
  const t = useT();
  const values = numbers.filter((n) => Number.isFinite(n));
  if (!values.length && answer === null) return <p className="muted nr-empty">{t("No answers yet")}</p>;
  // Far-off answers (a typo, a joke) would squeeze everyone else into one bar: only those far outside the bulk
  // (three times the middle half's spread) are left at the edges; the axis covers everything else.
  const sorted = [...values].sort((a, b) => a - b);
  const pick = (q: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))];
  const spread = sorted.length ? pick(0.75) - pick(0.25) : 0;
  let lo = sorted.length ? Math.max(sorted[0], pick(0.25) - 3 * spread) : (answer as number);
  let hi = sorted.length ? Math.min(sorted[sorted.length - 1], pick(0.75) + 3 * spread) : (answer as number);
  if (answer !== null) {
    lo = Math.min(lo, answer);
    hi = Math.max(hi, answer);
  }
  // Small whole numbers (cups of coffee, a score out of 10): one bar per value, every answer shown.
  const whole = [...values, ...(answer !== null ? [answer] : [])].every(Number.isInteger);
  const span = whole && sorted.length ? Math.max(sorted[sorted.length - 1], answer ?? -Infinity) - Math.min(sorted[0], answer ?? Infinity) : Infinity;
  if (span <= 24) {
    lo = Math.min(sorted[0], answer ?? Infinity) - 0.5;
    hi = Math.max(sorted[sorted.length - 1], answer ?? -Infinity) + 0.5;
  } else if (lo === hi) {
    const pad = Math.max(1, Math.abs(lo) * 0.1);
    lo -= pad;
    hi += pad;
  }
  const BINS = span <= 24 ? span + 1 : 12;
  const width = (hi - lo) / BINS;
  const bins = Array.from({ length: BINS }, () => 0);
  for (const v of values) bins[Math.min(BINS - 1, Math.max(0, Math.floor((v - lo) / width)))]++;
  const top = Math.max(1, ...bins);
  const at = (v: number) => `${Math.min(100, Math.max(0, ((v - lo) / (hi - lo)) * 100))}%`;
  // The bar to look at: the right answer's once shown, otherwise the most frequent answers.
  const binOf = (v: number) => Math.min(BINS - 1, Math.max(0, Math.floor((v - lo) / width)));
  const hot = answer !== null ? binOf(answer) : bins.indexOf(top);
  return (
    <div className="nr">
      <div className="nr-chart" aria-hidden>
        {bins.map((c, i) => (
          <i key={i} className={i === hot && c > 0 ? (answer !== null ? "nr-ok" : "nr-hot") : ""} style={{ height: `${c ? Math.max(6, (c / top) * 100) : 0}%` }} />
        ))}
        {answer !== null && <span className="nr-target" style={{ left: at(answer) }} />}
        {mine !== undefined && <span className="nr-mine" style={{ left: at(mine) }} />}
      </div>
      {span <= 12 ? (
        <div className="nr-axis nr-each" aria-hidden>
          {bins.map((_, i) => <span key={i}>{num(lo + 0.5 + i, locale)}</span>)}
        </div>
      ) : (
        <div className="nr-axis" aria-hidden>
          <span>{num(span <= 24 ? lo + 0.5 : lo, locale)}</span>
          <span>{num(span <= 24 ? hi - 0.5 : hi, locale)}</span>
        </div>
      )}
      <p className="nr-stats">
        {answer !== null && (
          <span className="nr-right">
            {t("Right answer:")} <strong>{num(answer, locale)}</strong>
          </span>
        )}
        {closest && answer !== null && (
          <span>
            {t("Closest:")} <strong>{closest.name ? `${closest.name} (${num(closest.value, locale)})` : num(closest.value, locale)}</strong>
          </span>
        )}
        {values.length > 0 && (
          <span>
            {t("Average:")} <strong>{num(values.reduce((a, b) => a + b, 0) / values.length, locale)}</strong>
          </span>
        )}
        {values.length > 1 && (
          <span>
            {t("Median:")} <strong>{num(median(values), locale)}</strong>
          </span>
        )}
      </p>
    </div>
  );
}

// A ranking with a right order, once shown: who found it all, and how often each item was put at its place.
export function OrderResults({ options, result, voters, locale = pageLocale() }: { options: string[]; result: { right: number; placed: number[] } | null; voters: number; locale?: string }) {
  const t = useT();
  const pct = (n: number) => (voters ? Math.round((n / voters) * 100) : 0);
  return (
    <div className="or">
      {result && (
        <p className="or-big">
          <strong>{pct(result.right).toLocaleString(locale)}%</strong> {t("found the right order")}
        </p>
      )}
      <ol className="or-list">
        {options.map((label, i) => (
          <li key={i}>
            <b>{i + 1}</b>
            <span className="truncate">{label}</span>
            {result && <em>{t("{n}% at the right place").replace("{n}", pct(result.placed[i] ?? 0).toLocaleString(locale))}</em>}
          </li>
        ))}
      </ol>
    </div>
  );
}

const WAITING = {
  words: "Words appear here as people send them",
  open: "Answers appear here as people send them",
  qa: "Questions appear here, the most upvoted first",
  game: "Answers stay hidden until you show the right one",
};

// What is on its way: the kind's own icon, or a closed eye while a game's answers stay hidden.
const WAITING_ICON = { words: Cloud, open: MessageSquareText, qa: MessageCircleQuestion, game: EyeOff };

// Shown before the first answers: one line, nothing that could pass for real results.
export function Waiting({ kind }: { kind: "words" | "open" | "qa" | "game" }) {
  const t = useT();
  const Icon = WAITING_ICON[kind];
  return (
    <div className="waiting">
      <span className="waiting-icon" aria-hidden><Icon /></span>
      <p className="waiting-text">{t(WAITING[kind])}</p>
    </div>
  );
}

// The room only sees how many people left their details, never the details themselves.
export function ContactCount({ count, locale = "en-US" }: { count: number; locale?: string }) {
  const t = useT();
  return (
    <div className="contact-count">
      <strong>{count}</strong>
      <span>{new Intl.PluralRules(locale).select(count) === "one" ? t("person left their details") : t("people left their details")}</span>
      <p><Lock size={16} /> {t("Only visible to the organizer")}</p>
    </div>
  );
}

// For presentations that ask first names: who answered the question on screen, and who is still thinking.
// Closed by default, so the big screen only shows names when the presenter opens it.
export function WhoAnswered({ people, className = "" }: { people: { name: string; avatar: string; done?: boolean }[]; className?: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  people = people.filter((p) => p.name);
  if (!people.length || people.every((p) => p.done === undefined)) return null;
  const done = people.filter((p) => p.done);
  const waiting = people.filter((p) => !p.done);
  return (
    <div className={`who ${className}`}>
      <button type="button" className={`who-btn ${open ? "on" : ""}`} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Users size={16} /> {t("{n}/{m} answered").replace("{n}", String(done.length)).replace("{m}", String(people.length))}
      </button>
      {open && (
        <div className="who-panel" role="dialog" aria-label={t("Who answered")}>
          <div className="who-col">
            <p>{t("Waiting · {n}").replace("{n}", String(waiting.length))}</p>
            <ul>{waiting.map((p, i) => <li key={i}><Buddy id={p.avatar} size={22} /> <span className="truncate">{p.name}</span></li>)}</ul>
          </div>
          <div className="who-col done">
            <p>{t("Answered · {n}").replace("{n}", String(done.length))}</p>
            <ul>{done.map((p, i) => <li key={i}><Buddy id={p.avatar} size={22} /> <span className="truncate">{p.name}</span> <Check size={14} strokeWidth={3} /></li>)}</ul>
          </div>
        </div>
      )}
    </div>
  );
}
