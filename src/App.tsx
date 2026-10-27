import { Component, lazy, Suspense, useEffect, useState, type ComponentType, type ReactNode } from "react";
import { Buddy } from "./buddies";
import { AVATARS } from "./avatars";
import type { UiKind } from "./questions";
import { useUser } from "./api";
import { appLang, translate, useAppT } from "./app-i18n";
import { allowPop, navigate, rememberPage } from "./router";
import { Message } from "./ui";

// Every page loads on demand, so a phone opening a vote page downloads only what it shows.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const page = <T extends ComponentType<any>>(load: () => Promise<Record<string, unknown>>, name: string) =>
  lazy(async () => ({ default: (await load())[name] as T }));
const Auth = page<typeof import("./pages/Auth").Auth>(() => import("./pages/Auth"), "Auth");
const GoogleReturn = page<typeof import("./pages/Auth").GoogleReturn>(() => import("./pages/Auth"), "GoogleReturn");
const Verify = page<typeof import("./pages/Auth").Verify>(() => import("./pages/Auth"), "Verify");
const Forgot = page<typeof import("./pages/Auth").Forgot>(() => import("./pages/Auth"), "Forgot");
const Reset = page<typeof import("./pages/Auth").Reset>(() => import("./pages/Auth"), "Reset");
const Account = page<typeof import("./pages/Account").Account>(() => import("./pages/Account"), "Account");
const Create = page<typeof import("./pages/Create").Create>(() => import("./pages/Create"), "Create");
const PreviewPage = page<typeof import("./pages/PreviewPage").PreviewPage>(() => import("./pages/PreviewPage"), "PreviewPage");
const DeckDetail = page<typeof import("./pages/DeckDetail").DeckDetail>(() => import("./pages/DeckDetail"), "DeckDetail");
const Decks = page<typeof import("./pages/Decks").Decks>(() => import("./pages/Decks"), "Decks");
const Help = page<typeof import("./pages/Help").Help>(() => import("./pages/Help"), "Help");
const Home = page<typeof import("./pages/Home").Home>(() => import("./pages/Home"), "Home");
const Community = page<typeof import("./pages/Community").Community>(() => import("./pages/Community"), "Community");
const Present = page<typeof import("./pages/Present").Present>(() => import("./pages/Present"), "Present");
const Vote = page<typeof import("./pages/Vote").Vote>(() => import("./pages/Vote"), "Vote");
const TeamJoin = page<typeof import("./pages/TeamJoin").TeamJoin>(() => import("./pages/TeamJoin"), "TeamJoin");

// The example screen of each kind of question (/preview/screen|phone/<kind>, src/pages/PreviewPage.tsx), for the checks
// (scripts/stage-check.mjs, scripts/brand-check.mjs, scripts/presenter-lang-test.mjs) and the optional builder pictures
// (scripts/previews.mjs). Listed here so the first download stays without the builder's code.
const PREVIEW_KINDS: UiKind[] = ["choice", "scale", "scales", "rank", "points", "words", "open", "qa", "wheel", "quiz", "number", "order", "fill", "match", "spot", "slide", "link", "media", "countdown", "contact", "topics"];

// "/" opens the app: the home page when signed in, else the sign-in page. The big screen tells the room to go to this
// address and type the code, so the sign-in page shown here also takes a code.
function Start() {
  const user = useUser();
  useEffect(() => {
    if (user) navigate("/app", true);
  }, [user]);
  if (user === null) return <Auth mode="login" join />;
  return (
    <main className="page center" role="status">
      <span className="spinner" aria-hidden />
    </main>
  );
}

// Any other address: a way back to the app.
function NotFound() {
  const t = useAppT();
  return <Message title={t("Page not found")} />;
}

