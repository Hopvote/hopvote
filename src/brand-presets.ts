// Example brands for the checks and the reviews: /preview/screen/<kind>?brand=light,wideLogo (src/pages/PreviewPage.tsx)
// and scripts/brand-check.mjs. Code constants only: never stored, never sent to the server, never shown to users.
// Several names joined by commas merge from left to right, so one option can be tried over another background.
import type { Brand } from "./brand-core";

const WELCOME = "Welcome to the 2026 annual conference of the regional sales and partnership teams";

export const BRAND_PRESETS: Record<string, Brand> = {
  // Backgrounds
  light: { bg: { kind: "color", value: "#ffffff" }, color: "#2563eb" },
  dark: { bg: { kind: "color", value: "#0d3b36" }, color: "#f2b84b" },
  gradient: { bg: { kind: "gradient", value: "#1e3a8a", value2: "#0f766e" }, color: "#fbbf24" },
  pastel: { bg: { kind: "gradient", value: "#fdf2e9", value2: "#e8f0fe" }, color: "#e2457a" },
  image: { bg: { kind: "image", value: "/photos/conference.webp", dim: 0.6 } },
  imageLight: { bg: { kind: "image", value: "/photos/conference.webp", dim: 0.2 } },
  // Text color alone, over Hopvote's own background
  navyText: { text: "#151a3d" },
  whiteText: { text: "#ffffff" },
  // Logos
  wideLogo: { logo: "/logos/demo-brand.svg", logoSize: "l" },
  logo: { logo: "/logos/demo-brand.svg", logoSize: "m" },
  smallLogo: { logo: "/logos/demo-brand.svg", logoSize: "s" },
  // Fonts: a wide one and a serif one
  wideFont: { font: "montserrat", headFont: "montserrat" },
  serif: { font: "lora", headFont: "playfair" },
  // Corners, colors, the join card, the welcome message
  sharp: { radius: "sharp" },
  round: { radius: "round" },
  bars: { bar: "#ff8a00" },
  darkCard: { card: "#151a3d" },
  welcome: { welcome: WELCOME },
  // An example brand, for the checks and the previews.
  northwind: {
    logo: "/logos/demo-brand.svg",
    bg: { kind: "gradient", value: "#0d3b36", value2: "#15564e" },
    color: "#f2b84b",
    text: "#f6f1e7",
    bar: "#f6f1e7",
    card: "#f6f1e7",
    font: "dmsans",
    headFont: "playfair",
  },
};

// "light,wideLogo,serif" -> one brand; unknown names are skipped. Null when nothing is left.
export function presetBrand(names: string | null | undefined): Brand | null {
  if (!names) return null;
  const brand: Brand = {};
  for (const name of names.split(",")) Object.assign(brand, BRAND_PRESETS[name.trim()] ?? {});
  return Object.keys(brand).length ? brand : null;
}
