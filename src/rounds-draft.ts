// Topic rounds in the builder (src/pages/Create.tsx): the list of drafts kept in the order the rounds need, questions moved
// between topics, a topic removed, and what keeps the rounds from being saved. The rules of the game live in src/rounds.ts.
import { MAX_TOPICS, TOPIC_LENGTH } from "./rounds";
import type { Draft } from "./questions";

export { MAX_TOPICS, TOPIC_LENGTH };

// Each topic's color, the same as its slice on the wheel on every round (styles.css .wh0 to .wh7).
const COLORS = ["#ff5436", "#f6f1e7", "#34418f", "#ffab90", "#cfd3ea", "#4f5fb8", "#b8321d", "#8d97d6"];
export const topicColor = (i: number) => COLORS[i % COLORS.length];

export const pickerAt = (list: Draft[]) => list.findIndex((q) => q.kind === "topics");

const plain = (q: Draft): Draft => {
  if (q.topic === undefined) return q;
  const { topic: _topic, ...rest } = q;
  return rest;
};

// [questions before] [picker] [topic 0's questions] [topic 1's]... [questions after]. Without a picker no question keeps a topic.
export function ordered(list: Draft[]): Draft[] {
  const p = pickerAt(list);
  if (p < 0) return list.some((q) => q.topic !== undefined) ? list.map(plain) : list;
  const n = list[p].options.length;
  const before: Draft[] = [];
  const after: Draft[] = [];
  const groups: Draft[][] = Array.from({ length: n }, () => []);
  list.forEach((q, i) => {
    if (i === p) return;
    if (q.kind !== "topics" && q.topic !== undefined && q.topic >= 0 && q.topic < n) groups[q.topic].push(q);
    else (i < p ? before : after).push(plain(q));
  });
  const out = [...before, list[p], ...groups.flat(), ...after];
  // Nothing moved: the same list, so React keeps it as it is.
  return out.length === list.length && out.every((q, i) => q === list[i]) ? list : out;
}

// The indices of each topic's questions.
export function topicGroups(list: Draft[]): number[][] {
  const p = pickerAt(list);
  if (p < 0) return [];
  const groups: number[][] = list[p].options.map(() => []);
  list.forEach((q, i) => q.topic !== undefined && groups[q.topic]?.push(i));
  return groups;
}

// ↑ and ↓ in the builder, card by card as they show: a question crosses from one topic into the next (its topic changes),
// from the last question before the rounds into the first topic, from the last topic into the questions after.
// The picker moves with its topics: the question it passes goes to the other side of the block.
export function moveDraft(list: Draft[], qi: number, by: -1 | 1): Draft[] {
  const p = pickerAt(list);
  const swap = (a: number, b: number) => {
    if (b < 0 || b >= list.length) return list;
    const next = [...list];
    [next[a], next[b]] = [next[b], next[a]];
    return next;
  };
  if (p < 0) return swap(qi, qi + by);
  const n = list[p].options.length;
  const without = (i: number) => list.filter((_, j) => j !== i);
  const firstAfter = list.findIndex((q, i) => i > p && q.topic === undefined);
  if (qi === p) {
    if (by < 0) {
      if (p === 0) return list;
      // The question just above becomes the first one after the rounds.
      const rest = without(p - 1);
      const at = rest.findIndex((x, i) => i > p - 1 && x.topic === undefined);
      return ordered(at < 0 ? [...rest, plain(list[p - 1])] : [...rest.slice(0, at), plain(list[p - 1]), ...rest.slice(at)]);
    }
    if (firstAfter < 0) return list;
    const rest = without(firstAfter);
    return ordered([...rest.slice(0, p), list[firstAfter], ...rest.slice(p)]);
  }
  const q = list[qi];
  const set = (d: Draft) => ordered(list.map((x, i) => (i === qi ? d : x)));
  if (q.topic === undefined) {
    if (qi < p) {
      if (by < 0 || qi + 1 < p) return swap(qi, qi + by);
      // The last question before the rounds joins the first topic.
      return ordered([...without(qi), { ...q, topic: 0 }]);
    }
    if (by > 0 || qi > firstAfter) return swap(qi, qi + by);
    // The first question after the rounds joins the last topic.
    return set({ ...q, topic: n - 1 });
  }
  const group = topicGroups(list)[q.topic] ?? [];
  const pos = group.indexOf(qi);
  if (by < 0) {
    if (pos > 0) return swap(qi, qi - 1);
    if (q.topic > 0) return set({ ...q, topic: q.topic - 1 });
    // The first question of the first topic goes before the rounds.
    const rest = without(qi);
    return ordered([...rest.slice(0, p), plain(q), ...rest.slice(p)]);
  }
  if (pos < group.length - 1) return swap(qi, qi + 1);
  if (q.topic < n - 1) return set({ ...q, topic: q.topic + 1 });
  return set(plain(q));
}

