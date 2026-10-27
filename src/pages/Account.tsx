import { useEffect, useRef, useState } from "react";
import {
  CalendarDays,
  Check,
  Download,
  KeyRound,
  Languages,
  LogOut,
  Mail,
  MonitorSmartphone,
  Palette,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  TriangleAlert,
  UserPlus,
  UserRound,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { api, displayName, setUser, signOut, useUser, type User } from "../api";
import { bgCss, type Brand } from "../brand-core";
import { forgetDecks } from "../decks";
import { navigate } from "../router";
import { AppShell, initials } from "./AppShell";
import { Link, PasswordInput } from "../ui";
import { setAppLang, translate, useAppLang, useAppT, type AppLang } from "../app-i18n";

type Account = User & { createdAt: number; hasPassword: boolean; sessions: number };
type Change = (a: Account) => void;

const locale = (lang: AppLang) => (lang === "fr" ? "fr-FR" : "en-US");

// The page's sections, in the side navigation (a tab strip on phones). The one shown lives in the address: #team.
const SECTIONS: { id: string; label: string; hint: string; icon: LucideIcon }[] = [
  { id: "profile", label: "Profile", hint: "How you appear in Hopvote.", icon: UserRound },
  { id: "security", label: "Account and security", hint: "Your sign-in, your devices and your data.", icon: ShieldCheck },
  { id: "preferences", label: "Preferences", hint: "Language and brand kits.", icon: SlidersHorizontal },
  { id: "team", label: "Team", hint: "Share presentations and present together, each with your own account.", icon: UsersRound },
  { id: "danger", label: "Danger zone", hint: "Actions that can't be undone.", icon: TriangleAlert },
];

function sectionFromUrl() {
  const id = location.hash.slice(1);
  return SECTIONS.some((s) => s.id === id) ? id : "profile";
}

// Feedback next to the action that triggered it: in progress, done (cleared after a moment), or the error.
type Flash = { kind: "busy" | "ok" | "error"; text: string } | null;

function useFlash() {
  const [flash, setFlash] = useState<Flash>(null);
  const timer = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);
  const show = (next: Flash, ms = 2500) => {
    clearTimeout(timer.current);
    setFlash(next);
    if (next?.kind === "ok") timer.current = window.setTimeout(() => setFlash(null), ms);
  };
  return [flash, show] as const;
}

function Status({ flash }: { flash: Flash }) {
  const quiet = flash && flash.kind !== "error" ? flash : null;
  return (
    <>
      <span className={`set-status ${quiet?.kind ?? ""}`} role="status" aria-live="polite">
        {quiet?.kind === "ok" && <Check size={15} strokeWidth={3} aria-hidden />}
        {quiet?.text}
      </span>
      {flash?.kind === "error" && <span className="set-status error" role="alert">{flash.text}</span>}
    </>
  );
}

// When a question or a form closes, focus goes back to the button that opened it, or to the section title once that button is gone.
function refocus(id: string, panel: string) {
  setTimeout(() => (document.getElementById(id) ?? document.getElementById(`settings-${panel}-title`))?.focus(), 30);
}

const message = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);

function Row({ icon: Icon, tone, title, hint, children, className }: { icon?: LucideIcon; tone?: string; title: React.ReactNode; hint?: React.ReactNode; children?: React.ReactNode; className?: string }) {
  return (
    <div className={`set-row ${className ?? ""}`}>
      {Icon && (
        <span className={`set-icon ${tone ? `is-${tone}` : ""}`} aria-hidden>
          <Icon size={19} />
        </span>
      )}
      <div className="set-text">
        <strong>{title}</strong>
        {hint && <span>{hint}</span>}
      </div>
      {children && <div className="set-actions">{children}</div>}
    </div>
  );
}

