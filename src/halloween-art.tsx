// Halloween drawings, flat SVG in one style: rounded shapes, pumpkin oranges, olive stems, navy, cream highlights.
// Used by the Halloween decor (src/halloween-decor.tsx) and meant for any other one: import the
// pieces and place them (position and size come from the caller's CSS). Styles and the soft animations (candle light,
// twinkling sparkles, only without reduced motion): src/halloween-art.css. Everything is decoration: aria-hidden.
import { useId, type CSSProperties } from "react";
import "./halloween-art.css";

const sid = (id: string) => id.replace(/[^a-zA-Z0-9]/g, "");

export type PumpkinShape = "round" | "wide" | "tall" | "squat";
const SHAPES: Record<PumpkinShape, [number, number]> = { round: [40, 30], wide: [46, 26], tall: [32, 34], squat: [42, 21] };

// A pumpkin on its own soft shadow, all bottoms on the same line so a row sits on one floor. `face` carves two eyes
// and the Hopvote check as a smile; `lit` fills the carving with candle light and a warm glow around it.
export function Pumpkin({ shape = "round", face = false, lit = false, className = "", style }: { shape?: PumpkinShape; face?: boolean; lit?: boolean; className?: string; style?: CSSProperties }) {
  const uid = sid(useId());
  const [w, h] = SHAPES[shape];
  const cx = 50;
  const cy = 86 - h;
  const top = cy - h * 1.02;
  const rib = (dx: number, bulge: number) => `M${cx + dx} ${cy - h * 0.82} Q${cx + dx + bulge} ${cy} ${cx + dx} ${cy + h * 0.82}`;
  const eye = (x: number) => `M${x - 5.6} ${cy - 3} L${x + 5.6} ${cy - 3} L${x + 0.6} ${cy - 12.5} Z`;
  const check = `M${cx - 13} ${cy + 5} L${cx - 5} ${cy + 13} L${cx + 14} ${cy - 1.5}`;
  return (
    <svg className={`hw-pumpkin${lit ? " is-lit" : ""} ${className}`} style={style} viewBox="0 0 100 92" aria-hidden focusable="false">
      {lit && (
        <defs>
          <radialGradient id={`${uid}h`}>
            <stop offset="0" stopColor="#ffb06b" stopOpacity=".55" />
            <stop offset="1" stopColor="#ff8a5c" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={`${uid}f`} cx=".5" cy=".45" r=".6">
            <stop offset="0" stopColor="#fff8dc" />
            <stop offset="1" stopColor="#ffc46a" />
          </radialGradient>
        </defs>
      )}
      {lit && <ellipse className="hw-halo" cx={cx} cy={cy} rx={w * 1.7} ry={h * 1.6} fill={`url(#${uid}h)`} />}
      <ellipse className="hw-ground" cx={cx} cy={87.5} rx={w * 0.98} ry={3} />
      <g className="hw-body">
        <ellipse cx={cx - w * 0.47} cy={cy} rx={w * 0.55} ry={h * 0.95} />
        <ellipse cx={cx + w * 0.47} cy={cy} rx={w * 0.55} ry={h * 0.95} />
        <ellipse cx={cx - w * 0.18} cy={cy} rx={w * 0.46} ry={h} />
        <ellipse cx={cx + w * 0.18} cy={cy} rx={w * 0.46} ry={h} />
      </g>
      <ellipse className="hw-shine" cx={cx - w * 0.06} cy={cy + h * 0.04} rx={w * 0.2} ry={h * 0.88} />
      <g className="hw-ribs" fill="none" strokeWidth={2.4} strokeLinecap="round">
        <path d={rib(-w * 0.3, -w * 0.12)} />
        <path d={rib(w * 0.3, w * 0.12)} />
        <path d={rib(-w * 0.72, -w * 0.1)} opacity={0.65} />
        <path d={rib(w * 0.72, w * 0.1)} opacity={0.65} />
      </g>
      <path className="hw-gloss" d={`M${cx - w * 0.82} ${cy - h * 0.25} Q${cx - w * 0.8} ${cy - h * 0.62} ${cx - w * 0.56} ${cy - h * 0.78}`} fill="none" strokeWidth={2.6} strokeLinecap="round" />
      <path className="hw-stem" d={`M${cx - 3.5} ${top + 5} C${cx - 4} ${top - 3} ${cx - 1} ${top - 9} ${cx + 5} ${top - 12} L${cx + 7.5} ${top - 8.5} C${cx + 3} ${top - 6} ${cx + 3} ${top - 1} ${cx + 3.5} ${top + 5} Z`} strokeLinejoin="round" strokeWidth={2.2} />
      {face && (
        <g className="hw-face" fill={lit ? `url(#${uid}f)` : undefined} stroke={lit ? "#ffd98a" : undefined}>
          <path d={eye(cx - 10)} strokeWidth={2.4} strokeLinejoin="round" />
          <path d={eye(cx + 10)} strokeWidth={2.4} strokeLinejoin="round" />
          <path d={check} fill="none" strokeWidth={6.2} strokeLinecap="round" strokeLinejoin="round" />
        </g>
      )}
    </svg>
  );
}

