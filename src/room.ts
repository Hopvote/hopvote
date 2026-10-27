import { useEffect, useRef, useState } from "react";
import type { Decor } from "./decor";

export type Kind = "choice" | "scale" | "words" | "open" | "rank" | "qa" | "contact" | "scales" | "number" | "slide" | "link" | "points" | "fill" | "match" | "spot" | "wheel" | "countdown" | "media";
// `original`: the text as written, when `text` shows a translation.
export type OpenAnswer = { id: string; text: string; at: number; hidden?: boolean; votes?: number; done?: boolean; original?: string };
// `rank`: equal scores share one. `tag`: lets a phone find itself (tagOf of its id). `prev`: the rank before the question on
// screen (0: not ranked yet), `gained`: the points it brought. Older rooms send name, score and avatar only.
export type BoardEntry = { name: string; score: number; avatar?: string; rank?: number; tag?: string; gained?: number; prev?: number };
// The quiz leaderboard setting: after each scored question, after each topic round, at the end, never, or with the
// presenter's button only.
export type BoardMode = "each" | "round" | "end" | "off" | "manual";
// A phone's own place: its rank among `of` players, its points and what the question on screen brought.
export type Standing = { rank: number; score: number; gained: number; of: number };

// Topic rounds (src/rounds.ts), as the room sends them with presentations that have them.
// Protocol for the screens (host or slide key): `step {dir: 1 | -1, from: index}` moves → or ← on the way the game goes;
// `spin` turns the picker's wheel (topics left only); `pick {}` closes the room's vote, `pick {topic}` chooses a topic by hand
// (wheel or vote, also after a tie draw); `repick` chooses again while the chosen topic has no answer. Phones vote at the
// picker with the usual `vote` plus `pass` (the vote under way): a vote from an earlier pass is refused.
export type TopicsState = {
  // Every topic: its name, its number of questions, whether it was played (or is playing), whether it has points to win.
  list: { label: string; n: number; done: boolean; scored: boolean }[];
  // Who chooses: the wheel or the room's vote.
  how: "wheel" | "vote";
  // Where the question on screen stands.
  at: "before" | "picker" | "topic" | "after";
  // The topic of the question on screen (null outside the topics).
  topic: number | null;
  // At the picker: the topic chosen for the next round and how ("last": the only one left, no wheel or vote).
  // With the wheel, it is known as the wheel starts: screens show it once the spin ends (spin.at + SPIN_MS).
  chosen: number | null;
  chosenHow: "wheel" | "vote" | "host" | "last" | null;
  // The round shown (from 1) out of the rounds to play.
  roundNo: number;
  of: number;
  // In a topic: the question's place in it (from 1) and its number of questions; 0 elsewhere.
  pos: number;
  size: number;
  // The chosen topic has answers already: no choosing again.
  locked: boolean;
  // A round can still start at the picker.
  left: boolean;
  // Whether → and ← lead anywhere (a slide tool moves to its own slides when they do not).
  hasNext: boolean;
  hasPrev: boolean;
  // The vote closed on a tie (drawn among the tied topics) or without any vote (drawn among every topic left).
  tie: boolean;
  empty: boolean;
  // The vote under way, sent back with each phone's vote; phones keep their own answer per pass.
  pass: number;
  // The topics played, in order, and how each was chosen.
  order: number[];
  hows: ("wheel" | "vote" | "host" | "last")[];
};

