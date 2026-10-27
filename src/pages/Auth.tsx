import { useEffect, useRef, useState } from "react";
import { navigate } from "../router";
import { api, setUser, useUser, type User } from "../api";
import { Link, Logo, PasswordInput } from "../ui";
import { useAppT } from "../app-i18n";
import { JoinCode } from "./JoinCode";

// "Text {x} more text" with a piece of markup in place of {x}.
function fill(text: string, slot: string, node: React.ReactNode) {
  const [before, after = ""] = text.split(slot);
  return <>{before}{node}{after}</>;
}

// Where to go after signing in: a page of this site only.
function nextPath() {
  const next = new URLSearchParams(location.search).get("next");
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/app";
}

// A sign-up finishes from the email, often in a new tab: the page the person was heading to (a team invitation,
// for instance) is kept on this device until they confirm.
const NEXT_KEY = "hopvote:next";
function keepNext() {
  try {
    if (nextPath() !== "/app") localStorage.setItem(NEXT_KEY, JSON.stringify({ path: nextPath(), at: Date.now() }));
  } catch {
    // Storage blocked: the account page is the fallback.
  }
}
function takeNext() {
  try {
    const saved = JSON.parse(localStorage.getItem(NEXT_KEY) ?? "null") as { path?: string; at?: number } | null;
    localStorage.removeItem(NEXT_KEY);
    if (saved?.path?.startsWith("/") && !saved.path.startsWith("//") && Date.now() - (saved.at ?? 0) < 2 * 86_400_000) return saved.path;
  } catch {
    // Nothing saved.
  }
  return "/app";
}

export function Auth({ mode, join }: { mode: "login" | "signup"; join?: boolean }) {
  const t = useAppT();
  const signup = mode === "signup";
  // Already signed in: straight to where the link was going.
  const user = useUser();
  useEffect(() => {
    if (user) navigate(nextPath(), true);
  }, [user]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (signup) {
        const res = await api<{ user?: User; pending?: boolean }>("/api/auth/signup", { body: { name, email, password } });
        if (!res.user) {
          keepNext();
          setSent(true);
          setBusy(false);
          return;
        }
        setUser(res.user);
        navigate(nextPath(), true);
        return;
      }
      const { user } = await api<{ user: User }>("/api/auth/login", { body: { email, password } });
      setUser(user);
      navigate(nextPath(), true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("No connection"));
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <main className="auth">
        <div className="auth-card">
          <Logo />
          <h1 className="title">{t("Check your inbox")}</h1>
          <p className="muted">{fill(t("We sent a link to {email}. Open it to finish creating your account."), "{email}", <strong>{email}</strong>)}</p>
          <p className="auth-note">
            {fill(t("Nothing after a minute? Look in your spam folder, or {retry}."), "{retry}", <button type="button" className="link" onClick={() => setSent(false)}>{t("try again")}</button>)}
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="auth">
      <div className="auth-card">
        <Logo />
        <h1 className="title">{signup ? t("Create your account") : t("Welcome back")}</h1>
        {!signup && <p className="muted">{t("Log in to get back to your presentations.")}</p>}

        <GoogleButton signup={signup} onError={setError} />

        <form className="stack" onSubmit={submit}>
          {signup && (
            <label className="field">
              <span>{t("First name")}</span>
              <input id="name" autoComplete="given-name" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            </label>
          )}
          <label className="field">
            <span>{t("Email")}</span>
            <input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus={!signup} />
          </label>
          <label className="field">
            <span>{t("Password")}</span>
            <PasswordInput
              id="password"
              autoComplete={signup ? "new-password" : "current-password"}
              minLength={signup ? 8 : undefined}
              placeholder={signup ? t("At least 8 characters") : undefined}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error && <p className="error">{error}</p>}
          {!signup && <Link to={`/forgot${location.search}`} className="auth-forgot">{t("Forgot your password?")}</Link>}
          <button className="primary" disabled={busy}>
            {busy ? t("One moment…") : signup ? t("Create my account") : t("Log in")}
          </button>
        </form>

        <p className="auth-switch">
          {signup ? t("Already have an account?") : t("No account yet?")}{" "}
          {/* The page to return to (a team invitation, for instance) follows the switch. */}
          <Link to={`${signup ? "/login" : "/signup"}${location.search}`}>{signup ? t("Log in") : t("Create an account")}</Link>
        </p>
        {/* On the home address, people joining a presentation type its code here (src/App.tsx Start). */}
        {join && <JoinCode />}
      </div>
    </main>
  );
}

const GOOGLE_STATE = "hopvote:google";

// Google's "G", drawn inline so it never depends on a third-party load.
function GoogleG() {
  return (
    <svg viewBox="0 0 48 48" width="20" height="20" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.2-.1-2.3-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.2-.1-2.3-.4-3.5z" />
    </svg>
  );
}

const randomId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");

