// A small example of each kind of question as the big screen shows it, next to the builder's list of kinds.
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { useAppLang, useAppT } from "./app-i18n";
import { KINDS, TOPICS_KIND, type UiKind } from "./questions";
import { PUBLIC_URL } from "./site-config";

export type T = (text: string, vars?: Record<string, string | number>) => string;

function Bars({ rows, good }: { rows: [string, number][]; good?: number }) {
  const top = Math.max(...rows.map((r) => r[1]));
  return (
    <ol className="kp-bars">
      {rows.map(([label, pct], i) => (
        <li key={i} className={good === i ? "good" : good === undefined && pct === top ? "win" : ""}>
          <span>{good === i ? `${label} ✓` : label}</span>
          <strong>{pct}%</strong>
          <i style={{ width: `${pct}%` }} />
        </li>
      ))}
    </ol>
  );
}

function Items({ rows, right }: { rows: string[]; right?: boolean }) {
  return (
    <ol className={`kp-items ${right ? "right" : ""}`}>
      {rows.map((r, i) => (
        <li key={i}>
          <b>{i + 1}</b>
          {r}
        </li>
      ))}
    </ol>
  );
}

function Spread({ heights }: { heights: number[] }) {
  return (
    <span className="kp-spread" aria-hidden>
      {heights.map((h, i) => (
        <i key={i} className={h === 100 ? "kp-peak" : ""} style={{ height: `${h}%` }} />
      ))}
    </span>
  );
}

