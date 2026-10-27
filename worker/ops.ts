// Daily counters: emails sent, and the caps on sign-in attempts, emails and template uses.
type OpsEnv = { DB: D1Database };

export const today = () => new Date().toISOString().slice(0, 10);

// Adds one to a counter of the day and returns the new value. Never throws: counting must not break a request.
export async function bump(env: OpsEnv, key: string, day = today()): Promise<number> {
  try {
    const row = await env.DB.prepare("INSERT INTO ops_daily (day, key, n) VALUES (?, ?, 1) ON CONFLICT(day, key) DO UPDATE SET n = n + 1 RETURNING n")
      .bind(day, key)
      .first<{ n: number }>();
    return row?.n ?? 0;
  } catch (err) {
    console.error(JSON.stringify({ at: "ops.bump", key, error: String(err) }));
    return 0;
  }
}

export async function counter(env: OpsEnv, key: string, day = today()) {
  const row = await env.DB.prepare("SELECT n FROM ops_daily WHERE day = ? AND key = ?").bind(day, key).first<{ n: number }>();
  return row?.n ?? 0;
}
