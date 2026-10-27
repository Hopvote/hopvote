import { useMemo, useState } from "react";
import { ArrowDownWideNarrow, ChartPie, CloudOff, MonitorPlay, Pencil, Plus, RotateCw, SearchX, Shapes } from "lucide-react";
import { displayName } from "../api";
import { useAppLang, useAppT } from "../app-i18n";
import { counted, refreshDecks, useDecks, type DeckRow } from "../decks";
import { KINDS, TOPICS_KIND, type UiKind } from "../questions";

// Every kind a presentation may hold: the builder's list, and topic rounds (out of KINDS).
const ALL_KINDS = [...KINDS, TOPICS_KIND];
import { Link } from "../ui";
import { AppShell } from "./AppShell";
import { ago, byLastUse, CopyButton, lastEvent } from "./HomeBlocks";
import { ChoiceMenu, FilterChip, Highlight, ListState, matches, SearchField, short, SkeletonRows, urlParam, useUrlParams, type Choice } from "./ListTools";

type Sort = "last" | "answers" | "name";
type Status = "live" | "answers" | "never";
type Owner = "mine" | "team";

const SORT_KEY = "hopvote:decks:sort";
const SORTS: Sort[] = ["last", "answers", "name"];
const SORT_LABEL: Record<Sort, string> = { last: "Last used", answers: "Most answers", name: "A to Z" };
const savedSort = (): Sort => {
  try {
    const s = localStorage.getItem(SORT_KEY);
    return SORTS.includes(s as Sort) ? (s as Sort) : "last";
  } catch {
    return "last";
  }
};

const kindInfo = (id: string) => ALL_KINDS.find((k) => k.id === id) ?? KINDS[0];
// The kind that best describes a presentation: a quiz if there is one, else its first question's kind.
const mainKind = (d: DeckRow) => (d.kinds?.includes("quiz") ? "quiz" : (d.kinds?.[0] ?? "choice"));

const STATUS_TEST: Record<Status, (d: DeckRow) => boolean> = {
  live: (d) => (d.live ?? 0) > 0,
  answers: (d) => d.votes > 0,
  never: (d) => !d.shownAt,
};
const STATUSES = Object.keys(STATUS_TEST) as Status[];
const OWNERS: Owner[] = ["mine", "team"];
const KIND_IDS = ALL_KINDS.map((k) => k.id);
const STATUS_LABEL: Record<Status, string> = { live: "Live now", answers: "With answers", never: "Never presented" };

function Row({ deck, query, i }: { deck: DeckRow; query: string; i: number }) {
  const t = useAppT();
  const lang = useAppLang();
  const kind = kindInfo(mainKind(deck));
  const Icon = kind.icon;
  const last = lastEvent(deck);
  // Only the name is searched, so only the name is marked: "By" stays plain.
  const [byBefore, byAfter = ""] = t("By {name}", { name: "{name}" }).split("{name}");
  return (
    <li className="hb-rise" style={{ "--i": Math.min(i, 8) } as React.CSSProperties}>
      <div className="hb-row">
        <Link to={`/app/p/${deck.code}`} className="hb-row-main">
          <span className="hb-row-icon" title={t(kind.label)}>
            <Icon size={19} />
          </span>
          <span className="hb-row-text">
            <strong className="truncate">
              <Highlight text={deck.title} query={query} />
              {deck.by && (
                <span className="home-tag">
                  {byBefore}
                  <Highlight text={displayName(deck.by)} query={query} />
                  {byAfter}
                </span>
              )}
            </strong>
            <span className="truncate">
              <span className={query.trim() ? undefined : "lt-wide"}>
                <span className="lt-code">
                  <Highlight text={deck.code} query={query} />
                </span>
                {" · "}
              </span>
              {counted(lang, deck.questions, "{n} question", "{n} questions")} · {counted(lang, deck.participants ?? 0, "{n} participant", "{n} participants")}
              <span className="lt-wide"> · {counted(lang, deck.votes, "{n} answer", "{n} answers")}</span>
            </span>
          </span>
          <span className={`hb-row-when ${deck.live ? "live" : ""}`}>
            {deck.live ? (
              <>
                <i className="hb-dot small" aria-hidden /> {t("Live")}
              </>
            ) : (
              t(last.text, { when: ago(lang, last.at) })
            )}
          </span>
        </Link>
        <div className="hb-row-actions">
          <Link to={`/present/${deck.code}`} className="hb-icon-btn" title={t("Present")} label={t("Present")}>
            <MonitorPlay size={17} />
          </Link>
          <CopyButton code={deck.code} />
          <Link to={`/app/p/${deck.code}`} className="hb-icon-btn lt-wide" title={t("Results")} label={t("Results")}>
            <ChartPie size={17} />
          </Link>
          <Link to={`/app/p/${deck.code}/edit`} className="hb-icon-btn lt-wide" title={t("Edit")} label={t("Edit")}>
            <Pencil size={16} />
          </Link>
        </div>
      </div>
    </li>
  );
}