// A bat seen from the front, wings open: pointed ears, scalloped wings, lighter navy with a thin cream edge.
export const BAT_PATH =
  "M50 14 Q52 13.6 53.6 13.2 L55.6 6.5 L57.2 15 Q57.8 16.4 57.4 17.6 C66 9 82 5 97 10 Q91 15 89 26 Q84 20.5 77.5 28.5 Q72 23.5 65.5 32 Q61 28 56.6 30.6 C55.6 36 53 39.5 50 40.5 C47 39.5 44.4 36 43.4 30.6 Q39 28 34.5 32 Q28 23.5 22.5 28.5 Q16 20.5 11 26 Q9 15 3 10 C18 5 34 9 42.6 17.6 Q42.2 16.4 42.8 15 L44.4 6.5 L46.4 13.2 Q48 13.6 50 14 Z";
export function Bat({ className = "", style }: { className?: string; style?: CSSProperties }) {
  return (
    <svg className={`hw-bat ${className}`} style={style} viewBox="0 3 100 40" aria-hidden focusable="false">
      <path className="hw-bat-wing" d={BAT_PATH} vectorEffect="non-scaling-stroke" />
      <path className="hw-bat-bones" d="M57.5 18 L89 26 M58 19 L77.5 28.5 M57 21 L65.5 32 M42.5 18 L11 26 M42 19 L22.5 28.5 M43 21 L34.5 32" fill="none" vectorEffect="non-scaling-stroke" />
      <circle className="hw-bat-eye" cx="47.6" cy="18.2" r="1.1" />
      <circle className="hw-bat-eye" cx="52.4" cy="18.2" r="1.1" />
    </svg>
  );
}

// The full moon: a cream disc, three faint craters, a wide soft glow (its strength: CSS --hw-halo, .2 by default).
export function Moon({ className = "", style }: { className?: string; style?: CSSProperties }) {
  const id = sid(useId());
  return (
    <svg className={`hw-moon ${className}`} style={style} viewBox="0 0 100 100" aria-hidden focusable="false">
      <defs>
        <radialGradient id={id}>
          <stop offset=".3" stopColor="#f6eedb" stopOpacity="var(--hw-halo, .2)" />
          <stop offset=".55" stopColor="#f6eedb" stopOpacity="calc(var(--hw-halo, .2) * .4)" />
          <stop offset="1" stopColor="#f6eedb" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r="50" fill={`url(#${id})`} />
      <circle cx="50" cy="50" r="21" fill="#f6eedb" />
      <circle cx="56.5" cy="55" r="4.2" fill="#e9dec3" />
      <circle cx="43" cy="43.5" r="2.8" fill="#e9dec3" />
      <circle cx="58" cy="41.5" r="1.9" fill="#e9dec3" />
    </svg>
  );
}

// A four-pointed sparkle, for the brightest stars (it twinkles; give each one its own animation-delay).
export function Sparkle({ style, className = "" }: { style?: CSSProperties; className?: string }) {
  return (
    <svg className={`hw-sparkle ${className}`} style={style} viewBox="-10 -10 20 20" aria-hidden focusable="false">
      <path d="M0 -10 Q1.3 -1.3 10 0 Q1.3 1.3 0 10 Q-1.3 1.3 -10 0 Q-1.3 -1.3 0 -10 Z" />
    </svg>
  );
}