// A dangerous action asks once more, in place, under its row.
function Confirm({ question, yes, busy, onYes, onNo, flash }: { question: string; yes: string; busy?: boolean; onYes: () => void; onNo: () => void; flash?: Flash }) {
  const t = useAppT();
  return (
    <div className="set-sub set-confirm" role="group" aria-label={question}>
      <p>{question}</p>
      <div className="set-actions">
        {flash !== undefined && <Status flash={flash} />}
        <button type="button" className="danger small" onClick={onYes} disabled={busy}>{yes}</button>
        <button type="button" className="ghost small" onClick={onNo} autoFocus>{t("Cancel")}</button>
      </div>
    </div>
  );
}

function Panel({ id, active, children }: { id: string; active: boolean; children: React.ReactNode }) {
  const t = useAppT();
  const s = SECTIONS.find((x) => x.id === id)!;
  return (
    <section className="set-panel" id={`settings-${id}`} hidden={!active} aria-labelledby={`settings-${id}-title`}>
      <header className="set-head">
        <h2 id={`settings-${id}-title`} tabIndex={-1}>{t(s.label)}</h2>
        <p>{t(s.hint)}</p>
      </header>
      {children}
    </section>
  );
}

function SubHead({ title, note }: { title: string; note?: string }) {
  return (
    <div className="set-subhead">
      <h3>{title}</h3>
      {note && <span>{note}</span>}
    </div>
  );
}

/* Profile */

function Profile({ account, onChange }: { account: Account; onChange: Change }) {
  const lang = useAppLang();
  const t = useAppT();
  const saved = displayName(account.name);
  const [name, setName] = useState(saved);
  const [flash, show] = useFlash();
  const busy = flash?.kind === "busy";
  const changed = name.trim() !== saved;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!changed || !name.trim() || busy) return;
    show({ kind: "busy", text: t("Saving…") });
    try {
      const { user } = await api<{ user: User }>("/api/account", { method: "PATCH", body: { name } });
      // Only the name changes: the team fields stay as the account page loaded them.
      const next = { ...account, name: user.name };
      setUser({ id: next.id, email: next.email, name: next.name, plan: next.plan, ownPlan: next.ownPlan, teamRole: next.teamRole });
      onChange(next);
      setName(displayName(user.name));
      show({ kind: "ok", text: t("Saved") });
    } catch (err) {
      show({ kind: "error", text: message(err, t("Couldn't save")) });
    }
  }

  return (
    <div className="set-card">
      <form className="set-row set-name" onSubmit={save}>
        <span className="set-avatar" aria-hidden>{initials(displayName(name.trim() || saved))}</span>
        <div className="set-text">
          <label htmlFor="set-first-name"><strong>{t("First name")}</strong></label>
          <span>{t("Shown in your workspace and to your teammates.")}</span>
          <div className="set-inline">
            <input id="set-first-name" maxLength={60} autoComplete="given-name" value={name} onChange={(e) => setName(e.target.value)} />
            <button className={changed && name.trim() ? "primary small" : "ghost small"} disabled={!changed || !name.trim() || busy}>{t("Save")}</button>
            <Status flash={flash} />
          </div>
        </div>
      </form>
      <Row icon={CalendarDays} title={t("Member since")} hint={new Intl.DateTimeFormat(locale(lang), { month: "long", year: "numeric" }).format(account.createdAt)} />
    </div>
  );
}

/* Account and security */