// Sends the visitor to Google's sign-in page; Google returns to /auth/google with an ID token.
function GoogleButton({ signup, onError }: { signup: boolean; onError: (message: string) => void }) {
  const t = useAppT();
  const [clientId, setClientId] = useState<string | null>(null);

  useEffect(() => {
    api<{ googleClientId: string | null }>("/api/config").then((d) => setClientId(d.googleClientId), () => {});
  }, []);

  if (!clientId) return null;

  async function start() {
    // The server gives the nonce, tied to a cookie of this browser: a token copied elsewhere can't sign in.
    const nonce = await api<{ nonce: string }>("/api/auth/google/start").then((d) => d.nonce, () => null);
    if (!nonce) return onError(t("Google sign-in didn't work, try again."));
    const state = randomId();
    const next = new URLSearchParams(location.search).get("next") ?? "/app";
    try {
      sessionStorage.setItem(GOOGLE_STATE, JSON.stringify({ state, next }));
    } catch {
      // Without storage the return check fails safely and asks to try again.
    }
    const params = new URLSearchParams({
      client_id: clientId!,
      redirect_uri: `${location.origin}/auth/google`,
      response_type: "id_token",
      scope: "openid email profile",
      nonce,
      state,
      prompt: "select_account",
    });
    location.assign(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  }

  return (
    <>
      <button type="button" className="google-btn" onClick={start}>
        <GoogleG />
        {signup ? t("Sign up with Google") : t("Continue with Google")}
      </button>
      <p className="auth-or"><span>{t("or with your email")}</span></p>
    </>
  );
}

// Google sends the visitor back here with the ID token in the URL fragment.
export function GoogleReturn() {
  const t = useAppT();
  const [error, setError] = useState("");
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    done.current = true;
    const hash = new URLSearchParams(location.hash.slice(1));
    let saved: { state: string; next: string } | null = null;
    try {
      saved = JSON.parse(sessionStorage.getItem(GOOGLE_STATE) ?? "null");
      sessionStorage.removeItem(GOOGLE_STATE);
    } catch {
      saved = null;
    }
    const credential = hash.get("id_token");
    if (!credential || !saved || hash.get("state") !== saved.state) {
      setError(hash.get("error") === "access_denied" ? t("Google sign-in canceled.") : t("Google sign-in didn't work, try again."));
      return;
    }
    history.replaceState(null, "", "/auth/google");
    api<{ user: User }>("/api/auth/google", { body: { credential } }).then(
      ({ user }) => {
        setUser(user);
        navigate(saved!.next.startsWith("/") ? saved!.next : "/app", true);
      },
      (e) => setError(e instanceof Error ? e.message : t("Couldn't sign in with Google")),
    );
  }, []);

  return (
    <main className="auth">
      <div className="auth-card">
        <Logo />
        {error ? (
          <>
            <h1 className="title">{t("Oops")}</h1>
            <p className="error">{error}</p>
            <Link to="/login" className="primary button">{t("Back to login")}</Link>
          </>
        ) : (
          <p className="muted">{t("Signing in with Google…")}</p>
        )}
      </div>
    </main>
  );
}

// Opened from the confirmation email. A button (not an automatic call) so mail scanners that open links don't use it up.
export function Verify() {
  const t = useAppT();
  const token = new URLSearchParams(location.search).get("t") ?? "";
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function confirm() {
    setBusy(true);
    setError("");
    try {
      const { user } = await api<{ user: User }>("/api/auth/verify", { body: { token } });
      setUser(user);
      navigate(takeNext(), true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("No connection"));
      setBusy(false);
    }
  }
  return (
    <main className="auth">
      <div className="auth-card">
        <Logo />
        <h1 className="title">{t("Confirm your email")}</h1>
        <p className="muted">{t("One click and your Hopvote account is ready.")}</p>
        {error && <p className="error">{error}</p>}
        <button className="primary" onClick={confirm} disabled={busy || !token}>{busy ? t("One moment…") : t("Confirm and continue")}</button>
        {error && <p className="auth-switch"><Link to="/login">{t("Log in")}</Link> · <Link to="/signup">{t("Sign up again")}</Link></p>}
      </div>
    </main>
  );
}

export function Forgot() {
  const t = useAppT();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/api/auth/forgot", { body: { email } });
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("No connection"));
    }
    setBusy(false);
  }
  return (
    <main className="auth">
      <div className="auth-card">
        <Logo />
        <h1 className="title">{sent ? t("Check your inbox") : t("Forgot your password?")}</h1>
        {sent ? (
          <p className="muted">{fill(t("If an account uses {email}, a link to choose a new password is on its way. It works for one hour."), "{email}", <strong>{email}</strong>)}</p>
        ) : (
          <form className="stack" onSubmit={submit}>
            <p className="muted">{t("Enter your email and we'll send you a link.")}</p>
            <label className="field">
              <span>{t("Email")}</span>
              <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
            </label>
            {error && <p className="error">{error}</p>}
            <button className="primary" disabled={busy || !email}>{busy ? t("One moment…") : t("Send the link")}</button>
          </form>
        )}
        <p className="auth-switch"><Link to={`/login${location.search}`}>{t("Back to log in")}</Link></p>
      </div>
    </main>
  );
}

export function Reset() {
  const t = useAppT();
  const token = new URLSearchParams(location.search).get("t") ?? "";
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { user } = await api<{ user: User }>("/api/auth/reset", { body: { token, password } });
      setUser(user);
      navigate("/app", true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("No connection"));
      setBusy(false);
    }
  }
  return (
    <main className="auth">
      <div className="auth-card">
        <Logo />
        <h1 className="title">{t("Choose a new password")}</h1>
        <p className="muted">{t("Every other browser signed in to your account will be signed out.")}</p>
        <form className="stack" onSubmit={submit}>
          <label className="field">
            <span>{t("New password")}</span>
            <PasswordInput autoComplete="new-password" minLength={8} placeholder={t("At least 8 characters")} value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
          </label>
          {error && <p className="error">{error}</p>}
          <button className="primary" disabled={busy || password.length < 8 || !token}>{busy ? t("One moment…") : t("Save and log in")}</button>
        </form>
        {error && <p className="auth-switch"><Link to="/forgot">{t("Get a new link")}</Link></p>}
      </div>
    </main>
  );
}