// The example itself, in any language: `t` writes its texts, `dec` its decimals, `qr` is the QR code's picture.
export function Example({ kind, t, qr, dec }: { kind: UiKind; t: T; qr: string; dec: (n: number) => string }) {
  switch (kind) {
    case "choice":
      return <><p className="kp-q">{t("What format for the June offsite?")}</p><Bars rows={[[t("Workshop"), 48], [t("Talk"), 27], [t("Debate"), 25]]} /></>;
    case "scale":
      return <><p className="kp-q">{t("How was today's session?")}</p><p className="kp-big">{dec(4.3)} <small>/ 5</small></p><Spread heights={[12, 10, 34, 100, 70]} /></>;
    case "scales":
      return (
        <>
          <p className="kp-q">{t("Your feedback on the training")}</p>
          <ul className="kp-scales">
            <li><span>{t("I learned new things")}</span><i><u style={{ width: "85%" }} /></i><b>{dec(4.4)}</b></li>
            <li><span>{t("The explanations were clear")}</span><i><u style={{ width: "78%" }} /></i><b>{dec(4.1)}</b></li>
            <li><span>{t("The length was right")}</span><i><u style={{ width: "55%" }} /></i><b>{dec(3.2)}</b></li>
          </ul>
        </>
      );
    case "rank":
      return <><p className="kp-q">{t("Your priorities for next year")}</p><Items rows={[t("Remote work"), t("Training"), t("Pay")]} /></>;
    case "words":
      return (
        <>
          <p className="kp-q kp-center">{t("One word for today?")}</p>
          <p className="kp-cloud"><span style={{ fontSize: 14 }}>{t("inspiring")}</span><span className="hot" style={{ fontSize: 28 }}>{t("motivated")}</span><span style={{ fontSize: 12 }}>{t("tired")}</span><span className="warm" style={{ fontSize: 19 }}>{t("curious")}</span><span style={{ fontSize: 15 }}>{t("ready")}</span></p>
        </>
      );
    case "open":
      return <><p className="kp-q">{t("An idea for the team?")}</p><p className="kp-bubble">{t("A lunch together every month")}</p><p className="kp-bubble">{t("Fewer meetings on Fridays")}</p></>;
    case "qa":
      return <><p className="kp-q">{t("Your questions for the speaker")}</p><p className="kp-bubble">{t("Which tools do you use?")}<b>▲ 12</b></p><p className="kp-bubble">{t("How did you start?")}<b>▲ 7</b></p></>;
    case "quiz":
      return <><p className="kp-q">{t("Which planet is the largest?")}</p><Bars rows={[[t("Saturn"), 21], [t("Jupiter"), 64], [t("Neptune"), 15]]} good={1} /></>;
    case "number":
      return (
        <>
          <p className="kp-q">{t("When did the Eiffel Tower open?")}</p>
          <div className="kp-hist" aria-hidden>
            {[12, 30, 62, 100, 55, 18].map((h, i) => <i key={i} style={{ height: `${h}%` }} />)}
            <span style={{ left: "58%" }} />
          </div>
          <p className="kp-note">{t("Right answer:")} <b>1889</b></p>
        </>
      );
    case "order":
      return <><p className="kp-q">{t("From the oldest to the newest")}</p><p className="kp-big">62% <small>{t("found the right order")}</small></p><Items rows={[t("Romanesque"), t("Renaissance"), t("Art Deco")]} right /></>;
    case "slide":
      return (
        <div className="kp-slide">
          <div>
            <p className="kp-q">{t("10-minute break")}</p>
            <p className="kp-note">{t("Coffee at the back. We start again at 10:45.")}</p>
          </div>
          <span className="kp-art" aria-hidden />
        </div>
      );
    case "link":
      return (
        <>
          <p className="kp-q">{t("Find me on LinkedIn")}</p>
          <div className="kp-link">
            <span className="kp-qr" aria-hidden dangerouslySetInnerHTML={{ __html: qr }} />
            <span>linkedin.com/in/…</span>
          </div>
        </>
      );
    case "contact":
      return <><p className="kp-q">{t("Let's stay in touch")}</p><p className="kp-field">{t("Full name")}</p><p className="kp-field">{t("Email")}</p><p className="kp-note">{t("Only you see them, in your results.")}</p></>;
    case "points":
      return (
        <>
          <p className="kp-q">{t("Where should the budget go?")}</p>
          <ol className="kp-bars kp-points">
            {([[t("Training"), 42], [t("Remote work"), 35], [t("Pay"), 23]] as [string, number][]).map(([label, n], i) => (
              <li key={i} className={i === 0 ? "win" : ""}>
                <span>{label}</span>
                <strong>{t("{n} pts", { n })}</strong>
                <i style={{ width: `${(n / 42) * 100}%` }} />
              </li>
            ))}
          </ol>
        </>
      );
    case "fill":
      return (
        <>
          <p className="kp-q">{t("Complete the sentence")}</p>
          <p className="kp-fill">{t("The capital of Australia is")} <b>Canberra</b>.</p>
          <p className="kp-big">72% <small>{t("filled every blank")}</small></p>
        </>
      );
    case "match":
      return (
        <>
          <p className="kp-q">{t("Match each country to its capital")}</p>
          <ul className="kp-pairs">
            {[[t("France"), "Paris"], [t("Italy"), "Rome"], [t("Spain"), "Madrid"]].map(([a, b]) => (
              <li key={a}><span>{a}</span><i>↔</i><span>{b}</span></li>
            ))}
          </ul>
        </>
      );
    case "spot":
      return (
        <>
          <p className="kp-q">{t("Where is Lyon on this map?")}</p>
          <div className="kp-map">
            <svg viewBox="0 0 200 150" aria-hidden>
              <path d="M70 8 L128 18 L170 52 L158 108 L118 140 L58 132 L24 98 L30 40 Z" />
            </svg>
            <span className="kp-zone" style={{ left: "60%", top: "50%", width: "16%", height: "20%" }} />
            {[[66, 58], [69, 61], [64, 63], [71, 57], [67, 65], [52, 40], [74, 70], [38, 72]].map(([x, y], i) => (
              <i key={i} style={{ left: `${x}%`, top: `${y}%` }} />
            ))}
          </div>
        </>
      );
    case "wheel":
      return (
        <>
          <p className="kp-q">{t("Who answers the next question?")}</p>
          <div className="kp-wheel">
            <svg viewBox="-110 -118 220 228" aria-hidden>
              {["Léa", "Tom", "Inès", "Hugo", "Sarah", "Malik", "Zoé", "Nina"].map((name, i) => {
                const a0 = (i * 45 * Math.PI) / 180;
                const a1 = ((i + 1) * 45 * Math.PI) / 180;
                // Names on the left half are turned over so they never read upside down (as on the real wheel).
                const a = i * 45 + 22.5 - 90;
                const flip = a > 90 && a < 270;
                return (
                  <g key={name}>
                    <path className={`wh${i}`} d={`M0 0 L${(100 * Math.sin(a0)).toFixed(1)} ${(-100 * Math.cos(a0)).toFixed(1)} A100 100 0 0 1 ${(100 * Math.sin(a1)).toFixed(1)} ${(-100 * Math.cos(a1)).toFixed(1)} Z`} />
                    <text className={`wht wht${i}`} transform={flip ? `rotate(${a + 180}) translate(-90 0)` : `rotate(${a}) translate(90 0)`} textAnchor={flip ? "start" : "end"} dominantBaseline="central" fontSize="14">{name}</text>
                  </g>
                );
              })}
              <circle r="15" className="wheel-hub" />
              <path d="M-10 -115 L10 -115 L0 -93 Z" className="wheel-pointer" />
            </svg>
          </div>
        </>
      );
    case "topics":
      // Topic rounds: the wheel among the topics, then the round chosen.
      return (
        <>
          <p className="kp-q">{t("What will the next topic be?")}</p>
          <div className="kp-wheel kp-topics">
            <svg viewBox="-110 -118 220 228" aria-hidden>
              {[t("History"), t("Geography"), t("Cinema"), t("Sport")].map((name, i) => {
                const a0 = (i * 90 * Math.PI) / 180;
                const a1 = ((i + 1) * 90 * Math.PI) / 180;
                const a = i * 90 + 45 - 90;
                const flip = a > 90 && a < 270;
                return (
                  <g key={i}>
                    <path className={`wh${i}`} d={`M0 0 L${(100 * Math.sin(a0)).toFixed(1)} ${(-100 * Math.cos(a0)).toFixed(1)} A100 100 0 0 1 ${(100 * Math.sin(a1)).toFixed(1)} ${(-100 * Math.cos(a1)).toFixed(1)} Z`} />
                    <text className={`wht wht${i}`} transform={flip ? `rotate(${a + 180}) translate(-90 0)` : `rotate(${a}) translate(90 0)`} textAnchor={flip ? "start" : "end"} dominantBaseline="central" fontSize="13">{name}</text>
                  </g>
                );
              })}
              <circle r="15" className="wheel-hub" />
              <path d="M-10 -115 L10 -115 L0 -93 Z" className="wheel-pointer" />
            </svg>
            <p className="kp-note">{t("Round 1 of 3")}</p>
          </div>
        </>
      );
    case "countdown":
      return (
        <>
          <p className="kp-q kp-center">{t("Group work")}</p>
          <div className="kp-clock">
            <svg viewBox="0 0 100 100" aria-hidden>
              <circle cx="50" cy="50" r="44" className="kp-clock-track" />
              <circle cx="50" cy="50" r="44" className="kp-clock-fill" strokeDasharray="276.5" strokeDashoffset="70" />
            </svg>
            <strong>4:59</strong>
          </div>
        </>
      );
    case "media":
      return (
        <>
          <p className="kp-q">{t("Watch the trailer")}</p>
          <div className="kp-video" aria-hidden>
            <span className="kp-play" />
            <i />
          </div>
          <p className="kp-note">YouTube · Vimeo · SoundCloud · Spotify</p>
        </>
      );
  }
}