function Security({ account, onChange }: { account: Account; onChange: Change }) {
  const t = useAppT();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [formFlash, showForm] = useFlash();
  const [pwFlash, showPw] = useFlash();
  const [asking, setAsking] = useState(false);
  const [devFlash, showDev] = useFlash();
  const [outFlash, showOut] = useFlash();
  const pwBusy = formFlash?.kind === "busy";

  function closeForm() {
    setOpen(false);
    setCurrent("");
    setNext("");
    showForm(null);
    refocus("set-pw-btn", "security");
  }

  async function savePassword(e: React.FormEvent) {
    e.preventDefault();
    if (pwBusy) return;
    showForm({ kind: "busy", text: t("Saving…") });
    try {
      await api("/api/account/password", { body: { current, next } });
      // The server logs out every other session and app when the password changes.
      const others = account.sessions > 1;
      closeForm();
      onChange({ ...account, hasPassword: true, sessions: 1 });
      setAsking(false);
      showPw({ kind: "ok", text: others ? t("Password saved. Other devices logged out.") : t("Password saved") }, 5000);
    } catch (err) {
      showForm({ kind: "error", text: message(err, t("Couldn't save")) });
    }
  }

  async function logoutOthers() {
    showDev({ kind: "busy", text: t("Logging out…") });
    try {
      await api("/api/account/sessions", { method: "DELETE" });
      setAsking(false);
      onChange({ ...account, sessions: 1 });
      refocus("set-dev-btn", "security");
      showDev({ kind: "ok", text: t("Other devices logged out") }, 4000);
    } catch (err) {
      showDev({ kind: "error", text: message(err, t("Couldn't log out the others")) });
    }
  }

  // Everything this account made, in one readable file.
  async function exportData() {
    showOut({ kind: "busy", text: t("Preparing…") });
    try {
      const { polls } = await api<{ polls: { code: string; by?: string }[] }>("/api/polls");
      // This person's own presentations: a teammate's stay out of their data.
      const presentations = await Promise.all(polls.filter((p) => !p.by).map((p) => api(`/api/polls/${p.code}`)));
      const data = { account: { name: account.name, email: account.email, createdAt: new Date(account.createdAt).toISOString() }, presentations };
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      Object.assign(document.createElement("a"), { href: url, download: "hopvote-my-data.json" }).click();
      URL.revokeObjectURL(url);
      showOut({ kind: "ok", text: t("Downloaded") });
    } catch (err) {
      showOut({ kind: "error", text: message(err, t("Couldn't export. Try again.")) });
    }
  }

  const many = account.sessions > 1;
  return (
    <div className="set-card">
      <Row icon={Mail} title={t("Email")} hint={account.email} />
      <Row icon={KeyRound} title={t("Password")} hint={account.hasPassword ? t("Sign in with email and password, or with Google.") : t("You sign in with Google only.")}>
        <Status flash={pwFlash} />
        {!open && (
          <button id="set-pw-btn" className="ghost small" onClick={() => (showPw(null), setOpen(true))}>{account.hasPassword ? t("Change") : t("Add")}</button>
        )}
      </Row>
      {open && (
        <form className="set-sub" onSubmit={savePassword}>
          <div className="set-fields">
            {account.hasPassword && (
              <label className="field">
                <span>{t("Current password")}</span>
                <PasswordInput autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
              </label>
            )}
            <label className="field">
              <span>{t("New password")}</span>
              <PasswordInput autoComplete="new-password" minLength={8} placeholder={t("At least 8 characters")} value={next} onChange={(e) => setNext(e.target.value)} />
            </label>
          </div>
          <p className="set-fine">
            {t("Saving logs out your other devices.")}
            {account.hasPassword && (
              <>
                {" "}
                <Link to="/forgot">{t("Forgot your password?")}</Link>
              </>
            )}
          </p>
          <div className="set-actions">
            <button className="primary small" disabled={next.length < 8 || pwBusy}>{t("Save")}</button>
            <button type="button" className="ghost small" onClick={closeForm}>{t("Cancel")}</button>
            <Status flash={formFlash} />
          </div>
        </form>
      )}
      <Row icon={MonitorSmartphone} title={many ? t("{n} devices signed in", { n: account.sessions }) : t("1 device signed in")} hint={many ? t("Other browsers signed in to your account.") : t("Just this one.")}>
        <Status flash={asking ? null : devFlash} />
        {many && !asking && <button id="set-dev-btn" className="ghost small" onClick={() => (showDev(null), setAsking(true))}>{t("Log out the others")}</button>}
      </Row>
      {asking && (
        <Confirm
          question={t("Log out every other device?")}
          yes={t("Log out the others")}
          busy={devFlash?.kind === "busy"}
          flash={devFlash}
          onYes={logoutOthers}
          onNo={() => (setAsking(false), showDev(null), refocus("set-dev-btn", "security"))}
        />
      )}
      <Row icon={Download} title={t("Export my data")} hint={t("Your account, your presentations and their results.")}>
        <Status flash={outFlash} />
        <button className="ghost small" onClick={exportData} disabled={outFlash?.kind === "busy"}>{t("Export")}</button>
      </Row>
      <Row icon={LogOut} title={t("Log out")} hint={t("Leave your account on this device.")}>
        <button className="ghost small" onClick={() => signOut().then(() => (forgetDecks(), navigate("/")))}>{t("Log out")}</button>
      </Row>
    </div>
  );
}