export function Decks() {
  const lang = useAppLang();
  const t = useAppT();
  const { decks, error } = useDecks();
  const [query, setQuery] = useState(() => urlParam("q") ?? "");
  const [sort, setSortState] = useState<Sort>(savedSort);
  const [status, setStatus] = useState<Status | null>(() => urlParam("status", STATUSES));
  const [owner, setOwner] = useState<Owner | null>(() => urlParam("owner", OWNERS));
  const [kind, setKind] = useState<UiKind | null>(() => urlParam("type", KIND_IDS));
  useUrlParams({ q: query.trim() ? query : null, status, owner, type: kind }, () => {
    setQuery(urlParam("q") ?? "");
    setStatus(urlParam("status", STATUSES));
    setOwner(urlParam("owner", OWNERS));
    setKind(urlParam("type", KIND_IDS));
  });
  const [retry, setRetry] = useState<"idle" | "busy" | string>("idle");

  function setSort(s: Sort) {
    setSortState(s);
    try {
      localStorage.setItem(SORT_KEY, s);
    } catch {
      // Remembered for this visit only.
    }
  }

  const all = decks ?? [];
  const filtered = !!(query.trim() || status || owner || kind);
  const resetFilters = () => (setStatus(null), setOwner(null), setKind(null));

  // Chips that would change nothing are left out: a filter shows when it keeps some presentations and not all.
  // Every chip is decided on the whole list, so the row never changes while the person clicks.
  const statusChips = STATUSES.filter((s) => {
    const n = all.filter(STATUS_TEST[s]).length;
    return s === status || (n > 0 && (s === "live" || n < all.length));
  });
  const team = (all.some((d) => d.by) && all.some((d) => !d.by)) || !!owner;

  // The type menu shows when one of the types would leave some presentations out.
  const typeHelps = ALL_KINDS.some((k) => {
    const n = all.filter((d) => d.kinds?.includes(k.id)).length;
    return n > 0 && n < all.length;
  });

  const { shown, kinds, searched } = useMemo(() => {
    const searched = (decks ?? []).filter((d) => matches(query, [d.title, d.code, d.by && displayName(d.by)]));
    const base = searched.filter((d) => (!status || STATUS_TEST[status](d)) && (!owner || (owner === "team" ? !!d.by : !d.by)));
    // Kinds present in the presentations shown by the other filters, in the builder's order.
    const kinds = ALL_KINDS.map((k) => ({ k, n: base.filter((d) => d.kinds?.includes(k.id)).length })).filter((x) => x.n > 0 || x.k.id === kind);
    let list = base.filter((d) => !kind || d.kinds?.includes(kind));
    if (sort === "answers") list = byLastUse(list).sort((a, b) => b.votes - a.votes);
    else if (sort === "name") list = [...list].sort((a, b) => a.title.localeCompare(b.title, lang, { sensitivity: "base", numeric: true }));
    else list = byLastUse(list);
    return { shown: list, kinds, searched: searched.length };
  }, [decks, query, status, owner, kind, sort, lang]);

  const count = decks?.length
    ? filtered
      ? t("{n} of {m} presentations", { n: shown.length, m: decks.length })
      : counted(lang, decks.length, "{n} presentation", "{n} presentations")
    : undefined;
  const narrowed = !!(status || owner || kind);

  const kindChoices: Choice<UiKind | null>[] = [
    { value: null, label: t("All types") },
    ...kinds.map(({ k, n }) => ({ value: k.id, label: t(k.label), icon: k.icon, count: n })),
  ];
  const sortChoices: Choice<Sort>[] = SORTS.map((s) => ({ value: s, label: t(SORT_LABEL[s]) }));
  const showTypes = typeHelps || !!kind;

  async function tryAgain() {
    setRetry("busy");
    try {
      await refreshDecks();
      setRetry("idle");
    } catch (e) {
      setRetry(e instanceof Error ? e.message : "Couldn't load");
    }
  }
  const failed = retry === "busy" ? "" : retry !== "idle" ? retry : error;
  // While loading, the subtitle line and the search bar already hold their place, so nothing jumps when the list arrives.
  const showList = decks ? decks.length > 0 : !failed;

  return (
    <AppShell
      title={t("Presentations")}
      subtitle={count ?? (!decks && !failed ? "\u00a0" : undefined)}
      action={
        <Link to="/app/new" className="primary button with-icon only-wide">
          <Plus size={18} strokeWidth={2.6} /> {t("New presentation")}
        </Link>
      }
    >
      <p className="sr-only" aria-live="polite">
        {count}
      </p>

      {!decks && failed && (
        <ListState icon={CloudOff} title={t("Couldn't load")} text={t("Check your connection, then try again.")} alert>
          <button type="button" className="hb-chip strong" onClick={tryAgain}>
            <RotateCw size={15} /> {t("Retry")}
          </button>
        </ListState>
      )}

      {decks?.length === 0 && (
        <div className="empty">
          <div className="empty-mark" aria-hidden>
            <span />
            <span />
            <span />
          </div>
          <h2>{t("Your first presentation awaits")}</h2>
          <p className="muted">{t("Start from scratch, or from one shared in Community.")}</p>
          <div className="empty-actions">
            <Link to="/app/new" className="primary button with-icon"><Plus size={18} strokeWidth={2.6} /> {t("Create a presentation")}</Link>
            <Link to="/app/community" className="ghost button">{t("Browse Community")}</Link>
          </div>
        </div>
      )}

      {showList && (
        <div className="lt-list">
          <div className="lt-bar">
            <div className="lt-top">
              <SearchField value={query} onChange={setQuery} label={t("Search presentations")} placeholder={t("Title, code or author")} />
              <ChoiceMenu icon={ArrowDownWideNarrow} className="lt-sort" label={t("Sort by")} text={t(SORT_LABEL[sort])} choices={sortChoices} value={sort} onChange={setSort} />
            </div>
            {(statusChips.length > 0 || team || showTypes) && (
              <div className="lt-chips" role="group" aria-label={t("Filter")}>
                <FilterChip on={!status && !owner && !kind} onClick={resetFilters}>
                  {t("All")}
                </FilterChip>
                {statusChips.map((s) => (
                  <FilterChip key={s} on={status === s} onClick={() => setStatus(status === s ? null : s)}>
                    {s === "live" && <i className="hb-dot small" aria-hidden />}
                    {t(STATUS_LABEL[s])}
                  </FilterChip>
                ))}
                {team &&
                  (["mine", "team"] as Owner[]).map((o) => (
                    <FilterChip key={o} on={owner === o} onClick={() => setOwner(owner === o ? null : o)}>
                      {t(o === "mine" ? "Mine" : "Team")}
                    </FilterChip>
                  ))}
                {showTypes && (
                  <ChoiceMenu
                    icon={kind ? kindInfo(kind).icon : Shapes}
                    label={t("Question type")}
                    text={kind ? t(kindInfo(kind).label) : t("Question type")}
                    choices={kindChoices}
                    value={kind}
                    onChange={setKind}
                    active={!!kind}
                  />
                )}
              </div>
            )}
          </div>

          {!decks ? (
            <SkeletonRows />
          ) : shown.length > 0 ? (
            <ul className="recent hb-recent lt-rows">
              {shown.map((d, i) => (
                <Row key={d.code} deck={d} query={query} i={i} />
              ))}
            </ul>
          ) : (
            <ListState
              icon={SearchX}
              title={
                !query.trim()
                  ? t("No presentation matches these filters.")
                  : narrowed && searched > 0
                    ? t("No presentation matches \"{query}\" with these filters.", { query: short(query) })
                    : t("No presentation matches \"{query}\".", { query: short(query) })
              }
            >
              {/* The filters come first when the search alone would find something. */}
              {narrowed && searched > 0 && (
                <button type="button" className="hb-chip" onClick={resetFilters}>
                  {t("Reset filters")}
                </button>
              )}
              {query.trim() && (
                <button type="button" className="hb-chip" onClick={() => setQuery("")}>
                  {t("Clear search")}
                </button>
              )}
              {narrowed && searched === 0 && (
                <button type="button" className="hb-chip" onClick={resetFilters}>
                  {t("Reset filters")}
                </button>
              )}
            </ListState>
          )}
        </div>
      )}
    </AppShell>
  );
}
