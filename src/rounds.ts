// Topic rounds: one question (the picker) chooses the next topic, by a wheel or by the room's vote; that topic's questions
// play, then the picker comes back for the next round with the topics left. Pure rules shared by the room (worker/room.ts),
// the server checks (worker/index.ts), the presenter's screens, the phones, the builder and the results, so there is never
// a second version of them.
//
// The questions stay one flat list: [questions before] [picker] [topic 0 questions] [topic 1 questions]... [questions after].
// The picker is a wheel (`type: "wheel"`) or a poll (`type: "choice"`, no right answer) marked `topics: true`, its `options`
// are the topic names, and `rounds` how many rounds to play (all the topics when missing). Each topic question carries
// `topic`: the index of its topic in the picker's options. An older app reading it sees a plain wheel or poll.

export const MIN_TOPICS = 2;
export const MAX_TOPICS = 8;
export const TOPIC_LENGTH = 40;

// The fields the rules read: a stored question (worker/room.ts Question, src/questions.ts Stored) fits.
export type RoundsQuestion = { type?: string; question?: string; options: string[]; topics?: boolean; rounds?: number; topic?: number };

// How a topic was chosen: the wheel, the room's vote, the presenter, or because it was the only one left.
export type How = "wheel" | "vote" | "host" | "last";

export type Rounds = {
  // Index of the picker in the list.
  picker: number;
  // Who chooses: the wheel or the room's vote.
  how: "wheel" | "vote";
  // Each topic: its name and the indices of its questions, in order.
  topics: { label: string; indices: number[] }[];
  // Indices of the questions before the picker, and after the topics.
  before: number[];
  after: number[];
  // Rounds to play: from 1 to the number of topics.
  rounds: number;
};

// What the room remembers of the game: the topics played so far, in order, and the topic chosen at the picker
// that has not started yet (null: nothing chosen).
export type Play = { order: number[]; chosen: number | null };

export const isPicker = (q: RoundsQuestion) => q.topics === true && (q.type === "wheel" || (q.type ?? "choice") === "choice");

// Why a list of questions does not hold together as topic rounds (English, as the server's other messages), or null when
// it does, or when it has no picker.
export function validRounds(questions: RoundsQuestion[]): string | null {
  const pickers = questions.flatMap((q, i) => (isPicker(q) ? [i] : []));
  if (!pickers.length) return null;
  if (pickers.length > 1) return "Only one topic rounds question per presentation";
  const p = pickers[0];
  const picker = questions[p];
  const n = picker.options.length;
  const short = String(picker.question ?? "").slice(0, 40);
  if (n < MIN_TOPICS) return `Add at least ${MIN_TOPICS} topics to "${short}"`;
  if (n > MAX_TOPICS) return `Up to ${MAX_TOPICS} topics in "${short}"`;
  if (picker.rounds !== undefined && (!Number.isInteger(picker.rounds) || picker.rounds < 1 || picker.rounds > n)) return `Play between 1 and ${n} rounds in "${short}"`;
  if (questions.slice(0, p).some((q) => q.topic !== undefined)) return "The questions of a topic go after the topic rounds question";
  let last = -1;
  let ended = false;
  const sizes = Array.from({ length: n }, () => 0);
  for (const q of questions.slice(p + 1)) {
    if (q.topic === undefined) {
      ended = true;
      continue;
    }
    if (!Number.isInteger(q.topic) || q.topic < 0 || q.topic >= n) return `"${String(q.question ?? "").slice(0, 40)}" belongs to no topic`;
    // Each topic's questions together, in the order of the topics, right after the picker.
    if (ended || q.topic < last) return "Keep the questions of each topic together, in the order of the topics";
    last = q.topic;
    sizes[q.topic]++;
  }
  const empty = sizes.findIndex((s) => s === 0);
  if (empty >= 0) return `Add a question to "${picker.options[empty]}"`;
  return null;
}

// The rounds of a presentation, or null when it has none (or when they do not hold together: it then plays as a plain list).
export function roundsOf(questions: RoundsQuestion[]): Rounds | null {
  const p = questions.findIndex(isPicker);
  if (p < 0 || validRounds(questions)) return null;
  const picker = questions[p];
  const topics = picker.options.map((label) => ({ label, indices: [] as number[] }));
  const after: number[] = [];
  questions.forEach((q, i) => {
    if (i <= p) return;
    if (q.topic !== undefined) topics[q.topic].indices.push(i);
    else after.push(i);
  });
  return {
    picker: p,
    how: picker.type === "wheel" ? "wheel" : "vote",
    topics,
    before: Array.from({ length: p }, (_, i) => i),
    after,
    rounds: Math.min(topics.length, Math.max(1, picker.rounds ?? topics.length)),
  };
}

