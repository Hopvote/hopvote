// The quiz leaderboard setting, as the presenter's screens and the phones read it (worker/room.ts stores it as `boardMode`):
// "each": after each scored question the answer shows, then the standings, then the next question;
// "round" (topic rounds): the standings after the last question of each round, the podium at the end;
// "end": the final podium after the last scored question; "off": never; "manual" (older presentations): the button only.
import type { BoardMode, RoomState } from "./room";

export const boardModeOf = (state: RoomState | null | undefined): BoardMode => state?.boardMode ?? "manual";

// What the presenter's → (or Next) does before moving on: show the right answer, then open the leaderboard.
// With topic rounds, at the picker: turn the wheel ("spin") or close the room's vote ("pick") until a topic is chosen.
// Null: it moves on as usual (with topic rounds, by sending `step`).
export function boardStep(state: RoomState | null | undefined): "reveal" | "board" | "spin" | "pick" | null {
  if (!state || state.lobby || state.board) return null;
  const topics = state.topics;
  if (topics?.at === "picker" && topics.left && topics.chosen === null) return topics.how === "wheel" ? "spin" : "pick";
  if (!state.hasBoard) return null;
  const mode = boardModeOf(state);
  if (mode === "round") {
    // The last question of a round with points to win: its answer (when it has one), then the standings. The podium after
    // the last round (even one without points) or, with scored questions after the rounds, after the last of them.
    const inRound = topics?.at === "topic" && topics.topic !== null;
    const roundEnd = inRound && topics!.pos === topics!.size && (!!topics!.list[topics!.topic!]?.scored || !!state.boardFinal);
    if (!roundEnd && !(!inRound && state.quiz && state.boardFinal)) return null;
    return state.quiz && !state.revealed ? "reveal" : "board";
  }
  if (!state.quiz) return null;
  if (mode !== "each" && !(mode === "end" && state.boardFinal)) return null;
  return state.revealed ? "board" : "reveal";
}

// How the open leaderboard draws: the standings between questions, the podium at the end, or the plain list (older ones).
export function boardView(state: RoomState | null | undefined): "standings" | "podium" | "list" {
  const mode = boardModeOf(state);
  if (mode !== "each" && mode !== "round" && mode !== "end") return "list";
  return state?.boardFinal ? "podium" : "standings";
}

// Length of each animation: past it (or for a screen opened later), the leaderboard shows as it ends.
export const STANDINGS_MS = 2600;
export const PODIUM_MS = 7200;

// Milliseconds since the leaderboard opened, on the room's clock, when its animation is still playing; null otherwise.
export function boardElapsed(state: RoomState | null | undefined, length: number): number | null {
  if (!state?.boardAt) return null;
  const elapsed = state.now + (Date.now() - state.receivedAt) - state.boardAt;
  return elapsed >= 0 && elapsed < length ? elapsed : null;
}

// "4th", "4e", "4.º": a rank as people say it, in the six languages written by hand; the number alone elsewhere.
export function ordinal(n: number, lang: string): string {
  if (lang === "en") {
    const suffix: Record<string, string> = { one: "st", two: "nd", few: "rd", other: "th" };
    return `${n}${suffix[new Intl.PluralRules("en-US", { type: "ordinal" }).select(n)] ?? "th"}`;
  }
  if (lang === "fr") return n === 1 ? "1er" : `${n}e`;
  if (lang === "de") return `${n}.`;
  if (lang === "es" || lang === "pt") return `${n}.º`;
  if (lang === "it") return `${n}º`;
  return String(n);
}

// Whether the open leaderboard belongs to the presentation's own rhythm (each question, each round, the end):
// ← then closes it and goes back to the question it follows.
export const ownBoardOf = (state: RoomState | null | undefined) => {
  const mode = boardModeOf(state);
  return mode === "each" || mode === "round" || mode === "end";
};
