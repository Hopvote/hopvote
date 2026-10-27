// Seasonal decors a presentation can pick: the normal one (no field stored) or Halloween.
// Shared by the server (worker/index.ts checks and stores it, worker/room.ts sends it to the screens) and the app
// (the builders offer it, src/pages/Present.tsx (the waiting screen included) and Vote.tsx draw it with
// src/halloween-decor.tsx).
import type { Brand } from "./brand-core";

export type Decor = "halloween";
export const DECORS: readonly Decor[] = ["halloween"];

// The Halloween decor ends once 31 October 2026 is over in every time zone ("until October 31" holds everywhere, the
// evening parties in the Americas included): 2026-11-01 12:00 UTC, the end of the 31st at UTC-12 (13:00 in Paris).
// Before it, the builders offer the choice and the screens draw the decor. From then on the builders no longer show
// the choice and every presentation shows the normal decor, without a new deploy (the saved field simply stays unused).
export const HALLOWEEN_END = Date.UTC(2026, 10, 1, 12, 0, 0);

// Whether the builders still offer a decor.
export const decorOffered = (decor: Decor, now = Date.now()) => decor === "halloween" && now < HALLOWEEN_END;

// The decor a screen draws: the stored one while it is still on offer, else the normal one (null).
export const shownDecor = (decor: unknown, now = Date.now()): Decor | null => (decor === "halloween" && decorOffered(decor, now) ? decor : null);

// A builder's value: "halloween", or null for the normal decor; anything else is dropped (undefined: the stored one stays).
export function parseDecor(raw: unknown): Decor | null | undefined {
  if (raw === "halloween") return "halloween";
  if (raw === null || raw === "" || raw === "normal") return null;
  return undefined;
}

// The Halloween night as a brand: deep navy to purple-black, cream text, pumpkin orange accents (AA on the ground and
// on the white join card, see src/halloween-decor.css). The scene itself (moon, stars, bats, pumpkins) is drawn on top.
const HALLOWEEN_LOOK: Brand = {
  bg: { kind: "gradient", value: "#1b1442", value2: "#0b0920" },
  color: "#ff8a3d",
  text: "#f6eedb",
  bar: "#c9c3e6",
  card: "#ffffff",
};

// The brand the screens use with a decor: the brand keeps its logo, fonts, corners and welcome line, the decor
// sets the background and the colors. Without a decor, the brand as it is.
export function decorBrand(brand: Brand | null, decor: Decor | null): Brand | null {
  if (decor !== "halloween") return brand;
  const { logo, logoSize, font, headFont, fontFile, fontName, radius, welcome } = brand ?? {};
  const kept = Object.fromEntries(Object.entries({ logo, logoSize, font, headFont, fontFile, fontName, radius, welcome }).filter(([, v]) => v !== undefined));
  return { ...kept, ...HALLOWEEN_LOOK };
}