function Route() {
  const [path, setPath] = useState(() => location.pathname);
  useEffect(() => {
    rememberPage();
    const onPop = () => {
      if (!allowPop()) return;
      setPath(location.pathname);
      rememberPage();
    };
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, []);

  if (path === "/") return <Start />;
  if (path === "/login") return <Auth mode="login" />;
  if (path === "/signup") return <Auth mode="signup" />;
  if (path === "/verify") return <Verify />;
  if (path === "/forgot") return <Forgot />;
  if (path === "/reset") return <Reset />;
  if (path === "/auth/google") return <GoogleReturn />;
  if (path === "/team/join") return <TeamJoin />;
  // Local check of the buddies' drawing.
  if (import.meta.env.DEV && path === "/dev/buddies")
    return <main style={{ display: "flex", flexWrap: "wrap", gap: 18, padding: 30, background: "#f5f3ee" }}>{AVATARS.map((a) => <Buddy key={a} id={a} size={96} />)}</main>;
  if (path === "/app") return <Home />;
  if (path === "/app/presentations") return <Decks />;
  if (path === "/app/community") return <Community />;
  if (path === "/app/help") return <Help />;
  if (path === "/app/new") return <Create />;
  if (path === "/app/account") return <Account />;
  const deck = path.match(/^\/app\/p\/([A-Z0-9]{5})$/i);
  if (deck) return <DeckDetail code={deck[1].toUpperCase()} />;
  const edit = path.match(/^\/app\/p\/([A-Z0-9]{5})\/edit$/i);
  if (edit) return <Create edit={edit[1].toUpperCase()} />;
  const present = path.match(/^\/present\/([A-Z0-9]{5})$/i);
  if (present) return <Present code={present[1].toUpperCase()} />;
  const vote = path.match(/^\/([A-Z0-9]{5})$/i);
  // Right after a scan the phone may wait seconds for the page's code: a spinner, never a blank page.
  if (vote) {
    return (
      <Suspense fallback={<main className="page narrow center vote" role="status"><span className="spinner" aria-hidden /></main>}>
        <Vote code={vote[1].toUpperCase()} />
      </Suspense>
    );
  }
  const preview = path.match(/^\/preview\/(screen|phone)\/([a-z]+)$/);
  if (preview && PREVIEW_KINDS.includes(preview[2] as UiKind)) return <PreviewPage view={preview[1] as "screen" | "phone"} kind={preview[2] as UiKind} />;
  return <NotFound />;
}

// After a deploy, a tab opened before it asks for page files that no longer exist: one reload fetches the new ones.
// Never twice in a row, so a real crash cannot loop.
function reloadOnce() {
  try {
    if (Date.now() - Number(sessionStorage.getItem("hopvote:reloaded") ?? 0) < 10_000) return false;
    sessionStorage.setItem("hopvote:reloaded", String(Date.now()));
  } catch {
    return false;
  }
  location.reload();
  return true;
}
addEventListener("vite:preloadError", (e) => {
  if (reloadOnce()) e.preventDefault();
});

// A phone's vote page fails in the phone's language (those written by hand), other pages in the app's language.
// Kept here, small: the phone's full translations stay out of the first download.
const CRASH: Record<string, [string, string]> = {
  es: ["Algo salió mal", "Recargar la página"],
  de: ["Etwas ist schiefgelaufen", "Seite neu laden"],
  it: ["Qualcosa è andato storto", "Ricarica la pagina"],
  pt: ["Algo deu errado", "Recarregar a página"],
};
function crashText(): [string, string] {
  let lang: string = appLang();
  // Vote codes are in capitals (the QR code links them so); /login and the app's pages are not.
  if (/^\/[A-Z0-9]{5}\/?$/.test(location.pathname)) {
    lang = (navigator.language || "en").slice(0, 2).toLowerCase();
    try {
      lang = localStorage.getItem("hopvote:lang") ?? lang;
    } catch {
      // Storage blocked: the phone's language.
    }
  }
  if (CRASH[lang]) return CRASH[lang];
  const app = lang === "fr" ? "fr" : "en";
  return [translate(app, "Something went wrong"), translate(app, "Reload the page")];
}

// Any page that fails shows a way out instead of a blank screen.
class Crash extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    if (!reloadOnce()) console.error(error);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    const [title, reload] = crashText();
    return (
      <main className="page narrow center">
        <h1 className="title">{title}</h1>
        <button className="primary" onClick={() => location.reload()}>{reload}</button>
      </main>
    );
  }
}

export function App() {
  return (
    <Crash>
      <Suspense fallback={null}>
        <Route />
      </Suspense>
    </Crash>
  );
}
