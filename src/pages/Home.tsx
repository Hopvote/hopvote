import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { displayName, useUser } from "../api";
import { useAppT } from "../app-i18n";
import { refreshLiveDecks, useDecks, type DeckRow } from "../decks";
import { Link } from "../ui";
import { AppShell } from "./AppShell";
import { byLastUse, CreateBar, FirstSteps, hideSteps, LastSession, LiveNow, Numbers, RecentList, Resume, stepsHidden, Totals, TryKinds, Welcome } from "./HomeBlocks";

const hello = () => (new Date().getHours() < 12 ? "Good morning" : new Date().getHours() < 18 ? "Good afternoon" : "Good evening");

// While a session is live, the home page follows it.
function useLiveRefresh(decks: DeckRow[] | null) {
  const live = !!decks?.some((d) => (d.live ?? 0) > 0);
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => document.visibilityState === "visible" && refreshLiveDecks().catch(() => {}), 20_000);
    return () => clearInterval(id);
  }, [live]);
}

// Presentations by last use: the one to pick up, the live one, the rest, the last session, and the first steps.
function useHome() {
  const { decks, limits } = useDecks();
  const [hidden, setHidden] = useState(stepsHidden);
  useLiveRefresh(decks);
  const sorted = decks ? byLastUse(decks) : null;
  const resume = sorted?.find((d) => !d.live) ?? null;
  // The session live now has its own banner (the one with the most people connected).
  const onAir = sorted?.filter((d) => (d.live ?? 0) > 0).sort((a, b) => (b.live ?? 0) - (a.live ?? 0))[0];
  // The last session of another presentation than the one to pick up, so the same one never shows twice.
  const session = sorted?.filter((d) => d !== resume && !d.live && (d.participants ?? 0) > 0).sort((a, b) => (b.shownAt ?? 0) - (a.shownAt ?? 0))[0] ?? null;
  // New accounts see their first steps until they have run a session with a group.
  const steps = !!decks && !hidden && !decks.some((d) => (d.participants ?? 0) >= 3);
  // Each presentation shows once: the recent list leaves out the ones already in a card above.
  const shown = steps ? null : session;
  const rest = sorted?.filter((d) => d !== resume && d !== onAir && d !== shown).slice(0, 5) ?? [];
  const hide = () => {
    hideSteps();
    setHidden(true);
  };
  return { decks, limits, resume, rest, session, steps, hide };
}

function Recent({ decks }: { decks: DeckRow[] }) {
  const t = useAppT();
  if (!decks.length) return null;
  return (
    <section>
      <div className="sec-head">
        <h2>{t("Recent")}</h2>
        <Link to="/app/presentations" className="sec-link">{t("See all")} <ArrowRight size={16} /></Link>
      </div>
      <RecentList decks={decks} />
    </section>
  );
}

// The app's home page: one line to start with the AI, the session live now, the presentation to pick up with its QR code,
// the last session question by question (first steps for new accounts), recent presentations, the totals and kinds to try.
export function Home() {
  const t = useAppT();
  const user = useUser();
  const { decks, resume, rest, session, steps, hide } = useHome();
  return (
    <AppShell title={`${t(hello())} ${user ? displayName(user.name) : ""}`} subtitle={t("What would you like to do today?")}>
      <CreateBar />
      {decks && <LiveNow decks={decks} />}
      {decks && (
        <div className="hb-grid hb-rise" style={{ "--i": 1 } as React.CSSProperties}>
          {resume ? <Resume deck={resume} /> : <Welcome />}
          {steps ? <FirstSteps decks={decks} onHide={hide} /> : session ? <LastSession deck={session} /> : <Numbers decks={decks} />}
        </div>
      )}
      <Recent decks={rest} />
      {decks && (
        <div className="hb-foot hb-rise" style={{ "--i": 4 } as React.CSSProperties}>
          {/* The totals show once: here, unless the numbers card already holds them. */}
          {(steps || !!session) && decks.some((d) => (d.participants ?? 0) > 0) && <Numbers decks={decks} />}
          <TryKinds decks={decks} />
        </div>
      )}
    </AppShell>
  );
}