export type RoomState = {
  // Changes when the presenter clears the answers: what a phone remembers from before no longer counts.
  round: number;
  title: string;
  // Language the presenter wrote the questions in.
  lang: string;
  // Position of the question on screen within the presentation.
  index: number;
  count: number;
  kind: Kind;
  question: string;
  options: string[];
  image: string | null;
  max: number;
  labels: [string, string] | null;
  // Ratings: how the results show.
  style: "bars" | "slider" | "gauge" | "dots" | "";
  // Details a contact question asks for.
  fields: ("name" | "email" | "phone" | "company")[];
  multi: boolean;
  quiz: boolean;
  hasQuiz: boolean;
  hasBoard: boolean;
  // Seconds for a timed quiz (0 when untimed), and when the host started the clock (server time).
  timer: number;
  startedAt: number | null;
  now: number;
  // Local time when this state arrived, to turn server times into local ones.
  receivedAt: number;
  correct: number | null;
  revealed: boolean;
  counts: number[];
  // Slides: the text under the title. Links: where the QR code and the button lead.
  text: string;
  url: string;
  // Rankings with a right order to find. The presenter gets the options in that order; phones and other screens get them
  // mixed (pairs: the right-hand items) until the answer shows, then in that order with `mix`: place j showed item mix[j].
  ordered: boolean;
  mix?: number[] | null;
  // Number questions: every answer, the right value and the closest answer once shown (empty while a game hides them).
  numbers: number[];
  answer: number | null;
  closest: { value: number; name: string } | null;
  // Rankings with a right order, once shown: how many found it all, and how many put each item at its place.
  // Pairs to match and blanks to fill use it too: everything right, and each pair or blank right.
  orderResults: { right: number; placed: number[] } | null;
  // Blanks to fill: the text around the blanks; once shown, the accepted answers of each blank and the most typed ones.
  gaps?: string[];
  blanks?: string[][];
  fillTop?: [string, number][][];
  // Blanks with words to place: the words offered (the answers and the presenter's extra ones), shuffled.
  bank?: string[];
  // Find on the image: x, y and how many people, one after the other (x and y from 0 to 1000); once shown, the right zone
  // and how many tapped in it.
  spots?: number[];
  zone?: [number, number, number, number] | null;
  found?: number;
  // The wheel: what it spins among, the last spin, who it picked.
  wheel?: { list: string[]; spin: { at: number; from: number; to: number; win: number; n: number; tag: string } | null; picked: string[] } | null;
  // A timer: running until `end` (server time), or paused with `left` milliseconds.
  clock?: { run: boolean; end: number; left: number; total: number } | null;
  words: [string, number][];
  answers: OpenAnswer[];
  answered: number;
  board: BoardEntry[] | null;
  // When the leaderboard shows (missing from older rooms: "manual"), when it opened (server time, to animate it only then),
  // and whether no scored question follows (the final leaderboard).
  boardMode?: BoardMode;
  boardAt?: number | null;
  boardFinal?: boolean;
  // The seasonal decor (src/decor.ts), sent only until its end date; missing or null: the normal one.
  decor?: Decor | null;
  // Phones only, when their screen shows it: their own place (null: no points yet).
  me?: Standing | null;
  // A slide is on its waiting screen: phones wait for the presenter to start.
  lobby: boolean;
  // The presenter paused voting on this question.
  locked: boolean;
  // The presentation asks for first names; `people` lists those connected now.
  names: boolean;
  // `tag`: the presenter's screen only, to take a name off the screens (the "unname" message).
  people: { name: string; avatar: string; done?: boolean; tag?: string }[];
  online: number;
  // Languages the connected phones read.
  langs?: string[];
  // When the presenter started, if the presentation plays the launch animation.
  launch?: number | null;
  // Topic rounds, only in presentations that have them.
  topics?: TopicsState | null;
};

export type Status = "connecting" | "open" | "missing" | "offline";

function storage(key: string, fallback: () => string) {
  try {
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const value = fallback();
    localStorage.setItem(key, value);
    return value;
  } catch {
    return fallback();
  }
}

// Older phones (iOS before 15.4) have no randomUUID.
const newId = () => crypto.randomUUID?.() ?? Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
let voter: string | undefined;
// Kept in memory as well: with storage blocked, the phone still keeps one id for the whole visit.
export const voterId = () => (voter ??= storage("hopvote:voter", newId));
// An id for a post, so a post sent again after a network drop shows only once.
export const postId = () => newId().replace(/-/g, "").slice(0, 12);

export function hostKeyFor(code: string) {
  try {
    return localStorage.getItem(`hopvote:host:${code}`) ?? undefined;
  } catch {
    return undefined;
  }
}

export function forgetHostKey(code: string) {
  try {
    localStorage.removeItem(`hopvote:host:${code}`);
  } catch {
    // Nothing stored.
  }
}

export function saveHostKey(code: string, key: string) {
  try {
    localStorage.setItem(`hopvote:host:${code}`, key);
  } catch {
    // Private mode: the presenter link still works in this tab.
  }
}

