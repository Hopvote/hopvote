// Fill in the blanks: a text with each answer between brackets, "The capital of Australia is [Canberra]."
// Several accepted answers are separated by a slash: [colour/color]. Shared by the builder, the phones and the room.
export const MAX_BLANKS = 6;
export const FILL_LENGTH = 300;
export const BLANK_LENGTH = 60;

// `pieces` are the bits of text around the blanks (one more than the blanks), `answers` the accepted answers of each blank.
export type Fill = { pieces: string[]; answers: string[][] };

const BLANK = /\[([^[\]]*)\]/g;
// A date or a fraction (24/10, 3/4) is one answer, not two.
const oneAnswer = (inside: string) => /^\s*-?\d+(\s*\/\s*\d+)+\s*$/.test(inside);

export function parseFill(text: string): Fill {
  const pieces: string[] = [];
  const answers: string[][] = [];
  let last = 0;
  for (const m of text.matchAll(BLANK)) {
    pieces.push(text.slice(last, m.index));
    const inside = m[1];
    answers.push((oneAnswer(inside) ? [inside] : inside.split("/")).map((a) => a.trim().slice(0, BLANK_LENGTH)).filter(Boolean));
    last = (m.index ?? 0) + m[0].length;
  }
  pieces.push(text.slice(last));
  return { pieces, answers };
}

// Compared without case, accents, extra spaces, quotes or a final full stop: "  Canberra. " is "canberra".
export function normalize(text: string) {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLocaleLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/\s+/g, " ")
    .replace(/^[\s"'«“]+|[\s.!?;:,"'»”]+$/g, "");
}

// True when `a` turns into `b` with one letter added, removed or changed.
function oneEdit(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}

// Right when it matches an accepted answer. One typo is forgiven in long words ("Canbera"), never in numbers.
export function rightBlank(given: string, accepted: string[]) {
  const g = normalize(given);
  if (!g) return false;
  return accepted.some((answer) => {
    const a = normalize(answer);
    return g === a || (a.length >= 6 && !/\d/.test(a) && oneEdit(g, a));
  });
}

// Words to place: from 0 to 6 extra words beside the answers, to make it harder.
export const MAX_DECOYS = 6;

// The words offered when people place them: each blank's answer and the extra words, in an order that gives nothing away
// but stays the same for the whole question (`seed`: the question's text).
export function wordBank(answers: string[][], decoys: string[], seed: string) {
  const right = answers.map((a) => a[0]).filter(Boolean);
  // An extra word that is already an answer would only be offered twice.
  const extra = decoys.filter((d) => !answers.some((a) => a.some((w) => normalize(w) === normalize(d))));
  const words = [...right, ...extra];
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const next = () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)) >>> 0) / 4294967296;
  for (let i = words.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [words[i], words[j]] = [words[j], words[i]];
  }
  return words;
}

// How a typed answer is counted among the room's answers: as written, lowercase, without a final full stop.
export const shownAnswer = (text: string) => text.trim().replace(/\s+/g, " ").replace(/[.!?;:,]+$/, "").toLocaleLowerCase().slice(0, BLANK_LENGTH);