/* Preferences */

type Kit = { id: string; name: string; brand: Brand };

function Preferences({ account }: { account: Account }) {
  const lang = useAppLang();
  const t = useAppT();
  const [langFlash, showLang] = useFlash();
  const [kits, setKits] = useState<Kit[] | null>(null);
  const [asking, setAsking] = useState("");
  const [kitFlash, showKit] = useFlash();

  useEffect(() => {
    api<{ kits: Kit[] }>("/api/brand-kits").then((d) => setKits(d.kits), () => setKits([]));
  }, []);

  async function removeKit(kit: Kit) {
    showKit({ kind: "busy", text: t("Deleting…") });
    try {
      await api(`/api/brand-kits/${kit.id}`, { method: "DELETE" });
      setKits((all) => (all ?? []).filter((k) => k.id !== kit.id));
      setAsking("");
      showKit({ kind: "ok", text: t("Deleted") });
      refocus("", "preferences");
    } catch (err) {
      showKit({ kind: "error", text: message(err, t("Couldn't delete. Try again.")) });
    }
  }

  const kitHint = kits?.length ? t("Apply them from Design, in any presentation.") : t("None yet. Save one from Design, in any presentation.");
  return (
    <div className="set-card">
      <div className="set-row">
        <span className="set-icon" aria-hidden><Languages size={19} /></span>
        <div className="set-text">
          <label htmlFor="set-lang"><strong>{t("Language")}</strong></label>
          <span>{t("Menus and screens of the app, on this device.")}</span>
        </div>
        <div className="set-actions">
          <Status flash={langFlash} />
          <select
            id="set-lang"
            className="set-select"
            value={lang}
            onChange={(e) => {
              setAppLang(e.target.value as AppLang);
              showLang({ kind: "ok", text: translate(e.target.value as AppLang, "Saved") });
            }}
          >
            <option value="en">English</option>
            <option value="fr">Français</option>
          </select>
        </div>
      </div>
      <Row icon={Palette} title={t("Brand kits")} hint={kits ? kitHint : " "}>
        <Status flash={asking ? null : kitFlash} />
      </Row>
      {kits?.map((k) => (
        <div key={k.id} className="set-group">
          <div className="set-kit">
            <i className="set-swatch" style={{ background: k.brand.bg ? bgCss(k.brand.bg) : "#151a3d" }} aria-hidden>
              <b style={{ background: k.brand.color ?? "#ff5436" }} />
            </i>
            <span className="truncate">{k.name}</span>
            {asking !== k.id && (
              <button id={`set-kit-${k.id}`} className="hb-icon-btn set-kit-x" aria-label={t("Delete {name}", { name: k.name })} title={t("Delete")} onClick={() => (showKit(null), setAsking(k.id))}>
                <Trash2 size={16} />
              </button>
            )}
          </div>
          {asking === k.id && (
            <Confirm
              question={t("Delete this brand kit?")}
              yes={t("Delete")}
              busy={kitFlash?.kind === "busy"}
              flash={kitFlash}
              onYes={() => removeKit(k)}
              onNo={() => (setAsking(""), showKit(null), refocus(`set-kit-${k.id}`, "preferences"))}
            />
          )}
        </div>
      ))}
    </div>
  );
}

