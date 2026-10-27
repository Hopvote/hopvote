// The bars of a multiple choice result, and the French punctuation rule.
// Kept apart from answers.tsx (which pulls the translation tables), so a page can show them without loading those.
import { Check } from "lucide-react";

export function ChoiceResults({
  options,
  counts,
  mine,
  correct,
  voters,
  done,
  doneLabel = "",
  chosen,
  onPick,
  pickTitle,
}: {
  options: string[];
  counts: number[];
  mine?: number | number[];
  correct?: number | null;
  // With several answers per person, percentages are out of the people who answered.
  voters?: number;
  // Topic rounds: the topics already played stay in their place, greyed and checked, with `doneLabel` instead of a figure;
  // `chosen` is the topic the vote chose (it takes the highlight); `onPick` lets the presenter click a topic to choose it.
  done?: boolean[];
  doneLabel?: string;
  chosen?: number | null;
  onPick?: (i: number) => void;
  pickTitle?: string;
}) {
  const total = voters ?? counts.reduce((a, b) => a + b, 0);
  const mineList = mine === undefined ? [] : Array.isArray(mine) ? mine : [mine];
  const max = Math.max(1, ...counts);
  const quizShown = correct !== null && correct !== undefined;
  return (
    <ol className={`results ${quizShown ? "quiz-shown" : ""} ${chosen !== undefined && chosen !== null ? "has-chosen" : ""}`}>
      {options.map((label, i) => {
        const pct = total ? Math.round((counts[i] / total) * 100) : 0;
        const off = !!done?.[i];
        // The topic chosen takes the highlight, unless nobody voted (it was drawn: no figure reads as a result).
        const win = chosen !== undefined && chosen !== null ? total > 0 && i === chosen : total > 0 && counts[i] === max;
        const cls = [mineList.includes(i) && "mine", quizShown ? i === correct && "right" : !off && win && "win", off && "round-done", onPick && !off && "pickable"];
        return (
          <li key={i} className={cls.filter(Boolean).join(" ")} onClick={onPick && !off ? () => onPick(i) : undefined} title={onPick && !off ? pickTitle : undefined}>
            <div className="result-label">
              <span className="truncate">
                {((quizShown && i === correct) || off) && <Check size={18} strokeWidth={3} className="right-mark" />}
                {label}
              </span>
              <strong>{off ? doneLabel : `${pct}%`}</strong>
            </div>
            <div className="bar">
              <div style={{ width: `${off ? 0 : (counts[i] / max) * 100}%` }} />
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// French puts a space before ? ! : ; and inside « »: a no-break space keeps the mark with its word at the end of a line.
// An inverted pronoun ("s'affiche-t-il") stays whole too: a word joiner (invisible) after each of its hyphens.
export const keepMarks = (text: string) =>
  text
    .replace(/ ([?!:;»])/g, "\u00a0$1")
    .replace(/« /g, "«\u00a0")
    .replace(/(\p{L})-(t-)?(il|elle|on|ils|elles)\b/gu, (_, a: string, t: string | undefined, p: string) => `${a}-\u2060${t ? "t-\u2060" : ""}${p}`);
