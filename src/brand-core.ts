// Branding shared by the server and the app: what a brand can hold and how it renders.

export type Bg =
  | { kind: "color"; value: string }
  | { kind: "gradient"; value: string; value2: string }
  // dim: strength of the dark veil over the image, from 0 to 0.85.
  | { kind: "image"; value: string; dim?: number };

export type FontId =
  | "figtree" | "inter" | "poppins" | "montserrat" | "dmsans" | "manrope"
  | "space" | "sora" | "outfit" | "playfair" | "lora" | "nunito" | "custom";
export type Size = "s" | "m" | "l";
export type Radius = "sharp" | "soft" | "round";

export type Brand = {
  logo?: string;
  logoSize?: Size;
  bg?: Bg;
  // Accent: buttons, the winning bar, highlights.
  color?: string;
  text?: string;
  // The other result bars.
  bar?: string;
  // The "To join" card with the QR code.
  card?: string;
  font?: FontId;
  headFont?: FontId;
  // An uploaded font file, used where "custom" is picked.
  fontFile?: string;
  fontName?: string;
  radius?: Radius;
  welcome?: string;
};

export const FONTS: Record<Exclude<FontId, "custom">, { label: string; family: string; query: string }> = {
  figtree: { label: "Figtree", family: '"Figtree", system-ui, sans-serif', query: "Figtree:wght@500;600;700;800;900" },
  inter: { label: "Inter", family: '"Inter", system-ui, sans-serif', query: "Inter:wght@500;600;700;800;900" },
  poppins: { label: "Poppins", family: '"Poppins", system-ui, sans-serif', query: "Poppins:wght@500;600;700;800" },
  montserrat: { label: "Montserrat", family: '"Montserrat", system-ui, sans-serif', query: "Montserrat:wght@500;600;700;800;900" },
  dmsans: { label: "DM Sans", family: '"DM Sans", system-ui, sans-serif', query: "DM+Sans:wght@500;600;700;800" },
  manrope: { label: "Manrope", family: '"Manrope", system-ui, sans-serif', query: "Manrope:wght@500;600;700;800" },
  space: { label: "Space Grotesk", family: '"Space Grotesk", system-ui, sans-serif', query: "Space+Grotesk:wght@500;600;700" },
  sora: { label: "Sora", family: '"Sora", system-ui, sans-serif', query: "Sora:wght@500;600;700;800" },
  outfit: { label: "Outfit", family: '"Outfit", system-ui, sans-serif', query: "Outfit:wght@500;600;700;800;900" },
  playfair: { label: "Playfair Display", family: '"Playfair Display", Georgia, serif', query: "Playfair+Display:wght@600;700;800;900" },
  lora: { label: "Lora", family: '"Lora", Georgia, serif', query: "Lora:wght@500;600;700" },
  nunito: { label: "Nunito", family: '"Nunito", system-ui, sans-serif', query: "Nunito:wght@600;700;800;900" },
};
export const FONT_IDS = Object.keys(FONTS) as Exclude<FontId, "custom">[];
export const CUSTOM_FAMILY = "Hopvote Brand Font";
// Served by the site itself from Google Fonts, so participants' phones never contact Google.
export const fontHref = (id: Exclude<FontId, "custom">) => `/fonts/css2?family=${FONTS[id].query}&display=swap`;
export const FONT_TYPES = ["font/woff2", "font/woff", "font/ttf", "font/otf"];

export const WELCOME_MAX = 80;
export const DEFAULT_DIM = 0.6;
export const LOGO_HEIGHT: Record<Size, number> = { s: 40, m: 64, l: 96 };
export const RADIUS: Record<Radius, { ui: string; bar: string; card: string }> = {
  sharp: { ui: "4px", bar: "3px", card: "6px" },
  soft: { ui: "14px", bar: "99px", card: "22px" },
  round: { ui: "26px", bar: "99px", card: "36px" },
};

const HEX = /^#[0-9a-f]{6}$/i;
const FILE = /^\/api\/images\/[a-f0-9]{32}$/;

const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

// Whether light text reads better over this color.
export const isDark = (hex: string) => luminance(hex) < 0.35;

// Whether text over the background must be light. Null when there is no background (Hopvote's default navy).
export function bgIsDark(bg?: Bg): boolean | null {
  if (!bg) return null;
  if (bg.kind === "image") return (bg.dim ?? DEFAULT_DIM) >= 0.3;
  if (bg.kind === "gradient") return (luminance(bg.value) + luminance(bg.value2)) / 2 < 0.35;
  return isDark(bg.value);
}

// The veil over a background image, so text reads on any photo: dark under light text, light under dark text.
// Dark: the "Darken" strength itself. Light (dark text, or a weak darkening): a cream veil that thins as the
// darkening grows (90% to 75%, 60% at least when a dark text color is forced), so dark text reads even over a dark photo.
export function imageVeil(bg: Bg & { kind: "image" }, dark: boolean | null = bgIsDark(bg)): { color: string; alpha: number } {
  const dim = bg.dim ?? DEFAULT_DIM;
  return dark === false ? { color: "#f6f4ef", alpha: Math.max(0.6, 0.9 - dim * 0.5) } : { color: "#0d1024", alpha: dim };
}

// `dark`: the text mode chosen for this brand (brandVars), when a text color decides it rather than the background.
export function bgCss(bg: Bg, origin = "", dark?: boolean | null) {
  if (bg.kind === "color") return bg.value;
  if (bg.kind === "gradient") return `linear-gradient(135deg, ${bg.value}, ${bg.value2})`;
  const { color, alpha } = imageVeil(bg, dark === undefined ? bgIsDark(bg) : dark);
  const veil = Math.round(alpha * 255).toString(16).padStart(2, "0");
  return `linear-gradient(${color}${veil}, ${color}${veil}), url("${origin}${bg.value}") center / cover`;
}

