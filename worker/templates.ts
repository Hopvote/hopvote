// Community templates: owners share a copy of a presentation's questions; anyone signed in can reuse them.
import type { User } from "./auth";
import type { Env } from "./index";
import type { Question } from "./room";
import { demoAuthor, isDemoUser } from "./demo-authors";
import { bump } from "./ops";
import { detectLang } from "./translate";
import { parseFill } from "../src/fill";

export const TEMPLATE_CATEGORIES = ["Team", "Events", "Training", "HR"];
// Reports from this many different people hide a template until it is shared again.
const HIDE_AT = 3;
const MAX_DESCRIPTION = 120;

type Row = { id: string; user_id: string; code: string; created_at: number; title: string; category: string; description: string; questions: string; uses: number; name: string; email: string | null };

const fail = (error: string, status = 400) => ({ error, status });

// A stable buddy for each author, from the same 24 the participants pick from.
function avatarOf(userId: string) {
  let h = 0;
  for (const c of userId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `b${h % 24}`;
}

// The language the template reads in, detected from its texts as a saved presentation's is.
const langOf = (title: string, description: string, questions: Question[]) =>
  detectLang([title, description, ...questions.flatMap((q) => [q.question, ...q.options, ...(q.labels ?? []), ...(q.text ? [q.text] : []), ...(q.fill ? [parseFill(q.fill).pieces.join(" ")] : [])])]);

function view(row: Row, user: User) {
  const questions = JSON.parse(row.questions) as Question[];
  // Fictional authors of the local demo seed: shown with their full name and bio, and marked as examples.
  const demo = isDemoUser(row.user_id, row.email) ? demoAuthor(row.user_id) : undefined;
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    description: row.description,
    questions,
    uses: row.uses,
    author: row.name.split(/\s+/)[0] ?? "",
    mine: row.user_id === user.id,
    createdAt: row.created_at,
    lang: langOf(row.title, row.description, questions),
    avatar: demo?.avatar ?? avatarOf(row.user_id),
    ...(demo ? { demo: true, profile: { name: demo.name, bio: demo.bio } } : {}),
    ...(row.user_id === user.id ? { code: row.code } : {}),
  };
}

const SELECT = "SELECT t.id, t.user_id, t.code, t.created_at, t.title, t.category, t.description, t.questions, t.uses, u.name, u.email FROM shared_templates t JOIN users u ON u.id = t.user_id";

export async function listTemplates(env: Env, user: User) {
  const { results } = await env.DB.prepare(`${SELECT} WHERE t.reports < ? OR t.user_id = ? ORDER BY t.uses DESC, t.created_at DESC LIMIT 120`)
    .bind(HIDE_AT, user.id)
    .all<Row>();
  return results.map((r) => view(r, user));
}

// Copies the presentation's current questions. Images stay with their owner, so they are left out.
export async function shareTemplate(env: Env, user: User, poll: { code: string; question: string; questions: string }, body: Record<string, unknown>) {
  const category = String(body.category ?? "");
  if (!TEMPLATE_CATEGORIES.includes(category)) return fail("Pick a category");
  const description = String(body.description ?? "").trim().replace(/\s+/g, " ").slice(0, MAX_DESCRIPTION);
  if (!description) return fail("Add a short description");
  const questions = (JSON.parse(poll.questions || "[]") as Question[]).map(({ image: _image, ...q }) => q);
  if (!questions.length) return fail("This presentation has no questions");
  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  await env.DB.prepare(
    `INSERT INTO shared_templates (id, user_id, code, title, category, description, questions, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(code) DO UPDATE SET title = excluded.title, category = excluded.category, description = excluded.description, questions = excluded.questions, reports = 0`,
  )
    .bind(id, user.id, poll.code, poll.question, category, description, JSON.stringify(questions), Date.now())
    .run();
  await env.DB.prepare("DELETE FROM template_reports WHERE template_id = (SELECT id FROM shared_templates WHERE code = ?)").bind(poll.code).run();
  return sharedFor(env, poll.code);
}

export async function sharedFor(env: Env, code: string) {
  return env.DB.prepare("SELECT id, category, description, uses FROM shared_templates WHERE code = ?")
    .bind(code)
    .first<{ id: string; category: string; description: string; uses: number }>();
}

// The one who shared it takes it down, and so does the author of the presentation it was copied from.
export async function unshareTemplate(env: Env, user: User, id: string) {
  await env.DB.prepare("DELETE FROM shared_templates WHERE id = ?1 AND (user_id = ?2 OR code IN (SELECT code FROM polls WHERE user_id = ?2))").bind(id, user.id).run();
}

// Opening a template to build from it counts as one use, once per account: the library's order can't be pushed
// by opening a template again and again. The note lives with the daily counters, under a day of its own that the
// clean-up never removes.
const USES_DAY = "template-uses";

export async function useTemplate(env: Env, user: User, id: string) {
  const row = await env.DB.prepare(`${SELECT} WHERE t.id = ?`).bind(id).first<Row>();
  if (!row) return null;
  if (row.user_id !== user.id && (await bump(env, `use:${id}:${user.id}`, USES_DAY)) === 1) {
    await env.DB.prepare("UPDATE shared_templates SET uses = uses + 1 WHERE id = ?").bind(id).run();
  }
  return view(row, user);
}

export async function reportTemplate(env: Env, user: User, id: string) {
  const added = await env.DB.prepare("INSERT OR IGNORE INTO template_reports (template_id, user_id) SELECT id, ? FROM shared_templates WHERE id = ? AND user_id != ?")
    .bind(user.id, id, user.id)
    .run();
  if (added.meta.changes) await env.DB.prepare("UPDATE shared_templates SET reports = reports + 1 WHERE id = ?").bind(id).run();
}
