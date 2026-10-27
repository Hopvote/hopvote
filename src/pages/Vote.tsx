import { useEffect, useMemo, useRef, useState } from "react";
import { Check, CircleAlert, CirclePlay, Clapperboard, ExternalLink, Languages, Layers, Lock, Minus, Plus, RefreshCw, RotateCcw, Timer, Trophy, WifiOff, X } from "lucide-react";
import { ChoiceResults, CountIn, Countdown, keepMarks, Leaderboard, NumberResults, OrderResults, QaList, RankResults, ScaleResults, ScalesResults, WordCloud, useCountdown } from "../answers";
import { parseNumber } from "../questions";
import { CountdownView, FillText, MediaPlayer, PartsVerdict, PointsResults, RoundWon, SpotImage, Wheel, shuffled } from "../kind-views";
import { inZone, POINTS, POINTS_STEP } from "../kinds";
import { rightBlank } from "../fill";
import { mediaOf } from "../media";
import { tagOf } from "../wheel";
import { postId, useRoom, voterId, type RoomState } from "../room";
import { AVATARS } from "../avatars";
import { PHONE } from "../phone";
import { Buddy } from "../buddies";
import { cloudWord, LANGUAGES, mergeWords, UiProvider, initialLang, saveLang, startsOnOriginal, useEcho, usePostTranslations, useT, useTranslated, useUiStrings, withTranslations } from "../translate";
import { LANG_CODES, RTL } from "../languages";
import { usePageLang } from "../app-i18n";
import { Message, Wordmark } from "../ui";
import { BrandLogo, useBodyBrand, useBrand } from "../brand";
import { LaunchCurtain, useLaunch } from "../launch";
import { boardElapsed, boardModeOf, boardView, ownBoardOf, PODIUM_MS } from "../board";
import { MyStanding, PhoneResults } from "../podium";
import { screenLocale } from "../screen-i18n";
import { decorBrand, shownDecor } from "../decor";
import { PhoneBats, PhoneMark, useBodyDecor } from "../halloween-decor";

// Answers are remembered per question, so a participant sees their choice again if the presenter comes back to it.
// A reset starts a new round: answers remembered from before it are left behind.
const key = (code: string, state: RoomState, kind = "vote") => `hopvote:${kind}:${code}:${state.round ? `${state.round}:` : ""}${state.index}`;
function read<T>(k: string): T | undefined {
  try {
    const saved = localStorage.getItem(k);
    return saved === null ? undefined : (JSON.parse(saved) as T);
  } catch {
    return undefined;
  }
}
function write(k: string, value: unknown) {
  try {
    localStorage.setItem(k, JSON.stringify(value));
  } catch {
    // Answer still counted, just not remembered on reload.
  }
}

type Send = (data: Record<string, unknown>, again?: boolean) => Promise<boolean>;
// An answer names its question and round: the room refuses it if the presenter has moved on or cleared the answers.
const answer = (state: RoomState, data: Record<string, unknown>) => ({ ...data, voter: voterId(), index: state.index, round: state.round });

// What happened to the last answer sent: on its way, counted by the room, or refused (voting paused, question over).
// "idle": nothing sent from this screen (an answer remembered from before shows as sent).
type SendPhase = "idle" | "sending" | "sent" | "refused";
function useSending() {
  const [phase, setPhase] = useState<SendPhase>("idle");
  const last = useRef(0);
  async function track(sending: Promise<boolean>) {
    const id = ++last.current;
    setPhase("sending");
    const ok = await sending;
    // A newer answer went out meanwhile: it tells the outcome.
    if (id !== last.current) return ok;
    setPhase(ok ? "sent" : "refused");
    if (ok) {
      try {
        navigator.vibrate?.(20);
      } catch {
        // No vibration on this phone.
      }
    }
    return ok;
  }
  return { phase, track };
}

// The line under an answer: "Sending…" while the room has not confirmed it (shown after a moment, so a quick answer
// never flickers), then the check. Only an answer confirmed on this screen rises in; one remembered from before stays still.
function Sent({ phase, text }: { phase: SendPhase; text: string }) {
  const t = useT();
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    setSlow(false);
    if (phase !== "sending") return;
    const timer = setTimeout(() => setSlow(true), 300);
    return () => clearTimeout(timer);
  }, [phase]);
  // A change the room refused: the answer from before still counts and stays marked as sent, the person is told the new one did not.
  if (phase === "refused") {
    return (
      <>
        <p className="sent-line" role="status">
          <Check size={18} strokeWidth={3} aria-hidden />
          {text}
        </p>
        <p className="muted sent-note" role="alert">{t("Your change was not sent.")}</p>
      </>
    );
  }
  if (phase === "sending") {
    return (
      <p className="sent-line sending" role="status">
        {slow && <><span className="spinner" aria-hidden />{t("Sending…")}</>}
      </p>
    );
  }
  return (
    <p className={`sent-line ${phase === "sent" ? "live" : ""}`} role="status">
      <Check size={18} strokeWidth={3} aria-hidden />
      {text}
    </p>
  );
}

// Shown on the answer form again when the room did not count the answer.
function Refused({ phase }: { phase: SendPhase }) {
  const t = useT();
  if (phase !== "refused") return null;
  return (
    <p className="sent-line ko" role="alert">
      <CircleAlert size={18} aria-hidden />
      {t("Not sent. Try again.")}
    </p>
  );
}

const NAME_KEY = "hopvote:name";
const AVATAR_KEY = "hopvote:avatar";
// When this phone last saw each room, by code.
const SEEN_KEY = "hopvote:seen:";
const SEEN_MS = 30 * 24 * 3600 * 1000;
// The buddy this phone shows: picked by the person, or drawn once at random and kept.
const savedAvatar = () => {
  const saved = read<string>(AVATAR_KEY);
  if (saved && AVATARS.includes(saved)) return saved;
  const drawn = AVATARS[Math.floor(Math.random() * AVATARS.length)];
  write(AVATAR_KEY, drawn);
  return drawn;
};
const savedName = () => read<string>(NAME_KEY);

// Asked once before the first quiz question, for the leaderboard.
function NameForm({ send, onDone, quiz = true }: { send: Send; onDone: (name: string, avatar: string) => void; quiz?: boolean }) {
  const t = useT();
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState(savedAvatar);
  function submit(e: React.FormEvent) {
    e.preventDefault();
    const typed = name.trim().slice(0, 20);
    const clean = typed || t("Anonymous");
    // Playing without a nickname holds for this visit only: the next presentation asks again.
    if (typed) write(NAME_KEY, clean);
    write(AVATAR_KEY, avatar);
    send({ type: "name", voter: voterId(), name: clean, avatar });
    onDone(clean, avatar);
  }
  return (
    <form className="stack name-form" onSubmit={submit}>
      {quiz ? (
        <>
          <p className="name-title"><Trophy size={20} />{t("It's a quiz")}</p>
          <p className="muted">{t("Pick a nickname to appear on the leaderboard.")}</p>
        </>
      ) : (
        <>
          <p className="name-title">{t("Welcome!")}</p>
          <p className="muted">{t("Your first name will appear on the room's screen.")}</p>
        </>
      )}
      <div className="avatar-row">
        <span className="avatar-big" aria-hidden><Buddy id={avatar} size={52} /></span>
        <input maxLength={20} autoComplete="off" autoCapitalize="words" enterKeyHint="go" aria-label={quiz ? t("Your nickname") : t("Your first name")} placeholder={quiz ? t("Your nickname") : t("Your first name")} value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <p className="avatar-label">{t("Pick your avatar")}</p>
      <div className="avatar-grid" role="radiogroup" aria-label={t("Pick your avatar")}>
        {AVATARS.map((a) => (
          <button type="button" key={a} role="radio" aria-checked={avatar === a} aria-label={`${t("Avatar")} ${a.slice(1)}`} className={avatar === a ? "on" : ""} onClick={() => setAvatar(a)}>
            <Buddy id={a} size={40} />
          </button>
        ))}
      </div>
      <button className="primary" disabled={!quiz && !name.trim()}>{name.trim() || !quiz ? t("Let's go") : t("Play without a nickname")}</button>
    </form>
  );
}

