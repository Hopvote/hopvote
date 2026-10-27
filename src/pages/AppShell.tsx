import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronsUpDown, House, LayoutGrid, LifeBuoy, LogOut, Plus, Settings, Users } from "lucide-react";
import { displayName, signOut, useUser, type User } from "../api";
import { useAppT } from "../app-i18n";
import { forgetDecks, useDecks } from "../decks";
import { navigate } from "../router";
import { Link, Wordmark } from "../ui";

const BOTTOM = [
  { to: "/app/help", label: "Help", icon: LifeBuoy },
];

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("") || "?";

const isActive = (to: string, path: string) =>
  to === "/app" ? path === "/app" : path.startsWith(to) || (to === "/app/presentations" && path.startsWith("/app/p/"));

async function leave() {
  await signOut();
  forgetDecks();
  navigate("/");
}

const SHOWN_DECKS = 8;

// "Présentations" with a chevron that unfolds the user's presentations for quick access.
function DecksNav({ path }: { path: string }) {
  const t = useAppT();
  const { decks } = useDecks();
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem("hopvote:nav:decks") !== "closed";
    } catch {
      return true;
    }
  });
  const toggle = () =>
    setOpen((o) => {
      try {
        localStorage.setItem("hopvote:nav:decks", o ? "closed" : "open");
      } catch {
        // Only the remembered state is lost.
      }
      return !o;
    });

  return (
    <div className="side-tree">
      <div className={`side-link has-toggle ${path === "/app/presentations" ? "on" : ""}`}>
        <Link to="/app/presentations" className="side-link-main">
          <LayoutGrid size={19} />
          <span>{t("Presentations")}</span>
        </Link>
        <button className={`side-toggle ${open ? "open" : ""}`} aria-label={open ? t("Collapse") : t("Expand")} aria-expanded={open} onClick={toggle}>
          <ChevronDown size={16} />
        </button>
      </div>
      {open && decks && (
        <ul className="side-sub">
          {decks.length === 0 && <li className="side-empty">{t("No presentations")}</li>}
          {decks.slice(0, SHOWN_DECKS).map((d) => (
            <li key={d.code}>
              <Link to={`/app/p/${d.code}`} className={`side-sublink ${path === `/app/p/${d.code}` ? "on" : ""}`}>
                <span className="truncate">{d.title}</span>
              </Link>
            </li>
          ))}
          {decks.length > SHOWN_DECKS && (
            <li>
              <Link to="/app/presentations" className="side-sublink more">
                {t("See all ({n})", { n: decks.length })}
              </Link>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

// Profile block pinned to the bottom of the sidebar, with its menu opening upwards.
function ProfileCard({ user }: { user: User }) {
  const t = useAppT();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    addEventListener("mousedown", close);
    addEventListener("keydown", esc);
    return () => {
      removeEventListener("mousedown", close);
      removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div className="me" ref={box}>
      {open && (
        <div className="me-menu" role="menu">
          <div className="me-menu-id">
            <strong className="truncate">{displayName(user.name)}</strong>
            <span className="truncate">{user.email}</span>
          </div>
          <Link to="/app/account" className="me-item">
            <Settings size={18} /> {t("Settings")}
          </Link>
          <button className="me-item" onClick={leave}>
            <LogOut size={18} /> {t("Log out")}
          </button>
        </div>
      )}
      <button className="me-card" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="me-avatar">{initials(displayName(user.name))}</span>
        <span className="me-text">
          <strong className="truncate">{displayName(user.name)}</strong>
          <span className="truncate">{user.email}</span>
        </span>
        <ChevronsUpDown size={16} className="me-chevron" />
      </button>
    </div>
  );
}

// Layout for every signed-in page: navy sidebar on desktop, tab bar on phones.
export function AppShell({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const t = useAppT();
  const user = useUser();
  const path = location.pathname;

  // Back to the same page after signing in, query included.
  useEffect(() => {
    if (user === null) navigate(`/login?next=${encodeURIComponent(path + location.search)}`, true);
  }, [user, path]);

  if (!user) return <main className="page center muted center-load" role="status" aria-live="polite"><span className="spinner" aria-hidden />{t("Loading…")}</main>;

  return (
    <div className="shell">
      <aside className="side">
        <Link to="/app" className="side-logo">
          <Wordmark bounce />
        </Link>

        <Link to="/app/new" className="side-new">
          <Plus size={18} strokeWidth={2.8} /> {t("New presentation")}
        </Link>

        <nav className="side-group" aria-label={t("Menu")}>
          <Link to="/app" className={`side-link ${path === "/app" ? "on" : ""}`}>
            <House size={19} />
            <span>{t("Home")}</span>
          </Link>
          <DecksNav path={path} />
          <Link to="/app/community" className={`side-link ${isActive("/app/community", path) ? "on" : ""}`}>
            <Users size={19} />
            <span>{t("Community")}</span>
          </Link>
        </nav>

        <nav className="side-group side-bottom" aria-label={t("Help and settings")}>
          {BOTTOM.map(({ to, label, icon: Icon }) => (
            <Link key={to} to={to} className={`side-link ${isActive(to, path) ? "on" : ""}`}>
              <Icon size={19} />
              <span>{t(label)}</span>
            </Link>
          ))}
        </nav>

        <ProfileCard user={user} />
      </aside>

      <div className="shell-main">
        <header className="shell-top">
          <div className="shell-heading">
            <h1 className="shell-title">{title}</h1>
            {subtitle && <p className="shell-sub">{subtitle}</p>}
          </div>
          {action && <div className="shell-actions">{action}</div>}
        </header>
        <main className="shell-content">{children}</main>
      </div>

      <nav className="tabbar" aria-label={t("Menu")}>
        <Link to="/app" className={`tab ${path === "/app" ? "on" : ""}`}>
          <House size={22} />
          <span>{t("Home")}</span>
        </Link>
        <Link to="/app/presentations" className={`tab ${isActive("/app/presentations", path) || path.startsWith("/app/p/") ? "on" : ""}`}>
          <LayoutGrid size={22} />
          <span>{t("Presentations")}</span>
        </Link>
        <Link to="/app/new" className="tab tab-new" aria-label={t("New presentation")}>
          <span className="tab-plus"><Plus size={24} strokeWidth={2.6} /></span>
        </Link>
        <Link to="/app/community" className={`tab ${isActive("/app/community", path) ? "on" : ""}`}>
          <Users size={22} />
          <span>{t("Community")}</span>
        </Link>
        <Link to="/app/account" className={`tab ${isActive("/app/account", path) ? "on" : ""}`}>
          <span className="tab-avatar">{initials(user.name)}</span>
          <span>{t("Settings")}</span>
        </Link>
      </nav>
    </div>
  );
}
