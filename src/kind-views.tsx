// Views of the newer kinds of questions, shared by the big screen, the phones and the results page:
// prioritize, fill in the blanks, match pairs, find on the image, the wheel, the timer, video and audio.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Check, Pause, PartyPopper, X } from "lucide-react";
import type { TopicsState } from "./room";
import type { RoomState } from "./room";
import { useT } from "./translate";
import { mediaOf } from "./media";
import { clockLeft, inZone, type Clock, type Zone } from "./kinds";
import { SPIN_MS, wheelAngle } from "./wheel";
import { normalize, rightBlank, shownAnswer } from "./fill";

const pageLocale = () => (typeof document !== "undefined" && document.documentElement.lang) || "en-US";
const pct = (n: number, total: number) => (total ? Math.round((n / total) * 100) : 0);
// The room's clock, read from the last state and the time since it arrived.
export const serverNow = (state: Pick<RoomState, "now" | "receivedAt">) => state.now + (Date.now() - state.receivedAt);

// The same items in a different order for each seed, never in their written order (shared with the phones).
export function shuffled(size: number, seed: string) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const next = () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)) >>> 0) / 4294967296;
  const order = Array.from({ length: size }, (_, i) => i);
  for (let i = size - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  if (size > 1 && order.every((item, pos) => item === pos)) order.push(order.shift()!);
  return order;
}

// Short sounds on the presenter's screen only (the wheel's ticks, a winner, the end of a timer). Never on phones.
let audio: AudioContext | null = null;
export function playSound(kind: "tick" | "win" | "end") {
  try {
    audio ??= new AudioContext();
    if (audio.state === "suspended") void audio.resume();
    const at = audio.currentTime;
    const tones: [number, number, number][] = kind === "tick" ? [[1400, 0, 0.025]] : kind === "win" ? [[784, 0, 0.5], [1175, 0.12, 0.7]] : [[880, 0, 0.6], [660, 0.35, 0.6], [880, 0.7, 0.9]];
    for (const [freq, delay, length] of tones) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = kind === "tick" ? "triangle" : "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, at + delay);
      gain.gain.exponentialRampToValueAtTime(kind === "tick" ? 0.05 : 0.18, at + delay + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + delay + length);
      osc.connect(gain).connect(audio.destination);
      osc.start(at + delay);
      osc.stop(at + delay + length + 0.05);
    }
  } catch {
    // No sound on this browser: the picture says it all.
  }
}

// Prioritize: the average points each item got, most first.
export function PointsResults({ options, counts, voters, mine, locale = pageLocale() }: { options: string[]; counts: number[]; voters: number; mine?: number[]; locale?: string }) {
  const t = useT();
  const rows = options.map((label, i) => ({ label, i, avg: voters ? (counts[i] ?? 0) / voters : 0 })).sort((a, b) => b.avg - a.avg);
  const top = Math.max(1, ...rows.map((r) => r.avg));
  return (
    <ol className="results points-results">
      {rows.map(({ label, i, avg }, pos) => (
        <li key={i} className={voters > 0 && pos === 0 ? "win" : ""}>
          <div className="result-label">
            <span className="truncate"><b className="rank-pos">{pos + 1}</b>{label}</span>
            <strong>{t("{n} pts").replace("{n}", Math.round(avg).toLocaleString(locale))}</strong>
          </div>
          <div className="bar">
            <div style={{ width: `${voters ? (avg / top) * 100 : 0}%` }} />
          </div>
          {mine && <em className="points-mine">{t("You: {n}").replace("{n}", String(mine[i] ?? 0))}</em>}
        </li>
      ))}
    </ol>
  );
}

// Fill in the blanks: the sentence with numbered boxes, or with the right answers once shown.
export function FillText({ gaps, blanks, given, big }: { gaps: string[]; blanks?: string[][]; given?: string[]; big?: boolean }) {
  return (
    <p className={`fill-text ${big ? "big" : ""}`}>
      {gaps.map((piece, i) => (
        <span key={i}>
          {piece}
          {i < gaps.length - 1 &&
            (blanks?.[i] ? (
              <b className="fill-gap shown">{blanks[i][0]}</b>
            ) : given ? (
              <b className="fill-gap mine">{given[i] || "…"}</b>
            ) : (
              <b className="fill-gap"><i>{i + 1}</i></b>
            ))}
        </span>
      ))}
    </p>
  );
}

