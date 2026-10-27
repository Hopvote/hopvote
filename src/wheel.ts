// The wheel: the room picks a winner and where the wheel stops; every screen and phone plays the same spin from it.
// Shared by the room and the pages that draw the wheel.
export const SPIN_MS = 6000;
// Entries drawn on one wheel: more would be slivers nobody can read.
export const WHEEL_SIZE = 60;
export const MAX_ENTRIES = 50;
export const ENTRY_LENGTH = 60;

export type Spin = { at: number; from: number; to: number; win: number; n: number; tag: string };

// Where the wheel rests so that entry `win` of `size` sits under the pointer at the top, `turns` full turns after `from`.
// `jitter` (from -0.5 to 0.5) keeps it from always stopping on the middle of the slice.
export function spinTarget(from: number, win: number, size: number, turns: number, jitter: number) {
  const slice = 360 / size;
  const rest = (((360 - (win + 0.5 + jitter * 0.7) * slice) % 360) + 360) % 360;
  return Math.ceil(from / 360) * 360 + turns * 360 + rest;
}

// The wheel's angle `elapsed` ms into a spin: fast at first, then slowing down onto the winner.
export function wheelAngle(spin: Pick<Spin, "from" | "to">, elapsed: number) {
  const p = Math.min(1, Math.max(0, elapsed / SPIN_MS));
  return spin.from + (spin.to - spin.from) * (1 - Math.pow(1 - p, 4));
}

// A short mark for a participant, so a phone knows it won without the room sending anyone's id.
export function tagOf(voter: string) {
  let h = 2166136261;
  for (const c of voter) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return (h >>> 0).toString(36);
}
