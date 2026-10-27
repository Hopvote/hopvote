import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import QRCode from "qrcode";
import { api, useUser } from "../api";
import { navigate } from "../router";
import { forgetHostKey, hostKeyFor, saveHostKey, useRoom, type RoomState } from "../room";
import { ChevronDown, ChevronLeft, ChevronRight, CircleCheck, Eye, EyeOff, Keyboard, Languages, Layers, LoaderPinwheel, Lock, LogOut, Maximize, MousePointerClick, Pause, Play, Plus, QrCode, RotateCcw, Unlock, Trophy, X } from "lucide-react";
import { mergeWords, UiProvider, usePostTranslations, withTranslations } from "../translate";
import { appLang, usePageLang } from "../app-i18n";
import { screenLang, screenLocale, screenText, useScreenStrings } from "../screen-i18n";
import { ChoiceResults, COUNT_IN_MS, CountIn, Countdown, keepMarks, Leaderboard, NumberResults, OpenWall, OrderResults, QaList, RankResults, ScaleResults, ScalesResults, Waiting, WordCloud, ContactCount, useCountdown, WhoAnswered } from "../answers";
import { Logo, Message, Wordmark } from "../ui";
import { Lobby } from "./Lobby";
import { LaunchCurtain, useLaunch } from "../launch";
import { BrandLogo, brandLook, useBrand } from "../brand";
import type { Brand } from "../brand-core";
import { CountdownView, FillStage, MatchBoard, MatchResults, MediaPlayer, PointsResults, RoundWon, SpotImage, Wheel, serverNow, wheelSpinning } from "../kind-views";
import { clockLeft } from "../kinds";
import { SPIN_MS } from "../wheel";
import { KINDS, TOPICS_KIND } from "../questions";
import { boardElapsed, boardModeOf, boardStep, boardView, ownBoardOf, PODIUM_MS, STANDINGS_MS } from "../board";
import { Podium, Standings } from "../podium";
import { decorBrand, shownDecor } from "../decor";
import { HalloweenScene } from "../halloween-decor";
import { PUBLIC_URL, SITE_HOST } from "../site-config";

// The page's <html lang> follows the screen's language (a framed preview leaves its page's alone).
function PageLang({ lang }: { lang: string }) {
  usePageLang(lang);
  return null;
}

// The footer's parts never touch: the levels apply in turn until they fit (see the footer rules in styles.css).
// "foot-short": the buttons that have a short label use it (topic rounds' "Start", "Choose again" as an icon).
const FOOT_LEVELS = ["foot-nodots", "foot-short", "foot-packed", "foot-wrap"];
function fitFoot(foot: HTMLElement) {
  const touching = () => {
    const f = foot.getBoundingClientRect();
    const boxes: DOMRect[] = [];
    for (const part of Array.from(foot.children)) {
      for (const el of part.classList.contains("foot-left") ? Array.from(part.children) : [part]) {
        const b = el.getBoundingClientRect();
        if (b.width && b.height) boxes.push(b);
      }
    }
    if (boxes.some((b) => b.left < f.left - 1 || b.right > f.right + 1)) return true;
    return boxes.some((a, i) => boxes.some((b, j) => i !== j && a.left <= b.left && a.right + 8 > b.left && a.top < b.bottom && b.top < a.bottom));
  };
  foot.classList.remove(...FOOT_LEVELS);
  for (const level of FOOT_LEVELS) {
    if (!touching()) return;
    foot.classList.add(level);
  }
}

// Kinds with nothing to answer: no count, no "who answered", no pause button.
const NOTHING_TO_ANSWER = ["slide", "wheel", "countdown", "media"];
// Kinds that show their own picture (or none): the question's image is not drawn next to them.
const OWN_PICTURE = ["link", "spot", "wheel", "countdown", "media"];
// Every question uses the same stage: a header row, the title at a fixed place, then the content zone.
// These kinds sit in the middle of that zone (a chart, a wheel, a clock, a picture); the others read from its top.
const CENTERED = ["scale", "words", "wheel", "countdown", "media", "spot", "link", "contact"];

// Lists read from the top that grow to use the content zone when they are short (letters up to 28% larger).
const GROWS = ["choice", "quiz", "rank", "points", "open", "qa", "scales", "order", "match", "topics"];
const GROW_MAX = 1.28;

// Drawn inside another page (embed=1), the same screen runs with the key from its URL, without the app's buttons.
const embedFromUrl = new URLSearchParams(location.search).get("embed") === "1";
const keyFromUrl = new URLSearchParams(location.search).get("k") ?? undefined;