/* Team */

type TeamMember = { email?: string; name: string; joined: boolean; expired?: boolean; you?: boolean };
type TeamInfo = { role: "owner" | "member" | null; seats: number; owner?: string; members: TeamMember[] };

// Teams: the owner invites up to 2 people by email; a member sees who is in and can leave.
function Team({ account }: { account: Account }) {
  const t = useAppT();
  const [info, setInfo] = useState<TeamInfo | null>(null);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState("");
  const [asking, setAsking] = useState("");
  // Where the last action's feedback shows: "invite", "leave" or a member's email.
  const [at, setAt] = useState("");
  const [flash, show] = useFlash();
  const load = () => api<TeamInfo>("/api/team").then(setInfo, () => {});
  useEffect(() => {
    load();
  }, [account.plan]);
  if (!info?.role) return null;

  const note = (where: string, next: Flash, ms?: number) => {
    setAt(where);
    show(next, ms);
  };

  async function invite(address: string, where: string) {
    setBusy(address);
    note(where, { kind: "busy", text: t("Sending…") });
    try {
      await api("/api/team/invite", { body: { email: address } });
      if (where === "invite") setEmail("");
      await load();
      note(where, { kind: "ok", text: t("Invitation sent") }, 4000);
    } catch (err) {
      note(where, { kind: "error", text: message(err, t("No connection")) });
    }
    setBusy("");
  }
  async function remove(m: TeamMember) {
    const where = m.email ?? "";
    setBusy(where);
    note(where, { kind: "busy", text: t("Removing…") });
    try {
      await api("/api/team/remove", { body: { email: m.email } });
      setAsking("");
      show(null);
      await load();
      refocus("", "team");
    } catch (err) {
      note(where, { kind: "error", text: message(err, t("No connection")) });
    }
    setBusy("");
  }
  async function leave() {
    setBusy("leave");
    note("leave", { kind: "busy", text: t("Leaving…") });
    try {
      await api("/api/team/leave", { method: "POST" });
      const { user } = await api<{ user: User }>("/api/me");
      setUser(user);
      forgetDecks();
      location.reload();
    } catch (err) {
      note("leave", { kind: "error", text: message(err, t("No connection")) });
      setBusy("");
    }
  }
  const here = (where: string) => (at === where ? flash : null);

  if (info.role === "member") {
    // The owner is named in the title; the hint lists the others, you first.
    const names = [t("You"), ...info.members.filter((m) => !m.you).map((m) => displayName(m.name))];
    return (
      <>
        <div className="set-card">
          <Row icon={UsersRound} title={t("{name}'s team", { name: displayName(info.owner ?? "") })} hint={names.join(", ")}>
            {asking !== "leave" && <button id="set-team-leave" className="ghost small" onClick={() => (show(null), setAsking("leave"))}>{t("Leave")}</button>}
          </Row>
          {asking === "leave" && (
            <Confirm
              question={t("Leave the team? Your presentations stay yours.")}
              yes={t("Leave")}
              busy={busy === "leave"}
              flash={here("leave")}
              onYes={leave}
              onNo={() => (setAsking(""), show(null), refocus("set-team-leave", "team"))}
            />
          )}
        </div>
      </>
    );
  }

  const used = 1 + info.members.length;
  return (
    <>
      <SubHead title={t("{n} of {m} presenters", { n: used, m: info.seats })} />
      <div className="set-card">
        <div className="set-row">
          <span className="set-avatar" aria-hidden>{initials(displayName(account.name))}</span>
          <div className="set-text">
            <strong className="truncate">{displayName(account.name)}</strong>
            <span>{t("You, owner")}</span>
          </div>
        </div>
        {info.members.map((m) => {
          const key = m.email ?? m.name;
          const who = m.joined && m.name ? displayName(m.name) : m.email ?? "";
          return (
            <div key={key} className="set-group">
              <div className="set-row">
                <span className={`set-avatar ${m.joined ? "navy" : "pending"}`} aria-hidden>{m.joined ? initials(who) : <Mail size={17} />}</span>
                <div className="set-text">
                  <strong className="truncate">{who}</strong>
                  <span className="truncate">{m.joined ? m.email : m.expired ? t("Invitation expired") : t("Invitation sent")}</span>
                </div>
                {asking !== key && (
                  <div className="set-actions">
                    <Status flash={here(key)} />
                    {!m.joined && (
                      <button className="ghost small" disabled={!!busy} onClick={() => invite(m.email ?? "", key)}>{t("Send again")}</button>
                    )}
                    <button id={`set-team-${key}`} className="ghost small" disabled={!!busy} onClick={() => (show(null), setAsking(key))}>{m.joined ? t("Remove") : t("Withdraw")}</button>
                  </div>
                )}
              </div>
              {asking === key && (
                <Confirm
                  question={m.joined ? t("Remove {name} from your team? Their presentations stay theirs.", { name: who }) : t("Withdraw this invitation?")}
                  yes={m.joined ? t("Remove") : t("Withdraw the invitation")}
                  busy={busy === key}
                  flash={here(key)}
                  onYes={() => remove(m)}
                  onNo={() => (setAsking(""), show(null), refocus(`set-team-${key}`, "team"))}
                />
              )}
            </div>
          );
        })}
        {used < info.seats && (
          <form
            className="set-row set-invite"
            onSubmit={(e) => {
              e.preventDefault();
              invite(email.trim(), "invite");
            }}
          >
            <span className="set-icon" aria-hidden><UserPlus size={19} /></span>
            <div className="set-text">
              <label htmlFor="set-invite"><strong>{t("Invite a presenter")}</strong></label>
              <span>{t("An email invites them to join with their own account.")}</span>
              <div className="set-inline">
                <input id="set-invite" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t("colleague@company.com")} />
                <button className="primary small" disabled={!!busy}>{busy && at === "invite" ? t("Sending…") : t("Invite")}</button>
                <Status flash={here("invite")} />
              </div>
            </div>
          </form>
        )}
      </div>
    </>
  );
}