function Choice({ state, code, send }: { state: RoomState; code: string; send: Send }) {
  const t = useT();
  const k = key(code, state);
  const [mine, setMine] = useState<number | number[] | undefined>(() => read<number | number[]>(k));
  const [picked, setPicked] = useState<number[]>(() => (Array.isArray(mine) ? mine : []));
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(savedName);
  const clock = useCountdown(state);
  const scale = state.kind === "scale";
  const closed = state.quiz && (state.revealed || !!clock?.over);
  const { phase, track } = useSending();
  // A nickname only matters where a leaderboard can show (first names asked, leaderboard not off).
  const ranked = state.quiz && state.hasBoard;

  // The server keys points by device: send the pseudo again for each quiz question.
  useEffect(() => {
    if (ranked && name) send({ type: "name", voter: voterId(), name });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ranked, name, state.round]);

  async function vote(option: number | number[]) {
    setMine(option);
    setEditing(false);
    // Not counted (voting closed, time up, question changed): back to the last answer the room has.
    if (await track(send(answer(state, { type: "vote", option })))) write(k, option);
    else setMine(read(k));
  }

  if (ranked && !name) return <NameForm send={send} onDone={setName} />;

  if (state.quiz && state.timer > 0 && !state.startedAt && !state.revealed) {
    return (
      <div className="wait-card">
        <Timer size={28} />
        <strong>{t("Get ready")}</strong>
        <span>{state.timer} {t("seconds to answer, as soon as the timer starts.")}</span>
      </div>
    );
  }
  // The count-in before the question shows, in step with the big screen.
  if (clock && clock.pre > 0 && !state.revealed) return <CountIn pre={clock.pre} />;

  if (closed) {
    const right = mine === state.correct;
    return (
      <div className="stack">
        {!state.revealed ? (
          <p className="quiz-verdict wait"><Timer size={22} />{t("Time's up, answer on screen")}</p>
        ) : mine !== undefined ? (
          <p className={`quiz-verdict ${right ? "ok" : "ko"}`}>
            {right ? <Check size={22} strokeWidth={3} /> : <X size={22} strokeWidth={3} />}
            {right ? t("Correct!") : t("Not quite")}
          </p>
        ) : (
          <p className="quiz-verdict wait">{t("No answer this time")}</p>
        )}
        {state.revealed && <ChoiceResults options={state.options} counts={state.counts} mine={mine} correct={state.correct} />}
      </div>
    );
  }

  const answering = mine === undefined || editing;

  if (answering && state.multi) {
    const toggle = (i: number) => setPicked((p) => (p.includes(i) ? p.filter((x) => x !== i) : [...p, i]));
    return (
      <div className="stack">
        <p className="muted">{t("Several answers allowed.")}</p>
        <Refused phase={phase} />
        <div className="choices">
          {state.options.map((option, i) => (
            <button key={i} className={`choice check ${picked.includes(i) ? "picked" : ""}`} onClick={() => toggle(i)} aria-pressed={picked.includes(i)}>
              <span className="tick">{picked.includes(i) && <Check size={16} strokeWidth={3} />}</span>
              {option}
            </button>
          ))}
        </div>
        <button className="primary" disabled={!picked.length} onClick={() => vote(picked)}>{t("Submit")}</button>
      </div>
    );
  }

  if (answering) {
    return (
      <div className="stack">
        {clock && <Countdown left={clock.left} ratio={clock.ratio} />}
        <Refused phase={phase} />
        {scale ? (
          <>
            <div className="scale-pick">
              {Array.from({ length: state.max }, (_, i) => (
                <button key={i} className={`choice ${mine === i ? "picked" : ""}`} onClick={() => vote(i)}>
                  {i + 1}
                </button>
              ))}
            </div>
            {state.labels && (
              <div className="scale-ends">
                <span>1 · {state.labels[0] || t("Not at all")}</span>
                <span>{state.max} · {state.labels[1] || t("Completely")}</span>
              </div>
            )}
          </>
        ) : (
          <div className="choices">
            {state.options.map((option, i) => (
              <button key={i} className={`choice ${mine === i ? "picked" : ""}`} onClick={() => vote(i)}>
                {option}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="stack">
      {clock && <Countdown left={clock.left} ratio={clock.ratio} />}
      <Sent phase={phase} text={state.quiz ? t("Answer saved, result on screen") : t("Answer sent")} />
      {state.quiz ? (
        <p className="muted">{t("Your choice:")} {state.options[mine as number]}</p>
      ) : scale ? (
        <ScaleResults counts={state.counts} max={state.max} labels={state.labels} mine={mine as number} style={state.style} />
      ) : (
        <ChoiceResults options={state.options} counts={state.counts} mine={mine} voters={state.multi ? state.answered : undefined} />
      )}
      <button className="ghost" onClick={() => setEditing(true)}>{t("Change my answer")}</button>
    </div>
  );
}

// Tap the items in order of preference: simpler than dragging on a phone.
function Rank({ state, code, send }: { state: RoomState; code: string; send: Send }) {
  const t = useT();
  const k = key(code, state, "rank");
  const [sent, setSent] = useState<number[] | undefined>(() => read<number[]>(k));
  const [order, setOrder] = useState<number[]>([]);
  const [editing, setEditing] = useState(false);
  const size = state.options.length;
  const { phase, track } = useSending();

  async function submit() {
    setSent(order);
    setEditing(false);
    if (await track(send(answer(state, { type: "rank", order })))) write(k, order);
    else setSent(read(k));
  }

  if (sent && !editing) {
    return (
      <div className="stack">
        <Sent phase={phase} text={t("Ranking sent")} />
        <RankResults options={state.options} counts={state.counts} voters={state.answered} />
        <button className="ghost" onClick={() => (setOrder([]), setEditing(true))}>{t("Redo my ranking")}</button>
      </div>
    );
  }
  const left = state.options.map((_, i) => i).filter((i) => !order.includes(i));
  return (
    <div className="stack">
      <Refused phase={phase} />
      <p className="muted">{order.length < size ? `${t("Tap your choice number")} ${order.length + 1}` : t("Your ranking is ready.")}</p>
      {order.length > 0 && (
        <ol className="rank-picked">
          {order.map((i, pos) => (
            <li key={i}><b className="rank-pos">{pos + 1}</b>{state.options[i]}</li>
          ))}
        </ol>
      )}
      {left.length > 0 && (
        <div className="choices">
          {left.map((i) => (
            <button key={i} className="choice" onClick={() => setOrder((o) => (o.length === size - 2 ? [...o, i, ...left.filter((x) => x !== i)] : [...o, i]))}>
              {state.options[i]}
            </button>
          ))}
        </div>
      )}
      <div className="row-actions">
        {order.length > 0 && (
          <button className="ghost with-icon" onClick={() => setOrder([])}><RotateCcw size={16} />{t("Start over")}</button>
        )}
        <button className="primary grow" disabled={order.length < size} onClick={submit}>{t("Send")}</button>
      </div>
    </div>
  );
}

// A slide: its text under the title (the image shows above). Nothing to answer.
function SlideView({ state }: { state: RoomState; code: string; send: Send }) {
  return state.text ? <p className="slide-text">{state.text}</p> : null;
}

// Only web addresses open from a phone; the server already refuses anything else.
const safeUrl = (url: string) => (/^https?:\/\//i.test(url) ? url : "");
const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

// A link to open: one button. The room counts how many people opened it, once each.
function LinkView({ state, send }: { state: RoomState; code: string; send: Send }) {
  const t = useT();
  const url = safeUrl(state.url);
  if (!url) return null;
  return (
    <div className="stack link-view">
      <a className="primary button link-open" href={url} target="_blank" rel="noopener noreferrer" onClick={() => void send(answer(state, { type: "opened" }))}>
        <ExternalLink size={19} /> {t("Open the link")}
      </a>
      <p className="muted link-host">{hostOf(url)}</p>
    </div>
  );
}

// Several statements, each rated with a tap; sent together once every one has its rating.
function Scales({ state, code, send }: { state: RoomState; code: string; send: Send }) {
  const t = useT();
  const k = key(code, state, "scales");
  const size = state.options.length;
  const [sent, setSent] = useState<number[] | undefined>(() => read<number[]>(k));
  const [values, setValues] = useState<(number | undefined)[]>(() => sent ?? Array.from({ length: size }, () => undefined));
  const [editing, setEditing] = useState(false);
  const done = values.filter((v) => v !== undefined).length;
  const { phase, track } = useSending();

  async function submit() {
    const picked = values as number[];
    setSent(picked);
    setEditing(false);
    if (await track(send(answer(state, { type: "scales", values: picked })))) write(k, picked);
    else setSent(read(k));
  }

  if (sent && !editing) {
    return (
      <div className="stack">
        <Sent phase={phase} text={t("Answer sent")} />
        <ScalesResults options={state.options} counts={state.counts} max={state.max} labels={state.labels} mine={sent} />
        <button className="ghost" onClick={() => (setValues(sent), setEditing(true))}>{t("Change my answer")}</button>
      </div>
    );
  }
  return (
    <div className="stack">
      <Refused phase={phase} />
      {state.options.map((label, i) => (
        <div className="crit" key={i} role="radiogroup" aria-label={label}>
          <span className="crit-label">{label}</span>
          <div className={`crit-pick ${state.max > 5 ? "ten" : ""}`}>
            {Array.from({ length: state.max }, (_, v) => (
              <button
                type="button"
                key={v}
                role="radio"
                aria-checked={values[i] === v}
                className={`choice ${values[i] === v ? "picked" : ""}`}
                onClick={() => setValues((list) => list.map((x, j) => (j === i ? v : x)))}
              >
                {v + 1}
              </button>
            ))}
          </div>
        </div>
      ))}
      {state.labels && (state.labels[0] || state.labels[1]) && (
        <div className="scale-ends">
          <span>1 · {state.labels[0] || t("Not at all")}</span>
          <span>{state.max} · {state.labels[1] || t("Completely")}</span>
        </div>
      )}
      <button className="primary" disabled={done < size} onClick={submit}>
        {done < size ? `${t("Send")} (${done} / ${size})` : t("Send")}
      </button>
    </div>
  );
}

// A number to type. As a game (with a right answer), it follows the quiz rules: a timer, then the answer on screen.
function NumberAnswer({ state, code, send }: { state: RoomState; code: string; send: Send }) {
  const t = useT();
  const k = key(code, state, "number");
  const [mine, setMine] = useState<number | undefined>(() => read<number>(k));
  const [text, setText] = useState("");
  const [bad, setBad] = useState(false);
  const [editing, setEditing] = useState(false);
  const clock = useCountdown(state);
  const closed = state.quiz && (state.revealed || !!clock?.over);
  const shown = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 6, useGrouping: Math.abs(n) >= 10000 });
  const { phase, track } = useSending();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const n = parseNumber(text);
    if (n === undefined) return setBad(true);
    setBad(false);
    setMine(n);
    setEditing(false);
    if (await track(send(answer(state, { type: "number", value: n })))) write(k, n);
    else setMine(read(k));
  }

  if (state.quiz && state.timer > 0 && !state.startedAt && !state.revealed) {
    return (
      <div className="wait-card">
        <Timer size={28} />
        <strong>{t("Get ready")}</strong>
        <span>{state.timer} {t("seconds to answer, as soon as the timer starts.")}</span>
      </div>
    );
  }
  // The count-in before the question shows, in step with the big screen.
  if (clock && clock.pre > 0 && !state.revealed) return <CountIn pre={clock.pre} />;

  if (closed) {
    const exact = mine !== undefined && state.answer !== null && mine === state.answer;
    return (
      <div className="stack">
        {!state.revealed ? (
          <p className="quiz-verdict wait"><Timer size={22} />{t("Time's up, answer on screen")}</p>
        ) : mine === undefined ? (
          <p className="quiz-verdict wait">{t("No answer this time")}</p>
        ) : exact ? (
          <p className="quiz-verdict ok"><Check size={22} strokeWidth={3} />{t("Correct!")}</p>
        ) : (
          <p className="muted">{t("Your answer:")} <strong>{shown(mine)}</strong></p>
        )}
        {state.revealed && <NumberResults numbers={state.numbers ?? []} answer={state.answer} closest={state.closest} mine={mine} />}
      </div>
    );
  }

  if (mine === undefined || editing) {
    return (
      <form className="stack" onSubmit={submit}>
        {clock && <Countdown left={clock.left} ratio={clock.ratio} />}
        <Refused phase={phase} />
        <input
          className="number-input"
          inputMode="decimal"
          autoComplete="off"
          aria-label={t("Your number")}
          placeholder={t("Your number")}
          value={text}
          onChange={(e) => (setText(e.target.value.slice(0, 24)), setBad(false))}
        />
        {bad && <p className="error" role="alert">{t("Enter a number.")}</p>}
        <button className="primary" disabled={!text.trim()}>{t("Send")}</button>
      </form>
    );
  }

  return (
    <div className="stack">
      {clock && <Countdown left={clock.left} ratio={clock.ratio} />}
      <Sent phase={phase} text={state.quiz ? t("Answer saved, result on screen") : t("Answer sent")} />
      <p className="muted">{t("Your answer:")} <strong>{shown(mine)}</strong></p>
      {!state.quiz && <NumberResults numbers={state.numbers ?? []} mine={mine} />}
      <button className="ghost" onClick={() => (setText(String(mine)), setEditing(true))}>{t("Change my answer")}</button>
    </div>
  );
}

// A right order and pairs come mixed by the room (place j shows item mix[j]; pairs: the right-hand items), so the
// phone never holds the answer. Once it shows, they come in the written order with the mix: these switch between both.
function mixOptions(state: RoomState, toMixed: boolean) {
  const mix = state.mix ?? [];
  const half = state.kind === "match" ? state.options.length / 2 : 0;
  const items = state.options.slice(half);
  if (mix.length !== items.length) return state.options;
  const out = toMixed ? mix.map((i) => items[i]) : [...items];
  if (!toMixed) mix.forEach((i, j) => (out[i] = items[j]));
  return [...state.options.slice(0, half), ...out];
}

// This phone's answer (places in the mixed order) as written items, once the answer shows.
const asWritten = (sent: number[] | undefined, state: RoomState) => (sent && state.mix ? sent.map((j) => state.mix![j] ?? j) : sent);

// A ranking with a right order to find: the items come shuffled, tapped in order, then the answer shows on screen.
function OrderRank({ state, code, send }: { state: RoomState; code: string; send: Send }) {
  const t = useT();
  const k = key(code, state, "order");
  const [sent, setSent] = useState<number[] | undefined>(() => read<number[]>(k));
  const [order, setOrder] = useState<number[]>([]);
  const [editing, setEditing] = useState(false);
  const clock = useCountdown(state);
  const size = state.options.length;
  const [display] = useState(() => shuffled(size, `${voterId()}:${state.round}:${state.index}`));
  const closed = state.revealed || !!clock?.over;
  const { phase, track } = useSending();

  async function submit() {
    setSent(order);
    setEditing(false);
    if (await track(send(answer(state, { type: "rank", order })))) write(k, order);
    else setSent(read(k));
  }

  if (state.timer > 0 && !state.startedAt && !state.revealed) {
    return (
      <div className="wait-card">
        <Timer size={28} />
        <strong>{t("Get ready")}</strong>
        <span>{state.timer} {t("seconds to answer, as soon as the timer starts.")}</span>
      </div>
    );
  }
  if (clock && clock.pre > 0 && !state.revealed) return <CountIn pre={clock.pre} />;

  if (closed) {
    const mine = asWritten(sent, state);
    const right = !!mine && mine.every((item, pos) => item === pos);
    return (
      <div className="stack">
        {!state.revealed ? (
          <p className="quiz-verdict wait"><Timer size={22} />{t("Time's up, answer on screen")}</p>
        ) : !sent ? (
          <p className="quiz-verdict wait">{t("No answer this time")}</p>
        ) : (
          <p className={`quiz-verdict ${right ? "ok" : "ko"}`}>
            {right ? <Check size={22} strokeWidth={3} /> : <X size={22} strokeWidth={3} />}
            {right ? t("Correct!") : t("Not quite")}
          </p>
        )}
        {state.revealed && <OrderResults options={state.options} result={state.orderResults} voters={state.answered} />}
      </div>
    );
  }

  if (sent && !editing) {
    return (
      <div className="stack">
        {clock && <Countdown left={clock.left} ratio={clock.ratio} />}
        <Sent phase={phase} text={t("Answer saved, result on screen")} />
        <ol className="rank-picked">
          {sent.map((i, pos) => (
            <li key={i}><b className="rank-pos">{pos + 1}</b>{state.options[i]}</li>
          ))}
        </ol>
        <button className="ghost" onClick={() => (setOrder([]), setEditing(true))}>{t("Change my answer")}</button>
      </div>
    );
  }

  const left = display.filter((i) => !order.includes(i));
  return (
    <div className="stack">
      {clock && <Countdown left={clock.left} ratio={clock.ratio} />}
      <Refused phase={phase} />
      <p className="muted">{order.length < size ? `${t("Put them in the right order. Tap the one in place")} ${order.length + 1}` : t("Your ranking is ready.")}</p>
      {order.length > 0 && (
        <ol className="rank-picked">
          {order.map((i, pos) => (
            <li key={i}><b className="rank-pos">{pos + 1}</b>{state.options[i]}</li>
          ))}
        </ol>
      )}
      {left.length > 0 && (
        <div className="choices">
          {left.map((i) => (
            <button key={i} className="choice" onClick={() => setOrder((o) => (o.length === size - 2 ? [...o, i, ...left.filter((x) => x !== i)] : [...o, i]))}>
              {state.options[i]}
            </button>
          ))}
        </div>
      )}
      <div className="row-actions">
        {order.length > 0 && (
          <button className="ghost with-icon" onClick={() => setOrder([])}><RotateCcw size={16} />{t("Start over")}</button>
        )}
        <button className="primary grow" disabled={order.length < size} onClick={submit}>{t("Send")}</button>
      </div>
    </div>
  );
}

// A timed game waits for the presenter's clock: "Get ready", then the count-in, in step with the big screen.
function gate(state: RoomState, clock: ReturnType<typeof useCountdown>, t: (s: string) => string) {
  if (state.quiz && state.timer > 0 && !state.startedAt && !state.revealed) {
    return (
      <div className="wait-card">
        <Timer size={28} />
        <strong>{t("Get ready")}</strong>
        <span>{state.timer} {t("seconds to answer, as soon as the timer starts.")}</span>
      </div>
    );
  }
  if (clock && clock.pre > 0 && !state.revealed) return <CountIn pre={clock.pre} />;
  return null;
}

// Prioritize: 100 points to share between the items, ten at a time; sent once they are all given.
function PointsAnswer({ state, code, send }: { state: RoomState; code: string; send: Send }) {
  const t = useT();
  const k = key(code, state, "points");
  const size = state.options.length;
  const [sent, setSent] = useState<number[] | undefined>(() => read<number[]>(k));
  const [values, setValues] = useState<number[]>(() => sent ?? Array.from({ length: size }, () => 0));
  const [editing, setEditing] = useState(false);
  const left = POINTS - values.reduce((a, b) => a + b, 0);
  const change = (i: number, by: number) => setValues((list) => list.map((v, j) => (j === i ? Math.min(v + left, Math.max(0, v + by)) : v)));
  const { phase, track } = useSending();

  async function submit() {
    setSent(values);
    setEditing(false);
    if (await track(send(answer(state, { type: "points", values })))) write(k, values);
    else setSent(read(k));
  }

  if (sent && !editing) {
    return (
      <div className="stack">
        <Sent phase={phase} text={t("Answer sent")} />
        <PointsResults options={state.options} counts={state.counts} voters={state.answered} mine={sent} />
        <button className="ghost" onClick={() => (setValues(sent), setEditing(true))}>{t("Change my answer")}</button>
      </div>
    );
  }
  return (
    <div className="stack">
      <Refused phase={phase} />
      <p className={`points-left ${left === 0 ? "done" : ""}`} aria-live="polite">
        {left === 0 ? (
          <>
            <Check size={20} strokeWidth={3} /> {t("All 100 points are shared")}
          </>
        ) : (
          <>
            <strong>{left}</strong> {t("points left to share")}
          </>
        )}
      </p>
      <ul className="points-pick">
        {state.options.map((label, i) => (
          <li key={i}>
            <span className="points-label">{label}</span>
            <div className="stepper">
              <button type="button" aria-label={`${t("Fewer points")} · ${label}`} disabled={values[i] === 0} onClick={() => change(i, -POINTS_STEP)}><Minus size={18} strokeWidth={3} /></button>
              <strong>{values[i]}</strong>
              <button type="button" aria-label={`${t("More points")} · ${label}`} disabled={left === 0} onClick={() => change(i, POINTS_STEP)}><Plus size={18} strokeWidth={3} /></button>
            </div>
            <i className="points-share" style={{ width: `${values[i]}%` }} aria-hidden />
          </li>
        ))}
      </ul>
      <button className="primary" disabled={left !== 0} onClick={submit}>{t("Send")}</button>
    </div>
  );
}

// Fill in the blanks: one box per blank, inside the sentence. As a game, the answers show on screen.
function FillAnswer({ state, code, send }: { state: RoomState; code: string; send: Send }) {
  const t = useT();
  const k = key(code, state, "fill");
  const gaps = state.gaps ?? [];
  const size = Math.max(0, gaps.length - 1);
  const [sent, setSent] = useState<string[] | undefined>(() => read<string[]>(k));
  const [values, setValues] = useState<string[]>(() => sent ?? Array.from({ length: size }, () => ""));
  const [editing, setEditing] = useState(false);
  const clock = useCountdown(state);
  const closed = state.revealed || !!clock?.over;
  const { phase, track } = useSending();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const clean = values.map((v) => v.trim());
    setSent(clean);
    setEditing(false);
    if (await track(send(answer(state, { type: "fill", values: clean })))) write(k, clean);
    else setSent(read(k));
  }

  const waiting = gate(state, clock, t);
  if (waiting) return waiting;

  if (closed) {
    const blanks = state.blanks ?? [];
    const right = sent ? sent.filter((v, i) => !!blanks[i] && rightBlank(v, blanks[i])).length : 0;
    return (
      <div className="stack">
        {!state.revealed ? (
          <p className="quiz-verdict wait"><Timer size={22} />{t("Time's up, answer on screen")}</p>
        ) : !sent ? (
          <p className="quiz-verdict wait">{t("No answer this time")}</p>
        ) : (
          <PartsVerdict right={right} size={size} />
        )}
        {state.revealed && blanks.length > 0 && (
          <p className="fill-text">
            {gaps.map((piece, i) => (
              <span key={i}>
                {piece}
                {i < size &&
                  (sent && rightBlank(sent[i] ?? "", blanks[i] ?? []) ? (
                    <b className="fill-gap ok">{sent[i]}</b>
                  ) : (
                    <>
                      {sent?.[i] && <s className="fill-gap ko">{sent[i]}</s>}
                      <b className="fill-gap shown">{blanks[i]?.[0]}</b>
                    </>
                  ))}
              </span>
            ))}
          </p>
        )}
      </div>
    );
  }

  if (sent && !editing) {
    return (
      <div className="stack">
        {clock && <Countdown left={clock.left} ratio={clock.ratio} />}
        <Sent phase={phase} text={t("Answer saved, result on screen")} />
        <FillText gaps={gaps} given={sent} />
        <button className="ghost" onClick={() => (setValues(sent), setEditing(true))}>{t("Change my answer")}</button>
      </div>
    );
  }
  // Words to place: the presenter chose them, people tap them into the blanks.
  if ((state.bank ?? []).length > 0)
    return (
      <form className="stack" onSubmit={submit}>
        {clock && <Countdown left={clock.left} ratio={clock.ratio} />}
        <Refused phase={phase} />
        <PlaceWords gaps={gaps} bank={state.bank ?? []} values={values} onChange={setValues} />
        <button className="primary" disabled={values.some((v) => !v)}>{t("Send")}</button>
      </form>
    );
  return (
    <form className="stack" onSubmit={submit}>
      {clock && <Countdown left={clock.left} ratio={clock.ratio} />}
      <Refused phase={phase} />
      <p className="fill-text answer">
        {gaps.map((piece, i) => (
          <span key={i}>
            {piece}
            {i < size && (
              <input
                className="fill-input"
                data-blank={i}
                value={values[i] ?? ""}
                size={Math.max(5, (values[i] ?? "").length + 1)}
                maxLength={60}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                enterKeyHint={i < size - 1 ? "next" : "send"}
                aria-label={`${t("Blank")} ${i + 1}`}
                placeholder={String(i + 1)}
                onChange={(e) => setValues((list) => list.map((v, j) => (j === i ? e.target.value : v)))}
                // The keyboard's Next key goes to the next blank.
                onKeyDown={(e) => {
                  const next = e.currentTarget.form?.querySelector<HTMLInputElement>(`[data-blank="${i + 1}"]`);
                  if (e.key === "Enter" && next) {
                    e.preventDefault();
                    next.focus();
                  }
                }}
              />
            )}
          </span>
        ))}
      </p>
      <button className="primary" disabled={values.some((v) => !v.trim())}>{t("Send")}</button>
    </form>
  );
}

// Tap a word: it goes in the chosen blank (the first empty one at first). Tap a filled blank: its word goes back.
// `values`: the word in each blank ("" when empty); each word offered is used once.
function PlaceWords({ gaps, bank, values, onChange }: { gaps: string[]; bank: string[]; values: string[]; onChange: (values: string[]) => void }) {
  const t = useT();
  const size = Math.max(0, gaps.length - 1);
  // The word offered each blank holds (its place in `bank`, as a word can be offered twice).
  const [used, setUsed] = useState<number[]>(() => {
    const taken: number[] = [];
    return values.map((v) => {
      const j = bank.findIndex((w, k) => w === v && !taken.includes(k));
      if (j >= 0) taken.push(j);
      return j;
    });
  });
  const [chosen, setChosen] = useState(() => Math.max(0, values.findIndex((v) => !v)));
  const put = (next: number[]) => {
    setUsed(next);
    onChange(next.map((j) => (j >= 0 ? bank[j] : "")));
  };
  function tapWord(j: number) {
    const target = used[chosen] === -1 ? chosen : used.findIndex((k) => k === -1);
    const at = target === -1 ? chosen : target;
    const next = used.map((k, i) => (i === at ? j : k));
    put(next);
    // On to the next empty blank, if any.
    const empty = next.findIndex((k, i) => k === -1 && i > at);
    setChosen(empty >= 0 ? empty : Math.max(0, next.findIndex((k) => k === -1)));
  }
  function tapBlank(i: number) {
    if (used[i] >= 0) put(used.map((k, n) => (n === i ? -1 : k)));
    setChosen(i);
  }
  return (
    <>
      <p className="fill-text answer">
        {gaps.map((piece, i) => (
          <span key={i}>
            {piece}
            {i < size && (
              <button
                type="button"
                className={`fill-box ${used[i] >= 0 ? "placed" : ""} ${chosen === i ? "on" : ""}`}
                aria-label={`${t("Blank")} ${i + 1}${used[i] >= 0 ? `: ${bank[used[i]]}` : ""}`}
                onClick={() => tapBlank(i)}
              >
                {used[i] >= 0 ? bank[used[i]] : i + 1}
              </button>
            )}
          </span>
        ))}
      </p>
      <p className="muted">{t("Tap a word to place it.")}</p>
      <div className="fill-tray">
        {bank.map((word, j) => (
          <button key={j} type="button" className="fill-word" disabled={used.includes(j)} onClick={() => tapWord(j)}>
            {word}
          </button>
        ))}
      </div>
    </>
  );
}

// Match pairs: tap an item on the left, then its pair among the shuffled ones. As a game, the answers show on screen.
function MatchAnswer({ state, code, send }: { state: RoomState; code: string; send: Send }) {
  const t = useT();
  const k = key(code, state, "match");
  const half = state.options.length / 2;
  const lefts = state.options.slice(0, half);
  const rights = state.options.slice(half);
  const [display] = useState(() => shuffled(half, `${voterId()}:${state.round}:${state.index}`));
  const [sent, setSent] = useState<number[] | undefined>(() => read<number[]>(k));
  const [picks, setPicks] = useState<(number | null)[]>(() => sent ?? Array.from({ length: half }, () => null));
  const [active, setActive] = useState(0);
  const [editing, setEditing] = useState(false);
  const clock = useCountdown(state);
  const closed = state.revealed || !!clock?.over;
  const { phase, track } = useSending();

  function assign(r: number) {
    const next = picks.map((x) => (x === r ? null : x));
    next[active] = r;
    setPicks(next);
    // On to the next item still without its pair.
    const empty = [...next.keys()].filter((i) => next[i] === null);
    setActive(empty.find((i) => i > active) ?? empty[0] ?? active);
  }

  async function submit() {
    const order = picks as number[];
    setSent(order);
    setEditing(false);
    if (await track(send(answer(state, { type: "match", order })))) write(k, order);
    else setSent(read(k));
  }

  const waiting = gate(state, clock, t);
  if (waiting) return waiting;

  if (closed) {
    const mine = asWritten(sent, state);
    const right = mine ? mine.filter((r, i) => r === i).length : 0;
    return (
      <div className="stack">
        {!state.revealed ? (
          <p className="quiz-verdict wait"><Timer size={22} />{t("Time's up, answer on screen")}</p>
        ) : !mine ? (
          <p className="quiz-verdict wait">{t("No answer this time")}</p>
        ) : (
          <PartsVerdict right={right} size={half} />
        )}
        {state.revealed && (
          <ul className="match-mine">
            {lefts.map((l, i) => (
              <li key={i} className={!mine ? "" : mine[i] === i ? "ok" : "ko"}>
                <span>{l}</span>
                <i aria-hidden>↔</i>
                <span>{rights[i]}</span>
                {mine && mine[i] !== i && <s>{rights[mine[i]]}</s>}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  if (sent && !editing) {
    return (
      <div className="stack">
        {clock && <Countdown left={clock.left} ratio={clock.ratio} />}
        <Sent phase={phase} text={t("Answer saved, result on screen")} />
        <ul className="match-mine">
          {lefts.map((l, i) => (
            <li key={i}>
              <span>{l}</span>
              <i aria-hidden>↔</i>
              <span>{rights[sent[i]]}</span>
            </li>
          ))}
        </ul>
        <button className="ghost" onClick={() => (setPicks(sent), setActive(0), setEditing(true))}>{t("Change my answer")}</button>
      </div>
    );
  }
  const pool = display.filter((r) => !picks.includes(r));
  return (
    <div className="stack">
      {clock && <Countdown left={clock.left} ratio={clock.ratio} />}
      <Refused phase={phase} />
      <p className="muted">{t("Tap an item, then its pair.")}</p>
      <ul className="match-pick">
        {lefts.map((l, i) => (
          <li key={i} className={i === active ? "on" : ""}>
            <button type="button" className="match-left" aria-pressed={i === active} onClick={() => setActive(i)}>{l}</button>
            <button
              type="button"
              className={`match-slot ${picks[i] !== null ? "full" : ""}`}
              aria-label={picks[i] !== null ? `${t("Remove")} ${rights[picks[i]!]}` : t("Its pair")}
              onClick={() => (picks[i] !== null ? setPicks((list) => list.map((x, j) => (j === i ? null : x))) : undefined, setActive(i))}
            >
              {picks[i] !== null ? rights[picks[i]!] : t("Its pair")}
            </button>
          </li>
        ))}
      </ul>
      {pool.length > 0 && (
        <div className="match-pool">
          {pool.map((r) => (
            <button key={r} type="button" className="choice" onClick={() => assign(r)}>{rights[r]}</button>
          ))}
        </div>
      )}
      <button className="primary" disabled={picks.some((p) => p === null)} onClick={submit}>{t("Send")}</button>
    </div>
  );
}

// Find on the image: tap (or drag) a pin onto the image, then send it. A poll shows where the room tapped;
// a game keeps it for the screen until the zone shows.
function SpotAnswer({ state, code, send }: { state: RoomState; code: string; send: Send }) {
  const t = useT();
  const k = key(code, state, "spot");
  const [sent, setSent] = useState<[number, number] | undefined>(() => read<[number, number]>(k));
  const [pin, setPin] = useState<[number, number] | null>(() => sent ?? null);
  const [editing, setEditing] = useState(false);
  const clock = useCountdown(state);
  const game = state.quiz;
  const closed = game && (state.revealed || !!clock?.over);
  const { phase, track } = useSending();

  async function submit() {
    if (!pin) return;
    setSent(pin);
    setEditing(false);
    if (await track(send(answer(state, { type: "spot", x: pin[0], y: pin[1] })))) write(k, pin);
    else setSent(read(k));
  }

  const waiting = gate(state, clock, t);
  if (waiting) return waiting;
  if (!state.image) return <Unknown />;

  if (closed) {
    const zone = state.zone ?? null;
    const right = !!sent && !!zone && inZone(sent[0], sent[1], zone);
    return (
      <div className="stack">
        {!state.revealed ? (
          <p className="quiz-verdict wait"><Timer size={22} />{t("Time's up, answer on screen")}</p>
        ) : !sent ? (
          <p className="quiz-verdict wait">{t("No answer this time")}</p>
        ) : (
          <p className={`quiz-verdict ${right ? "ok" : "ko"}`}>
            {right ? <Check size={22} strokeWidth={3} /> : <X size={22} strokeWidth={3} />}
            {right ? t("Correct!") : t("Not quite")}
          </p>
        )}
        <SpotImage image={state.image} spots={state.revealed ? state.spots : []} zone={zone} mine={sent} />
      </div>
    );
  }

  if (sent && !editing) {
    return (
      <div className="stack">
        {clock && <Countdown left={clock.left} ratio={clock.ratio} />}
        <Sent phase={phase} text={game ? t("Answer saved, result on screen") : t("Answer sent")} />
        <SpotImage image={state.image} spots={game ? [] : state.spots} mine={sent} />
        <button className="ghost" onClick={() => (setPin(sent), setEditing(true))}>{t("Change my answer")}</button>
      </div>
    );
  }
  return (
    <div className="stack">
      {clock && <Countdown left={clock.left} ratio={clock.ratio} />}
      <Refused phase={phase} />
      <p className="muted">{pin ? t("Drag the pin to adjust, then send.") : t("Tap the spot on the image.")}</p>
      <SpotImage image={state.image} mine={pin} onPick={(x, y) => setPin([x, y])} />
      <button className="primary" disabled={!pin} onClick={submit}>{t("Send")}</button>
    </div>
  );
}

// The wheel turns on the phones too; the person it stops on is told.
function WheelView({ state }: { state: RoomState; code: string; send: Send }) {
  return <Wheel state={state} me={tagOf(voterId())} />;
}

// Topic rounds' picker: the wheel turning among the topics left, or the room's vote, then the topic chosen.
// The picker's options are the topics, in the language the question is shown in.
function TopicPicker({ state, code, send }: { state: RoomState; code: string; send: Send }) {
  const topics = state.topics!;
  const labels = state.options.length === topics.list.length ? state.options : topics.list.map((x) => x.label);
  if (topics.chosenHow === "last" && topics.chosen !== null) return <RoundWon topics={topics} label={labels[topics.chosen]} phone />;
  if (topics.how === "wheel") return <Wheel state={state} labels={labels} phone />;
  return <TopicVote state={state} code={code} send={send} labels={labels} />;
}

// The room's vote for the next topic. Each vote (a new round, or the presenter choosing again) has its number (`pass`):
// the answer remembered here is kept per pass, the first one under the usual key.
function TopicVote({ state, code, send, labels }: { state: RoomState; code: string; send: Send; labels: string[] }) {
  const t = useT();
  const topics = state.topics!;
  const k = `${key(code, state)}${topics.pass > 1 ? `:p${topics.pass}` : ""}`;
  const [mine, setMine] = useState<number | undefined>(() => read<number>(k));
  const [editing, setEditing] = useState(false);
  const { phase, track } = useSending();
  const done = topics.list.map((x) => x.done);
  async function vote(option: number) {
    setMine(option);
    setEditing(false);
    if (await track(send(answer(state, { type: "vote", option, pass: topics.pass })))) write(k, option);
    else setMine(read(k));
  }
  if (topics.chosen !== null) {
    return (
      <div className="stack">
        {/* "The room chose" only when the votes did: a tie or no vote at all was drawn at random (its own line says so). */}
        <RoundWon topics={topics} label={labels[topics.chosen]} phone eyebrow={topics.chosenHow === "vote" && !topics.tie && !topics.empty ? t("The room chose") : undefined} />
        {state.answered > 0 && <ChoiceResults options={labels} counts={state.counts} mine={mine} done={done} doneLabel={t("Played")} chosen={topics.chosen} />}
      </div>
    );
  }
  if (mine === undefined || editing) {
    return (
      <div className="stack">
        <Refused phase={phase} />
        <div className="choices">
          {labels.map((label, i) =>
            done[i] ? (
              <button key={i} className="choice played" disabled>
                <span>{label}</span>
                <small><Check size={14} strokeWidth={3} aria-hidden /> {t("Played")}</small>
              </button>
            ) : (
              <button key={i} className={`choice ${mine === i ? "picked" : ""}`} onClick={() => vote(i)}>
                {label}
              </button>
            ),
          )}
        </div>
      </div>
    );
  }
  return (
    <div className="stack">
      <Sent phase={phase} text={t("Vote sent")} />
      <ChoiceResults options={labels} counts={state.counts} mine={mine} done={done} doneLabel={t("Played")} />
      <button className="ghost" onClick={() => setEditing(true)}>{t("Change my answer")}</button>
    </div>
  );
}

// A timer, the same as on the big screen.
function CountdownPhone({ state }: { state: RoomState; code: string; send: Send }) {
  return <CountdownView state={state} />;
}

// A video or audio plays on the big screen; someone following from afar can play it on the phone.
function MediaPhone({ state }: { state: RoomState; code: string; send: Send }) {
  const t = useT();
  const [play, setPlay] = useState(false);
  const media = mediaOf(state.url);
  if (!media) return null;
  if (play) return <MediaPlayer url={state.url} title={state.question} />;
  return (
    <div className="stack">
      <div className="wait-card">
        <Clapperboard size={28} />
        <strong>{media.audio ? t("Listen on the big screen") : t("Watch the big screen")}</strong>
      </div>
      <button className="ghost with-icon" onClick={() => setPlay(true)}>
        <CirclePlay size={18} /> {t("Play on my phone")}
      </button>
    </div>
  );
}

// A kind of question this page doesn't know yet (an older page kept open): nothing breaks, the person is told to reload.
function Unknown() {
  const t = useT();
  return (
    <button type="button" className="wait-card wait-reload" onClick={() => location.reload()}>
      <RefreshCw size={28} />
      <strong>{t("Reload the page to answer.")}</strong>
    </button>
  );
}

function Qa({ state, code, send }: { state: RoomState; code: string; send: Send }) {
  const t = useT();
  const k = key(code, state, "qa");
  const upKey = key(code, state, "up");
  // The question just asked, and how it reads in the presentation's language.
  const [last, setLast] = useState<{ id: string; text: string } | null>(null);
  const echo = useEcho(code, state, "posts", last ? [last.id] : []);
  const [asked, setAsked] = useState(() => read<number>(k) ?? 0);
  const [mine, setMine] = useState<string[]>(() => read<string[]>(upKey) ?? []);
  const [text, setText] = useState("");
  const { phase, track } = useSending();

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    const sending = text;
    const id = postId();
    setAsked((n) => n + 1);
    setText("");
    if (await track(send(answer(state, { type: "ask", text: sending, id })))) {
      write(k, (read<number>(k) ?? 0) + 1);
      setLast({ id, text: sending });
    } else {
      setAsked(read<number>(k) ?? 0);
      setText(sending);
    }
  }
  function upvote(id: string) {
    send(answer(state, { type: "upvote", id }), false);
    const next = mine.includes(id) ? mine.filter((x) => x !== id) : [...mine, id];
    setMine(next);
    write(upKey, next);
  }

  return (
    <div className="stack">
      {asked < 3 ? (
        <form className="stack" onSubmit={ask}>
          <Refused phase={phase} />
          <textarea maxLength={200} rows={3} aria-label={t("Your question")} placeholder={t("Your question")} value={text} onChange={(e) => setText(e.target.value)} />
          <p className="muted count-hint">{200 - text.length} {t("characters left")}</p>
          <button className="primary" disabled={!text.trim()}>{t("Send my question")}</button>
        </form>
      ) : (
        <p className="muted">{t("You've asked your 3 questions. Upvote the others.")}</p>
      )}
      {(phase === "sending" || phase === "sent") && <Sent phase={phase} text={t("Question sent")} />}
      {/* The question already shows in the list: repeated only with how the room reads it, when that differs. */}
      {last && echo[0] && echo[0] !== last.text && <Echo text={last.text} translation={echo[0]} />}
      <QaList items={state.answers} onUpvote={upvote} mine={mine} empty={t("Be the first to ask a question.")} />
    </div>
  );
}

function Words({ state, code, send }: { state: RoomState; code: string; send: Send }) {
  const t = useT();
  const k = key(code, state, "words");
  const [sent, setSent] = useState<string[] | undefined>(() => read<string[]>(k));
  // The words the room has stored: their translation is asked only then, or it would come back empty.
  const [stored, setStored] = useState<string[] | undefined>(sent);
  const [draft, setDraft] = useState<string[]>(() => sent ?? ["", "", ""]);
  const echo = useEcho(code, state, "words", (stored ?? []).map(cloudWord));
  const [editing, setEditing] = useState(false);
  const { phase, track } = useSending();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const words = draft.map((w) => w.trim()).filter(Boolean);
    if (!words.length) return;
    setSent(words);
    setEditing(false);
    if (await track(send(answer(state, { type: "words", words })))) {
      write(k, words);
      setStored(words);
    } else setSent(read(k));
  }

  if (sent && !editing) {
    return (
      <div className="stack">
        <Sent phase={phase} text={t("Words sent")} />
        <Echo text={sent.join(", ")} translation={echo.length === sent.length ? echo.join(", ") : undefined} />
        <WordCloud words={state.words} base={26} limit={25} />
        <button className="ghost" onClick={() => (setDraft([...sent, "", "", ""].slice(0, 3)), setEditing(true))}>{t("Change my words")}</button>
      </div>
    );
  }
  return (
    <form className="stack" onSubmit={submit}>
      <Refused phase={phase} />
      <p className="muted">{t("Up to 3 words, one per box.")}</p>
      {draft.map((w, i) => (
        <input
          key={i}
          autoFocus={i === 0}
          maxLength={25}
          autoComplete="off"
          enterKeyHint={i < draft.length - 1 ? "next" : "send"}
          // The keyboard's Next key goes to the next box instead of sending one word.
          onKeyDown={(e) => {
            const next = e.currentTarget.nextElementSibling;
            if (e.key === "Enter" && i < draft.length - 1 && next instanceof HTMLInputElement) {
              e.preventDefault();
              next.focus();
            }
          }}
          aria-label={`${t("Word")} ${i + 1}`}
          placeholder={`${t("Word")} ${i + 1}`}
          value={w}
          onChange={(e) => setDraft((d) => d.map((x, j) => (j === i ? e.target.value : x)))}
        />
      ))}
      <button className="primary" disabled={!draft.some((w) => w.trim())}>{t("Send")}</button>
    </form>
  );
}

function Open({ state, code, send }: { state: RoomState; code: string; send: Send }) {
  const t = useT();
  const k = key(code, state, "open");
  const [sent, setSent] = useState(() => read<number>(k) ?? 0);
  const [text, setText] = useState("");
  const [writing, setWriting] = useState(sent === 0);
  // The answer just sent, and how it reads in the presentation's language.
  const [last, setLast] = useState<{ id: string; text: string } | null>(null);
  const echo = useEcho(code, state, "posts", last ? [last.id] : []);
  const { phase, track } = useSending();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    const sending = text;
    const id = postId();
    setSent((n) => n + 1);
    setText("");
    setWriting(false);
    if (await track(send(answer(state, { type: "answer", text: sending, id })))) {
      write(k, (read<number>(k) ?? 0) + 1);
      setLast({ id, text: sending });
    } else {
      setSent(read<number>(k) ?? 0);
      setText(sending);
      setWriting(true);
    }
  }

  if (!writing) {
    return (
      <div className="stack">
        <Sent phase={phase} text={t("Answer sent")} />
        {last && <Echo text={last.text} translation={echo[0]} />}
        {sent < 3 ? (
          <button className="ghost" onClick={() => setWriting(true)}>{t("Send another answer")}</button>
        ) : (
          <p className="muted">{t("Thanks, you've sent your 3 answers.")}</p>
        )}
      </div>
    );
  }
  return (
    <form className="stack" onSubmit={submit}>
      <Refused phase={phase} />
      <textarea autoFocus maxLength={200} rows={4} aria-label={t("Your answer")} placeholder={t("Your answer")} value={text} onChange={(e) => setText(e.target.value)} />
      <p className="muted count-hint">{200 - text.length} {t("characters left")}</p>
      <button className="primary" disabled={!text.trim()}>{t("Send")}</button>
    </form>
  );
}

const FIELD_LABEL: Record<string, string> = { name: "Full name", email: "Email", phone: "Phone", company: "Company" };
const FIELD_INPUT: Record<string, { type: string; autoComplete: string }> = {
  name: { type: "text", autoComplete: "name" },
  email: { type: "email", autoComplete: "email" },
  phone: { type: "tel", autoComplete: "tel" },
  company: { type: "text", autoComplete: "organization" },
};

// What the person wrote, with how it shows on the big screen when that is in another language.
function Echo({ text, translation }: { text: string; translation?: string }) {
  return (
    <div className="echo">
      <p className="echo-mine">{text}</p>
      {translation && translation !== text && (
        <p className="echo-tr">
          <Languages size={14} aria-hidden /> {translation}
        </p>
      )}
    </div>
  );
}

// Contact details, sent only with the person's consent and never shown to the room.
function ContactForm({ state, code, send }: { state: RoomState; code: string; send: Send }) {
  const t = useT();
  const k = key(code, state, "contact");
  const [sent, setSent] = useState(() => read<boolean>(k) ?? false);
  const { phase, track } = useSending();
  // The email hint waits until the person leaves the field, not while they type.
  const [emailLeft, setEmailLeft] = useState(false);
  const [data, setData] = useState<Record<string, string>>({});
  const [consent, setConsent] = useState(false);
  const fields = state.fields.length ? state.fields : ["email"];
  const emailOk = !fields.includes("email") || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test((data.email ?? "").trim());
  const phone = (data.phone ?? "").trim();
  const phoneOk = !phone || PHONE.test(phone);
  const filled = fields.some((f) => (data[f] ?? "").trim());

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSent(true);
    if (await track(send(answer(state, { type: "contact", data, consent: true })))) write(k, true);
    else setSent(false);
  }

  if (sent) {
    return (
      <div className="stack">
        <Sent phase={phase} text={t("Thanks, sent")} />
        <p className="muted">{t("Your details are shared only with the organizer.")}</p>
        <button className="ghost" onClick={() => setSent(false)}>{t("Edit my details")}</button>
      </div>
    );
  }
  return (
    <form className="stack" onSubmit={submit}>
      {fields.map((f) => {
        // A wrong address shows once the person leaves the field, a wrong number as soon as it is typed: right under the field.
        const hint = f === "email" ? (!emailOk && emailLeft && !!(data.email ?? "").trim() ? t("Check the email address.") : "") : f === "phone" && !phoneOk ? t("Check the phone number.") : "";
        return (
          <label className="field" key={f}>
            <span>{t(FIELD_LABEL[f])}</span>
            <input {...FIELD_INPUT[f]} maxLength={f === "email" ? 120 : 80} value={data[f] ?? ""} onChange={(e) => setData((d) => ({ ...d, [f]: e.target.value }))} onBlur={f === "email" ? () => setEmailLeft(true) : undefined} aria-invalid={hint ? true : undefined} aria-describedby={hint ? `hint-${f}` : undefined} />
            {hint && <em className="field-hint" id={`hint-${f}`}>{hint}</em>}
          </label>
        );
      })}
      <label className="consent">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span>{t("I agree that the organizer may use this information to contact me.")}</span>
      </label>
      <Refused phase={phase} />
      <button className="primary" disabled={!consent || !filled || !emailOk || !phoneOk}>{t("Send")}</button>
      <p className="muted small-print">{t("They are not shown on the room's screen.")}</p>
    </form>
  );
}

// Language picker for participants: the phone's language by default. Its label stays in the person's own language.
function LangPicker({ lang, onChange, label }: { lang: string; onChange: (l: string) => void; label: string }) {
  return (
    <label className="lang-pick">
      <Languages size={16} />
      <span className="sr-only" lang={lang}>{label}</span>
      <select value={lang} onChange={(e) => onChange(e.target.value)}>
        {LANGUAGES.map(([c, label]) => (
          <option key={c} value={c}>{label}</option>
        ))}
      </select>
    </label>
  );
}

// True once `on` has held for `ms`: a short network blip shows nothing.
function useLate(on: boolean, ms: number) {
  const [late, setLate] = useState(false);
  useEffect(() => {
    setLate(false);
    if (!on) return;
    const timer = setTimeout(() => setLate(true), ms);
    return () => clearTimeout(timer);
  }, [on, ms]);
  return on && late;
}

// The connection dropped: a small note at the bottom of every screen, over the page so nothing moves.
function OfflineNote({ t }: { t: (s: string) => string }) {
  return (
    <p className="vote-offline" role="status">
      <WifiOff size={16} aria-hidden />
      {t("Reconnecting…")}
    </p>
  );
}

// `demo`: an example phone for the builder's pictures, drawn from this state without any room behind it.
export function Vote({ code, demo }: { code: string; demo?: RoomState }) {
  const room = useRoom(code, undefined, !demo);
  const raw = demo ?? room.state;
  const status = demo ? "open" : room.status;
  const send: typeof room.send = demo ? async () => false : room.send;
  const { full, retryFull, ended } = room;
  // Timed questions stay hidden until their clock runs: "Get ready", then the count-in.
  const clock = useCountdown(raw);
  const counting = !!raw && raw.quiz && raw.timer > 0 && !raw.revealed && (!raw.startedAt || (clock?.pre ?? 0) > 0);
  const [lang, setLang] = useState(initialLang);
  const [original, setOriginal] = useState(startsOnOriginal);
  // A right order or pairs whose answer shows is translated in the mixed order it came in (the same request as before),
  // then read in the written order.
  const { view: mixedView, translated, loading, failed } = useTranslated(code, raw?.mix ? { ...raw, options: mixOptions(raw, true) } : raw, lang, original);
  const translatedState = mixedView?.mix ? { ...mixedView, options: mixOptions(mixedView, false) } : mixedView;
  // Questions from the audience read in this phone's language too, whatever language each person wrote in.
  // Only what the phone shows: the Q&A list, and the cloud once this phone has sent its words (open answers stay private).
  const shown = !!raw && (raw.kind === "qa" || (raw.kind === "words" && !!read(key(code, raw, "words"))));
  const posts = usePostTranslations(code, raw, lang, !original && shown, true);
  const state = !translatedState
    ? translatedState
    : translatedState.kind === "qa"
      ? { ...translatedState, answers: withTranslations(translatedState.answers, posts) }
      : translatedState.kind === "words"
        ? { ...translatedState, words: mergeWords(translatedState.words, posts) }
        : translatedState;
  // One language on screen at a time: the buttons and hints follow the language the question is shown in.
  // The question shows in the presentation's language when the person asked for the original, or while no translation
  // came (none needed, or it failed); in the person's language once translated. An unknown presentation language keeps theirs.
  // While the next question loads, the buttons keep the language of the last outcome for this pair of languages,
  // so a phone that got no translation does not switch back and forth on every question.
  const pair = raw ? `${lang}|${raw.lang}` : "";
  const outcome = useRef({ pair: "", untranslated: false });
  if (raw && lang !== raw.lang && !original && !loading) outcome.current = { pair, untranslated: !translated };
  const stayOriginal = outcome.current.pair === pair && outcome.current.untranslated;
  const showsOriginal = !!raw && lang !== raw.lang && (original || (!translated && (!loading || stayOriginal)));
  const uiLang = showsOriginal && LANG_CODES.includes(raw.lang) ? raw.lang : lang;
  const ui = useUiStrings(uiLang);
  // The way back to their language (the picker, "See translation") always reads in it.
  const own = useUiStrings(lang);
  const mine = (s: string) => own[s] ?? s;
  const launch = useLaunch(raw);
  // The seasonal decor (src/decor.ts): the page at night with the decor's colors, the brand keeping its logo and fonts.
  const decor = shownDecor(raw?.decor);
  const ownBrand = useBrand(demo ? "" : code);
  const brand = useMemo(() => decorBrand(ownBrand, decor), [ownBrand, decor]);
  // The buddy this phone shows, the same one the big screen draws for it: updated when the person picks another.
  const [myAvatar, setMyAvatar] = useState(savedAvatar);
  useBodyBrand(brand);
  useBodyDecor(decor === "halloween");
  // Not a link: a tap on the logo must not take the person out of the presentation.
  const logo = brand?.logo ? <BrandLogo brand={brand} /> : <span className="logo"><Wordmark /></span>;
  // With the Halloween decor: a carved pumpkin beside the logo, two small bats in the header.
  const mark = decor === "halloween" ? <PhoneMark>{logo}<PhoneBats /></PhoneMark> : logo;
  const t = (fr: string) => ui[fr] ?? fr;
  const changeLang = (l: string) => {
    setLang(l);
    saveLang(l);
    setOriginal(false);
  };
  // Screen readers read the page in the language shown, right to left for Arabic and Hebrew.
  usePageLang(uiLang);
  useEffect(() => {
    document.documentElement.dir = RTL.includes(uiLang) ? "rtl" : "ltr";
    // Leaving for another page of the site (Back to home): it reads left to right again.
    return () => void (document.documentElement.dir = "ltr");
  }, [uiLang]);
  const [name, setName] = useState(savedName);
  const named = !!state && state.names;
  // Shown after 1.5 s without the room, on every screen; and help after 8 s of "Connecting…".
  const offline = useLate(!!state && status !== "open" && status !== "missing", 1500);
  const stuck = useLate(!state && status !== "missing" && !full, 8000);
  const note = offline && <OfflineNote t={t} />;
  // A new screen (first name, waiting, next question, leaderboard) starts at its top, not where the last one was scrolled.
  const screen = !state ? "" : `${state.names && !name}|${state.lobby}|${!!state.board}|${state.round}:${state.index}`;
  useEffect(() => {
    if (screen) window.scrollTo(0, 0);
  }, [screen]);

  // Each new connection tells the room who this phone is, so the screen can show the name.
  useEffect(() => {
    // Anonymous rooms get the buddy only, so the screen draws the same face as this phone.
    // Sent again after a reset, which clears the names in the room.
    // The phone's language goes along: the room translates answers only when languages are mixed.
    if (status === "open" && state) send({ type: "name", voter: voterId(), name: named ? name : "", avatar: read<string>(AVATAR_KEY) ?? myAvatar, lang });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, !!state, named, name, raw?.round, lang]);

  // This phone was in the room: after a reload, a deleted presentation still reads as ended, not as a wrong code.
  useEffect(() => {
    if (raw && !demo) write(`${SEEN_KEY}${code}`, Date.now());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!raw, code, demo]);
  const seen = status === "missing" && Date.now() - (read<number>(`${SEEN_KEY}${code}`) ?? 0) < SEEN_MS;

  // Deleted while people were in it: it ended, the code was right.
  if (status === "missing" && (ended || seen)) return <Message title={t("Presentation ended")} text={t("Thanks for taking part.")} back={t("Back to home")} />;
  if (status === "missing") return <Message title={t("Presentation not found")} text={t("Check the code.")} back={t("Back to home")} />;
  if (full) {
    return (
      <Message title={t("This presentation is full")} text={t("It has reached its maximum number of participants.")} back={t("Back to home")}>
        <button className="ghost" onClick={retryFull}>{t("Try again")}</button>
      </Message>
    );
  }
  if (!state) {
    return (
      <main className="page narrow center muted vote" role="status" aria-live="polite">
        <span className="spinner" aria-hidden />
        {stuck ? t("Still connecting. Check your connection.") : t("Connecting…")}
        {stuck && (
          <button type="button" className="ghost with-icon" onClick={() => location.reload()}>
            <RefreshCw size={16} aria-hidden />
            {t("Reload")}
          </button>
        )}
      </main>
    );
  }

  if (state.names && !name) {
    return (
      <UiProvider value={ui}><main className="page narrow vote">
        <header className="top">{mark}<LangPicker lang={lang} onChange={changeLang} label={mine("Language")} /></header>
        <h1 className="question">{state.title}</h1>
        <NameForm send={send} onDone={(n, a) => (setName(n), setMyAvatar(a))} quiz={false} />
      {note}
      </main></UiProvider>
    );
  }

  // While the curtain closes, the waiting screen stays: question 1 shows only once it is shut.
  if (state.lobby || launch?.phase === "closing") {
    return (
      <UiProvider value={ui}><main className="page narrow vote">
        <header className="top">{mark}<LangPicker lang={lang} onChange={changeLang} label={mine("Language")} /></header>
        <div className="wait-screen">
          <div className="wait-stage" aria-hidden>
            <span className="wait-ring" />
            <span className="wait-ring late" />
            <Buddy id={myAvatar} size={128} className="wait-buddy" />
          </div>
          {brand?.welcome && <p className="lobby-welcome">{brand.welcome}</p>}
          <h1 className="wait-head">{keepMarks(state.names && name ? t("Starting soon, {name}!").replace("{name}", name) : t("Starting soon!"))}</h1>
          <p className="wait-deck">{state.title}</p>
          <p className="muted wait-text">{t("The presentation is about to start. The first question will appear here.")}</p>
          <span className="wait-dots" aria-hidden><i /><i /><i /></span>
        </div>
      {launch && <LaunchCurtain text={t("Here we go!")} start={launch.start} />}
      {note}
      </main></UiProvider>
    );
  }
  const BODIES = {
    words: Words, open: Open, rank: Rank, qa: Qa, choice: Choice, scale: Choice, contact: ContactForm, scales: Scales, number: NumberAnswer, slide: SlideView, link: LinkView,
    points: PointsAnswer, fill: FillAnswer, match: MatchAnswer, spot: SpotAnswer, wheel: WheelView, countdown: CountdownPhone, media: MediaPhone,
  };
  const topics = state.topics ?? null;
  const Body = topics?.at === "picker" ? TopicPicker : state.kind === "rank" && state.ordered ? OrderRank : (BODIES[state.kind] ?? Unknown);
  // With the leaderboard after each question, each round or at the end, each phone sees its own place first, then the top of the board.
  const ownBoard = ownBoardOf(state);
  const tv = (text: string, vars?: Record<string, string | number>) => Object.entries(vars ?? {}).reduce((out, [k, v]) => out.replaceAll(`{${k}}`, String(v)), t(text));
  if (state.board && ownBoard) {
    const final = boardView(state) === "podium";
    return (
      <UiProvider value={ui}><main className="page narrow vote">
        <header className="top">{mark}<LangPicker lang={lang} onChange={changeLang} label={mine("Language")} /></header>
        <h1 className="question with-icon-title"><Trophy size={26} />{final ? t("Final ranking") : boardModeOf(state) === "round" && topics?.at === "topic" && topics.pos === topics.size ? tv("After round {n}", { n: topics.roundNo }) : t("Leaderboard")}</h1>
        <PhoneResults me={state.me} board={state.board} mine={tagOf(voterId())} lang={uiLang} locale={screenLocale(uiLang)} t={tv} final={final} elapsed={final ? boardElapsed(state, PODIUM_MS) : null} key={state.boardAt ?? 0} />
      {note}
      </main></UiProvider>
    );
  }
  if (state.board) {
    return (
      <UiProvider value={ui}><main className="page narrow vote">
        <header className="top">{mark}<LangPicker lang={lang} onChange={changeLang} label={mine("Language")} /></header>
        <h1 className="question with-icon-title"><Trophy size={26} />{t("Leaderboard")}</h1>
        {/* Its own row by tag when the room tags rows, else by the saved name (never the shared "Anonymous"). */}
        <Leaderboard entries={state.board} mine={tagOf(voterId())} me={name || undefined} />
      {note}
      </main></UiProvider>
    );
  }
  return (
    <UiProvider value={ui}><main className="page narrow vote">
      <header className="top">
        {mark}
        <div className="top-right">
          {/* With topic rounds: the place in the topic under way (nothing at the picker, nor before and after the rounds). */}
          {topics ? (
            topics.at === "topic" && topics.size > 1 && <span className="step-pill" dir="ltr">{topics.pos} / {topics.size}</span>
          ) : (
            state.count > 1 && <span className="step-pill" dir="ltr">{state.index + 1} / {state.count}</span>
          )}
          <LangPicker lang={lang} onChange={changeLang} label={mine("Language")} />
        </div>
      </header>
      {!counting && topics?.at === "topic" && topics.topic !== null && (
        <p className="phone-round"><Layers size={16} aria-hidden /> {tv("Round {n}", { n: topics.roundNo })} · {topics.list[topics.topic]?.label}</p>
      )}
      {!counting && <h1 className="question" key={state.index}>{keepMarks(state.question)}</h1>}
      {!counting && lang !== state.lang && (translated || original) && (
        <p className="translated-note" lang={lang} dir={RTL.includes(lang) ? "rtl" : "ltr"}>
          <Languages size={14} /> {original ? mine("Original version") : mine("Automatically translated")} ·{" "}
          <button className="link-btn" onClick={() => setOriginal((o) => !o)}>{original ? mine("See translation") : mine("See original")}</button>
        </p>
      )}
      {lang !== state.lang && loading && !translated && !original && <p className="translated-note" lang={lang} dir={RTL.includes(lang) ? "rtl" : "ltr"}>{mine("Translating…")}</p>}
      {!counting && lang !== state.lang && failed && (
        <p className="translated-note" lang={lang} dir={RTL.includes(lang) ? "rtl" : "ltr"}><Languages size={14} /> {mine("Translation unavailable")}</p>
      )}
      {/* On a spot question the image is where people tap: it shows with the answer. */}
      {state.image && !counting && state.kind !== "spot" && <img className="vote-image" src={state.image} alt="" />}
      {/* Keyed by question so each one starts with its own saved answer. */}
      {state.locked ? (
        <div className="wait-card"><Lock size={28} /><strong>{t("Voting is paused")}</strong></div>
      ) : (
        <Body key={`${state.round}:${state.index}:${raw?.question}${topics ? `:${topics.pass}` : ""}`} state={state} code={code} send={send} />
      )}
      {/* After each scored question: once the answer shows, the person's place so far. */}
      {boardModeOf(state) === "each" && state.quiz && state.revealed && <MyStanding me={state.me} lang={uiLang} locale={screenLocale(uiLang)} t={tv} />}
      {(topics ? topics.hasNext : state.index < state.count - 1) && !counting && <p className="muted next-hint">{t("The next question will show up here automatically.")}</p>}
    {launch && <LaunchCurtain text={t("Here we go!")} start={launch.start} />}
    {note}
    </main></UiProvider>
  );
}
