// Workers AI is free up to 10,000 neurons a day and billed past that. To keep AI spending within a set budget,
// every AI call is counted from the tokens the model reports, and AI pauses once the budget is spent: the free daily
// allowance, plus a small reserve for busy days over any 30 days. Past the budget, writing help asks
// to try again tomorrow and phones show the original text; polls themselves never need AI.
type AiEnv = { AI: Ai; DB: D1Database };

// Counts are estimates, so the free part stops short of Cloudflare's 10,000.
const FREE_DAILY = 9_000;
// Writing help stops earlier in the day: what is left keeps translations, which phones rely on, running.
const WRITING_DAILY = 6_000;
// Neurons past the free part allowed over 30 days.
const RESERVE_30_DAYS = 80_000;
// Neurons per million tokens [input, output], from the Workers AI price list.
const RATES: Record<string, [number, number]> = {
  "@cf/openai/gpt-oss-120b": [31_818, 68_182],
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast": [26_668, 204_805],
  "@cf/meta/m2m100-1.2b": [31_050, 31_050],
};
// A model missing from the list is counted at the dearest rate.
const DEAREST: [number, number] = [31_818, 204_805];

const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
// The day's counts only: rows of one day, never a longer key.
const DAYS = "SELECT day, neurons FROM ai_budget WHERE day >= ? AND length(day) = 10";

// Whether AI may run now. When the count cannot be read, AI stays off rather than risk running past the budget.
export async function aiAvailable(env: AiEnv, use: "writing" | "translation") {
  try {
    const { results } = await env.DB.prepare(DAYS).bind(daysAgo(30)).all<{ day: string; neurons: number }>();
    const spentToday = results.find((r) => r.day === today())?.neurons ?? 0;
    if (use === "writing") return spentToday < WRITING_DAILY;
    if (spentToday < FREE_DAILY) return true;
    const reserveUsed = results.reduce((sum, r) => sum + Math.max(0, r.neurons - FREE_DAILY), 0);
    return reserveUsed < RESERVE_30_DAYS;
  } catch (err) {
    console.error(JSON.stringify({ at: "ai-budget", error: String(err) }));
    return false;
  }
}

type Usage = { neurons?: number; input_tokens?: number; output_tokens?: number; prompt_tokens?: number; completion_tokens?: number };

// A part of the day's budget for one room or one account, so a single one cannot spend what everyone shares.
// `hold` takes neurons before a call (false: none left), `settle` gives back what the call did not use (or adds what it used past them).
export type Share = { hold: (neurons: number) => Promise<boolean>; settle: (neurons: number) => Promise<void> };

// Thrown when the budget, or a share of it, has no room for a call: nothing ran and nothing was counted.
export class NoBudget extends Error {}

// An account's part of the day's translations, in neurons, kept in ai_usage under the day followed by ":tr" for questions
// and ":tp" for what the audience wrote (the daily clean-up removes them with the rest; the writing help's own count stays
// under the plain day).
export function accountShare(env: AiEnv, userId: string, limit: number, part: "tr" | "tp" = "tr"): Share {
  const day = `${today()}:${part}`;
  return {
    hold: async (neurons) => {
      if (neurons > limit) return false;
      const row = await env.DB.prepare(
        "INSERT INTO ai_usage (user_id, day, n) VALUES (?1, ?2, ?3) ON CONFLICT(user_id, day) DO UPDATE SET n = n + excluded.n WHERE n + excluded.n <= ?4 RETURNING n",
      )
        .bind(userId, day, neurons, limit)
        .first<{ n: number }>()
        .catch(() => null);
      return !!row;
    },
    settle: async (neurons) => {
      if (!neurons) return;
      await env.DB.prepare("UPDATE ai_usage SET n = MAX(0, n + ?) WHERE user_id = ? AND day = ?").bind(neurons, userId, day).run().catch(() => {});
    },
  };
}

// The most a call can cost: its input at about 2 characters per token, and its whole output allowance.
function mostOf(model: string, input: Record<string, unknown>) {
  const [rateIn, rateOut] = RATES[model] ?? DEAREST;
  const chars = JSON.stringify(input).length;
  const out = Number(input.max_output_tokens ?? input.max_tokens ?? String(input.text ?? "").length);
  return Math.ceil((Math.ceil(chars / 2) * rateIn + out * rateOut) / 1_000_000);
}