// The topic of question `index` (null for the picker and the questions before and after).
export function topicAt(r: Rounds, index: number): number | null {
  const t = r.topics.findIndex((topic) => topic.indices.includes(index));
  return t < 0 ? null : t;
}

export type Where = "before" | "picker" | "topic" | "after";
export function whereOf(r: Rounds, index: number): Where {
  if (index < r.picker) return "before";
  if (index === r.picker) return "picker";
  return topicAt(r, index) === null ? "after" : "topic";
}

// Topics not played yet (the one chosen at the picker included).
export const remainingOf = (r: Rounds, play: Play) => r.topics.map((_, i) => i).filter((i) => !play.order.includes(i));

// Whether another round can start at the picker.
export const roundsLeft = (r: Rounds, play: Play) => play.order.length < r.rounds && remainingOf(r, play).length > 0;

// The topic the next round plays, once decided: the one chosen, or the only one left (no wheel, no vote for it).
export function decisionOf(r: Rounds, play: Play): { topic: number; last: boolean } | null {
  if (!roundsLeft(r, play)) return null;
  if (play.chosen !== null && !play.order.includes(play.chosen)) return { topic: play.chosen, last: false };
  const left = remainingOf(r, play);
  return left.length === 1 ? { topic: left[0], last: true } : null;
}

// Where → leads from question `current`:
// - `{ to }`: that question; `enter`: the topic it starts (the room adds it to the topics played);
// - `{ need: "pick" }`: on the picker, the wheel must turn (or the vote close) first;
// - null: nothing after (a slide tool moves to its next slide).
export type Step = { to: number; enter?: number; back?: boolean } | { need: "pick" } | null;

// After the last question of the round in progress: the picker for the next round, or the questions after the rounds.
function afterRound(r: Rounds, play: Play, playedNow: number): Step {
  const left = remainingOf(r, play);
  if (playedNow < r.rounds && left.length > 0) return { to: r.picker };
  return r.after.length ? { to: r.after[0] } : null;
}

export function nextStep(r: Rounds, play: Play, current: number, count: number): Step {
  const where = whereOf(r, current);
  if (where === "before" || where === "after") return current + 1 < count ? { to: current + 1 } : null;
  if (where === "picker") {
    if (!roundsLeft(r, play)) return r.after.length ? { to: r.after[0] } : null;
    const d = decisionOf(r, play);
    return d ? { to: r.topics[d.topic].indices[0], enter: d.topic } : { need: "pick" };
  }
  const t = topicAt(r, current)!;
  const { indices } = r.topics[t];
  const pos = indices.indexOf(current);
  if (pos < indices.length - 1) return { to: indices[pos + 1] };
  const k = play.order.indexOf(t);
  // An earlier round, opened again from the dots: on to the round that followed it.
  if (k >= 0 && k < play.order.length - 1) return { to: r.topics[play.order[k + 1]].indices[0] };
  const playedNow = k >= 0 ? play.order.length : play.order.length + 1;
  return afterRound(r, { ...play, order: k >= 0 ? play.order : [...play.order, t] }, playedNow);
}

// Where ← leads. From the first question of the round in progress it goes back to the picker with the same topic chosen
// (`back`: the room takes it out of the topics played, without a new draw). When the picker already holds the next round's
// topic (← from it, then back through the round before), that round stays played: a topic started is never dropped.
export function prevStep(r: Rounds, play: Play, current: number): Step {
  const where = whereOf(r, current);
  const lastOf = (t: number) => r.topics[t].indices[r.topics[t].indices.length - 1];
  if (where === "before") return current > 0 ? { to: current - 1 } : null;
  if (where === "picker") {
    if (play.order.length) return { to: lastOf(play.order[play.order.length - 1]) };
    return r.before.length ? { to: r.before[r.before.length - 1] } : null;
  }
  if (where === "after") {
    if (current > r.after[0]) return { to: current - 1 };
    return play.order.length ? { to: lastOf(play.order[play.order.length - 1]) } : { to: r.picker };
  }
  const t = topicAt(r, current)!;
  const { indices } = r.topics[t];
  const pos = indices.indexOf(current);
  if (pos > 0) return { to: indices[pos - 1] };
  const k = play.order.indexOf(t);
  if (k >= 0 && k === play.order.length - 1) return play.chosen === null ? { to: r.picker, back: true } : { to: r.picker };
  if (k > 0) return { to: lastOf(play.order[k - 1]) };
  return { to: r.picker };
}

