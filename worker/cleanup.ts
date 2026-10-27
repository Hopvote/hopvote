// Once a day: removes what has expired (sessions, links, old counters) so the database stays small and fast.
import type { Env } from "./index";

const DAY = 86_400_000;

export async function dailyCleanup(env: Env) {
  const now = Date.now();
  const oldDay = new Date(now - 30 * DAY).toISOString().slice(0, 10);
  const results = await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(now),
    env.DB.prepare("DELETE FROM pending_signups WHERE expires_at < ?").bind(now),
    env.DB.prepare("DELETE FROM reset_tokens WHERE expires_at < ?").bind(now),
    env.DB.prepare("DELETE FROM ai_usage WHERE day < ?").bind(oldDay),
    env.DB.prepare("DELETE FROM ai_budget WHERE day < ?").bind(oldDay),
    env.DB.prepare("DELETE FROM ops_daily WHERE day < ?").bind(oldDay),
  ]);
  const images = await removeUnusedImages(env, 7 * DAY);
  console.log(`[cleanup] removed ${results.reduce((n, r) => n + (r.meta.changes ?? 0), 0)} rows and ${images} unused images`);
}

// Uploads nothing points to any more: removed or replaced in the editor, or their presentation deleted.
// Every reference counts, whoever owns it: a presentation made from a shared template shows its author's images.
// Recent uploads stay, as they may belong to a presentation still being written.
export async function removeUnusedImages(env: Env, olderThan: number, userId?: string) {
  const before = Date.now() - olderThan;
  const { results: candidates } = await (userId
    ? env.DB.prepare("SELECT id FROM images WHERE user_id = ? AND created_at < ?").bind(userId, before)
    : env.DB.prepare("SELECT id FROM images WHERE created_at < ?").bind(before)
  ).all<{ id: string }>();
  if (!candidates.length) return 0;
  const used = new Set<string>();
  for (const sql of [
    "SELECT questions AS t FROM polls WHERE questions LIKE '%/api/images/%'",
    "SELECT brand AS t FROM polls WHERE brand LIKE '%/api/images/%'",
    "SELECT questions AS t FROM shared_templates WHERE questions LIKE '%/api/images/%'",
    "SELECT brand AS t FROM brand_kits WHERE brand LIKE '%/api/images/%'",
    "SELECT brand AS t FROM users WHERE brand LIKE '%/api/images/%'",
  ]) {
    const { results } = await env.DB.prepare(sql).all<{ t: string | null }>();
    for (const row of results) for (const m of (row.t ?? "").matchAll(/\/api\/images\/([a-f0-9]{32})/g)) used.add(m[1]);
  }
  const unused = candidates.map((c) => c.id).filter((id) => !used.has(id));
  for (let i = 0; i < unused.length; i += 50) {
    const ids = unused.slice(i, i + 50);
    await env.DB.prepare(`DELETE FROM images WHERE id IN (${ids.map(() => "?").join(", ")})`).bind(...ids).run();
  }
  return unused.length;
}
