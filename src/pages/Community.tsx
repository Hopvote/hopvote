import { useEffect, useState } from "react";
import { ArrowDownWideNarrow, ArrowLeft, ArrowRight, Check, ChevronRight, CloudOff, Flag, Languages, Lock, QrCode, RotateCw, SearchX, Share2, X } from "lucide-react";
import { api } from "../api";
import { translate, useAppLang, useAppT, type AppLang } from "../app-i18n";
import { CONTACT_FIELDS, kindLabel, kindOf } from "../questions";
import { parseFill } from "../fill";
import { Buddy } from "../buddies";
import { OFFICIAL } from "../official-templates";
import { CATEGORIES, type Category, type Template } from "../templates";
import { counted, useDecks } from "../decks";
import { Link } from "../ui";
import { AppShell } from "./AppShell";
import { ChoiceMenu, FilterChip, Highlight, ListState, matches, SearchField, short, urlParam, useUrlParams, type Choice } from "./ListTools";

const TONE: Record<Category, string> = { Team: "tone-blue", Events: "tone-peach", Training: "tone-lilac", HR: "tone-mint" };
// A category the page does not know yet still gets a background.
const toneOf = (c: string) => TONE[c as Category] ?? "tone-blue";

// A number as the rest of the app writes it: years and small counts without a thousands space ("1789", not "1 789").
const num = (n: number, lang: string) => n.toLocaleString(lang === "fr" ? "fr-FR" : "en-US", { maximumFractionDigits: 3, useGrouping: Math.abs(n) >= 10000 });

// A timer's length as the big screen shows it: 5:00, 10:00.
const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

