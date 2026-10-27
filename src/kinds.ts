// Limits and small rules of the newer kinds of questions, shared by the builder, the phones and the room.

// Prioritize: each person shares 100 points between the items, ten at a time on the phone.
export const POINTS = 100;
export const POINTS_STEP = 10;

// Match pairs: from 2 to 6 pairs, stored as the left items then the right items, in matching order.
export const MAX_PAIRS = 6;

// Find on the image: a spot is x and y from 0 to 1000 across the image, and the right zone a rectangle [x, y, width, height].
export const SPOT_SCALE = 1000;
export const MIN_ZONE = 20;
export type Zone = [number, number, number, number];
export const inZone = (x: number, y: number, z: Zone) => x >= z[0] && x <= z[0] + z[2] && y >= z[1] && y <= z[1] + z[3];

// Timer: from 10 seconds to an hour, 5 minutes unless set.
export const COUNTDOWN_MIN = 10;
export const COUNTDOWN_MAX = 3600;
export const COUNTDOWN_DEFAULT = 300;
// A running timer ends at `end` (server time); a paused one keeps `left` milliseconds. `total` is its full length.
export type Clock = { run: boolean; end: number; left: number; total: number };
export const clockLeft = (c: Clock, serverNow: number) => (c.run ? Math.max(0, c.end - serverNow) : c.left);