export function KindPreview({ kind }: { kind: UiKind }) {
  const t = useAppT();
  const lang = useAppLang();
  const dec = (n: number) => n.toLocaleString(lang === "fr" ? "fr-FR" : "en-US", { minimumFractionDigits: 1 });
  const [qr, setQr] = useState("");
  useEffect(() => {
    QRCode.toString(PUBLIC_URL, { type: "svg", margin: 0, color: { dark: "#151a3d", light: "#ffffff" } }).then(setQr, () => {});
  }, []);
  // The kind whose pictures are missing (the dev server before scripts/previews.mjs ran): its drawing instead.
  const [missing, setMissing] = useState<UiKind | null>(null);
  const info = [...KINDS, TOPICS_KIND].find((k) => k.id === kind);
  if (!info) return null;
  // A picture of the real big screen, taken from example answers by scripts/previews.mjs (optional).
  const pics = `/previews/${lang === "fr" ? "fr" : "en"}/${kind}`;
  const text = (
    <div className="kp-text">
      <p className="kp-title">{t(info.label)}</p>
      <p className="kp-hint">{t(info.hint)}</p>
    </div>
  );
  // A picture missing (the dev server before scripts/previews.mjs ran): the drawing instead.
  if (missing === kind)
    return (
      <div className="kind-preview drawn" aria-hidden>
        <div className="kp-stage">
          <Example kind={kind} t={t} qr={qr} dec={dec} />
        </div>
        {text}
      </div>
    );
  return (
    <div className="kind-preview" aria-hidden>
      <img key={kind} className="kp-shot" src={`${pics}.webp`} alt="" width={1280} height={720} onError={() => setMissing(kind)} />
      {text}
    </div>
  );
}
