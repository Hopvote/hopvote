import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { Lock, UserRound, X } from "lucide-react";
import { AVATARS } from "../avatars";
import { Buddy } from "../buddies";
import type { RoomState } from "../room";
import { SITE_HOST } from "../site-config";

// The big screen before the first question: how to join, and the room filling up.
// `t` and `lang`: the presentation's language on the big screen, the app's in the design studio's preview.
// `style`: the big screen hides the waiting screen for a moment while its language's text loads.
// `site`: the address shown to join (an example screen shows the public address wherever it is drawn).
// `onRemove`: the presenter's screen, which can take a first name off (a cross shows when the pointer is on it,
// or once the name is tapped on a touch screen).
export function Lobby({ state, code, qr, welcome, t, lang, style, site = SITE_HOST, onRemove }: { state: RoomState; code: string; qr: string; welcome?: string; t: (text: string, vars?: Record<string, string | number>) => string; lang: string; style?: CSSProperties; site?: string; onRemove?: (tag: string) => void }) {
  // French says "0 participant", English "0 people".
  const one = new Intl.PluralRules(lang).select(state.online) === "one";
  const count = state.online;
  const named = state.people.filter((p) => p.name);
  const faces = state.people.filter((p) => !p.name);
  const last = useRef(count);
  const [bump, setBump] = useState(0);
  const [toast, setToast] = useState("");

  // The waiting screen always fits its window: a long title gets smaller letters (three lines at most), a full room
  // shows the rows that fit, and the QR code gives up some size before anything runs into the footer.
  // Nothing changes when everything fits already.
  const root = useRef<HTMLDivElement>(null);
  const welcomeText = welcome ?? "";
  useLayoutEffect(() => {
    const box = root.current;
    const stage = box?.querySelector<HTMLElement>(".lobby-stage");
    const title = stage?.querySelector<HTMLElement>("h1");
    const card = box?.querySelector<HTMLElement>(".lobby-card");
    const qr = card?.querySelector<HTMLElement>(".lobby-qr");
    if (!box || !stage || !title || !card || !qr) return;
    // The window the screen is drawn in (the design studio draws it inside a frame).
    const narrow = box.ownerDocument.defaultView?.matchMedia("(max-width: 760px)");
    const fit = () => {
      title.style.fontSize = "";
      qr.style.width = "";
      stage.classList.remove("tight");
      const crowd = stage.querySelector<HTMLElement>(".lobby-crowd");
      const fade = () => crowd?.classList.toggle("clipped", crowd.scrollHeight > crowd.clientHeight + 1);
      // A phone or a narrow window scrolls: the normal sizes stay, a full room only fades its last row.
      if (narrow?.matches) return fade();
      const over = () => stage.scrollHeight > stage.clientHeight + 1;
      if (over()) stage.classList.add("tight");
      const base = parseFloat(getComputedStyle(title).fontSize);
      const fits = (k: number) => {
        title.style.fontSize = k === 1 ? "" : `${base * k}px`;
        const line = parseFloat(getComputedStyle(title).lineHeight) || base * k * 1.05;
        return title.offsetHeight <= line * 3 + 2 && !over();
      };
      if (!fits(1)) {
        let lo = 0.45;
        let hi = 1;
        for (let i = 0; i < 7; i++) {
          const mid = (lo + hi) / 2;
          if (fits(mid)) lo = mid;
          else hi = mid;
        }
        fits(lo);
      }
      const extra = card.scrollHeight - card.clientHeight;
      if (extra > 1) qr.style.width = `${Math.max(96, qr.offsetWidth - extra - 2)}px`;
      fade();
    };
    fit();
    const watch = new ResizeObserver(fit);
    watch.observe(box);
    document.fonts?.addEventListener("loadingdone", fit);
    return () => {
      watch.disconnect();
      document.fonts?.removeEventListener("loadingdone", fit);
    };
  }, [state.title, welcomeText, count, named.length, state.names]);

  useEffect(() => {
    const before = last.current;
    last.current = count;
    if (count <= before) return;
    setBump((b) => b + 1);
    const fresh = state.names ? state.people.slice(-(count - before)) : [];
    setToast(fresh.length === 1 ? t("{name} joined!", { name: fresh[0].name }) : count - before > 1 ? t("{n} people joined!", { n: count - before }) : t("Someone joined!"));
    const timer = setTimeout(() => setToast(""), 2200);
    return () => clearTimeout(timer);
  }, [count]);

  return (
    <div className="lobby" style={style} ref={root}>
      <div className="lobby-card">
        <p className="lobby-k">{t("To join")}</p>
        <p className="lobby-site">{site}</p>
        <div className="lobby-code">
          {code.split("").map((c, i) => <span key={i}>{c}</span>)}
        </div>
        <p className="lobby-or">{t("or scan")}</p>
        <div className="lobby-qr" dangerouslySetInnerHTML={{ __html: qr }} />
      </div>
      <div className="lobby-stage">
        {welcome && <p className="lobby-welcome">{welcome}</p>}
        <h1>{state.title}</h1>
        <p className="lobby-mode">
          {state.names ? <><UserRound size={18} /> {t("Names shown, answers anonymous")}</> : <><Lock size={18} /> {t("Anonymous answers")}</>}
        </p>
        <div className="lobby-counter">
          <b key={bump} className={bump ? "bump" : ""}>{count}</b>
          <span>{one ? t("person joined") : t("people joined")}</span>
        </div>
        <div className="lobby-crowd">
          {count === 0 ? (
            <p className="lobby-empty">{t("Participants will appear here as they scan.")}</p>
          ) : (
            <>
              {named.map((p, i) => (
                <span key={`${p.avatar}${p.name}${i}`} className="chip" tabIndex={onRemove && p.tag ? 0 : undefined}>
                  <Buddy id={p.avatar || p.name} size={34} />{p.name}
                  {onRemove && p.tag && (
                    <button type="button" className="chip-x" title={t("Remove this name")} aria-label={t("Remove this name")} onClick={() => onRemove(p.tag!)}><X size={16} strokeWidth={3} /></button>
                  )}
                </span>
              ))}
              {/* Anonymous phones show the buddy they picked; phones not heard from yet get a placeholder. */}
              {faces.map((p, i) => (
                <i key={`f${i}`}><Buddy id={p.avatar} size={52} /></i>
              ))}
              {Array.from({ length: Math.min(Math.max(0, count - state.people.length), 80) }, (_, i) => (
                <i key={i}><Buddy id={AVATARS[(i * 7) % AVATARS.length]} size={52} /></i>
              ))}
            </>
          )}
        </div>
      </div>
      {toast && <div className="lobby-toast" key={toast + bump}>{toast}</div>}
    </div>
  );
}
