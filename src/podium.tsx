// The quiz leaderboard's animated views (the setting in src/board.ts). On the big screen: the standings between questions
// (top 5 moving from their rank before the question to the new one, points counting up) and the final podium (3rd, 2nd,
// then 1st with confetti, then 4th to 10th). On phones: the person's own place and the top of the board.
// Animations play only when the leaderboard just opened (`elapsed`, from boardElapsed), carry on where they were when the
// screen is drawn again, end on the full result, and stay still with reduced motion.
import { useEffect, useState } from "react";
import { ArrowUp, Medal } from "lucide-react";
import { Buddy } from "./buddies";
import { playSound } from "./kind-views";
import { ordinal } from "./board";
import type { BoardEntry, Standing } from "./room";
import "./podium.css";

type T = (text: string, vars?: Record<string, string | number>) => string;

const reduced = () => {
  try {
    return matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};

// The animation's start, read once: negative when the leaderboard opened a moment before this was drawn.
function useOffset(elapsed: number | null) {
  const [offset] = useState(() => (elapsed === null || reduced() ? null : -Math.round(elapsed)));
  return offset;
}

// A number counting from `from` to `to`, `delay` ms after the animation's start, for `length` ms.
function CountUp({ from, to, offset, delay, length, locale }: { from: number; to: number; offset: number | null; delay: number; length: number; locale: string }) {
  const [value, setValue] = useState(() => (offset === null || offset <= -(delay + length) ? to : from));
  useEffect(() => {
    if (offset === null || from === to) return setValue(to);
    const start = performance.now() + offset + delay;
    let frame = 0;
    const step = (now: number) => {
      const p = Math.min(1, Math.max(0, (now - start) / length));
      setValue(Math.round(from + (to - from) * (1 - Math.pow(1 - p, 3))));
      if (p < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [from, to, offset]);
  return <>{value.toLocaleString(locale)}</>;
}

const before = (e: BoardEntry) => e.score - (e.gained ?? 0);

// Between questions: the top 5, each row sliding from its place before the question to its new one.
export function Standings({ entries, locale, elapsed, t }: { entries: BoardEntry[]; locale: string; elapsed: number | null; t: T }) {
  const offset = useOffset(elapsed);
  if (!entries.length) return <p className="cloud-empty">{t("Nobody has points yet.")}</p>;
  const top = entries.slice(0, 5);
  // The order before the question: players new on the board come in from below.
  const earlier = [...top].sort((a, b) => Number(before(b) > 0) - Number(before(a) > 0) || before(b) - before(a) || a.name.localeCompare(b.name));
  return (
    <ol className={`sd ${offset === null ? "still" : ""}`} style={{ "--t0": `${offset ?? 0}ms` } as React.CSSProperties}>
      {top.map((e, i) => {
        const from = before(e) > 0 ? earlier.indexOf(e) - i : top.length - i;
        // Places won since the last question (a fall shows by the row moving down, without a mark).
        const moved = e.prev ? e.prev - (e.rank ?? i + 1) : 0;
        // The points this question brought, unless they are the whole score (the first question): one figure shown once.
        const gained = e.gained && e.gained !== e.score ? e.gained : 0;
        return (
          <li key={e.tag || `${e.name}-${i}`} className={`sd-row ${i === 0 ? "first" : ""}`} style={{ "--from": from, "--i": i, zIndex: from > 0 ? 2 : 1 } as React.CSSProperties}>
            <span className={`sd-rank r${Math.min(4, e.rank ?? i + 1)}`}>{e.rank ?? i + 1}</span>
            <Buddy id={e.avatar} size={48} className="sd-buddy" />
            <span className="sd-name truncate">{e.name}</span>
            <span className="sd-move" aria-hidden>
              {moved > 0 && <><ArrowUp size={18} strokeWidth={3} />{moved}</>}
            </span>
            <span className="sd-gain">{gained ? `+${gained.toLocaleString(locale)}` : ""}</span>
            <strong className="sd-score"><CountUp from={before(e)} to={e.score} offset={offset} delay={700} length={1100} locale={locale} /></strong>
          </li>
        );
      })}
    </ol>
  );
}

// Timings of the podium, in ms from its start: the 3rd place, the 2nd, a pause, the 1st, then the rest of the top 10.
const STEPS = { third: 500, second: 1800, first: 3500, rest: 5300 };

// The confetti of the launch animation, in a burst over the winner.
function Confetti() {
  return (
    <span className="pd-confetti" aria-hidden>
      {Array.from({ length: 36 }, (_, i) => {
        const second = i >= 22;
        const angle = -Math.PI / 2 + (((second ? i - 22 : i) / (second ? 14 : 22)) - 0.5) * Math.PI * 1.6;
        const reach = (second ? 26 : 18) + (i % 4) * 5;
        return (
          <b
            key={i}
            className={second ? "late" : ""}
            style={{ "--x": `${Math.cos(angle) * reach}vmin`, "--y": `${Math.sin(angle) * reach * 0.8}vmin`, "--r": `${(i % 2 ? 1 : -1) * (160 + i * 19)}deg` } as React.CSSProperties}
          />
        );
      })}
    </span>
  );
}

// The final leaderboard: three steps rising one after the other, the winner last, then 4th to 10th.
// `sound`: the presenter's screen plays a short tone for each place (never phones or other screens).
export function Podium({ entries, locale, elapsed, sound, t }: { entries: BoardEntry[]; locale: string; elapsed: number | null; sound?: boolean; t: T }) {
  const offset = useOffset(elapsed);
  useEffect(() => {
    if (!sound || offset === null) return;
    const timers = [
      [STEPS.third + 700, "tick"],
      [STEPS.second + 700, "tick"],
      [STEPS.first + 900, "win"],
    ]
      .filter(([at]) => (at as number) + offset > 0)
      .map(([at, kind]) => setTimeout(() => playSound(kind as "tick" | "win"), (at as number) + offset));
    return () => timers.forEach(clearTimeout);
  }, [offset, sound]);
  if (!entries.length) return <p className="cloud-empty">{t("Nobody has points yet.")}</p>;
  const places = [entries[1], entries[0], entries[2]];
  const rest = entries.slice(3, 10);
  return (
    <div className={`pd ${offset === null ? "still" : ""} ${rest.length ? "" : "alone"}`} style={{ "--t0": `${offset ?? 0}ms` } as React.CSSProperties}>
      <div className="pd-stage">
        {places.map((e, i) => {
          const place = i === 1 ? 1 : i === 0 ? 2 : 3;
          const at = place === 1 ? STEPS.first : place === 2 ? STEPS.second : STEPS.third;
          return (
            // Steps and sizes follow the rank: two players tied for first look the same, on the highest step.
            <div key={place} className={`pd-col p${place} r${Math.min(3, e?.rank ?? place)}`} style={{ "--d": `${at}ms` } as React.CSSProperties}>
              {e ? (
                <div className="pd-who">
                  {place === 1 && <Confetti />}
                  <Buddy id={e.avatar} size={(e.rank ?? place) === 1 ? 88 : 68} className="pd-buddy" />
                  <span className="pd-name truncate">{e.name}</span>
                  <strong className="pd-score">{e.score.toLocaleString(locale)}</strong>
                </div>
              ) : (
                <div className="pd-who" />
              )}
              <div className="pd-bar">
                <span className="pd-rank">{e?.rank ?? place}</span>
              </div>
            </div>
          );
        })}
      </div>
      {rest.length > 0 && (
        <ol className="pd-rest" aria-label={t("Leaderboard")}>
          {rest.map((e, i) => (
            <li key={e.tag || `${e.name}-${i}`} style={{ "--i": i } as React.CSSProperties}>
              <span className="pd-rest-rank">{e.rank ?? i + 4}</span>
              <Buddy id={e.avatar} size={36} />
              <span className="pd-rest-name truncate">{e.name}</span>
              <strong>{e.score.toLocaleString(locale)}</strong>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// A phone's own place: "You are 4th of 40", with its points and what the last question brought.
// `listed`: its row is in the list below, which already shows its points: they are not repeated.
export function MyStanding({ me, lang, locale, t, final, listed, elapsed }: { me: Standing | null | undefined; lang: string; locale: string; t: T; final?: boolean; listed?: boolean; elapsed?: number | null }) {
  const offset = useOffset(elapsed ?? null);
  if (me === undefined) return null;
  // The final leaderboard closes the quiz: no "yet" there.
  if (!me) return <p className="my-place none">{final ? t("No points scored") : t("No points yet")}</p>;
  // The final leaderboard is about the whole quiz: no points of the last question there.
  const gained = !final && me.gained && me.gained !== me.score ? me.gained : 0;
  return (
    <div className={`my-place ${me.rank <= 3 ? `p${me.rank}` : ""} ${offset === null ? "still" : ""}`} role="status">
      {final && me.rank <= 3 && <Confetti />}
      <Medal size={30} className="my-place-icon" aria-hidden />
      <span className="my-place-text">
        <strong className="truncate">{t("You are {rank} of {n}", { rank: ordinal(me.rank, lang), n: me.of.toLocaleString(locale) })}</strong>
        {(!listed || gained > 0) && (
          <small className="truncate">
            {!listed && t("{n} points", { n: me.score.toLocaleString(locale) })}
            {gained > 0 && <em>+{gained.toLocaleString(locale)}</em>}
          </small>
        )}
      </span>
    </div>
  );
}

// The time the big screen's podium takes to show its winner: phones keep the result until then, so nobody in the room
// reads the winner on a phone before the screen shows it.
export const PODIUM_WINNER_MS = STEPS.first + 1300;

// A phone's leaderboard: its own place, then the top of the board. On the final podium, while the big screen is still
// showing 3rd, 2nd then 1st, the phone says to watch the screen (a phone that joins later, or reduced motion, sees it all).
export function PhoneResults({ me, board, mine, lang, locale, t, final, elapsed }: { me: Standing | null | undefined; board: BoardEntry[]; mine: string; lang: string; locale: string; t: T; final: boolean; elapsed: number | null }) {
  const wait = final && elapsed !== null && !reduced() ? PODIUM_WINNER_MS - elapsed : 0;
  const [held, setHeld] = useState(wait > 0);
  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setHeld(false), wait);
    return () => clearTimeout(timer);
  }, []);
  if (held) return <p className="my-place none watch">{t("Watch the big screen")}</p>;
  return (
    <>
      <MyStanding me={me} lang={lang} locale={locale} t={t} final={final} listed={board.some((e) => e.tag === mine)} elapsed={final && elapsed !== null ? 0 : null} />
      <PhoneBoard entries={board} mine={mine} locale={locale} t={t} />
    </>
  );
}

// The top of the board on a phone, the person's own row marked (found by its tag, never by name).
export function PhoneBoard({ entries, mine, locale, t }: { entries: BoardEntry[]; mine: string; locale: string; t: T }) {
  if (!entries.length) return <p className="cloud-empty">{t("Nobody has points yet.")}</p>;
  return (
    <ol className="board">
      {entries.map((e, i) => (
        <li key={e.tag || `${e.name}-${i}`} className={[(e.rank ?? i + 1) <= 3 && `podium p${e.rank ?? i + 1}`, e.tag && e.tag === mine && "me"].filter(Boolean).join(" ")}>
          <span className="board-pos">{e.rank ?? i + 1}</span>
          <Buddy id={e.avatar} size={34} className="board-buddy" />
          <span className="board-name truncate">{e.name}</span>
          <strong>{e.score.toLocaleString(locale)}</strong>
        </li>
      ))}
    </ol>
  );
}
