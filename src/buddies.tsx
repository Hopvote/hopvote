// Hopvote buddies: the little characters people pick on the waiting screen. Drawn here, so they are ours.
// Each one is a soft body with a face, an accessory and the Hopvote check on its belly.
import { AVATARS } from "./avatars";

const COLORS = ["#ff5436", "#3b5bdb", "#12a37a", "#8b46d6", "#f59f00", "#e2457a", "#0ea5b7", "#151a3d"];
const ACCESSORIES = ["none", "cap", "glasses", "headphones", "bow", "antenna", "crown", "sprout", "beanie", "party", "bun", "shades"] as const;
type Accessory = (typeof ACCESSORIES)[number];

const INK = "#151a3d";

// Old rooms stored emojis: any unknown value still maps to a stable buddy.
export function buddyIndex(id: string | undefined) {
  const i = AVATARS.indexOf(id ?? "");
  if (i >= 0) return i;
  let h = 0;
  for (const c of id ?? "") h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % AVATARS.length;
}

// 24 buddies: every accessory twice, each time on a different color and face.
function look(i: number) {
  const color = COLORS[(i * 3 + Math.floor(i / 12)) % COLORS.length];
  return {
    color,
    accessory: ACCESSORIES[i % ACCESSORIES.length] as Accessory,
    eyes: (i * 7 + 1) % 3,
    mouth: (i * 5 + Math.floor(i / 12)) % 4,
    cheeks: (i + Math.floor(i / 3)) % 2 === 0,
    face: color === INK ? "#ffffff" : INK,
  };
}

function Accessory({ kind, color }: { kind: Accessory; color: string }) {
  const onDark = color === INK;
  switch (kind) {
    case "cap":
      return (
        <g>
          <path d="M14 22c0-9 8-14 18-14s18 5 18 14z" fill={INK} />
          <path d="M30 21h26c0 3-3 4-6 4H30z" fill={INK} />
        </g>
      );
    case "glasses":
      return (
        <g fill="none" stroke={onDark ? "#fff" : INK} strokeWidth="2.6">
          <circle cx="24" cy="34" r="6.5" />
          <circle cx="40" cy="34" r="6.5" />
          <path d="M30.5 34h3" />
        </g>
      );
    case "headphones":
      return (
        <g>
          <path d="M11 34c0-14 9-24 21-24s21 10 21 24" fill="none" stroke={INK} strokeWidth="3.4" strokeLinecap="round" />
          <rect x="6" y="29" width="8" height="14" rx="4" fill={INK} />
          <rect x="50" y="29" width="8" height="14" rx="4" fill={INK} />
        </g>
      );
    case "bow":
      return (
        <g fill="#ff8fa3" stroke={INK} strokeWidth="1.6" strokeLinejoin="round">
          <path d="M42 12l-8-5v10z" />
          <path d="M42 12l8-5v10z" />
          <circle cx="42" cy="12" r="2.6" fill={INK} />
        </g>
      );
    case "antenna":
      return (
        <g>
          <path d="M32 14V5" stroke={INK} strokeWidth="2.6" strokeLinecap="round" />
          <circle cx="32" cy="5" r="3.6" fill="#ffc53d" stroke={INK} strokeWidth="1.6" />
        </g>
      );
    case "crown":
      return <path d="M20 16l3-10 5 6 4-8 4 8 5-6 3 10z" fill="#ffc53d" stroke={INK} strokeWidth="1.6" strokeLinejoin="round" />;
    case "sprout":
      return (
        <g>
          <path d="M32 15V7" stroke="#12a37a" strokeWidth="2.6" strokeLinecap="round" />
          <path d="M32 9c-6 0-9-3-9-6 5 0 9 2 9 6z" fill="#3ccf91" />
          <path d="M32 8c5 0 8-3 8-6-4 0-8 2-8 6z" fill="#3ccf91" />
        </g>
      );
    case "beanie":
      return (
        <g>
          <path d="M12 24c0-11 9-17 20-17s20 6 20 17z" fill="#ffc53d" />
          <rect x="11" y="21" width="42" height="6" rx="3" fill="#f59f00" />
          <circle cx="32" cy="6" r="4" fill="#fff" stroke={INK} strokeWidth="1.4" />
        </g>
      );
    case "party":
      return (
        <g>
          <path d="M24 16L32 0l8 16z" fill="#8b46d6" stroke={INK} strokeWidth="1.4" strokeLinejoin="round" />
          <path d="M27 10h10M29.5 5h5" stroke="#ffc53d" strokeWidth="2.2" />
        </g>
      );
    case "bun":
      return <circle cx="32" cy="10" r="7" fill={color} stroke={INK} strokeOpacity=".18" strokeWidth="2" />;
    case "shades":
      return (
        <g fill={onDark ? "#ff5436" : INK}>
          <rect x="15" y="29" width="15" height="9" rx="4" />
          <rect x="34" y="29" width="15" height="9" rx="4" />
          <path d="M30 32h4" stroke={onDark ? "#ff5436" : INK} strokeWidth="2" />
        </g>
      );
    default:
      return null;
  }
}

export function Buddy({ id, size = 40, className = "" }: { id?: string; size?: number; className?: string }) {
  const i = buddyIndex(id);
  const b = look(i);
  const hidesEyes = b.accessory === "shades";
  return (
    <svg className={`buddy ${className}`} width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <ellipse cx="32" cy="60" rx="18" ry="3" fill="#000" opacity=".12" />
      {b.accessory === "bun" && <Accessory kind="bun" color={b.color} />}
      <rect x="8" y="14" width="48" height="44" rx="19" fill={b.color} />
      <rect x="8" y="14" width="48" height="44" rx="19" fill="url(#buddy-shine)" opacity=".25" />
      <defs>
        <linearGradient id="buddy-shine" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" />
          <stop offset=".6" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      {b.cheeks && (
        <g fill="#ff8fa3" opacity=".55">
          <circle cx="17" cy="42" r="3.4" />
          <circle cx="47" cy="42" r="3.4" />
        </g>
      )}
      {!hidesEyes &&
        (b.eyes === 0 ? (
          <g fill={b.face}>
            <circle cx="24" cy="34" r="3.4" />
            <circle cx="40" cy="34" r="3.4" />
          </g>
        ) : b.eyes === 1 ? (
          <g fill="none" stroke={b.face} strokeWidth="2.8" strokeLinecap="round">
            <path d="M20 35q4-5 8 0" />
            <path d="M36 35q4-5 8 0" />
          </g>
        ) : (
          <g>
            <circle cx="24" cy="33" r="5.6" fill="#fff" />
            <circle cx="40" cy="33" r="5.6" fill="#fff" />
            <circle cx="25" cy="34" r="2.8" fill={INK} />
            <circle cx="41" cy="34" r="2.8" fill={INK} />
          </g>
        ))}
      {b.mouth === 0 ? (
        <path d="M26 43q6 6 12 0" fill="none" stroke={b.face} strokeWidth="2.8" strokeLinecap="round" />
      ) : b.mouth === 1 ? (
        <path d="M25 42h14q0 8-7 8t-7-8z" fill={b.face} />
      ) : b.mouth === 2 ? (
        <circle cx="32" cy="45" r="2.8" fill={b.face} />
      ) : (
        <path d="M24 43q8 7 16 0" fill="none" stroke={b.face} strokeWidth="2.8" strokeLinecap="round" />
      )}
      <path d="M44 51l2.6 2.6 5-5.6" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" opacity=".9" />
      {b.accessory !== "bun" && <Accessory kind={b.accessory} color={b.color} />}
    </svg>
  );
}
