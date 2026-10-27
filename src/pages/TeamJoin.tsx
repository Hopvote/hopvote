import { useEffect, useState } from "react";
import { api, displayName, setUser, signOut, useUser, type User } from "../api";
import { useAppT } from "../app-i18n";
import { forgetDecks } from "../decks";
import { navigate } from "../router";
import { Link, Logo } from "../ui";

// The link of a team invitation: sign in (or sign up), then one click to join.
export function TeamJoin() {
  const t = useAppT();
  const user = useUser();
  const token = new URLSearchParams(location.search).get("t") ?? "";
  const [owner, setOwner] = useState("");
  // The invitation is for one address: signed in with another one, the page says so and offers to switch.
  const [invited, setInvited] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const back = encodeURIComponent(`/team/join?t=${token}`);

  useEffect(() => {
    if (!user) return;
    api<{ owner: string; email: string }>(`/api/team/invite?t=${encodeURIComponent(token)}`).then(
      (d) => {
        setOwner(d.owner);
        setInvited(d.email);
      },
      (e) => setError(e.message),
    );
  }, [user?.id]);

  async function join() {
    setBusy(true);
    setError("");
    try {
      await api("/api/team/accept", { body: { token } });
      // The presentations change with the team.
      const { user: fresh } = await api<{ user: User }>("/api/me");
      setUser(fresh);
      forgetDecks();
      navigate("/app/presentations", true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("No connection"));
      setBusy(false);
    }
  }

  const other = !!user && !!invited && user.email.toLowerCase() !== invited.toLowerCase();

  return (
    <main className="auth">
      <div className="auth-card">
        <Logo />
        <h1 className="title">{owner ? t("Join {name}'s team", { name: displayName(owner) }) : t("Join a team")}</h1>
        <p className="muted">{t("Share presentations and present together, each with your own account.")}</p>
        {error && <p className="error">{error}</p>}
        {other && !error && <p className="error">{t("This invitation was sent to {email}. Log in with that email to join.", { email: invited })}</p>}
        {user === null ? (
          <>
            <Link to={`/login?next=${back}`} className="primary button">{t("Log in to join")}</Link>
            <p className="auth-switch">
              {t("No account yet?")} <Link to={`/signup?next=${back}`}>{t("Sign up")}</Link>
            </p>
          </>
        ) : other ? (
          <button className="primary" onClick={() => signOut().then(() => navigate(`/login?next=${back}`, true))}>{t("Use another account")}</button>
        ) : (
          <button className="primary" onClick={join} disabled={busy || !user || !owner}>
            {busy ? t("One moment…") : t("Join the team")}
          </button>
        )}
        {user && <p className="auth-switch">{t("Signed in as {email}", { email: user.email })}</p>}
      </div>
    </main>
  );
}