// A field of small stars filling its positioned parent (repeating tiles, no element per star).
export function Stars({ className = "" }: { className?: string }) {
  return <div className={`hw-stars ${className}`} aria-hidden />;
}

// A cobweb in a corner: spokes from the corner and threads sagging between them, drawn as fine lines in currentColor.
// The corner is the top left; turn it with CSS (scale: -1 1 for the top right). `spider` hangs a small spider from it.
export function Cobweb({ className = "", spider = false }: { className?: string; spider?: boolean }) {
  const angles = [0, 16, 33, 51, 69, 90].map((a) => (a * Math.PI) / 180);
  const rings = [18, 35, 53, 72, 92];
  const jitter = [1, 0.96, 1.03, 0.98, 1.02, 1];
  const at = (a: number, r: number) => `${(Math.cos(a) * r).toFixed(1)} ${(Math.sin(a) * r).toFixed(1)}`;
  let d = angles.map((a) => `M0 0 L${at(a, 100)}`).join(" ");
  for (const r of rings) {
    for (let i = 0; i < angles.length - 1; i++) {
      const r1 = r * jitter[i];
      const r2 = r * jitter[i + 1];
      const mid = (angles[i] + angles[i + 1]) / 2;
      d += ` M${at(angles[i], r1)} Q${at(mid, ((r1 + r2) / 2) * 0.8)} ${at(angles[i + 1], r2)}`;
    }
  }
  return (
    <svg className={`hw-web ${className}`} viewBox="0 0 100 100" aria-hidden focusable="false">
      <path d={d} fill="none" vectorEffect="non-scaling-stroke" />
      {spider && (
        <g className="hw-web-spider">
          <path d="M60 41 V70" fill="none" vectorEffect="non-scaling-stroke" />
          <g transform="translate(60 74)">
            <path d="M-2 -1 L-6 -4 L-8 -1 M-2 1 L-7 1 L-9 4 M-1.6 2.6 L-5 6 L-5.4 8.6 M2 -1 L6 -4 L8 -1 M2 1 L7 1 L9 4 M1.6 2.6 L5 6 L5.4 8.6" fill="none" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            <ellipse cx="0" cy="1.4" rx="3" ry="3.6" />
            <circle cx="0" cy="-3" r="2" />
          </g>
        </g>
      )}
    </svg>
  );
}

// A friendly ghost on its own shadow (the body is .hw-ghost-body, to float it).
export function Ghost({ className = "", style }: { className?: string; style?: CSSProperties }) {
  return (
    <svg className={`hw-ghost ${className}`} style={style} viewBox="0 0 100 118" aria-hidden focusable="false">
      <ellipse className="hw-ghost-shadow" cx="50" cy="114" rx="24" ry="3.4" />
      <g className="hw-ghost-body">
        <path d="M18 94 V48 C18 22 33 8 50 8 C67 8 82 22 82 48 V94 Q77 86 71.5 94 Q66 102 60.5 94 Q55 86 50 94 Q45 102 39.5 94 Q34 86 28.5 94 Q23 102 18 94 Z" fill="#f6eedb" />
        <path d="M19 58 C10 60 7 68 9 74 C13 70 16 69 19 70 Z M81 58 C90 58 94 64 93 70 C89 67 85 67 81 69 Z" fill="#f6eedb" />
        <path d="M70 18 C76 24 79 34 79 46" fill="none" stroke="#e3d9bf" strokeWidth="3" strokeLinecap="round" />
        <ellipse cx="40" cy="44" rx="4.6" ry="6.4" fill="#151a3d" />
        <ellipse cx="60" cy="44" rx="4.6" ry="6.4" fill="#151a3d" />
        <circle cx="41.4" cy="41.6" r="1.4" fill="#f6eedb" />
        <circle cx="61.4" cy="41.6" r="1.4" fill="#f6eedb" />
        <path d="M44 58 Q50 64 56 58" fill="none" stroke="#151a3d" strokeWidth="3" strokeLinecap="round" />
        <circle cx="32" cy="55" r="4" fill="#ff8a5c" opacity=".55" />
        <circle cx="68" cy="55" r="4" fill="#ff8a5c" opacity=".55" />
      </g>
    </svg>
  );
}