// Live connection to a room, reconnecting on network drops.
// `viewer`: a slide that only watches, never counted as a participant.
export function useRoom(code: string, hostKey?: string, enabled = true, viewer = false) {
  const [state, setState] = useState<RoomState | null>(null);
  const [status, setStatus] = useState<Status>("connecting");
  // The room caps distinct voters (worker/limits.ts); it answers "full" to newcomers past it.
  const [full, setFull] = useState(false);
  // The presentation was there and is gone now (deleted while people were in it): "missing" with this set.
  const [ended, setEnded] = useState(false);
  // The room refused the key (new keys since, or a teammate who left): the screen asks for the key again, or watches.
  const [badKey, setBadKey] = useState(false);
  const socket = useRef<WebSocket | null>(null);
  // Answers sent during a network blip wait here and go out as soon as the link is back.
  const pending = useRef<Outgoing[]>([]);
  // Sent, waiting for the room to say whether they counted.
  const waiting = useRef(new Map<number, Outgoing>());
  const nextRef = useRef(1);

  useEffect(() => {
    let closed = false;
    // The presentation is gone (deleted, or never existed): nothing to reconnect to.
    let gone = false;
    let everOpened = false;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout>;
    if (!enabled) return;
    setBadKey(false);

    const connect = () => {
      // Sent on the last connection but never confirmed: answers safe to repeat go out again first.
      const unsure = [...waiting.current.values()].filter((o) => o.again);
      waiting.current.clear();
      pending.current = [...unsure, ...pending.current];
      socket.current?.close();
      const proto = location.protocol === "https:" ? "wss" : "ws";
      // Phones say who they are up front, so the room counts people rather than connections.
      const query = hostKey ? `?key=${encodeURIComponent(hostKey)}` : viewer ? "?view=1" : `?voter=${encodeURIComponent(voterId())}`;
      const ws = new WebSocket(`${proto}://${location.host}/api/rooms/${code}/ws${query}`);
      socket.current = ws;
      let opened = false;
      // A connection replaced by a newer one (back from sleep) says nothing more.
      ws.onopen = () => {
        if (socket.current !== ws) return;
        opened = true;
        everOpened = true;
        retry = 0;
        setStatus("open");
        for (const out of pending.current.splice(0)) {
          ws.send(out.text);
          waiting.current.set(out.ref, out);
        }
      };
      ws.onmessage = (e) => {
        if (socket.current !== ws || e.data === "pong") return;
        const data = JSON.parse(e.data);
        if (data.type === "state") setState({ ...data, receivedAt: Date.now() });
        if (data.type === "full") setFull(true);
        if (data.type === "ack") {
          const out = waiting.current.get(data.ref);
          waiting.current.delete(data.ref);
          out?.done(!!data.ok);
        }
      };
      ws.onclose = (e) => {
        if (closed || socket.current !== ws) return;
        // The presentation was deleted while open.
        if (e.code === 4404) {
          gone = true;
          setEnded(true);
          setStatus("missing");
          return;
        }
        if (e.code === 4403 && hostKey) {
          gone = true;
          setStatus("offline");
          setBadKey(true);
          return;
        }
        // Never opened on the first try: the room may not exist. Asked again every third failed try, as a presentation
        // deleted while this phone was offline never sends its closing code.
        if (!opened && (everOpened ? retry % 3 === 2 : retry === 0)) {
          fetch(`/api/rooms/${code}/ws`).then((r) => {
            if (r.status === 404) {
              gone = true;
              if (everOpened) setEnded(true);
              setStatus("missing");
            } else schedule();
          }, schedule);
          return;
        }
        schedule();
      };
    };
    const schedule = () => {
      if (gone) return;
      setStatus("offline");
      timer = setTimeout(connect, Math.min(1000 * 2 ** retry++, 10000));
    };

    connect();
    // Some networks drop silent connections: a small ping keeps it open (answered without waking the room).
    const ping = setInterval(() => socket.current?.readyState === WebSocket.OPEN && socket.current.send("ping"), 25_000);
    // Back from sleep or a lost network: reconnect right away instead of waiting for the backoff.
    const wake = () => {
      if (gone) return;
      if (document.visibilityState === "visible" && socket.current?.readyState !== WebSocket.OPEN && socket.current?.readyState !== WebSocket.CONNECTING) {
        clearTimeout(timer);
        retry = 0;
        connect();
      }
    };
    document.addEventListener("visibilitychange", wake);
    addEventListener("online", wake);
    return () => {
      closed = true;
      clearTimeout(timer);
      clearInterval(ping);
      document.removeEventListener("visibilitychange", wake);
      removeEventListener("online", wake);
      socket.current?.close();
    };
  }, [code, hostKey, enabled, viewer]);

  // Resolves true once the room has counted the message, false when it refused it.
  // `again`: safe to send a second time if the connection drops before the room answers (not a toggle like an upvote).
  const send = (data: Record<string, unknown>, again = true) =>
    new Promise<boolean>((done) => {
      const ref = nextRef.current++;
      const out = { text: JSON.stringify({ ...data, ref }), ref, again, done };
      if (socket.current?.readyState === WebSocket.OPEN) {
        socket.current.send(out.text);
        waiting.current.set(ref, out);
      } else if (pending.current.length < 20) pending.current.push(out);
      else done(false);
    });

  return { state, status, send, full, ended, badKey, retryFull: () => setFull(false) };
}

type Outgoing = { text: string; ref: number; again: boolean; done: (ok: boolean) => void };
