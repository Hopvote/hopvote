// The tools shared by the app's lists (Presentations, Community): the search field, the filter and sort menus,
// the highlighted match, and the loading, empty and error states.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search, X, type LucideIcon } from "lucide-react";
import { useAppT } from "../app-i18n";
import { rememberPage } from "../router";

// Case and accent insensitive: "retro" finds "Rétrospective".
export const fold = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
const words = (query: string) => fold(query).split(/\s+/).filter(Boolean);

// Every word of the query is found in one of the fields.
export function matches(query: string, fields: (string | undefined | null)[]) {
  const q = words(query);
  if (!q.length) return true;
  const text = fold(fields.filter(Boolean).join(" \n "));
  return q.every((w) => text.includes(w));
}

// The search and filters live in the address (replaced, never added to the history), so Back from a result
// finds the list as it was. Only known values are read back; an unknown one counts as none.
export function urlParam<T extends string>(key: string, allowed?: readonly T[]): T | null {
  try {
    const v = new URLSearchParams(location.search).get(key);
    if (!v) return null;
    return !allowed || allowed.includes(v as T) ? (v as T) : null;
  } catch {
    return null;
  }
}
// readBack runs when the address changes under the page (its own link in the menu, Back, Forward), to show what it asks.
export function useUrlParams(params: Record<string, string | null | undefined>, readBack: () => void) {
  const key = JSON.stringify(params);
  const page = useRef(location.pathname);
  const read = useRef(readBack);
  read.current = readBack;
  useEffect(() => {
    const onPop = () => location.pathname === page.current && read.current();
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, []);
  useEffect(() => {
    try {
      if (location.pathname !== page.current) return;
      const u = new URL(location.href);
      for (const [k, v] of Object.entries(params)) {
        if (v) u.searchParams.set(k, v);
        else u.searchParams.delete(k);
      }
      if (u.href === location.href) return;
      history.replaceState(history.state, "", u.pathname + u.search + u.hash);
      rememberPage();
    } catch {
      // The list still works; only Back loses the search.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

// The query as quoted in a message, cut so it stays on one line.
export const short = (q: string) => (q.trim().length > 32 ? `${q.trim().slice(0, 30)}…` : q.trim());

// The text with the words of the query marked, accents ignored.
export function Highlight({ text, query }: { text: string; query: string }) {
  const q = words(query);
  if (!q.length) return <>{text}</>;
  // Folded text, and for each folded character the index of the original one.
  let folded = "";
  const at: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const f = fold(text[i]);
    folded += f;
    for (let j = 0; j < f.length; j++) at.push(i);
  }
  const marked = new Array<boolean>(text.length).fill(false);
  for (const w of q) {
    let from = folded.indexOf(w);
    while (from !== -1) {
      for (let k = from; k < from + w.length; k++) marked[at[k]] = true;
      from = folded.indexOf(w, from + w.length);
    }
  }
  const parts: { text: string; on: boolean }[] = [];
  for (let i = 0; i < text.length; i++) {
    const last = parts[parts.length - 1];
    if (last && last.on === marked[i]) last.text += text[i];
    else parts.push({ text: text[i], on: marked[i] });
  }
  return <>{parts.map((p, i) => (p.on ? <mark key={i} className="lt-mark">{p.text}</mark> : p.text))}</>;
}

// The search field: one frame, the accent and a halo when focused, a button to clear it. Escape clears, "/" focuses.
export function SearchField({ value, onChange, placeholder, label }: { value: string; onChange: (v: string) => void; placeholder: string; label: string }) {
  const t = useAppT();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const slash = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      const typing = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey && !e.altKey && !document.querySelector(".sheet, .lt-pop")) {
        e.preventDefault();
        input.current?.focus();
      }
    };
    addEventListener("keydown", slash);
    return () => removeEventListener("keydown", slash);
  }, []);
  return (
    <label className="lt-search">
      <Search size={19} aria-hidden />
      <span className="sr-only">{label}</span>
      <input
        ref={input}
        type="search"
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="search"
        maxLength={100}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Escape") return;
          if (value) {
            e.preventDefault();
            e.stopPropagation();
            onChange("");
          } else input.current?.blur();
        }}
      />
      {value && (
        <button
          type="button"
          className="lt-clear"
          aria-label={t("Clear search")}
          title={t("Clear search")}
          onClick={() => {
            onChange("");
            input.current?.focus();
          }}
        >
          <X size={17} />
        </button>
      )}
    </label>
  );
}

export type Choice<T> = { value: T; label: string; icon?: LucideIcon; count?: number };