const fontFamily = (brand: Brand, id?: FontId) =>
  !id ? null : id === "custom" ? (brand.fontFile ? `"${CUSTOM_FAMILY}", system-ui, sans-serif` : null) : FONTS[id].family;

// The Google Fonts a brand needs, and the @font-face for an uploaded font.
export function fontLinks(brand: Brand) {
  return [...new Set([brand.font, brand.headFont])].filter((f): f is Exclude<FontId, "custom"> => !!f && f !== "custom" && f !== "figtree").map(fontHref);
}
export function fontFace(brand: Brand, origin = "") {
  if (!brand.fontFile || (brand.font !== "custom" && brand.headFont !== "custom")) return "";
  return `@font-face { font-family: "${CUSTOM_FAMILY}"; src: url("${origin}${brand.fontFile}"); font-display: swap; }`;
}

// Everything a branded screen needs as CSS custom properties. Same values on the big screen and phones.
export function brandVars(brand: Brand | null) {
  const vars: Record<string, string> = {};
  if (!brand) return { vars, dark: null as boolean | null };
  const dark = brand.text ? !isDark(brand.text) : bgIsDark(brand.bg);
  if (brand.color) {
    vars["--accent"] = brand.color;
    vars["--accent-ink"] = isDark(brand.color) ? "#ffffff" : "#151a3d";
  }
  const card = brand.card ?? "#ffffff";
  vars["--card-bg"] = card;
  vars["--card-ink"] = isDark(card) ? "#ffffff" : "#151a3d";
  // On the join card, a pale accent would vanish: fall back to the card's ink.
  vars["--accent-on-card"] = brand.color && isDark(brand.color) !== isDark(card) ? brand.color : vars["--card-ink"];
  if (brand.text) {
    vars["--text"] = brand.text;
    vars["--muted"] = `color-mix(in srgb, ${brand.text} 68%, transparent)`;
  }
  if (brand.bg || brand.text) {
    const ink = brand.text ?? (dark ? "#ffffff" : "#151a3d");
    vars["--bar"] = `color-mix(in srgb, ${ink} 15%, transparent)`;
    vars["--line"] = `color-mix(in srgb, ${ink} 16%, transparent)`;
    vars["--surface"] = `color-mix(in srgb, ${ink} 8%, transparent)`;
  }
  if (brand.bar) vars["--bar-fill"] = brand.bar;
  const body = fontFamily(brand, brand.font);
  const head = fontFamily(brand, brand.headFont) ?? body;
  if (body) vars["--font-body"] = body;
  if (head) vars["--font-head"] = head;
  const r = RADIUS[brand.radius ?? "soft"];
  vars["--r-ui"] = r.ui;
  vars["--r-bar"] = r.bar;
  vars["--r-card"] = r.card;
  vars["--logo-h"] = `${LOGO_HEIGHT[brand.logoSize ?? "m"]}px`;
  return { vars, dark };
}

// Keeps only well-formed values; an empty brand is stored as nothing.
export function cleanBrand(raw: unknown): Brand | null {
  const r = (raw ?? {}) as Record<string, unknown>;
  const brand: Brand = {};
  const hex = (v: unknown) => (typeof v === "string" && HEX.test(v) ? v.toLowerCase() : null);
  const file = (v: unknown) => (typeof v === "string" && FILE.test(v) ? v : null);
  const pick = <T extends string>(v: unknown, allowed: readonly T[]) => (allowed.includes(v as T) ? (v as T) : null);
  const fonts = [...FONT_IDS, "custom"] as const;

  const logo = file(r.logo);
  if (logo) brand.logo = logo;
  const logoSize = pick(r.logoSize, ["s", "m", "l"] as const);
  if (logoSize) brand.logoSize = logoSize;
  for (const key of ["color", "text", "bar", "card"] as const) {
    const v = hex(r[key]);
    if (v) brand[key] = v;
  }
  const bg = (r.bg ?? {}) as Record<string, unknown>;
  const v1 = hex(bg.value);
  const v2 = hex(bg.value2);
  if (bg.kind === "color" && v1) brand.bg = { kind: "color", value: v1 };
  if (bg.kind === "gradient" && v1 && v2) brand.bg = { kind: "gradient", value: v1, value2: v2 };
  const image = file(bg.value);
  if (bg.kind === "image" && image) {
    const dim = Number(bg.dim);
    brand.bg = { kind: "image", value: image, dim: Number.isFinite(dim) ? Math.min(0.85, Math.max(0, dim)) : DEFAULT_DIM };
  }
  const font = pick(r.font, fonts);
  const headFont = pick(r.headFont, fonts);
  if (font) brand.font = font;
  if (headFont) brand.headFont = headFont;
  const fontFile = file(r.fontFile);
  if (fontFile) {
    brand.fontFile = fontFile;
    brand.fontName = String(r.fontName ?? "Your font").replace(/[^\p{L}\p{N} ._-]/gu, "").trim().slice(0, 40) || "Your font";
  }
  const radius = pick(r.radius, ["sharp", "soft", "round"] as const);
  if (radius) brand.radius = radius;
  const welcome = String(r.welcome ?? "").trim().replace(/\s+/g, " ").slice(0, WELCOME_MAX);
  if (welcome) brand.welcome = welcome;
  return Object.keys(brand).length ? brand : null;
}