// What a call usually costs at most: input at about 3 characters per token, and an answer about as long as its input
// plus some reasoning, within its output allowance. Shares hold this rather than the most: a room asking a dozen
// translations at once (every phone language, current and next question) is not refused for what they will never spend.
// The day's budget itself still holds the most, so spending can never pass it.
function likelyOf(model: string, input: Record<string, unknown>) {
  const [rateIn, rateOut] = RATES[model] ?? DEAREST;
  const chars = JSON.stringify(input).length;
  const allowance = Number(input.max_output_tokens ?? input.max_tokens ?? String(input.text ?? "").length);
  const out = Math.min(allowance, Math.ceil(chars / 2) + 300);
  return Math.min(mostOf(model, input), Math.ceil((Math.ceil(chars / 3) * rateIn + out * rateOut) / 1_000_000));
}

// Takes `neurons` from today's budget before a call, in one statement: calls made at the same moment cannot all pass
// a budget that only one of them fits in. False when they do not fit, or when the count cannot be read.
async function hold(env: AiEnv, use: "writing" | "translation", day: string, neurons: number) {
  try {
    const { results } = await env.DB.prepare(DAYS).bind(daysAgo(30)).all<{ day: string; neurons: number }>();
    const reserveUsed = results.reduce((sum, r) => sum + (r.day === day ? 0 : Math.max(0, r.neurons - FREE_DAILY)), 0);
    const ceiling = use === "writing" ? WRITING_DAILY : FREE_DAILY + Math.max(0, RESERVE_30_DAYS - reserveUsed);
    if (neurons > ceiling) return false;
    const row = await env.DB.prepare(
      "INSERT INTO ai_budget (day, neurons) VALUES (?1, ?2) ON CONFLICT(day) DO UPDATE SET neurons = neurons + excluded.neurons WHERE neurons + excluded.neurons <= ?3 RETURNING neurons",
    )
      .bind(day, neurons, ceiling)
      .first<{ neurons: number }>();
    return !!row;
  } catch (err) {
    console.error(JSON.stringify({ at: "ai-budget", error: String(err) }));
    return false;
  }
}

async function settle(env: AiEnv, day: string, neurons: number) {
  if (!neurons) return;
  try {
    await env.DB.prepare("UPDATE ai_budget SET neurons = MAX(0, neurons + ?) WHERE day = ?").bind(neurons, day).run();
  } catch (err) {
    console.error(JSON.stringify({ at: "ai-budget", error: String(err) }));
  }
}

// Runs a model and counts what it cost. The most it could cost is held first from today's budget (each share holds what
// it usually costs, see likelyOf), then the count is set to what it really cost: the neurons Workers AI reports, or else
// the price of the tokens it reports, or else that most (input at about 3 characters per token, full output allowance).
// Throws when the budget has no room.
export async function aiRun(env: AiEnv, model: string, input: Record<string, unknown>, opts: { use?: "writing" | "translation"; shares?: Share[] } = {}): Promise<unknown> {
  const day = today();
  const most = mostOf(model, input);
  const likely = likelyOf(model, input);
  // The shares first: a room or an account past its part never touches the day's count.
  const held: Share[] = [];
  let global = false;
  let raw: { usage?: Usage } & Record<string, unknown>;
  try {
    for (const share of opts.shares ?? []) {
      if (!(await share.hold(likely))) throw new NoBudget("AI share spent");
      held.push(share);
    }
    global = await hold(env, opts.use ?? "writing", day, most);
    if (!global) throw new NoBudget("AI budget spent");
    raw = (await env.AI.run(model as Parameters<Ai["run"]>[0], input as never)) as { usage?: Usage } & Record<string, unknown>;
  } catch (err) {
    // Nothing ran: everything held goes back.
    await Promise.all([global ? settle(env, day, -most) : null, ...held.map((s) => s.settle(-likely))]);
    throw err;
  }
  const usage = raw?.usage;
  const chars = JSON.stringify(input).length;
  const tokensIn = usage?.input_tokens ?? usage?.prompt_tokens ?? Math.ceil(chars / 3);
  const tokensOut =
    usage?.output_tokens ??
    usage?.completion_tokens ??
    Number(input.max_output_tokens ?? input.max_tokens ?? Math.ceil(String(raw?.translated_text ?? input.text ?? "").length / 2));
  const [rateIn, rateOut] = RATES[model] ?? DEAREST;
  const neurons = Math.ceil(typeof usage?.neurons === "number" ? usage.neurons : (tokensIn * rateIn + tokensOut * rateOut) / 1_000_000);
  await Promise.all([settle(env, day, neurons - most), ...held.map((s) => s.settle(neurons - likely))]);
  return raw;
}