// Removes topic `t` and its questions; the topics after it move up one place.
export function removeTopic(list: Draft[], t: number): Draft[] {
  return ordered(
    list
      .filter((q) => q.kind === "topics" || q.topic !== t)
      .map((q) => {
        if (q.kind === "topics") {
          const options = q.options.filter((_, i) => i !== t);
          return { ...q, options, rounds: q.rounds && q.rounds < options.length ? q.rounds : undefined };
        }
        return q.topic !== undefined && q.topic > t ? { ...q, topic: q.topic - 1 } : q;
      }),
  );
}

// The picker taken out: its questions stay, as ordinary ones, in the same order.
export const removePicker = (list: Draft[]) => list.filter((q) => q.kind !== "topics").map(plain);

// Before saving: topics left without a name and without questions are dropped (the stored list holds named topics only).
export function compactTopics(list: Draft[]): Draft[] {
  const p = pickerAt(list);
  if (p < 0) return list;
  const groups = topicGroups(list);
  const keep = list[p].options.map((o, i) => !!o.trim() || groups[i].length > 0);
  if (keep.every(Boolean)) return list;
  const to: number[] = [];
  let k = 0;
  keep.forEach((on, i) => (to[i] = on ? k++ : -1));
  return list.map((q) => {
    if (q.kind === "topics") {
      const options = q.options.filter((_, i) => keep[i]);
      return { ...q, options, rounds: q.rounds && q.rounds < options.length ? q.rounds : undefined };
    }
    return q.topic !== undefined ? { ...q, topic: to[q.topic] } : q;
  });
}

// What keeps the rounds from being saved, in the builder's words (English keys, translated where shown).
// `where`: the picker, or the topic it is about. `n` and `topic` fill the message.
export type RoundsProblem = { text: string; where: "picker" | number; vars: Record<string, string | number> };
export function roundsProblems(list: Draft[]): RoundsProblem[] {
  const p = pickerAt(list);
  if (p < 0) return [];
  const picker = list[p];
  const groups = topicGroups(list);
  const out: RoundsProblem[] = [];
  const named = picker.options.map((o) => o.trim()).filter(Boolean);
  if (named.length < 2) out.push({ text: "Add at least 2 topics", where: "picker", vars: { n: p + 1 } });
  picker.options.forEach((o, i) => {
    if (!o.trim() && groups[i].length) out.push({ text: "Name topic {k}", where: "picker", vars: { n: p + 1, k: i + 1 } });
  });
  const seen = new Set<string>();
  for (const name of named) {
    const low = name.toLowerCase();
    if (seen.has(low)) {
      out.push({ text: "Two topics are called \"{topic}\"", where: "picker", vars: { n: p + 1, topic: name } });
      break;
    }
    seen.add(low);
  }
  picker.options.forEach((o, i) => {
    if (o.trim() && !groups[i].length) out.push({ text: "Add a question to the topic {topic}", where: i, vars: { n: p + 1, topic: o.trim() } });
  });
  return out;
}