// embed: drawn inside another page (the design studio, the preview pages).
// `demo`: an example screen for the builder's pictures, drawn from this state without any room behind it.
// `brand`: a brand given by the page (the preview pages, the design studio): the server is never asked for one.
// Without it an example screen shows Hopvote's own look and a real one the presentation's brand.
// `demoJoinHidden`: an example screen without its join card; the presenter's own choice on this computer is left alone.
// `framed`: drawn inside another page's frame (the design studio): it leaves that page's keys and language alone.
export function Present({ code, embed, embedKey, demo, brand: givenBrand, demoJoinHidden, framed }: { code: string; embed?: boolean; embedKey?: string; demo?: RoomState; brand?: Brand | null; demoJoinHidden?: boolean; framed?: boolean }) {
  const embedded = embed ?? embedFromUrl;
  // Who looks at this screen: someone signed in to another account is told so, not asked to sign in.
  const viewerUser = useUser();
  const urlKey = embedKey ?? keyFromUrl;
  const [hostKey, setHostKey] = useState(() => (embedded ? urlKey : hostKeyFor(code)));
  // Connect once we know whether this screen is the host, so it never counts as a participant.
  const [lookedUp, setLookedUp] = useState(() => embedded || !!hostKeyFor(code));
  // Without the host key (a computer that is not signed in), the screen only watches: it never counts as a participant.
  const room = useRoom(code, hostKey, lookedUp && !demo, !hostKey);
  const state = demo ?? room.state;
  const status = demo ? "open" : room.status;
  const send: typeof room.send = demo ? async () => false : room.send;
  const index = state?.index ?? 0;
  const count = state?.count ?? 1;
  // The screen, its controls and the waiting screen speak the presentation's language (the app's when it is unknown);
  // phones keep their own. Numbers and plurals follow it too.
  const lang = screenLang(state?.lang, appLang());
  const [strings, stringsReady] = useScreenStrings(lang);
  // Labels wait for the room and its language's text, so they never show in another language first.
  const hold = !(state && stringsReady) ? ({ visibility: "hidden" } as const) : undefined;
  const t = (text: string, vars?: Record<string, string | number>) => screenText(strings, text, vars);
  // Questions and answers from the audience show in the presentation's language (the presenter's own when it is unknown).
  const [translatePosts, setTranslatePosts] = useState(() => {
    try {
      return localStorage.getItem("hopvote:posts-original") !== "1";
    } catch {
      return true;
    }
  });
  const postMap = usePostTranslations(code, state, lang, translatePosts);
  // Hidden posts leave the big screen; the presenter can list them again to bring one back.
  const [showHidden, setShowHidden] = useState(false);
  const hiddenCount = state?.answers.filter((a) => a.hidden).length ?? 0;
  const answers = state ? withTranslations(state.answers, postMap).filter((a) => showHidden || !a.hidden) : [];
  // Cloud words in the presentation's language: the same idea in several languages counts once.
  const cloudWords = state ? (state.kind === "words" ? mergeWords(state.words, postMap) : state.words) : [];
  // Removing a translated word removes every original behind it.
  const dropWord = (word: string) => {
    const originals = state?.words.map(([w]) => w).filter((w) => (postMap[w] ?? w) === word) ?? [];
    for (const w of originals.length ? originals : [word]) send({ type: "drop", word: w });
  };
  useEffect(() => setShowHidden(false), [index]);
  // The presenter can take the QR code column off the screen (remembered on this computer); the code stays on top.
  const [joinHidden, setJoinHidden] = useState(() => {
    if (demo) return !!demoJoinHidden;
    try {
      return localStorage.getItem("hopvote:join-hidden") === "1";
    } catch {
      return false;
    }
  });
  // The list of keyboard shortcuts ("?" or the keyboard button in the top bar).
  const [keysOpen, setKeysOpen] = useState(false);
  const toggleJoin = () =>
    setJoinHidden((hidden) => {
      try {
        if (!demo) localStorage.setItem("hopvote:join-hidden", hidden ? "0" : "1");
      } catch {
        // Only the preference is lost.
      }
      return !hidden;
    });
  // The seasonal decor (src/decor.ts) sets the ground and the colors; the brand keeps its logo and fonts with it.
  const decor = shownDecor(state?.decor);
  const ownBrand = useBrand(demo ? "" : code, givenBrand);
  const brand = useMemo(() => decorBrand(ownBrand, decor), [ownBrand, decor]);
  const look = brandLook(brand);
  // The title and the answers fit again when the brand's look (its fonts) changes.
  const lookKey = `${look.className}|${JSON.stringify(look.style)}`;
  // The answers always fit the screen: many or long options shrink instead of being cut off.
  const stageRef = useRef<HTMLDivElement>(null);
  const fitRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const lists = state?.kind === "open" || state?.kind === "qa";
  // Each question (and each new round of it) gets its own stage: it enters with a short rise, its bars grow from zero.
  const at = `${state?.round ?? 0}:${index}`;
  // A timed quiz shows its count-in first (same test as `counting` below, read before the clock's hook).
  const countingIn = !!state && state.quiz && state.timer > 0 && !state.revealed && (!state.startedAt || state.startedAt > serverNow(state));
  // The title keeps its place: a long one gets smaller letters (3 lines at most) instead of pushing the answers down.
  useLayoutEffect(() => {
    const title = titleRef.current;
    const zone = title?.parentElement;
    if (!title || !zone) return;
    const fit = () => {
      title.classList.add("measuring");
      const fits = (k: number) => {
        title.style.fontSize = k === 1 ? "" : `calc(var(--fs-title) * ${k})`;
        return title.scrollHeight <= zone.clientHeight + 1;
      };
      if (!fits(1)) {
        let lo = 0.5;
        let hi = 1;
        for (let i = 0; i < 7; i++) {
          const mid = (lo + hi) / 2;
          if (fits(mid)) lo = mid;
          else hi = mid;
        }
        fits(lo);
      }
      title.classList.remove("measuring");
    };
    fit();
    // A brand font may arrive after the first fit: the title then fits again in its fixed zone.
    document.fonts?.ready.then(fit);
    document.fonts?.addEventListener("loadingdone", fit);
    const watch = new ResizeObserver(fit);
    watch.observe(zone);
    return () => {
      watch.disconnect();
      document.fonts?.removeEventListener("loadingdone", fit);
    };
  }, [at, state?.question, !!state?.lobby, !!state?.board, countingIn, lookKey]);
  useLayoutEffect(() => {
    const box = stageRef.current;
    const content = fitRef.current;
    if (!box || !content) return;
    // The largest size that fits, found in a few steps (text wraps differently at each size).
    // Lists (Q&A, open answers) keep a readable size and scroll past what fits; bounded results always show whole.
    // The bottom fades out while more lies below (a list that scrolls), or when a result is still too tall.
    const more = () => box.classList.toggle("clipped", box.scrollTop + box.clientHeight < box.scrollHeight - 2);
    // A short list read from the top (a few options, answers or questions) grows up to GROW_MAX to use the zone,
    // keeping a little air at the bottom; still short, it sits in the middle of the zone. The title never moves.
    const grows = box.closest(".stage")?.getAttribute("data-align") === "top" && GROWS.includes(box.closest(".stage")?.getAttribute("data-kind") ?? "");
    const fit = () => {
      const fits = (z: number, room = 1) => {
        content.style.zoom = String(z);
        return content.getBoundingClientRect().height <= box.clientHeight * room + 1;
      };
      if (fits(1)) {
        box.classList.remove("clipped", "scrolls");
        if (grows) {
          let lo = 1;
          let hi = GROW_MAX;
          if (fits(hi, 0.9)) lo = hi;
          else
            for (let i = 0; i < 5; i++) {
              const mid = (lo + hi) / 2;
              if (fits(mid, 0.9)) lo = mid;
              else hi = mid;
            }
          fits(lo);
        }
        box.classList.toggle("short", grows && content.getBoundingClientRect().height < box.clientHeight * 0.7);
        return;
      }
      box.classList.remove("short");
      let lo = lists ? 0.8 : 0.5;
      let hi = 1;
      for (let i = 0; i < 6; i++) {
        const mid = (lo + hi) / 2;
        if (fits(mid)) lo = mid;
        else hi = mid;
      }
      const over = !fits(lo);
      // A long Q&A or answer wall scrolls, so every question and its buttons stay within reach.
      box.classList.toggle("scrolls", over && lists);
      if (over && lists) more();
      else box.classList.toggle("clipped", over);
    };
    fit();
    const onScroll = () => box.classList.contains("scrolls") && more();
    box.addEventListener("scroll", onScroll, { passive: true });
    // The content zone has a fixed size: it changes with the window, and pictures and fonts that load late fit again.
    const watch = new ResizeObserver(fit);
    watch.observe(box);
    content.addEventListener("load", fit, true);
    document.fonts?.ready.then(fit);
    document.fonts?.addEventListener("loadingdone", fit);
    return () => {
      watch.disconnect();
      box.removeEventListener("scroll", onScroll);
      content.removeEventListener("load", fit, true);
      document.fonts?.removeEventListener("loadingdone", fit);
    };
    // Topic rounds' picker: the vote closing (bars and the topic chosen side by side, in the middle) fits again.
  }, [lookKey, !!state?.lobby, !!state?.board, at, state?.kind, state?.question, state?.options.join("\n"), state?.startedAt, state?.revealed, answers.length, showHidden, state?.wheel?.picked.length, countingIn, state?.topics?.at === "picker" ? `${state.topics.chosen}:${state.topics.chosenHow}:${state.topics.pass}` : ""]);
  const togglePosts = () => {
    setTranslatePosts((on) => {
      try {
        localStorage.setItem("hopvote:posts-original", on ? "1" : "0");
      } catch {
        // Only the preference is lost.
      }
      return !on;
    });
  };
  const lobby = !!state?.lobby;
  const launch = useLaunch(state);
  // With the launch animation, once started the waiting screen does not come back.
  const started = !!state?.launch;
  const waitingStart = !!state?.quiz && state.timer > 0 && !state.startedAt && !state.revealed;
  const goto = (i: number) => {
    if (hostKey && i >= 0 && i < count) send({ type: "goto", index: i });
  };
  // The waiting screen comes first; the right arrow leaves it, the left arrow on question 1 returns to it.
  const setLobby = (on: boolean) => hostKey && send({ type: "lobby", on });
  // With the leaderboard after each question (or the final one), → first shows the answer, then the leaderboard.
  // With topic rounds, at the picker → turns the wheel or closes the vote first, then starts the topic chosen.
  const step = hostKey ? boardStep(state) : null;
  const ownBoard = ownBoardOf(state);
  // Topic rounds (src/rounds.ts): → and ← follow the way the game goes, worked out by the room (`step`).
  const topics = state?.topics ?? null;
  const picker = topics?.at === "picker" ? topics : null;
  const next = () => {
    if (step === "reveal") return void send({ type: "reveal", show: true });
    if (step === "board") return void send({ type: "board", show: true });
    if (topics && hostKey && !lobby) {
      if (step === "spin") return spin();
      if (step === "pick") return void send({ type: "pick", from: index });
      if (topics.hasNext) return void send({ type: "step", dir: 1, from: index });
      return;
    }
    if (lobby) setLobby(false);
    else goto(index + 1);
  };
  const prev = () => {
    if (lobby) return;
    // ← on the leaderboard goes back to the question it follows.
    if (ownBoard && state?.board) return void send({ type: "board", show: false });
    if (topics) {
      if (topics.hasPrev) return void send({ type: "step", dir: -1, from: index });
      if (!started) setLobby(true);
      return;
    }
    if (index === 0) {
      if (!started) setLobby(true);
    } else goto(index - 1);
  };
  // The topic chosen is shown once the wheel stops (the room knows it as the wheel starts).
  const spinning = !!picker && state?.kind === "wheel" && wheelSpinning(state.wheel?.spin, state);
  const settled = !!picker && picker.chosen !== null && !spinning;
  const chosenLabel = picker && picker.chosen !== null ? (picker.list[picker.chosen]?.label ?? "") : "";
  // The "Choose" menu: the topics left, to pick one by hand.
  const [chooseOpen, setChooseOpen] = useState(false);
  const chooseBtn = useRef<HTMLButtonElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => setChooseOpen(false), [index, picker?.chosen, !!state?.board]);

  // The plain leaderboard shows every player: its rows get smaller (down to 62%, still readable) before the list has to fade and scroll.
  const plainBoard = useRef<HTMLDivElement>(null);
  const plainRows = state?.board && boardView(state) === "list" ? state.board.length : 0;
  useLayoutEffect(() => {
    const box = plainBoard.current;
    const list = box?.querySelector<HTMLElement>(".board");
    if (!box || !list) return;
    const fit = () => {
      const over = () => list.scrollHeight > list.clientHeight + 1;
      list.style.removeProperty("--bk");
      if (over()) {
        let lo = 0.62;
        let hi = 1;
        for (let i = 0; i < 6; i++) {
          const mid = (lo + hi) / 2;
          list.style.setProperty("--bk", String(mid));
          if (over()) hi = mid;
          else lo = mid;
        }
        list.style.setProperty("--bk", String(lo));
      }
      list.classList.toggle("clipped", over());
    };
    fit();
    const watch = new ResizeObserver(fit);
    watch.observe(box);
    return () => watch.disconnect();
  }, [plainRows]);
  // The animated standings and the podium's list fit the stage too: on a short screen their rows get smaller
  // instead of running over the footer and its buttons.
  const animBoard = useRef<HTMLDivElement>(null);
  const animRows = state?.board && boardView(state) !== "list" ? `${boardView(state)}:${state.board.length}:${state.boardAt ?? 0}` : "";
  useLayoutEffect(() => {
    const box = animBoard.current;
    const list = box?.querySelector<HTMLElement>(".sd, .pd-rest");
    if (!box || !list) return;
    const parent = list.parentElement!;
    const fits = (z: number) => {
      list.style.zoom = z === 1 ? "" : String(z);
      const room = parent === box ? box.getBoundingClientRect().bottom - list.getBoundingClientRect().top : parent.getBoundingClientRect().height;
      return list.getBoundingClientRect().height <= room + 1;
    };
    const fit = () => {
      if (fits(1)) return;
      let lo = 0.5;
      let hi = 1;
      for (let i = 0; i < 6; i++) {
        const mid = (lo + hi) / 2;
        if (fits(mid)) lo = mid;
        else hi = mid;
      }
      fits(lo);
    };
    fit();
    const watch = new ResizeObserver(fit);
    watch.observe(box);
    return () => watch.disconnect();
  }, [animRows]);
  // The footer stays on one line without its parts touching: when they would, the question dots go first (the top
  // already says "3 / 20"), then the tools move next to the arrows, then the tools take a line of their own.
  const footRef = useRef<HTMLElement>(null);
  const footFit = useRef("");
  const missing = status === "missing";
  useLayoutEffect(() => {
    const foot = footRef.current;
    if (!foot) return;
    let width = foot.clientWidth;
    const watch = new ResizeObserver(() => {
      if (foot.clientWidth === width) return;
      width = foot.clientWidth;
      fitFoot(foot);
    });
    watch.observe(foot);
    document.fonts?.ready.then(() => fitFoot(foot));
    return () => watch.disconnect();
  }, [missing]);
  // Fitted again when the footer's content changes; not on every redraw (the page redraws often during a timer).
  useLayoutEffect(() => {
    const foot = footRef.current;
    if (!foot) return;
    const sig = `${foot.textContent}|${foot.querySelectorAll("button, i").length}`;
    if (footFit.current === sig) return;
    footFit.current = sig;
    fitFoot(foot);
  });
  // A footer button lets go of the focus after a click, so no focus ring stays on the projected screen
  // (a keyboard press keeps it, for those who move with Tab).
  const dropFocus = (e: React.MouseEvent<HTMLElement>) => {
    const button = (e.target as HTMLElement).closest("button");
    if (e.detail > 0 && button?.closest(".present-tools, .present-nav, .lobby-start")) button.blur();
  };

  // What the presenter's keys can do on this step: the handler below and the shortcuts card share these.
  const onStep = !!hostKey && !!state && !lobby && !state.board;
  const canPause = onStep && !picker && !state!.quiz && state!.kind !== "contact" && state!.kind !== "link" && !NOTHING_TO_ANSWER.includes(state!.kind);
  const canSpin = onStep && (state!.kind === "wheel" || state!.kind === "countdown");
  const canQr = onStep && state!.kind !== "link";
  // Clicking anywhere outside the card closes it (its own top-bar button toggles it).
  const keysPanel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!keysOpen) return;
    const away = (e: PointerEvent) => {
      const el = e.target as Element | null;
      if (keysPanel.current?.contains(el) || el?.closest?.(".keys-btn")) return;
      setKeysOpen(false);
    };
    addEventListener("pointerdown", away);
    return () => removeEventListener("pointerdown", away);
  }, [keysOpen]);

  // Arrow keys and the space bar move between questions, like a slide deck. F toggles full screen.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (framed) return;
      const t = e.target;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return;
      if (t instanceof HTMLElement && t.isContentEditable) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      // The shortcuts card is for the presenter only: on a watch-only or embedded screen the keys do nothing.
      if (e.key === "?" && hostKey && !embedded) return setKeysOpen((open) => !open);
      if (e.key === "Escape" && keysOpen) return setKeysOpen(false);
      if (e.key === "Escape" && chooseOpen) return setChooseOpen(false);
      if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown") {
        e.preventDefault();
        next();
      }
      if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        prev();
      }
      // Home and End jump to the first and the last question (not with topic rounds: the way the game goes decides).
      if (e.key === "Home" && !lobby && !topics) {
        e.preventDefault();
        goto(0);
      }
      if (e.key === "End" && !lobby && !topics) {
        e.preventDefault();
        goto(count - 1);
      }
      // P pauses or resumes voting, R shows or hides the right answer of a quiz.
      if ((e.key === "p" || e.key === "P") && hostKey && state && !lobby && !picker && !state.quiz && state.kind !== "contact" && state.kind !== "link" && !NOTHING_TO_ANSWER.includes(state.kind) && !state.board) {
        send({ type: "lock", on: !state.locked });
      }
      // S spins the wheel, or starts and pauses a timer.
      if ((e.key === "s" || e.key === "S") && hostKey && state && !lobby && !state.board) {
        if (state.kind === "wheel") spin();
        if (state.kind === "countdown") toggleClock();
      }
      if ((e.key === "r" || e.key === "R") && hostKey && state && !lobby && state.quiz && !waitingStart && !counting && !state.board) {
        send({ type: "reveal", show: !state.revealed });
      }
      // Q shows or hides the QR code column, like its button.
      if ((e.key === "q" || e.key === "Q") && hostKey && state && !lobby && !state.board && state.kind !== "link") toggleJoin();
      if ((e.key === "f" || e.key === "F") && !embedded) {
        if (document.fullscreenElement) document.exitFullscreen();
        else document.documentElement.requestFullscreen().catch(() => {});
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  });

  // Opened from another device: the owner gets the host key from their account. Nobody signed in: the screen only watches.
  useEffect(() => {
    if (hostKey || embedded || viewerUser === undefined) return;
    if (viewerUser === null) return void setLookedUp(true);
    api<{ hostKey: string }>(`/api/polls/${code}/host`).then(
      (d) => {
        saveHostKey(code, d.hostKey);
        setHostKey(d.hostKey);
        setLookedUp(true);
      },
      () => setLookedUp(true),
    );
  }, [code, hostKey, viewerUser]);

  // The room refused the key (new keys were made, or a teammate left the team): ask the account again,
  // and only watch if that fails. A slide keeps showing the room without driving it.
  const askedAt = useRef(0);
  useEffect(() => {
    if (!room.badKey) return;
    setHostKey(undefined);
    if (embedded || Date.now() - askedAt.current < 10_000) return;
    askedAt.current = Date.now();
    forgetHostKey(code);
    setLookedUp(false);
  }, [room.badKey]);
  const [qr, setQr] = useState("");
  // An example screen shows the real address, wherever it is drawn.
  // The address people join at: VITE_PUBLIC_URL when set (like your network address, for phones on the same Wi-Fi), else this page's.
  const site = SITE_HOST;
  const joinUrl = `${PUBLIC_URL}/${code}`;

  useEffect(() => {
    QRCode.toString(joinUrl, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#151a3d", light: "#ffffff" } }).then(setQr);
  }, [joinUrl]);
  // A link question: its own QR code, to the presenter's link.
  const linkUrl = state?.kind === "link" && /^https?:\/\//i.test(state.url) ? state.url : "";
  const [linkQr, setLinkQr] = useState("");
  useEffect(() => {
    setLinkQr("");
    if (!linkUrl) return;
    QRCode.toString(linkUrl, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#151a3d", light: "#ffffff" } }).then(setLinkQr, () => {});
  }, [linkUrl]);

  // Answers are saved as they arrive: leaving just closes the screen and opens the results.
  const leave = async () => {
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
    navigate(`/app/p/${code}`);
  };

  // The wheel spins once at a time; a timer starts, pauses, starts again.
  const spin = () => {
    // Topic rounds: a topic chosen is chosen again with "Choose again", never by a stray S.
    if (picker && (picker.chosen !== null || !picker.left)) return;
    if (state?.kind === "wheel" && state.wheel?.list.length && !wheelSpinning(state.wheel.spin, state)) send(picker ? { type: "spin", from: index } : { type: "spin" });
  };
  const clockOn = !!state?.clock?.run && clockLeft(state.clock, serverNow(state)) > 0;
  const toggleClock = () => {
    if (state?.kind === "countdown") send({ type: "clock", act: clockOn ? "pause" : "start" });
  };

  // Presenting opens on the waiting screen, once per visit, unless the session already runs
  // (the presenter reloaded the page): phones then keep their question.
  const opened = useRef(false);
  useEffect(() => {
    // A screen drawn inside another page does not reset the session.
    if (!hostKey || embedded || status !== "open" || !state || opened.current) return;
    opened.current = true;
    if (state.index === 0 && state.answered === 0 && !state.board) send({ type: "lobby", on: true });
  }, [hostKey, status, !!state]);

  const clock = useCountdown(state);
  // A timed question starts by itself when it comes on screen: a count-in (3, 2, 1, here we go), then the question and its clock.
  const autoStarted = useRef("");
  useEffect(() => {
    if (!hostKey || status !== "open" || !state || state.lobby || state.board || !state.quiz || !state.timer || state.startedAt || state.revealed) return;
    const at = `${state.round}:${state.index}`;
    if (autoStarted.current === at) return;
    autoStarted.current = at;
    send({ type: "start", lead: COUNT_IN_MS });
  }, [hostKey, status, state?.round, state?.index, state?.lobby, state?.board, state?.quiz, state?.timer, state?.startedAt, state?.revealed]);
  // Until the clock runs, the question stays hidden behind the count-in.
  const counting = !!state && state.quiz && state.timer > 0 && !state.revealed && (!state.startedAt || (clock?.pre ?? 0) > 0);
  const canReveal = onStep && !!state?.quiz && !waitingStart && !counting;
  // The buttons follow the wheel and the timer: the screen redraws when a spin stops or a timer reaches zero.
  const [, redraw] = useState(0);
  const spinAt = state?.kind === "wheel" ? state.wheel?.spin?.at : undefined;
  const clockEnd = state?.kind === "countdown" && state.clock?.run ? state.clock.end : undefined;
  useEffect(() => {
    if (!state) return;
    const at = spinAt !== undefined ? spinAt + SPIN_MS : clockEnd;
    const left = at === undefined ? 0 : at - serverNow(state);
    if (left <= 0) return;
    const id = setTimeout(() => redraw((n) => n + 1), left + 60);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spinAt, clockEnd]);
  if (status === "missing") return <Message title={t("Presentation not found")} />;

  const total = state?.answered ?? 0;
  const unit =
    picker ? ["vote", "votes"] : state?.kind === "contact" ? ["contact", "contacts"] : state?.kind === "qa" ? ["question", "questions"] : state?.kind === "open" ? ["answer", "answers"] : state?.kind === "link" ? ["person opened the link", "people opened the link"] : state?.kind === "words" || state?.kind === "rank" || state?.kind === "points" || state?.multi ? ["participant", "participants"] : ["answer", "answers"];
  // A link has its own QR code: the one to join steps aside, as when the presenter hides it.
  // The standings and the podium take the whole width: the code stays in the top bar.
  const joinAside = !joinHidden && state?.kind !== "link" && !(ownBoard && state?.board);
  // French says "0 réponse", English "0 answers".
  const one = (n: number) => new Intl.PluralRules(lang).select(n) === "one";
  const numbers = screenLocale(lang);

  const empty = total === 0 && !state?.board && !showHidden;
  // The kind as the builder names it (a quiz is a choice with a right answer, a right order a ranking with one).
  const uiKind = !state ? "choice" : picker ? "topics" : state.kind === "choice" && state.quiz ? "quiz" : state.kind === "rank" && state.ordered ? "order" : state.kind;
  const KindIcon = [...KINDS, TOPICS_KIND].find((k) => k.id === uiKind)?.icon;
  // The builder's names for the kinds, written out so the screen's dictionaries carry each of them.
  const kindNames: Record<string, string> = {
    choice: t("Multiple choice"), scale: t("Rating"), scales: t("Rating scale"), rank: t("Ranking"), points: t("Prioritize"),
    words: t("Word cloud"), open: t("Open text"), qa: t("Audience Q&A"), wheel: t("Spin the wheel"), quiz: t("Quiz"),
    number: t("Guess a number"), order: t("Right order"), fill: t("Fill in the blanks"), match: t("Match pairs"), spot: t("Find on the image"),
    slide: t("Slide"), link: t("Link to scan"), media: t("Video or audio"), countdown: t("Timer"), contact: t("Contact details"),
    topics: t("Topic rounds"),
  };
  const kindName = kindNames[uiKind];
  // Only a waiting line to show (answers hidden until shown, nothing sent yet): it sits in the middle of the zone.
  const waitingOnly = !!state && ((state.kind === "number" && state.quiz && !state.revealed) || (uiKind === "order" && !state.revealed) || (["words", "open", "qa"].includes(state.kind) && empty));
  const centered = counting || waitingOnly || (picker ? picker.how === "wheel" || picker.chosen !== null : CENTERED.includes(uiKind));
  // The question's own picture shares the content zone with the answers (a slide without text shows it alone).
  const picture = state?.image && !OWN_PICTURE.includes(state.kind) ? state.image : null;
  const pictureOnly = !!picture && state?.kind === "slide" && !state.text;
  // While the curtain closes, the footer stays the waiting screen's, like the page above it.
  const footLobby = lobby || launch?.phase === "closing";
  // "Who answered" (first names) already gives the figure when it matches the count: the count then steps aside.
  const named = state?.people.filter((p) => p.name) ?? [];
  // Topic rounds' picker once a topic is chosen: the vote that chose it gives the count, nobody answers any more
  // (and the only topic left had no vote at all).
  const pickerClosed = !!picker && picker.chosen !== null;
  const whoShown = !!hostKey && !!state && !footLobby && !state.board && !NOTHING_TO_ANSWER.includes(state.kind) && !pickerClosed && named.some((p) => p.done !== undefined);
  const showCount = !!state && !NOTHING_TO_ANSWER.includes(state.kind) && state.kind !== "contact" && picker?.chosenHow !== "last" && !(whoShown && named.filter((p) => p.done).length === total);
  // What the arrows do on this step, as their tooltips say it.
  const nextLabel =
    step === "reveal" ? t("Show right answer") : step === "board" ? t("Leaderboard") : step === "spin" ? t("Spin") : step === "pick" ? t("Close the vote") : settled && picker?.left ? t("Start {topic}", { topic: chosenLabel }) : t("Next question");
  // From the first question of the round under way, ← goes back to the picker (same topic, no new draw).
  const backToPicker = !!topics && topics.at === "topic" && topics.pos === 1 && topics.topic !== null && topics.order[topics.order.length - 1] === topics.topic && !state?.board;
  // The standings that close a round (the leaderboard after each round): "After round 2".
  const roundBoard = !!topics && boardModeOf(state) === "round" && topics.at === "topic" && topics.pos === topics.size && boardView(state) === "standings";
  const prevLabel = backToPicker ? (topics!.how === "wheel" ? t("Back to the wheel") : t("Back to the vote")) : index === 0 && !topics ? t("Back to the waiting screen") : t("Previous question");

  return (
    <UiProvider value={strings}>
    <main className={`present ${embedded ? "embedded" : ""} ${look.className}${decor ? ` decor-${decor}` : ""}`} style={look.style} ref={mainRef}>
      {decor === "halloween" && <HalloweenScene />}
      {!framed && <PageLang lang={lang} />}
      <header className="present-top">
        {brand?.logo ? <BrandLogo brand={brand} /> : embedded ? <span className="logo"><Wordmark /></span> : <Logo bounce to="/app" />}
        <div className="present-actions">
          {/* Only shown when the link drops, so the screen stays clean. */}
          {status !== "open" && (
            <span className="live-pill">
              <i />
              {status === "connecting" ? t("Connecting…") : t("Reconnecting…")}
            </span>
          )}
          {state?.locked && !lobby && !state.quiz && state.kind !== "contact" && !NOTHING_TO_ANSWER.includes(state.kind) && (
            <span className="live-pill paused" role="status">
              <Lock size={14} /> {t("Voting paused")}
            </span>
          )}
          {!lobby && !state?.board && !joinAside && (
            <span className="code-pill" aria-label={t("Code {code}", { code })}>
              {site} · <strong>{code}</strong>
            </span>
          )}
          {hostKey && !embedded && (
            <button className="ghost save-exit" onClick={leave} style={hold} aria-label={t("Save and exit")} title={t("Save and exit")}>
              <LogOut size={18} /> <span className="save-exit-label">{t("Save and exit")}</span>
            </button>
          )}
          {!embedded && hostKey && (
            <button className={`icon-btn keys-btn ${keysOpen ? "on" : ""}`} aria-label={t("Keyboard shortcuts (?)")} title={t("Keyboard shortcuts (?)")} aria-expanded={keysOpen} aria-keyshortcuts="?" onClick={(e) => (e.currentTarget.blur(), setKeysOpen((open) => !open))}>
              <Keyboard size={19} />
            </button>
          )}
          {!embedded && (
            <button
              className="icon-btn"
              aria-keyshortcuts="F"
              aria-label={t("Full screen (F)")}
              title={t("Full screen (F)")}
              // The button lets go of the focus, so no focus ring stays on the projected screen.
              onClick={(e) => (e.currentTarget.blur(), document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen())}
            >
              <Maximize size={19} />
            </button>
          )}
        </div>
      </header>
      {keysOpen && hostKey && !embedded && (
        // Only the keys that do something on this step are listed.
        <div className="keys-panel" role="dialog" aria-label={t("Keyboard shortcuts")} ref={keysPanel}>
          <p className="keys-title">
            <Keyboard size={16} aria-hidden /> <span>{t("Keyboard shortcuts")}</span>
            <button type="button" className="keys-close" aria-label={t("Close")} title={t("Close")} onClick={() => setKeysOpen(false)}><X size={16} /></button>
          </p>
          <dl>
            <dt><kbd>→</kbd></dt><dd>{t("Next step")}</dd>
            <dt><kbd>←</kbd></dt><dd>{t("Previous step")}</dd>
            {canPause && <><dt><kbd>P</kbd></dt><dd>{t("Pause or resume voting")}</dd></>}
            {canReveal && <><dt><kbd>R</kbd></dt><dd>{t("Show or hide the right answer")}</dd></>}
            {canSpin && <><dt><kbd>S</kbd></dt><dd>{t("Spin the wheel or start the timer")}</dd></>}
            {canQr && <><dt><kbd>Q</kbd></dt><dd>{t("Show or hide the QR code")}</dd></>}
            <dt><kbd>F</kbd></dt><dd>{t("Full screen")}</dd>
            <dt><kbd>?</kbd></dt><dd>{t("Show or hide this list")}</dd>
          </dl>
          {onStep && state?.kind === "words" && <p className="keys-hint">{t("Click a word in the cloud to remove it")}</p>}
          {onStep && (state?.kind === "open" || state?.kind === "qa") && <p className="keys-hint">{t("Point at an answer, then click the eye to hide it")}</p>}
        </div>
      )}

      {/* While the curtain closes, the waiting screen stays: question 1 shows only once it is shut. */}
      {(lobby || launch?.phase === "closing") && state ? (
        <Lobby state={state} code={code} qr={qr} welcome={brand?.welcome} t={t} lang={lang} style={hold} site={site} onRemove={hostKey ? (tag) => void send({ type: "unname", tag }) : undefined} />
      ) : (
      <div className={`present-body ${joinAside ? "" : "no-join"}`} style={hold}>
        <section className={`stage ${state?.board ? "is-board" : ""}`} data-kind={uiKind} data-align={centered ? "center" : "top"}>
          {state?.board && boardView(state) !== "list" ? (
            // Keyed by when it opened: a leaderboard opened again plays again.
            <div className="pd-view" key={`board${state.boardAt ?? 0}`} ref={animBoard}>
              {/* After a topic round: which round the standings follow; the final ranking of topic rounds says so. */}
              {roundBoard ? (
                <p className="pd-meta"><Layers size={18} aria-hidden /> {t("After round {n}", { n: topics!.roundNo })}</p>
              ) : topics && boardView(state) === "podium" ? (
                <p className="pd-meta"><Layers size={18} aria-hidden /> {t("Topic rounds")}</p>
              ) : (
                <p className="pd-meta"><Trophy size={18} aria-hidden /> {t("Quiz")}</p>
              )}
              <h1 className="pd-title">{boardView(state) === "podium" ? t("Final ranking") : t("Leaderboard")}</h1>
              {boardView(state) === "podium" ? (
                <Podium entries={state.board} locale={numbers} elapsed={boardElapsed(state, PODIUM_MS)} sound={!!hostKey && !demo} t={t} />
              ) : (
                <Standings entries={state.board} locale={numbers} elapsed={boardElapsed(state, STANDINGS_MS)} t={t} />
              )}
            </div>
          ) : state?.board ? (
            <div className="present-board" ref={plainBoard}>
              <p className="present-step">{t("Quiz")}</p>
              <h1 className="question big with-icon-title"><Trophy size={48} className="gold" /> {t("Leaderboard")}</h1>
              <Leaderboard entries={state.board} locale={numbers} />
            </div>
          ) : (
            <>
              {/* Same rows for every kind: where we are and what kind of question, the title, then the content zone. */}
              <div className="stage-head" key={`h${at}`}>
                <p className="stage-meta">
                  {/* Where we are, in figures: the same for a question, a slide or a timer. */}
                  {topics ? (
                    // Topic rounds: the round at the picker, the topic and the place in it during a round.
                    // The last round says so in big below: no "Round 4 of 4" above it.
                    picker ? (
                      picker.chosenHow === "last" ? null : <span className="present-step">{t("Round {n} of {m}", { n: Math.min(picker.roundNo, picker.of).toLocaleString(numbers), m: picker.of.toLocaleString(numbers) })}</span>
                    ) : topics.at === "topic" && topics.topic !== null ? (
                      <span className="present-step"><span className="round-tag">{topics.list[topics.topic]?.label}</span>{topics.pos.toLocaleString(numbers)} / {topics.size.toLocaleString(numbers)}</span>
                    ) : null
                  ) : count > 1 && <span className="present-step">{(index + 1).toLocaleString(numbers)} / {count.toLocaleString(numbers)}</span>}
                  {kindName && KindIcon && (
                    <span className="stage-kind">
                      <KindIcon size={16} aria-hidden /> {kindName}
                    </span>
                  )}
                </p>
                <div className="stage-title">
                  {/* During the count-in the question stays hidden: it shows on every screen at once. */}
                  <h1 className="question big" ref={titleRef}>{state && !counting ? keepMarks(state.question) : ""}</h1>
                </div>
              </div>
              {counting ? (
                <div className="stage-body" key={`c${at}`}>
                  {hostKey || state?.startedAt ? <CountIn big pre={state?.startedAt ? (clock?.pre ?? 0) : COUNT_IN_MS} /> : <div className="count-in big"><em>{t("Get ready")}</em></div>}
                </div>
              ) : (
              <>
              <div className={`stage-body ${picture ? (pictureOnly ? "picture-only" : "with-picture") : ""}`} ref={stageRef} key={`b${at}`}>
                {picture && <img className="present-image" src={picture} alt="" />}
                <div className={`stage-fit ${(state?.kind === "choice" || state?.kind === "rank") && (state?.options.length ?? 0) > 5 ? "many" : ""}`} ref={fitRef}>
                {clock && !state?.revealed && <Countdown left={clock.left} ratio={clock.ratio} />}
                {picker && state && (
                  picker.chosenHow === "last" ? (
                    // The only topic left: no wheel, no vote.
                    <div className="round-alone"><RoundWon topics={picker} label={chosenLabel} /></div>
                  ) : picker.how === "wheel" ? (
                    <Wheel key={at} state={state} sound={!!hostKey} onSpin={hostKey && picker.chosen === null ? spin : undefined} />
                  ) : picker.chosen === null ? (
                    <ChoiceResults options={state.options} counts={state.counts} done={picker.list.map((x) => x.done)} doneLabel={t("Played")} onPick={hostKey && picker.left ? (i) => send({ type: "pick", topic: i, from: index }) : undefined} pickTitle={t("Choose this topic")} />
                  ) : (
                    // The vote closed: its bars, and the topic it chose.
                    <div className="round-pick">
                      <ChoiceResults options={state.options} counts={state.counts} done={picker.list.map((x) => x.done)} doneLabel={t("Played")} chosen={picker.chosen} onPick={hostKey && !picker.locked ? (i) => i !== picker.chosen && send({ type: "pick", topic: i, from: index }) : undefined} pickTitle={t("Choose this topic")} />
                      <div className="wheel-side"><RoundWon topics={picker} label={chosenLabel} key={`${picker.chosen}:${picker.pass}`} /></div>
                    </div>
                  )
                )}
                {state?.kind === "choice" && !picker &&
                  (waitingStart ? (
                    <ol className="quiz-preview">
                      {state.options.map((o, i) => <li key={i}><b>{String.fromCharCode(65 + i)}</b>{o}</li>)}
                    </ol>
                  ) : (
                    <ChoiceResults options={state.options} counts={state.counts} correct={state.correct} voters={state.multi ? state.answered : undefined} />
                  ))}
                {state?.kind === "scale" && <ScaleResults counts={state.counts} max={state.max} labels={state.labels} locale={numbers} style={state.style} />}
                {state?.kind === "contact" && <ContactCount count={state.answered} locale={numbers} />}
                {state?.kind === "rank" &&
                  (state.ordered ? (
                    state.revealed ? <OrderResults options={state.options} result={state.orderResults} voters={state.answered} locale={numbers} /> : <Waiting kind="game" />
                  ) : (
                    <RankResults options={state.options} counts={state.counts} voters={state.answered} />
                  ))}
                {state?.kind === "scales" && <ScalesResults options={state.options} counts={state.counts} max={state.max} labels={state.labels} locale={numbers} />}
                {state?.kind === "number" &&
                  (state.quiz && !state.revealed ? (
                    <Waiting kind="game" />
                  ) : (
                    <NumberResults numbers={state.numbers ?? []} answer={state.answer} closest={state.closest} locale={numbers} />
                  ))}
                {state?.kind === "slide" && state.text && <p className="slide-text big">{state.text}</p>}
                {state?.kind === "link" && linkUrl && (
                  <div className={`link-stage ${state.image ? "with-image" : ""}`}>
                    {state.image && <img className="link-art" src={state.image} alt="" />}
                    <div className="link-qr" role="img" aria-label={t("QR code to {url}", { url: linkUrl })} dangerouslySetInnerHTML={{ __html: linkQr }} />
                    {!state.image && <p className="link-url">{linkUrl.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "")}</p>}
                  </div>
                )}
                {state?.kind === "points" && <PointsResults options={state.options} counts={state.counts} voters={state.answered} locale={numbers} />}
                {state?.kind === "fill" && (
                  <FillStage gaps={state.gaps ?? []} bank={state.bank ?? []} blanks={state.blanks ?? []} revealed={state.revealed} result={state.orderResults} top={state.fillTop ?? []} voters={state.answered} locale={numbers} waiting={<Waiting kind="game" />} />
                )}
                {state?.kind === "match" &&
                  (state.revealed ? (
                    <MatchResults options={state.options} result={state.orderResults} voters={state.answered} locale={numbers} />
                  ) : (
                    <>
                      <MatchBoard options={state.options} seed={`${state.round}:${state.index}`} />
                      <Waiting kind="game" />
                    </>
                  ))}
                {state?.kind === "spot" && state.image && (
                  <div className="spot-stage">
                    <SpotImage image={state.image} spots={state.spots} zone={state.zone} big />
                    {state.quiz && !state.revealed ? (
                      <Waiting kind="game" />
                    ) : state.zone ? (
                      <p className="or-big">
                        <strong>{(state.answered ? Math.round(((state.found ?? 0) / state.answered) * 100) : 0).toLocaleString(numbers)}%</strong> {t("found the right spot")}
                      </p>
                    ) : null}
                  </div>
                )}
                {state?.kind === "wheel" && !picker && <Wheel key={at} state={state} sound={!!hostKey} onSpin={hostKey ? spin : undefined} />}
                {state?.kind === "countdown" && (
                  <div className={`clock-stage ${hostKey ? "can-toggle" : ""}`} onClick={hostKey ? toggleClock : undefined}>
                    <CountdownView state={state} big sound={!!hostKey} />
                  </div>
                )}
                {state?.kind === "media" && <MediaPlayer url={state.url} big title={state.question} poster={demo ? "/photos/conference.webp" : undefined} />}
                {state?.kind === "words" && (empty ? <Waiting kind="words" /> : <WordCloud words={cloudWords} base={60} onRemove={hostKey ? dropWord : undefined} />)}
                {state?.kind === "open" &&
                  (empty ? <Waiting kind="open" /> : <OpenWall answers={answers} onHide={hostKey ? (id) => send({ type: "hide", id }, false) : undefined} />)}
                {state?.kind === "qa" &&
                  (empty ? (
                    <Waiting kind="qa" />
                  ) : (
                    <QaList items={answers} onDone={hostKey ? (id) => send({ type: "done", id }, false) : undefined} onHide={hostKey ? (id) => send({ type: "hide", id }, false) : undefined} />
                  ))}
                </div>
              </div>
              </>
              )}
            </>
          )}
        </section>

        {joinAside && (
        <aside className="join-card">
          <p className="join-title">{t("To answer")}</p>
          <div className="qr" dangerouslySetInnerHTML={{ __html: qr }} />
          <p className="join-hint">{t("Scan the QR code or go to")}</p>
          <p className="join-url">{site}</p>
          <div className="join-code" aria-label={t("Code {code}", { code })}>
            {code.split("").map((c, i) => <span key={i}>{c}</span>)}
          </div>
        </aside>
        )}
      </div>
      )}

      <footer className="present-foot" ref={footRef} onClick={dropFocus}>
        <div className="foot-left">
          {(footLobby || state?.board || showCount) && (
            <p className="foot-count">
              {footLobby ? (embedded ? t("Click Start when everyone is in") : t("Press → or Start when everyone is in")) : state?.board ? t("Points: right answers and speed") : <><strong className="foot-n" key={total}>{total}</strong> {t(one(total) ? unit[0] : unit[1])}</>}
            </p>
          )}
          {whoShown && <WhoAnswered people={state!.people} />}
        </div>
        {hostKey && state && !footLobby && (
          // The presenter's buttons, in the order they are used: the step this question waits for (start, spin, show the
          // answer), what belongs to this kind of question, then what applies to every question. Shortcuts show on hover.
          <div className="present-tools">
            {waitingStart && !state.board && autoStarted.current !== `${state.round}:${state.index}` && (
              <button className="primary" onClick={() => send({ type: "start", lead: COUNT_IN_MS })}>
                <Play size={18} /> {t("Start timer ({n}s)", { n: state.timer })}
              </button>
            )}
            {picker && !state.board && picker.left && (
              // Topic rounds' picker: turn the wheel or close the vote (or choose by hand), then start the topic chosen.
              settled ? (
                <>
                  <button className="primary" title={t("Shortcut: →")} onClick={next} aria-label={t("Start {topic}", { topic: chosenLabel })}>
                    {/* A small screen keeps "Start": the topic's name is already big above. */}
                    <Play size={18} /> <span className="lbl-long">{t("Start {topic}", { topic: chosenLabel })}</span><span className="lbl-short">{t("Start")}</span>
                  </button>
                  {!picker.locked && picker.chosenHow !== "last" && (
                    <button className="ghost" title={t("While the round has not started")} aria-label={t("Choose again")} onClick={() => send({ type: "repick", from: index })}>
                      <RotateCcw size={18} /> <span className="lbl-long">{t("Choose again")}</span>
                    </button>
                  )}
                </>
              ) : (
                <>
                  {picker.how === "wheel" ? (
                    <button className="primary" title={t("Shortcut: S")} aria-keyshortcuts="S" disabled={spinning || !state.wheel?.list.length} onClick={spin}>
                      <LoaderPinwheel size={18} /> {t("Spin")}
                    </button>
                  ) : (
                    <button className="primary" onClick={() => send({ type: "pick", from: index })}>
                      <CircleCheck size={18} /> {t("Close the vote")}
                    </button>
                  )}
                  {!spinning && (
                    <button className="ghost" ref={chooseBtn} aria-haspopup="menu" aria-expanded={chooseOpen} title={t("Choose the topic yourself")} onClick={() => setChooseOpen((o) => !o)}>
                      <MousePointerClick size={18} /> {t("Choose")} <ChevronDown size={16} />
                    </button>
                  )}
                </>
              )
            )}
            {state.kind === "wheel" && !picker && !state.board && (
              <>
                <button className="primary" title={t("Shortcut: S")} aria-keyshortcuts="S" disabled={!state.wheel?.list.length || wheelSpinning(state.wheel?.spin, state)} onClick={spin}>
                  <LoaderPinwheel size={18} /> {t("Spin")}
                </button>
                {!!state.wheel?.picked.length && (
                  <button className="ghost" onClick={() => send({ type: "unspin" })} title={t("Everyone back on the wheel")}>
                    <RotateCcw size={18} /> {t("Start over")}
                  </button>
                )}
              </>
            )}
            {state.kind === "countdown" && !state.board && (
              <>
                <button className={clockOn ? "ghost" : "primary"} title={t("Shortcut: S")} aria-keyshortcuts="S" onClick={toggleClock}>
                  {clockOn ? <><Pause size={18} /> {t("Pause")}</> : <><Play size={18} /> {t("Start")}</>}
                </button>
                <button className="ghost" onClick={() => send({ type: "clock", act: "add", by: 60 })}>
                  <Plus size={18} /> {t("1 min")}
                </button>
                <button className="ghost" aria-label={t("Reset")} title={t("Reset")} onClick={() => send({ type: "clock", act: "reset" })}>
                  <RotateCcw size={18} />
                </button>
              </>
            )}
            {state.quiz && !waitingStart && !counting && !state.board && (
              <button className={state.revealed ? "ghost" : "primary"} title={t("Shortcut: R")} aria-keyshortcuts="R" onClick={() => send({ type: "reveal", show: !state.revealed })}>
                {state.revealed ? <><EyeOff size={18} /> {t("Hide answer")}</> : <><Eye size={18} /> {t("Show right answer")}</>}
              </button>
            )}
            {(state.kind === "qa" || state.kind === "open") && (hiddenCount > 0 || showHidden) && (
              <button className="ghost" onClick={() => setShowHidden((s) => !s)} title={t("Answers taken off the screen")}>
                {showHidden ? <><EyeOff size={18} /> {t("Done")}</> : <><Eye size={18} /> {hiddenCount === 1 ? t("1 hidden") : t("{n} hidden", { n: hiddenCount })}</>}
              </button>
            )}
            {(state.kind === "qa" || state.kind === "open" || state.kind === "words") && (Object.keys(postMap).length > 0 || !translatePosts) && (
              <button className="ghost" onClick={togglePosts} title={t("Answers written in other languages")}>
                <Languages size={18} /> {translatePosts ? t("Show originals") : t("Translate")}
              </button>
            )}
            {!state.quiz && !picker && state.kind !== "contact" && state.kind !== "link" && !NOTHING_TO_ANSWER.includes(state.kind) && (
              <button className="ghost" title={t("Shortcut: P")} aria-keyshortcuts="P" aria-pressed={state.locked} onClick={() => send({ type: "lock", on: !state.locked })}>
                {state.locked ? <><Unlock size={18} /> {t("Resume voting")}</> : <><Lock size={18} /> {t("Pause voting")}</>}
              </button>
            )}
            {state.hasBoard && (state.quiz || state.board || index === count - 1) && (
              <button className="ghost" onClick={() => send({ type: "board", show: !state.board })}>
                {state.board ? <><X size={18} /> {t("Close leaderboard")}</> : <><Trophy size={18} /> {t("Leaderboard")}</>}
              </button>
            )}
            {!state.board && state.kind !== "link" && (
              <button className="ghost" onClick={toggleJoin} aria-pressed={!joinHidden} title={t("Shortcut: Q")} aria-keyshortcuts="Q">
                <QrCode size={18} /> {joinHidden ? t("Show QR code") : t("Hide QR code")}
              </button>
            )}
          </div>
        )}
        {hostKey && footLobby ? (
          <button className="primary lobby-start" onClick={lobby ? next : undefined}>
            {t("Start")} <ChevronRight size={20} />
          </button>
        ) : hostKey ? (
          <nav className="present-nav" aria-label={t("Questions")}>
            <button className="icon-btn" onClick={prev} disabled={topics ? !topics.hasPrev && started && !(ownBoard && state?.board) : index === 0 && started && !(ownBoard && state?.board)} aria-keyshortcuts="ArrowLeft" aria-label={prevLabel} title={prevLabel}>
              <ChevronLeft size={22} />
            </button>
            {topics ? (
              // Topic rounds: the dots of the topic on screen only (its questions follow each other in the list).
              topics.at === "topic" && topics.size > 1 && !state?.board && (
                <span className="present-dots" aria-hidden>
                  {Array.from({ length: topics.size }, (_, i) => (
                    <i key={i} className={i === topics.pos - 1 ? "on" : ""} onClick={() => goto(index - topics.pos + 1 + i)} />
                  ))}
                </span>
              )
            ) : count > 1 && (
              <span className="present-dots" aria-hidden>
                {Array.from({ length: count }, (_, i) => (
                  <i key={i} className={i === index ? "on" : ""} onClick={() => goto(i)} />
                ))}
              </span>
            )}
            <button className="icon-btn next" onClick={next} disabled={topics ? !topics.hasNext && !step : index === count - 1 && !step} aria-keyshortcuts="ArrowRight" aria-label={nextLabel} title={nextLabel}>
              <ChevronRight size={22} />
            </button>
          </nav>
        ) : !embedded && lookedUp && viewerUser === null ? (
          <a className="ghost button" href={`/login?next=${encodeURIComponent(`/present/${code}`)}`}>{t("Sign in to control")}</a>
        ) : !embedded && lookedUp && viewerUser ? (
          <span className="foot-count">{t("Watch only: another account runs it")}</span>
        ) : (
          <span />
        )}
      </footer>
      {launch && <LaunchCurtain text={t("Here we go!")} start={launch.start} />}
      {chooseOpen && picker && mainRef.current && createPortal(
        <ChooseMenu anchor={chooseBtn.current} label={t("Choose the topic yourself")} onClose={() => setChooseOpen(false)}>
          {picker.list.map((x, i) =>
            x.done || i === picker.chosen ? null : (
              <button key={i} type="button" role="menuitem" className="round-menu-item" onClick={() => (setChooseOpen(false), send({ type: "pick", topic: i, from: index }))}>
                <span>{x.label}</span>
                <small>{x.n === 1 ? t("1 question") : t("{n} questions", { n: x.n })}</small>
              </button>
            ),
          )}
        </ChooseMenu>,
        mainRef.current,
      )}
    </main>
    </UiProvider>
  );
}

// The topics left, to choose one by hand: drawn over the screen (out of the footer, which clips), above its button.
function ChooseMenu({ anchor, label, onClose, children }: { anchor: HTMLElement | null; label: string; onClose: () => void; children: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; bottom: number } | null>(null);
  useLayoutEffect(() => {
    const at = () => {
      const r = anchor?.getBoundingClientRect();
      if (!r) return;
      const width = box.current?.offsetWidth ?? 260;
      setPlace({ left: Math.max(12, Math.min(r.left, innerWidth - width - 12)), bottom: innerHeight - r.top + 8 });
    };
    at();
    addEventListener("resize", at);
    return () => removeEventListener("resize", at);
  }, [anchor]);
  useEffect(() => {
    const away = (e: PointerEvent) => {
      const el = e.target as Node;
      if (!box.current?.contains(el) && !anchor?.contains(el)) onClose();
    };
    addEventListener("pointerdown", away);
    box.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => removeEventListener("pointerdown", away);
  }, []);
  return (
    <div className="round-menu" role="menu" aria-label={label} ref={box} style={place ? { left: place.left, bottom: place.bottom } : { visibility: "hidden" }}>
      <p className="round-menu-title">{label}</p>
      {children}
    </div>
  );
}