// A button that opens a short list of choices above the page (rendered in a portal, so no card or scroll area cuts it).
// Arrow keys move, Enter picks, Escape or a click outside closes.
export function ChoiceMenu<T extends string | null>({
  icon: Icon,
  text,
  label,
  choices,
  value,
  onChange,
  active = false,
  className = "",
}: {
  icon: LucideIcon;
  text: string;
  label: string;
  choices: Choice<T>[];
  value: T;
  onChange: (v: T) => void;
  active?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left?: number; right?: number; up: boolean } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open) return setPos(null);
    const place = () => {
      const r = button.current?.getBoundingClientRect();
      if (!r) return;
      // Under the button, left edges aligned; right edges aligned when the button sits near the right side.
      const right = r.left + 280 > innerWidth - 12;
      const up = r.bottom + 320 > innerHeight && r.top > innerHeight - r.bottom;
      setPos({ top: up ? r.top - 6 : r.bottom + 6, left: right ? undefined : Math.max(12, r.left), right: right ? Math.max(12, innerWidth - r.right) : undefined, up });
    };
    place();
    // The page scrolling moves the button away: close. Scrolling the list itself keeps it open.
    const close = (e: Event) => !menu.current?.contains(e.target as Node) && setOpen(false);
    addEventListener("resize", place);
    addEventListener("scroll", close, true);
    return () => {
      removeEventListener("resize", place);
      removeEventListener("scroll", close, true);
    };
  }, [open]);

  const placed = !!pos;
  useEffect(() => {
    if (!open || !placed) return;
    const items = () => [...(menu.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    (items().find((b) => b.getAttribute("aria-checked") === "true") ?? items()[0])?.focus();
    const outside = (e: PointerEvent) => {
      const el = e.target as Node;
      if (!menu.current?.contains(el) && !button.current?.contains(el)) setOpen(false);
    };
    const keys = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Tab") {
        if (e.key === "Escape") e.preventDefault();
        setOpen(false);
        button.current?.focus();
        return;
      }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
      e.preventDefault();
      const list = items();
      const i = list.indexOf(document.activeElement as HTMLButtonElement);
      const next = e.key === "Home" ? 0 : e.key === "End" ? list.length - 1 : (i + (e.key === "ArrowDown" ? 1 : -1) + list.length) % list.length;
      list[next]?.focus();
    };
    addEventListener("pointerdown", outside, true);
    addEventListener("keydown", keys, true);
    return () => {
      removeEventListener("pointerdown", outside, true);
      removeEventListener("keydown", keys, true);
    };
  }, [open, placed]);

  return (
    <>
      <button
        ref={button}
        type="button"
        className={`hb-chip lt-menu-btn ${active ? "strong" : ""} ${className}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${label}: ${text}`}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon size={16} aria-hidden />
        <span className="lt-menu-text">{text}</span>
        <ChevronDown size={15} className="lt-caret" aria-hidden />
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={menu}
            className={`lt-pop ${pos.up ? "up" : ""} ${choices.some((c) => c.icon) ? "" : "plain"}`}
            role="menu"
            aria-label={label}
            style={{ top: pos.top, left: pos.left, right: pos.right }}
          >
            {choices.map((c) => {
              const ItemIcon = c.icon;
              const on = c.value === value;
              return (
                <button
                  key={String(c.value)}
                  type="button"
                  role="menuitemradio"
                  aria-checked={on}
                  className={on ? "on" : ""}
                  onClick={() => {
                    onChange(c.value);
                    setOpen(false);
                    button.current?.focus();
                  }}
                >
                  <span className="lt-pop-icon" aria-hidden>{ItemIcon && <ItemIcon size={16} />}</span>
                  <span className="lt-pop-label">{c.label}</span>
                  {c.count !== undefined && <span className="lt-n">{c.count}</span>}
                  <Check size={16} className="lt-pop-check" aria-hidden />
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}

// A filter chip: pressed or not, with an optional count.
export function FilterChip({ on, onClick, children, count }: { on: boolean; onClick: () => void; children: React.ReactNode; count?: number }) {
  return (
    <button type="button" className={`hb-chip lt-chip ${on ? "strong" : ""}`} aria-pressed={on} onClick={onClick}>
      {children}
      {count !== undefined && <span className="lt-n">{count}</span>}
    </button>
  );
}

// Grey rows while the list loads.
export function SkeletonRows({ n = 6 }: { n?: number }) {
  const t = useAppT();
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">{t("Loading…")}</span>
      <ul className="recent lt-skel" aria-hidden>
        {Array.from({ length: n }, (_, i) => (
          <li key={i} style={{ "--i": i } as React.CSSProperties}>
            <span className="lt-skel-icon" />
            <span className="lt-skel-lines">
              <i style={{ width: `${[46, 62, 38, 54, 42, 58][i % 6]}%` }} />
              <i />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// A message in place of the list: nothing found, nothing yet, or an error, with what to do next.
export function ListState({ icon: Icon, title, text, children, alert = false }: { icon: LucideIcon; title: string; text?: string; children?: React.ReactNode; alert?: boolean }) {
  return (
    <div className="lt-state" role={alert ? "alert" : undefined}>
      <span className="lt-state-icon" aria-hidden>
        <Icon size={22} />
      </span>
      <h2>{title}</h2>
      {text && <p className="muted">{text}</p>}
      {children && <div className="lt-state-actions">{children}</div>}
    </div>
  );
}