type FillResult = { right: number; placed: number[] } | null;

// A word counted among the room's answers (lowercase), as people saw it: the word to place it came from, or as typed.
const asPlaced = (word: string, bank: string[]) => bank.find((b) => shownAnswer(b) === word) ?? word;
// Typed answers are kept in lowercase: shown with a capital first letter ("sydney" is "Sydney").
const shownWord = (word: string) => word.charAt(0).toLocaleUpperCase() + word.slice(1);

// Results page: how many found every word, then a bar per blank: its right word with the share who found it,
// and the other words most put there.
export function FillBars({ blanks, bank = [], result, top, voters, locale = pageLocale() }: { blanks: string[][]; bank?: string[]; result: FillResult; top: [string, number][][]; voters: number; locale?: string }) {
  const t = useT();
  return (
    <div className="fill-bars">
      {result && (
        <p className="or-big">
          <strong>{pct(result.right, voters).toLocaleString(locale)}%</strong> {t("of participants found every word")}
        </p>
      )}
      <ol>
        {blanks.map((accepted, i) => {
          const right = pct(result?.placed[i] ?? 0, voters);
          const wrong = (top[i] ?? []).filter(([word]) => !rightBlank(word, accepted)).slice(0, 3);
          return (
            <li key={i}>
              <span className="fill-n">{i + 1}</span>
              <div className="fill-bar">
                <i className="ok" style={{ width: `${right}%` }} />
                {wrong.map(([word, n]) => <i key={word} style={{ width: `${pct(n, voters)}%` }} />)}
                <span><b>{accepted[0]}</b> {right.toLocaleString(locale)}%</span>
              </div>
              {wrong.length > 0 && (
                <p className="fill-others">
                  {wrong.map(([word, n]) => (
                    <span key={word}>{shownWord(asPlaced(word, bank))} <b>{pct(n, voters).toLocaleString(locale)}%</b></span>
                  ))}
                </p>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// Results page: the sentence with its answers, then the bars.
export function FillResults({ gaps, blanks, bank, result, top, voters, locale = pageLocale() }: { gaps: string[]; blanks: string[][]; bank?: string[]; result: FillResult; top: [string, number][][]; voters: number; locale?: string }) {
  return (
    <div className="fill-results">
      <FillText gaps={gaps} blanks={blanks} />
      <FillBars blanks={blanks} bank={bank} result={result} top={top} voters={voters} locale={locale} />
    </div>
  );
}

// The words to place lean a little, each its own way, and float gently.
const TILTS = [-3, 2, -1.5, 3, -2, 1];

// Fill in the blanks on the big screen. Before the answer: the sentence with a numbered box per blank and, when people
// place words, the words to place. Once shown: the right words land in their boxes (flying from the words below when they
// were there), then one figure: the share of people who found every word. The detail per blank is on the results page.
// `waiting`: what the screen says until the answer shows.
export function FillStage({ gaps, bank, blanks, revealed, result, top, voters, locale = pageLocale(), waiting }: { gaps: string[]; bank: string[]; blanks: string[][]; revealed: boolean; result: FillResult; top: [string, number][][]; voters: number; locale?: string; waiting?: React.ReactNode }) {
  const t = useT();
  const size = Math.max(0, gaps.length - 1);
  const shown = revealed && blanks.length === size;
  // The word to place each right answer comes from, each word used once (-1: typed blanks, or a word not offered).
  const from = useMemo(() => {
    const used = new Set<number>();
    return blanks.map((accepted) => {
      const j = bank.findIndex((w, k) => !used.has(k) && accepted.some((a) => normalize(a) === normalize(w)));
      if (j >= 0) used.add(j);
      return j;
    });
  }, [bank, blanks]);
  // Just shown: the words below stay a moment (the right ones as empty frames), so the right ones fly from there.
  const [wasShown, setWasShown] = useState(shown);
  const [leaving, setLeaving] = useState(false);
  if (wasShown !== shown) {
    setWasShown(shown);
    setLeaving(shown && bank.length > 0);
  }
  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => setLeaving(false), 1400);
    return () => clearTimeout(timer);
  }, [leaving]);

  // Once shown, each right word moves from its frame below into its box. Measured on the next frame, once the big
  // screen has shrunk its content to fit; the words wait hidden until then.
  const tiles = useRef(new Map<string, HTMLElement>());
  const before = useRef(shown);
  useLayoutEffect(() => {
    const justShown = shown && !before.current;
    before.current = shown;
    if (!justShown) return;
    const landed = Array.from({ length: size }, (_, i) => tiles.current.get(`s${i}`));
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    landed.forEach((el) => el && (el.style.visibility = "hidden"));
    const frame = requestAnimationFrame(() => {
      landed.forEach((el, i) => {
        if (!el) return;
        el.style.visibility = "";
        const to = el.getBoundingClientRect();
        // Screen pixels to the tile's own pixels (the big screen may zoom its content).
        el.style.transform = "translateX(100px)";
        const k = (el.getBoundingClientRect().left - to.left) / 100 || 1;
        el.style.transform = "";
        const start = from[i] >= 0 ? tiles.current.get(`w${from[i]}`)?.getBoundingClientRect() : undefined;
        const timing = { delay: i * 280, easing: "cubic-bezier(.2,.9,.25,1.12)", fill: "backwards" as const };
        if (start) {
          el.animate([{ transform: `translate(${(start.left - to.left) / k}px, ${(start.top - to.top) / k}px) rotate(${TILTS[from[i] % TILTS.length]}deg)` }, { transform: "none" }], { ...timing, duration: 850 });
        } else {
          el.animate([{ transform: "scale(.3)", opacity: 0 }, { transform: "none", opacity: 1 }], { ...timing, duration: 520 });
        }
      });
    });
    return () => {
      cancelAnimationFrame(frame);
      landed.forEach((el) => el && (el.style.visibility = ""));
    };
    // Only when the answer shows: other updates (a new answer counted) must not stop the flight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown]);
  const keep = (key: string) => (el: HTMLElement | null) => {
    if (el) tiles.current.set(key, el);
    else tiles.current.delete(key);
  };

  return (
    <div className={`fill-stage ${bank.length ? "placing" : "typing"}`}>
      <p className="fill-text big">
        {gaps.map((piece, i) => (
          <span key={i}>
            {piece}
            {i < size && (
              <span className={`fill-slot ${shown ? "landed" : ""}`}>
                {shown ? (
                  <b className="fill-tile ok" ref={keep(`s${i}`)}>
                    {blanks[i][0]}
                  </b>
                ) : (
                  <em>{i + 1}</em>
                )}
              </span>
            )}
          </span>
        ))}
      </p>
      {/* The words to place and, once shown, the figure take the same place; the words stay there unseen, so the screen
          keeps its size and layout when the answer shows. */}
      <div className="fill-below">
        <div className={`fill-wait ${shown ? (leaving ? "leaving" : "gone") : ""}`} aria-hidden={shown || undefined}>
            {bank.length > 0 && (
              <div className="fill-bank">
                <p>{t("Words to place")}</p>
                <div>
                  {bank.map((word, j) => (
                    <b
                      key={j}
                      ref={keep(`w${j}`)}
                      className={`fill-tile ${shown && from.includes(j) ? "ghost" : ""}`}
                      style={{ "--tilt": `${TILTS[j % TILTS.length]}deg`, "--float": `${-j * 0.45}s` } as React.CSSProperties}
                    >
                      {word}
                    </b>
                  ))}
                </div>
              </div>
            )}
            {waiting}
        </div>
        {shown && result && (
          <p className="or-big fill-score">
            <strong>{pct(result.right, voters).toLocaleString(locale)}%</strong> {t("of participants found every word")}
          </p>
        )}
      </div>
    </div>
  );
}

// Match pairs on the big screen before the answer: the left items, and the right ones in a fixed shuffled order.
export function MatchBoard({ options, seed }: { options: string[]; seed: string }) {
  const half = options.length / 2;
  const right = useMemo(() => shuffled(half, seed), [half, seed]);
  return (
    <div className="match-board">
      <ol>
        {options.slice(0, half).map((o, i) => <li key={i}><b>{String.fromCharCode(65 + i)}</b><span>{o}</span></li>)}
      </ol>
      <ol>
        {right.map((r, i) => <li key={i}><b>{i + 1}</b><span>{options[half + r]}</span></li>)}
      </ol>
    </div>
  );
}

// Once shown: how many matched every pair, and each pair with its share of right answers.
export function MatchResults({ options, result, voters, locale = pageLocale() }: { options: string[]; result: { right: number; placed: number[] } | null; voters: number; locale?: string }) {
  const t = useT();
  const half = options.length / 2;
  return (
    <div className="or match-results">
      {result && (
        <p className="or-big">
          <strong>{pct(result.right, voters).toLocaleString(locale)}%</strong> {t("matched every pair")}
        </p>
      )}
      <ol className="match-list">
        {options.slice(0, half).map((left, i) => (
          <li key={i}>
            <span className="truncate">{left}</span>
            <i aria-hidden>↔</i>
            <span className="truncate">{options[half + i]}</span>
            {result && <em>{t("{n}% right").replace("{n}", pct(result.placed[i] ?? 0, voters).toLocaleString(locale))}</em>}
          </li>
        ))}
      </ol>
    </div>
  );
}

// Find on the image: the image with the room's spots (bigger where many tapped), the right zone once shown,
// and this phone's own spot. With `onPick`, a tap (or a drag) places the spot.
export function SpotImage({
  image,
  spots = [],
  zone = null,
  mine,
  onPick,
  big,
}: {
  image: string;
  spots?: number[];
  zone?: Zone | null;
  mine?: [number, number] | null;
  onPick?: (x: number, y: number) => void;
  big?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const top = Math.max(1, ...spots.filter((_, i) => i % 3 === 2));
  const place = (e: React.PointerEvent) => {
    const rect = box.current?.getBoundingClientRect();
    if (!rect || !onPick) return;
    const x = Math.round(Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)) * 1000);
    const y = Math.round(Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)) * 1000);
    onPick(x, y);
  };
  const dots: { x: number; y: number; n: number }[] = [];
  for (let i = 0; i + 2 < spots.length; i += 3) dots.push({ x: spots[i], y: spots[i + 1], n: spots[i + 2] });
  return (
    <div
      ref={box}
      className={`spot ${big ? "big" : ""} ${onPick ? "picking" : ""}`}
      onPointerDown={onPick ? (e) => ((dragging.current = true), e.currentTarget.setPointerCapture(e.pointerId), place(e)) : undefined}
      onPointerMove={onPick ? (e) => dragging.current && place(e) : undefined}
      onPointerUp={onPick ? () => (dragging.current = false) : undefined}
      onPointerCancel={onPick ? () => (dragging.current = false) : undefined}
    >
      <img src={image} alt="" draggable={false} />
      {zone && <span className="spot-zone" style={{ left: `${zone[0] / 10}%`, top: `${zone[1] / 10}%`, width: `${zone[2] / 10}%`, height: `${zone[3] / 10}%` }} />}
      {dots.map((d, i) => (
        <i
          key={i}
          className={`spot-dot ${zone ? (inZone(d.x, d.y, zone) ? "in" : "out") : ""}`}
          style={{ left: `${d.x / 10}%`, top: `${d.y / 10}%`, ["--s" as string]: (0.6 + 1.4 * Math.sqrt(d.n / top)).toFixed(2) }}
        />
      ))}
      {mine && <b className={`spot-pin ${zone ? (inZone(mine[0], mine[1], zone) ? "in" : "out") : ""}`} style={{ left: `${mine[0] / 10}%`, top: `${mine[1] / 10}%` }} />}
    </div>
  );
}

// Slice colors: Hopvote's orange and navy with their light shades (styles.css .wh0 to .wh5).
const SLICES = 6;
// Neighbouring slices never share a color, the last and the first one included.
// Topic rounds have up to 8 topics, each with its own color (.wh0 to .wh7).
const TOPIC_SLICES = 8;
const sliceColor = (i: number, size: number) => (size > 1 && i === size - 1 && i % SLICES === 0 ? 2 : i % SLICES);
// How far into a spin the names are laid out again for where it stops (the wheel then turns too fast to read).
const LAYOUT_SWITCH = 0.3;
const point = (deg: number, r: number) => [r * Math.sin((deg * Math.PI) / 180), -r * Math.cos((deg * Math.PI) / 180)];

// The wheel, turning with the room's spin: every screen and phone stops on the same entry at the same moment.
// `sound`: ticks and a chime, on the presenter's screen. `onSpin`: the presenter spins it with a click.
// `labels`: the topics of topic rounds in the phone's language, in the order of `state.topics.list` (the wheel's own list
// holds the originals). `phone`: the round reads "Round 1 of 3" there.
export function Wheel({ state, sound, onSpin, me, labels, phone }: { state: RoomState; sound?: boolean; onSpin?: () => void; me?: string; labels?: string[]; phone?: boolean }) {
  const t = useT();
  const wheel = state.wheel ?? { list: [], spin: null, picked: [] };
  const topics = state.topics?.at === "picker" ? state.topics : null;
  // Topic rounds: the wheel holds the topics left, each in the language shown.
  const shownLabel = (label: string) => {
    const i = topics ? topics.list.findIndex((x) => x.label === label) : -1;
    return i >= 0 && labels?.[i] ? labels[i] : label;
  };
  const list = topics ? wheel.list.map(shownLabel) : wheel.list;
  const { spin } = wheel;
  // Topic rounds: each topic keeps its own color on every round (the builder shows the same, src/rounds-draft.ts), and the
  // topic the presenter chose without a spin sits under the pointer, its slice marked.
  const topicOf = (i: number) => (topics ? topics.list.findIndex((x) => x.label === wheel.list[i]) : -1);
  const color = (i: number) => (topics && topicOf(i) >= 0 ? topicOf(i) % TOPIC_SLICES : sliceColor(i, Math.max(1, list.length)));
  const placed = topics && !spin && topics.chosen !== null ? wheel.list.indexOf(topics.list[topics.chosen]?.label ?? "") : -1;
  const group = useRef<SVGGElement>(null);
  // The spin (by its start time) that has stopped: its winner shows. A new spin, or a wheel started over, shows none.
  const [ended, setEnded] = useState(0);
  // The spin (by its start time) whose names are laid out for where it stops. Until then they read well where it started.
  const [laidOut, setLaidOut] = useState(0);
  const latest = useRef(state);
  latest.current = state;
  const size = Math.max(1, list.length);
  const slice = 360 / size;
  // Where the wheel rests with no spin: at the start, or on the topic the presenter chose.
  const still = placed >= 0 ? (((360 - (placed + 0.5) * slice) % 360) + 360) % 360 : 0;

  useEffect(() => {
    if (!spin) {
      group.current?.setAttribute("transform", `rotate(${still.toFixed(2)})`);
      setEnded(0);
      setLaidOut(0);
      return;
    }
    // The names turn over for the stopping place once the wheel runs fast (30% into the spin), never as it sets off.
    const turnAt = LAYOUT_SWITCH * SPIN_MS - (serverNow(latest.current) - spin.at);
    const layout = turnAt <= 0 ? (setLaidOut(spin.at), 0) : setTimeout(() => setLaidOut(spin.at), turnAt);
    let raf = 0;
    let lastSlice = -1;
    // Topic rounds with less motion asked for: the wheel shows where it stops at once, the topic once the spin's time is up.
    if (topics && matchMedia("(prefers-reduced-motion: reduce)").matches) {
      group.current?.setAttribute("transform", `rotate(${wheelAngle(spin, SPIN_MS).toFixed(2)})`);
      setLaidOut(spin.at);
      const left = SPIN_MS - (serverNow(latest.current) - spin.at);
      const end = () => {
        if (sound && left > -1500) playSound("win");
        setEnded(spin.at);
      };
      const id = left > 0 ? setTimeout(end, left) : (end(), 0);
      return () => {
        clearTimeout(id);
        clearTimeout(layout);
      };
    }
    const frame = () => {
      const elapsed = serverNow(latest.current) - spin.at;
      const angle = wheelAngle(spin, elapsed);
      // The SVG attribute turns around the wheel's center, the origin of its drawing.
      group.current?.setAttribute("transform", `rotate(${angle.toFixed(2)})`);
      if (sound) {
        const crossing = Math.floor(angle / slice);
        if (lastSlice >= 0 && crossing !== lastSlice && elapsed < SPIN_MS) playSound("tick");
        lastSlice = crossing;
      }
      if (elapsed < SPIN_MS) raf = requestAnimationFrame(frame);
      else {
        if (sound && elapsed < SPIN_MS + 1500) playSound("win");
        setEnded(spin.at);
      }
    };
    frame();
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(layout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spin?.n, spin?.at, size, still]);

  const done = !!spin && ended === spin.at;
  // The slice marked as chosen: the spin's, once it stops, or the presenter's choice.
  const won = done ? spin!.win : placed >= 0 ? placed : null;
  const winner = done ? list[spin!.win] : null;
  const font = size <= 6 ? 11 : size <= 10 ? 9 : size <= 16 ? 7.4 : size <= 28 ? 5.2 : 3.6;
  const maxChars = size <= 10 ? 28 : size <= 28 ? 14 : 12;
  const short = (label: string) => (label.length > maxChars ? `${label.slice(0, maxChars - 1)}…` : label);
  // A long entry gets smaller letters, so it fits between the rim and the hub.
  const fit = (label: string) => Math.min(font, 74 / (Math.min(label.length, maxChars) * 0.56));
  // The entry the pointer stopped on, from the phone's own point of view.
  const mine = done && !!me && spin!.tag === me;
  // Where the wheel rests (where this spin started, then where it will stop): the names are laid out to read well there.
  const rest = spin ? (laidOut === spin.at ? spin.to : spin.from) : still;
  // The last spin's pick is the big name (or not given away while the wheel turns): the list holds the ones before.
  const picked = spin ? wheel.picked.slice(0, -1) : wheel.picked;

  return (
    <div className={`wheel-wrap ${done ? "done" : ""}`}>
      <div className="wheel-box">
        <svg className={`wheel ${onSpin && !spinning(spin, state) ? "can-spin" : ""}`} viewBox="-110 -118 220 228" role="img" aria-label={t("Wheel")} onClick={onSpin && !spinning(spin, state) && list.length ? onSpin : undefined}>
          <g ref={group} className="wheel-turn">
            {list.length <= 1 ? (
              <circle r="100" className="wh0" />
            ) : (
              list.map((_, i) => {
                const [x0, y0] = point(i * slice, 100);
                const [x1, y1] = point((i + 1) * slice, 100);
                return <path key={i} className={`wh${color(i)} ${i === won ? "won" : ""}`} d={`M0 0 L${x0.toFixed(2)} ${y0.toFixed(2)} A100 100 0 ${slice > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)} Z`} />;
              })
            )}
            {list.map((label, i) => {
              // Each name runs along its slice; names that would read upside down where the wheel stops are turned over.
              const a = (i + 0.5) * slice - 90;
              const flip = (((a + rest) % 360) + 360) % 360 > 90 && (((a + rest) % 360) + 360) % 360 < 270;
              return (
                <text key={i} className={`wht wht${color(i)}`} transform={flip ? `rotate(${a + 180}) translate(-92 0)` : `rotate(${a}) translate(92 0)`} textAnchor={flip ? "start" : "end"} dominantBaseline="central" fontSize={fit(label).toFixed(2)}>
                  {short(label)}
                </text>
              );
            })}
            {/* The picked slice: an accent arc along its edge, visible on every slice color. */}
            {won !== null && size > 1 && (() => {
              const pad = Math.min(1.5, slice / 6);
              const [x0, y0] = point(won * slice + pad, 106);
              const [x1, y1] = point((won + 1) * slice - pad, 106);
              return <path className="wheel-won-arc" d={`M${x0.toFixed(2)} ${y0.toFixed(2)} A106 106 0 ${slice > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`} />;
            })()}
          </g>
          <circle r="101" className="wheel-rim" />
          <circle r="15" className="wheel-hub" />
          <path d="M-10 -115 L10 -115 L0 -93 Z" className="wheel-pointer" />
        </svg>
      </div>
      <div className="wheel-side">
        {topics ? (
          spin && !done ? (
            <p className="wheel-status spinning">{t("The wheel is spinning…")}</p>
          ) : topics.chosen !== null ? (
            <RoundWon topics={topics} label={labels?.[topics.chosen] ?? topics.list[topics.chosen].label} phone={phone} key={spin?.n ?? -1} />
          ) : (
            <>
              <p className="wheel-status">{list.length === 1 ? t("1 topic on the wheel") : t("{n} topics on the wheel").replace("{n}", String(list.length))}</p>
              <PlayedTopics topics={topics} labels={labels} />
            </>
          )
        ) : !list.length ? (
          <p className="wheel-status">{t("The wheel fills with first names as people join.")}</p>
        ) : winner !== null ? (
          <div className="wheel-winner" key={spin!.n}>
            <PartyPopper size={34} aria-hidden />
            <strong>{mine ? t("It's you!") : winner}</strong>
            {mine && <span>{winner}</span>}
          </div>
        ) : spin ? (
          <p className="wheel-status spinning">{t("The wheel is spinning…")}</p>
        ) : (
          <p className="wheel-status">
            {state.options.length
              ? list.length === 1 ? t("1 entry on the wheel") : t("{n} entries on the wheel").replace("{n}", String(list.length))
              : list.length === 1 ? t("1 name on the wheel") : t("{n} names on the wheel").replace("{n}", String(list.length))}
          </p>
        )}
        {picked.length > 0 && (
          <div className="wheel-picked">
            <p>{t("Already picked")}</p>
            <ul>{picked.map((name, i) => <li key={i}>{name}</li>)}</ul>
          </div>
        )}
      </div>
    </div>
  );
}

// Topic rounds: the topic chosen for the next round, its number and its questions. "Last round" when it was the only one
// left; on a phone "Round 1 of 3". `eyebrow`: another first line (a phone after the room's vote: "The room chose").
export function RoundWon({ topics, label, phone, eyebrow }: { topics: TopicsState; label: string; phone?: boolean; eyebrow?: string }) {
  const t = useT();
  const n = topics.chosen !== null ? (topics.list[topics.chosen]?.n ?? 0) : 0;
  const head = eyebrow ?? (topics.chosenHow === "last" ? t("Last round") : phone ? t("Round {n} of {m}").replace("{n}", String(topics.roundNo)).replace("{m}", String(topics.of)) : t("Round {n}").replace("{n}", String(topics.roundNo)));
  // On the big screen the name takes the largest size at which each word fits its column, on 3 lines at most: a long
  // word gets smaller letters instead of being cut, whatever the window, the join card or the zoom of the content zone.
  const name = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const el = name.current;
    if (phone || !el) return;
    const fit = () => {
      el.style.fontSize = "";
      let size = parseFloat(getComputedStyle(el).fontSize) || 48;
      const over = () => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > size * 1.05 * 3 + 2;
      for (let i = 0; i < 24 && size > 18 && over(); i++) {
        size *= 0.92;
        el.style.fontSize = `${size.toFixed(1)}px`;
      }
    };
    fit();
    const watch = new ResizeObserver(fit);
    if (el.parentElement) watch.observe(el.parentElement);
    document.fonts?.ready.then(fit);
    return () => watch.disconnect();
  }, [label, phone]);
  return (
    <div className="wheel-winner round-won">
      <PartyPopper size={34} aria-hidden />
      <p className="round-eyebrow">{head}</p>
      <strong ref={name}>{label}</strong>
      <span>{n === 1 ? t("1 question") : t("{n} questions").replace("{n}", String(n))}</span>
      {(topics.tie || topics.empty) && <span className="round-note">{topics.tie ? t("Tie: drawn at random") : t("No votes: drawn at random")}</span>}
      {/* On the presenter's screen, back from a round already answered: why it can no longer be chosen again. */}
      {!phone && topics.locked && topics.chosenHow !== "last" && <span className="round-note">{t("Round started")}</span>}
    </div>
  );
}

// The topics already played, checked, under the wheel's count.
export function PlayedTopics({ topics, labels }: { topics: TopicsState; labels?: string[] }) {
  const t = useT();
  const played = topics.order.filter((i) => topics.list[i]);
  if (!played.length) return null;
  return (
    <div className="wheel-picked round-played">
      <p>{t("Already played")}</p>
      <ul>
        {played.map((i) => (
          <li key={i}><Check size={16} strokeWidth={3} aria-hidden />{labels?.[i] ?? topics.list[i].label}</li>
        ))}
      </ul>
    </div>
  );
}

const spinning = (spin: { at: number } | null | undefined, state: RoomState) => !!spin && serverNow(state) - spin.at < SPIN_MS;
export const wheelSpinning = spinning;

// A timer: minutes and seconds, a ring that empties, and "Time's up!" at zero. Ticks locally from the room's clock.
export function CountdownView({ state, big, sound }: { state: RoomState; big?: boolean; sound?: boolean }) {
  const t = useT();
  const clock: Clock = state.clock ?? { run: false, end: 0, left: 0, total: 1 };
  const [, tick] = useState(0);
  useEffect(() => {
    if (!clock.run) return;
    const id = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(id);
  }, [clock.run, clock.end]);
  const left = clockLeft(clock, serverNow(state));
  const over = clock.run && left <= 0;
  const rang = useRef(0);
  useEffect(() => {
    if (sound && over && rang.current !== clock.end) {
      rang.current = clock.end;
      if (serverNow(state) - clock.end < 3000) playSound("end");
    }
  });
  const secs = Math.ceil(left / 1000);
  const shown = secs >= 3600 ? `${Math.floor(secs / 3600)}:${String(Math.floor((secs % 3600) / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}` : `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
  const ratio = clock.total ? Math.min(1, left / clock.total) : 0;
  const r = 46;
  const circ = 2 * Math.PI * r;
  return (
    <div className={`clock ${big ? "big" : ""} ${over ? "over" : ""} ${clock.run && !over && secs <= 10 ? "hurry" : ""}`} role="timer" aria-live="off">
      <svg viewBox="0 0 100 100" aria-hidden>
        <circle cx="50" cy="50" r={r} className="clock-track" />
        <circle cx="50" cy="50" r={r} className="clock-fill" strokeDasharray={circ} strokeDashoffset={circ * (1 - ratio)} />
      </svg>
      <div className="clock-face">
        <strong>{over ? t("Time's up!") : shown}</strong>
        {!clock.run && left > 0 && left < clock.total && <span><Pause size={16} /> {t("Paused")}</span>}
      </div>
    </div>
  );
}

// A video or audio from its link: the provider's player, or the browser's own for a file.
// `poster`: a picture of a player instead of the player itself (the example pictures).
export function MediaPlayer({ url, big, title, poster }: { url: string; big?: boolean; title?: string; poster?: string }) {
  const media = mediaOf(url);
  if (!media) return null;
  if (poster) {
    return (
      <div className={`media-frame media-poster ${big ? "big" : ""}`} style={{ backgroundImage: `url(${poster})` }} aria-hidden>
        <span className="media-play" />
        <span className="media-bar"><i /></span>
      </div>
    );
  }
  if (media.kind === "video") return <video className={`media-frame ${big ? "big" : ""}`} src={media.src} controls playsInline preload="metadata" />;
  if (media.kind === "audio") return <audio className="media-audio" src={media.src} controls preload="metadata" />;
  return (
    <iframe
      className={`media-frame ${media.audio ? `audio ${media.kind}` : ""} ${big ? "big" : ""}`}
      src={media.src}
      title={title ?? media.label}
      allow="autoplay; encrypted-media; picture-in-picture; fullscreen; clipboard-write"
      referrerPolicy="strict-origin-when-cross-origin"
    />
  );
}

// A phone's verdict once the answer shows, for the games with several parts (blanks, pairs): all right, some, or none.
export function PartsVerdict({ right, size }: { right: number; size: number }) {
  const t = useT();
  if (right === size)
    return (
      <p className="quiz-verdict ok"><Check size={22} strokeWidth={3} />{t("Correct!")}</p>
    );
  return (
    <p className={`quiz-verdict ${right ? "some" : "ko"}`}>
      {right ? null : <X size={22} strokeWidth={3} />}
      {right ? t("{n} of {m} right").replace("{n}", String(right)).replace("{m}", String(size)) : t("Not quite")}
    </p>
  );
}