// A small replica of the voter screen, so the card shows what the room will see.
// `lang`: the template's language, so its sample words read like its questions.
function Slide({ q, lang }: { q: Template["questions"][number]; lang?: string }) {
  const appT = useAppT();
  const appLang = useAppLang();
  const tr = lang === "en" || lang === "fr" ? (text: string) => translate(lang as AppLang, text) : appT;
  const kind = kindOf(q);
  const first = q.options.slice(0, 3);
  return (
    <div className="mini-slide">
      <p>{q.question}</p>
      {kind === "words" ? (
        <div className="mini-cloud" aria-hidden>
          <b>{tr("team")}</b> <i>{tr("energy")}</i> <em>{tr("clarity")}</em> <i>{tr("pace")}</i> <b className="s">{tr("trust")}</b>
        </div>
      ) : kind === "contact" ? (
        <div className="mini-contact" aria-hidden><span>{tr("Email")}</span><span>{tr("Phone")}</span></div>
      ) : kind === "qa" ? (
        <div className="mini-qa" aria-hidden><span><b>12</b></span><span><b>7</b></span><span><b>3</b></span></div>
      ) : kind === "rank" || kind === "order" ? (
        <ul>
          {first.map((o, i) => (
            <li key={i} className="truncate"><b className="mini-pos">{i + 1}</b>{o}</li>
          ))}
        </ul>
      ) : kind === "open" ? (
        <div className="mini-wall" aria-hidden><span /><span /><span /></div>
      ) : kind === "scale" ? (
        <div className="mini-scale" aria-hidden>
          {Array.from({ length: q.max ?? 5 }, (_, i) => <span key={i}>{i + 1}</span>)}
        </div>
      ) : kind === "slide" ? (
        <p className="mini-text">{q.text}</p>
      ) : kind === "link" ? (
        <div className="mini-center" aria-hidden><span className="mini-qr"><QrCode size={34} strokeWidth={1.6} /></span></div>
      ) : kind === "countdown" ? (
        <div className="mini-center" aria-hidden><strong className="mini-big">{clock(q.duration ?? 300)}</strong></div>
      ) : kind === "number" ? (
        <div className="mini-center" aria-hidden><strong className="mini-big">{q.answer !== undefined ? num(q.answer, lang === "en" || lang === "fr" ? lang : appLang) : "?"}</strong></div>
      ) : kind === "fill" ? (
        <p className="mini-fill">
          {parseFill(q.fill ?? "").pieces.map((piece, i, all) => (
            <span key={i}>{piece}{i < all.length - 1 && <u aria-hidden />}</span>
          ))}
        </p>
      ) : kind === "match" ? (
        <ul className="mini-pairs" aria-hidden>
          {q.options.slice(0, Math.min(3, q.options.length / 2)).map((left, i) => (
            <li key={i}><span className="truncate">{left}</span><i /><span className="truncate">{q.options[q.options.length / 2 + i]}</span></li>
          ))}
        </ul>
      ) : kind === "points" ? (
        <ul className="mini-points" aria-hidden>
          {first.map((o, i) => (
            <li key={i}><span className="truncate">{o}</span><b>{[50, 30, 20][i]}</b></li>
          ))}
        </ul>
      ) : kind === "scales" ? (
        <ul className="mini-scales" aria-hidden>
          {first.map((o, i) => (
            <li key={i}><span className="truncate">{o}</span><i style={{ "--w": `${[82, 64, 48][i]}%` } as React.CSSProperties} /></li>
          ))}
        </ul>
      ) : kind === "wheel" ? (
        <div className="mini-center" aria-hidden><span className="mini-wheel" /></div>
      ) : (
        <ul>
          {first.map((o, i) => (
            <li key={i} className={`truncate ${kind === "quiz" ? (i === q.correct ? "right" : "") : i === 0 ? "first" : ""}`}>{o}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Hopvote's own mark, for its templates.
function HopvoteMark({ size = 22 }: { size?: number }) {
  return (
    <svg className="cm-mark" width={size} height={size} viewBox="0 0 96 96" aria-hidden>
      <rect width="96" height="96" rx="24" fill="#ff5436" />
      <svg x="10" y="11" width="76" height="76" viewBox="-39 -20 138 138">
        <g fill="none" stroke="#fff" strokeLinecap="round" strokeWidth="18" transform="translate(0 -9) rotate(-6 47 100)">
          <path d="M22 100V8" />
          <path d="M22 68c0-18 11-28 25-28s25 10 25 26v34" />
        </g>
      </svg>
    </svg>
  );
}

// What a question holds, under its title in the sheet: options, pairs, the sentence to fill, the range, the link.
function Detail({ q }: { q: Template["questions"][number] }) {
  const tr = useAppT();
  const lang = useAppLang();
  const kind = kindOf(q);
  if (kind === "slide") return q.text ? <p className="muted cm-detail">{q.text}</p> : null;
  if (kind === "link") return <p className="muted cm-detail truncate">{q.url}</p>;
  if (kind === "countdown") return <div className="chips"><span>{clock(q.duration ?? 300)}</span></div>;
  if (kind === "number") return q.answer !== undefined ? <div className="chips"><span className="right">{num(q.answer, lang)}</span></div> : null;
  if (kind === "scale") return <div className="chips"><span>{tr("1 to {n}", { n: q.max ?? 5 })}</span>{q.labels?.filter(Boolean).map((l, i) => <span key={i}>{l}</span>)}</div>;
  if (kind === "contact") return <div className="chips">{(q.fields ?? ["email"]).map((f) => <span key={f}>{tr(CONTACT_FIELDS.find((c) => c.id === f)?.label ?? f)}</span>)}</div>;
  if (kind === "wheel" && !q.options.length) return <p className="muted cm-detail">{tr("Spins among the first names of the participants")}</p>;
  if (kind === "fill") {
    const { pieces, answers } = parseFill(q.fill ?? "");
    return (
      <p className="cm-fill">
        {pieces.map((piece, i) => (
          <span key={i}>{piece}{i < answers.length && <b>{answers[i][0]}</b>}</span>
        ))}
      </p>
    );
  }
  if (kind === "match") {
    const half = q.options.length / 2;
    return <div className="chips">{q.options.slice(0, half).map((left, i) => <span key={i}>{left} <ArrowRight size={12} aria-hidden /> {q.options[half + i]}</span>)}</div>;
  }
  if (!q.options.length) return null;
  return (
    <div className="chips">
      {q.options.map((o, j) => <span key={j} className={j === q.correct ? "right" : ""}>{kind === "order" ? `${j + 1}. ${o}` : o}</span>)}
    </div>
  );
}

// A presentation shared by a Hopvote user. Only its questions are public: answers and images stay private.
// `lang`: the language its text reads in. `demo`: a fictional author of the local demo seed, shown as an example.
type Shared = Template & { author: string; uses: number; mine: boolean; code?: string; lang?: string; avatar?: string; demo?: boolean; profile?: { name: string; bio: string }; official?: boolean };
type Row = Omit<Shared, "context">;
const toShared = (r: Row): Shared => ({ ...r, context: r.author ? `By ${r.author}` : "Hopvote user" });
// Hopvote's templates, written in the code: always there, before what users share.
const OFFICIAL_LIST: Shared[] = OFFICIAL.map((o) => ({ id: o.id, title: o.title, category: o.category, description: o.description, questions: o.questions, lang: o.lang, context: "", author: "Hopvote", uses: 0, mine: false, official: true }));
// The name a tile shows: the demo author's full name, a user's first name.
const authorName = (t: Shared, tr: (s: string) => string) => (t.official ? "Hopvote" : t.profile?.name ?? (t.author || tr("Hopvote user")));

function Avatar({ t, size = 22 }: { t: Shared; size?: number }) {
  return t.official ? <HopvoteMark size={size} /> : <Buddy id={t.avatar ?? t.id} size={size} className="cm-avatar" />;
}

function Preview({ t, onClose, onGone }: { t: Shared; onClose: () => void; onGone: (id: string) => void }) {
  const lang = useAppLang();
  const tr = useAppT();
  const [reported, setReported] = useState(false);

  async function report() {
    await api(`/api/templates/${t.id}/report`, { method: "POST" }).catch(() => {});
    setReported(true);
  }

  async function unshare() {
    await api(`/api/templates/${t.id}`, { method: "DELETE" }).catch(() => {});
    onGone(t.id);
    onClose();
  }

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", esc);
    return () => removeEventListener("keydown", esc);
  }, [onClose]);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal aria-label={t.title} onClick={(e) => e.stopPropagation()}>
        <header className="sheet-head">
          <div className="cm-sheet-head">
            <span className={`cat-pill ${toneOf(t.category)}`}>{tr(t.category)}</span>
            <h2>{t.title}</h2>
            <p className="muted">{t.description}</p>
            <div className="cm-author">
              <Avatar t={t} size={36} />
              <div>
                <strong className="truncate">{t.official ? tr("Hopvote template") : t.mine ? tr("Shared by you") : authorName(t, tr)}</strong>
                {t.profile?.bio && <span className="cm-bio">{t.profile.bio}</span>}
                {!t.official && (
                  <span className="cm-bio">
                    {counted(lang, t.uses, "{n} use", "{n} uses")}
                    {t.demo && <> · <em className="cm-example">{tr("Example")}</em></>}
                  </span>
                )}
              </div>
            </div>
          </div>
          <button className="icon" aria-label={tr("Close")} onClick={onClose}><X size={20} /></button>
        </header>
        <ol className="sheet-qs">
          {t.questions.map((q, i) => (
            <li key={i}>
              <span className="question-n">{tr("Question {n} · {kind}", { n: i + 1, kind: tr(kindLabel(q)) })}</span>
              <strong>{q.question}</strong>
              <Detail q={q} />
            </li>
          ))}
        </ol>
        <footer className="sheet-foot">
          {!t.mine && !t.official && (
            <button className="ghost small with-icon" onClick={report} disabled={reported}>
              <Flag size={16} /> {reported ? tr("Reported, thanks") : tr("Report")}
            </button>
          )}
          {t.mine && <button className="ghost small" onClick={unshare}>{tr("Stop sharing")}</button>}
          <Link to={t.official ? `/app/new?template=${t.id}` : `/app/new?shared=${t.id}`} className="primary button with-icon">
            {tr("Use this presentation")} <ArrowRight size={18} />
          </Link>
        </footer>
      </div>
    </div>
  );
}

// Picks one of your presentations, then a category and a line of description.
export function ShareForm({ code, current, onDone }: { code: string; current?: { category: Category; description: string } | null; onDone: (shared: { id: string; category: Category; description: string; uses: number }) => void }) {
  const t = useAppT();
  const [category, setCategory] = useState<Category>(current?.category ?? "Team");
  const [description, setDescription] = useState(current?.description ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function share(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const out = await api<{ shared: { id: string; category: Category; description: string; uses: number } }>(`/api/polls/${code}/share`, { body: { category, description } });
      onDone(out.shared);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Couldn't share"));
      setBusy(false);
    }
  }

  return (
    <form className="stack share-form" onSubmit={share}>
      <div className="field">
        <span>{t("Category")}</span>
        <div className="segmented wrap" role="group" aria-label={t("Category")}>
          {CATEGORIES.map((c) => (
            <button key={c} type="button" className={category === c ? "on" : ""} onClick={() => setCategory(c)}>{t(c)}</button>
          ))}
        </div>
      </div>
      <label className="field">
        <span>{t("One line to describe it")}</span>
        <input autoFocus maxLength={120} placeholder={t("Check the mood and set the week's priority")} value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <p className="muted share-note"><Lock size={14} /> {t("Only the questions are shared. Answers, names and images stay private.")}</p>
      {error && <p className="error">{error}</p>}
      <button className="primary" disabled={busy || !description.trim()}>{busy ? t("Sharing…") : current ? t("Update") : t("Share to Community")}</button>
    </form>
  );
}

function ShareSheet({ shared, onClose, onShared }: { shared: Shared[]; onClose: () => void; onShared: () => void }) {
  const lang = useAppLang();
  const tr = useAppT();
  const { decks } = useDecks();
  const [code, setCode] = useState<string | null>(null);
  const sharedCodes = new Set(shared.filter((t) => t.mine).map((t) => t.code));
  const pick = decks?.find((d) => d.code === code);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", esc);
    return () => removeEventListener("keydown", esc);
  }, [onClose]);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal aria-label={tr("Share a presentation")} onClick={(e) => e.stopPropagation()}>
        <header className="sheet-head">
          <div>
            <h2>{pick ? pick.title : tr("Share a presentation")}</h2>
            <p className="muted">{pick ? counted(lang, pick.questions, "{n} question", "{n} questions") : tr("Pick one of your presentations. Others can then use it in one click.")}</p>
          </div>
          <button className="icon" aria-label={tr("Close")} onClick={onClose}><X size={20} /></button>
        </header>
        <div className="sheet-body">
          {pick ? (
            <>
              <button type="button" className="ghost small with-icon share-back" onClick={() => setCode(null)}><ArrowLeft size={16} /> {tr("Another presentation")}</button>
              <ShareForm code={pick.code} onDone={onShared} />
            </>
          ) : !decks ? (
            <p className="muted">{tr("Loading…")}</p>
          ) : decks.length === 0 ? (
            <div className="stack">
              <p className="muted">{tr("You don't have a presentation yet.")}</p>
              <Link to="/app/new" className="primary button">{tr("Create a presentation")}</Link>
            </div>
          ) : (
            <ul className="share-list">
              {decks.map((d) => (
                <li key={d.code}>
                  <button type="button" onClick={() => setCode(d.code)}>
                    <span className="truncate"><strong>{d.title}</strong><small>{counted(lang, d.questions, "{n} question", "{n} questions")}</small></span>
                    {sharedCodes.has(d.code) ? <em><Check size={13} /> {tr("Shared")}</em> : <ChevronRight size={18} />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

// Sorts of the Community list: most used first (the server's order), or newest first.
type Sort = "popular" | "recent";
const SORTS: Sort[] = ["popular", "recent"];
const SORT_LABEL: Record<Sort, string> = { popular: "Popular", recent: "Newest" };

function SkeletonTiles({ n = 6 }: { n?: number }) {
  const tr = useAppT();
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">{tr("Loading…")}</span>
      <div className="tpl-grid" aria-hidden>
        {Array.from({ length: n }, (_, i) => (
          <div key={i} className="lt-skel-tile" style={{ "--i": i } as React.CSSProperties}>
            <span />
            <i />
            <i />
          </div>
        ))}
      </div>
    </div>
  );
}

// Languages of the list: the app's language by default. A presentation is hidden only when it clearly reads in the other
// one: short wording (detected "auto"), other languages and the user's own shares stay listed.
type LangFilter = "all" | "en" | "fr";
const LANG_FILTERS: LangFilter[] = ["en", "fr", "all"];
const inLanguage = (t: Shared, f: LangFilter) => f === "all" || t.mine || t.lang !== (f === "en" ? "fr" : "en");
const LANG_LABEL: Record<LangFilter, string> = { all: "All languages", en: "English", fr: "French" };

// Small phones: two icon menus leave the search field narrow, so its hint gets shorter.
function useNarrow(query = "(max-width: 379px)") {
  const [narrow, setNarrow] = useState(() => typeof matchMedia === "function" && matchMedia(query).matches);
  useEffect(() => {
    const m = matchMedia(query);
    const change = () => setNarrow(m.matches);
    m.addEventListener("change", change);
    return () => m.removeEventListener("change", change);
  }, [query]);
  return narrow;
}

// Many presentations open with a word cloud: the tile previews the first other question, so tiles tell apart.
const previewOf = (t: Shared) => t.questions.find((q) => kindOf(q) !== "words") ?? t.questions[0];

function Tile({ t, query, onOpen, i }: { t: Shared; query: string; onOpen: () => void; i: number }) {
  const lang = useAppLang();
  const tr = useAppT();
  return (
    <button className="tpl-tile" title={t.title} onClick={onOpen} style={{ "--i": Math.min(i, 8) } as React.CSSProperties}>
      <div className={`tpl-stage ${toneOf(t.category)}`}>
        <Slide q={previewOf(t)} lang={t.lang} />
      </div>
      <div className="tpl-info">
        <div className="cm-title">
          <strong className="truncate"><Highlight text={t.title} query={query} /></strong>
        </div>
        {/* The name shortens first; the count and the example mention always show. Hopvote's mark already signs its tiles. */}
        <span className="cm-meta">
          <Avatar t={t} />
          {!t.official && <span className="truncate">{t.mine ? tr("Shared by you") : <Highlight text={authorName(t, tr)} query={query} />}</span>}
          <span className="cm-meta-rest">
            {!t.official && "· "}
            {counted(lang, t.questions.length, "{n} question", "{n} questions")}
            {t.demo ? <> · <em className="cm-example">{tr("Example")}</em></> : !t.official && <> · {counted(lang, t.uses, "{n} use", "{n} uses")}</>}
          </span>
        </span>
      </div>
    </button>
  );
}

export function Community() {
  const lang = useAppLang();
  const tr = useAppT();
  const narrow = useNarrow();
  const [query, setQuery] = useState(() => urlParam("q") ?? "");
  const [filter, setFilter] = useState<Category | null>(() => urlParam("category", CATEGORIES));
  const [sort, setSort] = useState<Sort>(() => urlParam("sort", SORTS) ?? "popular");
  const [langFilter, setLangFilter] = useState<LangFilter>(() => urlParam("lang", LANG_FILTERS) ?? lang);
  useUrlParams({ q: query.trim() ? query : null, category: filter, sort: sort === "popular" ? null : sort, lang: langFilter === lang ? null : langFilter }, () => {
    setQuery(urlParam("q") ?? "");
    setFilter(urlParam("category", CATEGORIES));
    setSort(urlParam("sort", SORTS) ?? "popular");
    setLangFilter(urlParam("lang", LANG_FILTERS) ?? lang);
  });
  const [open, setOpen] = useState<Shared | null>(null);
  const [sharing, setSharing] = useState(false);
  const [list, setList] = useState<Shared[] | null>(null);
  const [error, setError] = useState("");

  const load = () => {
    setError("");
    return api<{ templates: Row[] }>("/api/templates").then(
      (d) => setList(d.templates.map(toShared)),
      (e) => setError(e instanceof Error ? e.message : "Couldn't load"),
    );
  };
  useEffect(() => {
    load();
  }, []);

  // Language, then search, so each category shows how many of the matches it holds.
  const all = [...OFFICIAL_LIST, ...(list ?? [])];
  const inLang = all.filter((t) => inLanguage(t, langFilter));
  const searched = (t: Shared) => matches(query, [t.title, t.description, authorName(t, tr), ...t.questions.map((q) => q.question)]);
  const found = inLang.filter(searched);
  const perCategory = (c: Category) => found.filter((t) => t.category === c).length;
  const categories = CATEGORIES.filter((c) => c === filter || perCategory(c) > 0);
  const shown = found.filter((t) => !filter || t.category === filter);
  const official = shown.filter((t) => t.official);
  const community = shown.filter((t) => !t.official);
  if (sort === "recent") community.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  const filtered = !!(query.trim() || filter);
  // Shared presentations the language alone hides: the page points to "All languages" instead of saying nobody shared.
  const hiddenByLang = (list ?? []).filter((t) => !inLanguage(t, langFilter) && (!filter || t.category === filter) && searched(t)).length;
  const sortChoices: Choice<Sort>[] = SORTS.map((s) => ({ value: s, label: tr(SORT_LABEL[s]) }));
  // The app's language first, then the other one, then all.
  const langChoices: Choice<LangFilter>[] = (lang === "fr" ? (["fr", "en", "all"] as const) : (["en", "fr", "all"] as const)).map((l) => ({ value: l, label: tr(LANG_LABEL[l]) }));
  const otherLanguages = (
    <button type="button" className="hb-chip" onClick={() => setLangFilter("all")}>
      <Languages size={15} /> {tr("All languages")}
    </button>
  );

  return (
    <AppShell
      title={tr("Community")}
      subtitle={tr("Hopvote templates and presentations shared by users.")}
      action={<button className="primary button small with-icon" onClick={() => setSharing(true)}><Share2 size={16} /> {tr("Share a presentation")}</button>}
    >
      {list === null && error && (
        <ListState icon={CloudOff} title={tr("Couldn't load")} text={tr("Check your connection, then try again.")} alert>
          <button type="button" className="hb-chip strong" onClick={() => (setError(""), load())}>
            <RotateCw size={15} /> {tr("Retry")}
          </button>
        </ListState>
      )}

      {/* While loading, the search bar already holds its place above the grey tiles. Hopvote's templates are always there. */}
      {(list || !error) && (
        <div className="lt-list">
          <div className="lt-bar">
            <div className="lt-top">
              <SearchField value={query} onChange={setQuery} label={tr("Search Community")} placeholder={tr(narrow ? "Search" : "Title, author or question")} />
              <div className="cm-menus">
                <ChoiceMenu icon={Languages} className={`lt-sort cm-lang ${langFilter === "all" ? "" : `cm-code-${langFilter}`}`} label={tr("Language")} text={tr(LANG_LABEL[langFilter])} choices={langChoices} value={langFilter} onChange={setLangFilter} />
                <ChoiceMenu icon={ArrowDownWideNarrow} className="lt-sort" label={tr("Sort by")} text={tr(SORT_LABEL[sort])} choices={sortChoices} value={sort} onChange={setSort} />
              </div>
            </div>
            {/* One category alone would only repeat "All": the row shows from two, or while one is picked. */}
            {(categories.length > 1 || filter) && (
            <div className="lt-chips" role="group" aria-label={tr("Category")}>
              <FilterChip on={!filter} onClick={() => setFilter(null)} count={found.length}>
                {tr("All")}
              </FilterChip>
              {categories.map((c) => (
                <FilterChip key={c} on={filter === c} onClick={() => setFilter(filter === c ? null : c)} count={perCategory(c)}>
                  {tr(c)}
                </FilterChip>
              ))}
            </div>
            )}
          </div>
          <p className="sr-only" aria-live="polite">
            {filtered ? tr("{n} of {m} presentations", { n: shown.length, m: inLang.length }) : counted(lang, inLang.length, "{n} presentation", "{n} presentations")}
          </p>

          {official.length > 0 && (
            <section className="cm-section cm-official" aria-labelledby="cm-official">
              <div className="sec-head"><h2 id="cm-official">{tr("Hopvote templates")}</h2></div>
              <div className="tpl-grid">
                {official.map((t, i) => <Tile key={t.id} t={t} i={i} query={query} onOpen={() => setOpen(t)} />)}
              </div>
            </section>
          )}

          {!list ? (
            <SkeletonTiles n={3} />
          ) : community.length > 0 ? (
            <section className="cm-section" aria-labelledby="cm-shared">
              <div className="sec-head"><h2 id="cm-shared">{tr("Shared by users")}</h2></div>
              <div className="tpl-grid">
                {community.map((t, i) => <Tile key={t.id} t={t} i={i} query={query} onOpen={() => setOpen(t)} />)}
              </div>
            </section>
          ) : hiddenByLang > 0 && (!filtered || official.length > 0) ? (
            <div className="cm-first">
              <strong>{tr(langFilter === "fr" ? "Nothing shared in French" : "Nothing shared in English")}</strong>
              {otherLanguages}
            </div>
          ) : list.length === 0 && !filtered ? (
            <div className="cm-first">
              <div>
                <strong>{tr("Be the first to share")}</strong>
                <p className="muted">{tr("Share one of your presentations: others reuse your questions, never your answers.")}</p>
              </div>
              <button className="hb-chip strong" onClick={() => setSharing(true)}><Share2 size={15} /> {tr("Share a presentation")}</button>
            </div>
          ) : official.length === 0 ? (
            <ListState
              icon={SearchX}
              title={
                !query.trim()
                  ? tr("Nothing in {category} yet", { category: tr(filter ?? "") })
                  : filter && found.length > 0
                    ? tr("Nothing in {category} matches \"{query}\".", { category: tr(filter), query: short(query) })
                    : tr("Nothing matches \"{query}\".", { query: short(query) })
              }
            >
              {/* The category comes first when other categories hold matches. */}
              {filter && found.length > 0 && (
                <button type="button" className="hb-chip" onClick={() => setFilter(null)}>
                  {tr("Reset filters")}
                </button>
              )}
              {query.trim() && (
                <button type="button" className="hb-chip" onClick={() => setQuery("")}>
                  {tr("Clear search")}
                </button>
              )}
              {filter && found.length === 0 && (
                <button type="button" className="hb-chip" onClick={() => setFilter(null)}>
                  {tr("Reset filters")}
                </button>
              )}
              {langFilter !== "all" && otherLanguages}
            </ListState>
          ) : null}
        </div>
      )}

      {open && <Preview t={open} onClose={() => setOpen(null)} onGone={(id) => setList((c) => c?.filter((t) => t.id !== id) ?? null)} />}
      {sharing && <ShareSheet shared={list ?? []} onClose={() => setSharing(false)} onShared={() => { setSharing(false); load(); }} />}
    </AppShell>
  );
}