// Questions certainly ahead of `current` on the way the game goes, and the rounds still to choose (`rounds` among `pool`).
function ahead(r: Rounds, play: Play, current: number) {
  const where = whereOf(r, current);
  const left = remainingOf(r, play);
  if (where === "after") return { fixed: r.after.filter((i) => i > current), pool: [] as number[], rounds: 0 };
  if (where === "before") return { fixed: [...r.before.filter((i) => i > current), ...r.after], pool: left, rounds: r.rounds - play.order.length };
  if (where === "picker") {
    if (!roundsLeft(r, play)) return { fixed: r.after, pool: [], rounds: 0 };
    const d = decisionOf(r, play);
    if (!d) return { fixed: r.after, pool: left, rounds: r.rounds - play.order.length };
    return { fixed: [...r.topics[d.topic].indices, ...r.after], pool: left.filter((t) => t !== d.topic), rounds: r.rounds - play.order.length - 1 };
  }
  const t = topicAt(r, current)!;
  const fixed = r.topics[t].indices.filter((i) => i > current);
  const k = play.order.indexOf(t);
  if (k >= 0) {
    for (const later of play.order.slice(k + 1)) fixed.push(...r.topics[later].indices);
    return { fixed: [...fixed, ...r.after], pool: left, rounds: r.rounds - play.order.length };
  }
  return { fixed: [...fixed, ...r.after], pool: left.filter((x) => x !== t), rounds: r.rounds - play.order.length - 1 };
}

// True when no scored question can come after `current` on the way the game goes: the leaderboard shown now is the final one.
// A round still to choose counts as scored when any topic it may pick has a scored question. `byRound` (the leaderboard
// after each round): the podium waits for the last round, even when the rounds left have no points to win.
export function finalOnPath(r: Rounds, play: Play, current: number, scored: (index: number) => boolean, byRound = false): boolean {
  const { fixed, pool, rounds } = ahead(r, play, current);
  if (fixed.some(scored)) return false;
  if (rounds > 0 && pool.length > 0 && byRound) return false;
  return !(rounds > 0 && pool.some((t) => r.topics[t].indices.some(scored)));
}

// Topic rounds kept to the questions ticked (`keep`, one per question): a topic left without a question goes, the topics
// after it move up one place, and the picker's `rounds` stays within the topics left. The picker unticked: no rounds left,
// its questions stay as ordinary ones. Used where questions are picked from a list (the AI's review).
export function keepRounds<T extends RoundsQuestion>(questions: T[], keep: boolean[]): T[] {
  const p = questions.findIndex(isPicker);
  const plain = (q: T): T => {
    if (q.topic === undefined) return q;
    const { topic: _topic, ...rest } = q;
    return rest as T;
  };
  const kept = questions.filter((_, i) => keep[i] !== false);
  if (p < 0 || keep[p] === false) return kept.filter((q) => !isPicker(q)).map(plain);
  const n = questions[p].options.length;
  const used = Array.from({ length: n }, (_, t) => kept.some((q) => !isPicker(q) && q.topic === t));
  const to: number[] = [];
  let k = 0;
  used.forEach((on, t) => (to[t] = on ? k++ : -1));
  return kept.map((q) => {
    if (isPicker(q)) {
      const options = q.options.filter((_, t) => used[t]);
      const { rounds: _rounds, ...rest } = q;
      return (q.rounds !== undefined && q.rounds < options.length ? { ...rest, options, rounds: q.rounds } : { ...rest, options }) as T;
    }
    return q.topic === undefined ? q : ({ ...q, topic: to[q.topic] } as T);
  });
}

// Topic rounds cut to `max` questions (the cap of questions): the first topics kept, the same number of questions in each, as many
// questions as fit (then as many topics); never fewer than 2 topics. The questions before and after the rounds stay.
// Null when even 2 topics of 1 question do not fit. A list without rounds is cut at `max`.
export function fitRounds<T extends RoundsQuestion>(questions: T[], max: number): T[] | null {
  if (questions.length <= max) return questions;
  const r = roundsOf(questions);
  if (!r) return questions.slice(0, Math.max(0, max));
  const budget = max - 1 - r.before.length - r.after.length;
  const sizes = r.topics.map((t) => t.indices.length);
  let best: { topics: number; each: number; total: number } | null = null;
  for (let topics = MIN_TOPICS; topics <= sizes.length; topics++) {
    for (let each = 1; each <= Math.max(...sizes); each++) {
      const total = sizes.slice(0, topics).reduce((sum, s) => sum + Math.min(s, each), 0);
      if (total > budget) break;
      if (!best || total > best.total || (total === best.total && topics > best.topics)) best = { topics, each, total };
    }
  }
  if (!best) return null;
  const { topics, each } = best;
  const keep = questions.map((_, i) => {
    const t = topicAt(r, i);
    return t === null || (t < topics && r.topics[t].indices.indexOf(i) < each);
  });
  return keepRounds(questions, keep);
}