/* Danger zone */

function Danger({ account }: { account: Account }) {
  const t = useAppT();
  // The word to type, in the app's language; the server is always sent "DELETE".
  const word = t("DELETE");
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [flash, show] = useFlash();
  const busy = flash?.kind === "busy";

  async function remove() {
    show({ kind: "busy", text: t("Deleting…") });
    try {
      await api("/api/account", { method: "DELETE", body: { confirm: "DELETE" } });
      try {
        for (const key of Object.keys(localStorage)) if (key.startsWith("hopvote:host:")) localStorage.removeItem(key);
      } catch {
        // Storage blocked: nothing was kept.
      }
      forgetDecks();
      setUser(null);
      navigate("/");
    } catch (err) {
      show({ kind: "error", text: message(err, t("Couldn't delete. Try again.")) });
    }
  }

  function close() {
    setOpen(false);
    setTyped("");
    show(null);
    refocus("set-delete-btn", "danger");
  }

  return (
    <div className="set-card is-danger">
      <Row icon={Trash2} tone="danger" title={t("Delete account")} hint={t("Presentations, results and images are erased.")}>
        {!open && <button id="set-delete-btn" className="ghost small danger-text" onClick={() => setOpen(true)}>{t("Delete")}</button>}
      </Row>
      {open && (
        <form
          className="set-sub set-delete"
          onSubmit={(e) => {
            e.preventDefault();
            if (typed.trim().toUpperCase() === word && !busy) remove();
          }}
        >
          <label className="field">
            <span>{t("Type {word} to confirm.", { word })}</span>
            <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={word} autoComplete="off" autoCapitalize="characters" spellCheck={false} autoFocus />
          </label>
          <div className="set-actions">
            <button className="danger small" disabled={typed.trim().toUpperCase() !== word || busy}>{t("Delete my account")}</button>
            <button type="button" className="ghost small" onClick={close}>{t("Cancel")}</button>
            <Status flash={flash} />
          </div>
        </form>
      )}
    </div>
  );
}

