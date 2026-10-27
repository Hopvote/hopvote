// Branding on the server: stored per presentation, shown on its screens and phones.
import type { Env } from "./index";
import { cleanBrand, type Brand } from "../src/brand-core";

export { bgCss, brandVars, cleanBrand, fontFace, fontLinks, FONT_TYPES, isDark, type Brand } from "../src/brand-core";
const MAX_KITS = 20;

export function parseBrand(json: string | null | undefined): Brand | null {
  if (!json) return null;
  try {
    return cleanBrand(JSON.parse(json));
  } catch {
    return null;
  }
}

// The brand a presentation shows: every account can brand its presentations.
export async function brandFor(env: Env, code: string) {
  const row = await env.DB.prepare("SELECT brand FROM polls WHERE code = ?").bind(code).first<{ brand: string | null }>();
  return parseBrand(row?.brand);
}

// Brand kits: named looks an owner saves once and applies to any presentation.
export async function listKits(env: Env, userId: string) {
  const { results } = await env.DB.prepare("SELECT id, name, brand FROM brand_kits WHERE user_id = ? ORDER BY created_at DESC")
    .bind(userId)
    .all<{ id: string; name: string; brand: string }>();
  return results.map((k) => ({ id: k.id, name: k.name, brand: parseBrand(k.brand) ?? {} }));
}

export async function saveKit(env: Env, userId: string, body: { name?: unknown; brand?: unknown }) {
  const name = String(body.name ?? "").trim().slice(0, 40);
  const brand = cleanBrand(body.brand);
  if (!name) return { error: "Give the kit a name" };
  if (!brand) return { error: "This brand is empty" };
  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM brand_kits WHERE user_id = ?").bind(userId).first<{ n: number }>();
  if ((count?.n ?? 0) >= MAX_KITS) return { error: `Up to ${MAX_KITS} brand kits` };
  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  await env.DB.prepare("INSERT INTO brand_kits (id, user_id, name, brand, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(id, userId, name, JSON.stringify(brand), Date.now())
    .run();
  return { kit: { id, name, brand } };
}

export async function deleteKit(env: Env, userId: string, id: string) {
  await env.DB.prepare("DELETE FROM brand_kits WHERE id = ? AND user_id = ?").bind(id, userId).run();
}