/* The page */

export function Account() {
  const t = useAppT();
  const user = useUser();
  const [account, setAccount] = useState<Account | null>(null);
  const [failed, setFailed] = useState(false);
  const [section, setSection] = useState(sectionFromUrl);
  const tabs = useRef<HTMLUListElement>(null);
  const layout = useRef<HTMLDivElement>(null);

  const load = () => {
    setFailed(false);
    api<Account>("/api/account").then(setAccount, () => setFailed(true));
  };
  useEffect(() => {
    if (user) load();
  }, [user?.id]);

  // Links to /app/account#team from elsewhere in the app, and the browser's Back.
  useEffect(() => {
    const follow = () => setSection(sectionFromUrl());
    addEventListener("popstate", follow);
    addEventListener("hashchange", follow);
    return () => {
      removeEventListener("popstate", follow);
      removeEventListener("hashchange", follow);
    };
  }, []);

  // On phones the tab strip scrolls: the chosen tab stays in view.
  useEffect(() => {
    const list = tabs.current;
    const on = list?.querySelector<HTMLElement>(".on");
    if (!list || !on || list.scrollWidth <= list.clientWidth) return;
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    list.scrollTo({ left: on.offsetLeft - (list.clientWidth - on.offsetWidth) / 2, behavior: still ? "auto" : "smooth" });
  }, [section, account]);

  const go = (id: string) => {
    setSection(id);
    history.replaceState(null, "", `/app/account#${id}`);
    const top = layout.current?.getBoundingClientRect().top ?? 0;
    if (top < 0) layout.current?.scrollIntoView({ block: "start" });
  };

  return (
    <AppShell title={t("Settings")} subtitle={t("Your account, your team and your preferences.")}>
      {account ? (
        <div className="set-layout" ref={layout}>
          <nav className="set-nav" aria-label={t("Settings")}>
            <ul ref={tabs}>
              {SECTIONS.map(({ id, label, icon: Icon }) => (
                <li key={id}>
                  <a
                    href={`#${id}`}
                    className={`set-tab ${id === section ? "on" : ""} ${id === "danger" ? "is-danger" : ""}`}
                    aria-current={id === section ? "true" : undefined}
                    aria-controls={`settings-${id}`}
                    onClick={(e) => {
                      e.preventDefault();
                      go(id);
                    }}
                  >
                    <Icon size={18} aria-hidden />
                    <span>{t(label)}</span>
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <div className="set-panels">
            <Panel id="profile" active={section === "profile"}>
              <Profile account={account} onChange={setAccount} />
            </Panel>
            <Panel id="security" active={section === "security"}>
              <Security account={account} onChange={setAccount} />
            </Panel>
            <Panel id="preferences" active={section === "preferences"}>
              <Preferences account={account} />
            </Panel>
            <Panel id="team" active={section === "team"}>
              <Team account={account} />
            </Panel>
            <Panel id="danger" active={section === "danger"}>
              <Danger account={account} />
            </Panel>
          </div>
        </div>
      ) : failed ? (
        <div className="set-failed" role="alert">
          <p className="error">{t("Couldn't load your settings.")}</p>
          <button className="ghost small" onClick={load}>{t("Try again")}</button>
        </div>
      ) : (
        <p className="muted center-load" role="status" aria-live="polite"><span className="spinner" aria-hidden />{t("Loading…")}</p>
      )}
    </AppShell>
  );
}
