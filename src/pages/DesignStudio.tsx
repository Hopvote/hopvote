import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { BookmarkPlus, Check, ChevronDown, ImagePlus, Paintbrush, RotateCcw, Trash2, Type, Upload, X } from "lucide-react";
import { api } from "../api";
import { BrandLogo, brandLook, useBrandFonts } from "../brand";
import { bgCss, DEFAULT_DIM, FONT_IDS, FONTS, fontHref, WELCOME_MAX, type Bg, type Brand, type FontId, type Radius, type Size } from "../brand-core";
import { logoColors, mix } from "../palette";
import type { RoomState } from "../room";
import { Wordmark } from "../ui";
import { uploadFont, uploadImage, uploadLogo } from "../upload";
import { Present } from "./Present";
import { translate, useAppLang, useAppT, type AppLang } from "../app-i18n";

const PRESETS = ["#ff5436", "#2563eb", "#12a37a", "#8b46d6", "#e08a00", "#e2457a", "#0f172a", "#ffffff"];
type Kit = { id: string; name: string; brand: Brand };
type View = "waiting" | "question" | "phone";

type T = ReturnType<typeof useAppT>;
const fontLabel = (t: T, brand: Brand, id?: FontId) => (!id ? t("Default") : id === "custom" ? brand.fontName ?? t("Your font") : FONTS[id].label);
const fontCss = (id: FontId) => (id === "custom" ? '"Hopvote Brand Font", system-ui' : FONTS[id].family);

/* ---------------- Small controls ---------------- */

function ColorRow({ label, value, onChange, suggestions, auto = "Auto" }: { label: string; value?: string; onChange: (c?: string) => void; suggestions: string[]; auto?: string | null }) {
  const t = useAppT();
  const colors = [...new Set([...suggestions, ...PRESETS])].slice(0, 8);
  return (
    <div className="ds-color">
      <span className="ds-label">{label}</span>
      <div className="ds-swatches">
        {auto && (
          <button type="button" className={`ds-auto ${value ? "" : "on"}`} onClick={() => onChange(undefined)}>{t(auto)}</button>
        )}
        {colors.map((c) => (
          <button key={c} type="button" className={`ds-sw ${value === c ? "on" : ""}`} style={{ background: c }} aria-label={`${label} ${c}`} onClick={() => onChange(c)} />
        ))}
        <label className={`ds-sw ds-custom ${value && !colors.includes(value) ? "on" : ""}`} style={value && !colors.includes(value) ? { background: value } : undefined} title={t("Any color")}>
          <input type="color" value={value ?? "#ff5436"} onChange={(e) => onChange(e.target.value)} />
        </label>
      </div>
    </div>
  );
}

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="ds-seg" role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} className={value === v ? "on" : ""} onClick={() => onChange(v)}>{text}</button>
      ))}
    </div>
  );
}

function FilePick({ accept, label, busyLabel, onFile }: { accept: string; label: string; busyLabel: string; onFile: (f: File) => Promise<void> }) {
  const t = useAppT();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function pick(file?: File) {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      await onFile(file);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Upload failed"));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }
  return (
    <>
      <input ref={input} type="file" accept={accept} hidden onChange={(e) => pick(e.target.files?.[0])} />
      <button type="button" className="ghost small with-icon" disabled={busy} onClick={() => input.current?.click()}>
        <Upload size={15} /> {busy ? busyLabel : label}
      </button>
      {error && <p className="error ds-error">{error}</p>}
    </>
  );
}

// A font menu where every name shows in its own typeface.
function FontSelect({ brand, value, onChange, label }: { brand: Brand; value?: FontId; onChange: (f?: FontId) => void; label: string }) {
  const t = useAppT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    addEventListener("mousedown", close);
    return () => removeEventListener("mousedown", close);
  }, [open]);
  const ids: FontId[] = [...FONT_IDS, ...(brand.fontFile ? (["custom"] as const) : [])];
  return (
    <div className="ds-font" ref={ref}>
      <span className="ds-label">{label}</span>
      <button type="button" className="ds-font-btn" style={{ fontFamily: value ? fontCss(value) : undefined }} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {fontLabel(t, brand, value)} <ChevronDown size={16} />
      </button>
      {open && (
        <ul className="ds-font-menu" role="listbox" aria-label={label}>
          <li><button type="button" className={!value ? "on" : ""} onClick={() => (onChange(undefined), setOpen(false))}>{t("Default (Figtree)")}</button></li>
          {ids.map((id) => (
            <li key={id}>
              <button type="button" className={value === id ? "on" : ""} style={{ fontFamily: fontCss(id) }} onClick={() => (onChange(id), setOpen(false))}>
                {fontLabel(t, brand, id)} {value === id && <Check size={15} />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ---------------- True-to-life previews ---------------- */

const SAMPLE_OPTIONS = ["Keep our customers", "Launch the new offer", "Ship faster"];

function fakeState(t: T, title: string): RoomState {
  return {
    round: 0, style: "", title: title || t("Your presentation"), lang: "en", index: 0, count: 3, kind: "choice", question: t("What's our priority next quarter?"),
    options: SAMPLE_OPTIONS.map((o) => t(o)), image: null, max: 5, labels: null, fields: [], multi: false, quiz: false, hasQuiz: false,
  hasBoard: false, timer: 0,
    startedAt: null, now: 0, receivedAt: 0, correct: null, revealed: false, counts: [46, 31, 18], words: [], answers: [], answered: 95,
    text: "", url: "", ordered: false, numbers: [], answer: null, closest: null, orderResults: null,
    board: null, lobby: true, locked: false, names: true, online: 24,
    people: ["Emma", "Hugo", "Priya", "Malik", "Zoe", "Liam", "Sara"].map((name, i) => ({ name, avatar: `b${(i * 5) % 24}` })),
  };
}

// A real browser window of a given size: the app's styles, vw and vh behave like on the actual device.
function Frame({ width, height, children, className = "" }: { width: number; height: number; children: React.ReactNode; className?: string }) {
  const t = useAppT();
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [body, setBody] = useState<HTMLElement | null>(null);
  const [scale, setScale] = useState(0.5);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScale(Math.min(1, el.clientWidth / width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [width]);
  useEffect(() => {
    const doc = frame.current?.contentDocument;
    if (!doc) return;
    doc.open();
    doc.write("<!doctype html><html><head></head><body style=\"margin:0;overflow:hidden\"></body></html>");
    doc.close();
    // Same stylesheets and fonts as the page, kept in sync while the studio is open.
    const copy = () => {
      doc.head.innerHTML = "";
      document.head.querySelectorAll('style, link[rel="stylesheet"]').forEach((n) => doc.head.appendChild(n.cloneNode(true)));
    };
    copy();
    const mo = new MutationObserver(copy);
    mo.observe(document.head, { childList: true, subtree: true, characterData: true });
    setBody(doc.body);
    return () => mo.disconnect();
  }, []);
  return (
    <div className={`ds-frame ${className}`} ref={box} style={{ height: height * scale }}>
      <iframe ref={frame} title={t("Preview")} tabIndex={-1} style={{ width, height, transform: `scale(${scale})` }} />
      {body && createPortal(children, body)}
    </div>
  );
}

// The language of the sample texts: the app's, unless a caller gives one.
function usePreviewLang(lang?: AppLang) {
  const app = useAppLang();
  return lang ?? app;
}

// The real big screen (src/pages/Present.tsx), as a 1280×720 projector shows it, with this brand.
// The code is HELLO, like src/pages/PreviewPage.tsx: a scan of a preview never opens someone's presentation.
export function Screen({ brand, view, title, code = "HELLO", lang: pageLang }: { brand: Brand; view: Exclude<View, "phone">; title: string; code?: string; lang?: AppLang }) {
  // The preview stays in the app's language, whatever the presentations are written in.
  const lang = usePreviewLang(pageLang);
  const t: T = (text, vars) => translate(lang, text, vars);
  const state: RoomState = { ...fakeState(t, title), lang, lobby: view === "waiting" };
  return (
    <Frame width={1280} height={720} className="ds-screen">
      {/* The waiting screen with its Start button; a question without the presenter's tools, as the room sees it. */}
      {/* Keyed by view: Present reads its host key once, so each view mounts its own screen. */}
      <Present key={view} code={code} embed embedKey={view === "waiting" ? "demo" : undefined} demo={state} brand={brand} framed />
    </Frame>
  );
}

// A phone at its real size, with the brand on the whole page like on a participant's device.
export function Phone({ brand, lang: pageLang }: { brand: Brand; lang?: AppLang }) {
  const lang = usePreviewLang(pageLang);
  const t: T = (text, vars) => translate(lang, text, vars);
  const look = brandLook(brand);
  return (
    <div className="ds-phone-wrap">
      <div className="ds-phone">
        <Frame width={360} height={720}>
          <div className={`ds-phone-page ${look.className}`} style={{ ...look.style, minHeight: "100vh", background: look.style.background ?? "var(--bg)" }}>
            <div className="page narrow">
              <header className="top">
                {brand.logo ? <BrandLogo brand={brand} /> : <span className="logo"><Wordmark /></span>}
                <span className="step-pill">1 / 3</span>
              </header>
              <h1 className="question">{t("What's our priority next quarter?")}</h1>
              <div className="choices">
                {SAMPLE_OPTIONS.map((o, i) => (
                  <button key={o} type="button" className={`choice ${i === 0 ? "picked" : ""}`}>{t(o)}</button>
                ))}
              </div>
            </div>
          </div>
        </Frame>
      </div>
    </div>
  );
}

/* ---------------- The studio ---------------- */

function Studio({ brand, onChange, onClose, title }: { brand: Brand; onChange: (b: Brand) => void; onClose: () => void; title: string }) {
  const t = useAppT();
  const [view, setView] = useState<View>("waiting");
  const [colors, setColors] = useState<string[]>([]);
  const [kits, setKits] = useState<Kit[]>([]);
  const [naming, setNaming] = useState(false);
  const [kitName, setKitName] = useState("");
  const [kitError, setKitError] = useState("");
  const set = (patch: Partial<Brand>) => {
    const next: Brand = { ...brand, ...patch };
    for (const k of Object.keys(next) as (keyof Brand)[]) if (next[k] === undefined || next[k] === "") delete next[k];
    onChange(next);
  };
  useBrandFonts(brand);

  useEffect(() => {
    api<{ kits: Kit[] }>("/api/brand-kits").then((d) => setKits(d.kits), () => {});
    // Every font in the menus shows in its own typeface.
    for (const id of FONT_IDS) {
      const href = fontHref(id);
      if (!document.querySelector(`link[href="${href}"]`)) document.head.appendChild(Object.assign(document.createElement("link"), { rel: "stylesheet", href }));
    }
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", esc);
    document.body.style.overflow = "hidden";
    return () => {
      removeEventListener("keydown", esc);
      document.body.style.overflow = "";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The logo's own colors come first in every color row.
  useEffect(() => {
    if (!brand.logo) return setColors([]);
    let gone = false;
    logoColors(brand.logo).then((c) => !gone && setColors(c), () => {});
    return () => {
      gone = true;
    };
  }, [brand.logo]);

  const bg = brand.bg;
  const mode = bg?.kind ?? "none";
  const accent = brand.color ?? colors[0] ?? "#ff5436";
  const setBg = (next?: Bg) => set({ bg: next });

  async function saveKit() {
    if (!kitName.trim()) return;
    setKitError("");
    try {
      const { kit } = await api<{ kit: Kit }>("/api/brand-kits", { body: { name: kitName, brand } });
      setKits((k) => [kit, ...k]);
      setNaming(false);
      setKitName("");
    } catch (err) {
      setKitError(err instanceof Error ? err.message : t("Couldn't save"));
    }
  }

  return (
    <div className="ds" role="dialog" aria-modal aria-label={t("Design")}>
      <header className="ds-top">
        <div className="ds-title">
          <Paintbrush size={18} />
          <strong>{t("Design")}</strong>
          <span className="truncate">{title || t("New presentation")}</span>
        </div>
        <div className="ds-kits">
          {kits.map((k) => (
            <span key={k.id} className="kit-chip">
              <button type="button" onClick={() => onChange(k.brand)} title={t("Apply {name}", { name: k.name })}>
                <i style={{ background: k.brand.bg ? bgCss(k.brand.bg) : "#141a3c" }}><b style={{ background: k.brand.color ?? "#ff5436" }} /></i>
                {k.name}
              </button>
              <button type="button" className="kit-x" aria-label={t("Delete {name}", { name: k.name })} onClick={() => api(`/api/brand-kits/${k.id}`, { method: "DELETE" }).then(() => setKits((all) => all.filter((x) => x.id !== k.id)), () => {})}>
                <Trash2 size={13} />
              </button>
            </span>
          ))}
          {naming ? (
            <span className="kit-form">
              <input
                autoFocus
                maxLength={40}
                placeholder={t("Kit name")}
                value={kitName}
                onChange={(e) => setKitName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.preventDefault(), saveKit());
                  if (e.key === "Escape") (e.stopPropagation(), setNaming(false));
                }}
              />
              <button type="button" className="primary small" disabled={!kitName.trim()} onClick={saveKit}>{t("Save")}</button>
              <button type="button" className="ghost small" onClick={() => setNaming(false)}>{t("Cancel")}</button>
            </span>
          ) : (
            <button type="button" className="ghost small with-icon" disabled={!Object.keys(brand).length} onClick={() => setNaming(true)}>
              <BookmarkPlus size={15} /> {t("Save as a kit")}
            </button>
          )}
          {kitError && <span className="error">{kitError}</span>}
        </div>
        <div className="ds-actions">
          <button type="button" className="ghost small with-icon" onClick={() => onChange({})} disabled={!Object.keys(brand).length}>
            <RotateCcw size={15} /> {t("Reset")}
          </button>
          <button type="button" className="primary small" onClick={onClose}>{t("Done")}</button>
        </div>
      </header>

      <div className="ds-body">
        <aside className="ds-panel">
          <section className="ds-sec">
            <h3>{t("Logo")}</h3>
            <div className="ds-logo">
              <span className="ds-logo-box">{brand.logo ? <img src={brand.logo} alt="" /> : <ImagePlus size={22} />}</span>
              <div className="ds-row">
                <FilePick accept="image/png,image/webp,image/jpeg" label={brand.logo ? t("Replace") : t("Upload logo")} busyLabel={t("Uploading…")} onFile={async (f) => {
                    // A new logo also gives the accent its main color, unless one was picked.
                    const logo = await uploadLogo(f);
                    const [main] = await logoColors(logo).catch(() => [] as string[]);
                    set({ logo, ...(!brand.color && main ? { color: main } : {}) });
                  }} />
                {brand.logo && <button type="button" className="ghost small" onClick={() => set({ logo: undefined })}>{t("Remove")}</button>}
              </div>
            </div>
            <p className="ds-hint">{t("PNG with a transparent background. It shows exactly as uploaded.")}</p>
            {brand.logo && (
              <div className="ds-line">
                <span className="ds-label">{t("Size")}</span>
                <Segmented<Size> label={t("Logo size")} value={brand.logoSize ?? "m"} onChange={(logoSize) => set({ logoSize })} options={[["s", t("Small")], ["m", t("Medium")], ["l", t("Large")]]} />
              </div>
            )}
          </section>

          <section className="ds-sec">
            <h3>{t("Background")}</h3>
            <Segmented
              label={t("Background")}
              value={mode}
              onChange={(m) =>
                m === "none"
                  ? setBg()
                  : m === "color"
                    ? setBg({ kind: "color", value: bg?.kind === "color" ? bg.value : mix(accent, "#0a0d22", 0.86) })
                    : m === "gradient"
                      ? setBg({ kind: "gradient", value: mix(accent, "#000000", 0.15), value2: mix(colors[1] ?? accent, "#0a0d22", 0.7) })
                      : setBg(bg?.kind === "image" ? bg : { kind: "image", value: "", dim: DEFAULT_DIM })
              }
              options={[["none", t("Default")], ["color", t("Color")], ["gradient", t("Gradient")], ["image", t("Image")]]}
            />
            {bg?.kind === "color" && <ColorRow label={t("Color")} auto={null} value={bg.value} suggestions={colors} onChange={(value) => value && setBg({ kind: "color", value })} />}
            {bg?.kind === "gradient" && (
              <>
                <ColorRow label={t("From")} auto={null} value={bg.value} suggestions={colors} onChange={(value) => value && setBg({ ...bg, value })} />
                <ColorRow label={t("To")} auto={null} value={bg.value2} suggestions={colors} onChange={(value2) => value2 && setBg({ ...bg, value2 })} />
              </>
            )}
            {bg?.kind === "image" && (
              <>
                <div className="ds-row">
                  {bg.value && <span className="ds-thumb"><img src={bg.value} alt="" /></span>}
                  <FilePick accept="image/png,image/webp,image/jpeg" label={bg.value ? t("Replace image") : t("Upload image")} busyLabel={t("Uploading…")} onFile={async (f) => setBg({ kind: "image", value: await uploadImage(f), dim: bg.dim ?? DEFAULT_DIM })} />
                </div>
                {bg.value && (
                  <label className="ds-line">
                    <span className="ds-label">{t("Darken")}</span>
                    <input className="ds-range" type="range" min={0} max={0.85} step={0.05} value={bg.dim ?? DEFAULT_DIM} onChange={(e) => setBg({ ...bg, dim: Number(e.target.value) })} />
                  </label>
                )}
              </>
            )}
          </section>

          <section className="ds-sec">
            <h3>{t("Colors")}</h3>
            <ColorRow label={t("Accent")} value={brand.color} suggestions={colors} onChange={(color) => set({ color })} />
            <ColorRow label={t("Text")} value={brand.text} suggestions={["#ffffff", "#151a3d", ...colors]} onChange={(text) => set({ text })} />
            <ColorRow label={t("Bars")} value={brand.bar} suggestions={colors} onChange={(bar) => set({ bar })} />
            <ColorRow label={t("Join card")} value={brand.card} auto="White" suggestions={["#ffffff", ...colors]} onChange={(card) => set({ card })} />
          </section>

          <section className="ds-sec">
            <h3>{t("Typography")}</h3>
            <FontSelect brand={brand} label={t("Headings")} value={brand.headFont} onChange={(headFont) => set({ headFont })} />
            <FontSelect brand={brand} label={t("Text")} value={brand.font} onChange={(font) => set({ font })} />
            <div className="ds-row">
              <Type size={16} className="ds-ico" />
              <span className="ds-hint grow">{brand.fontFile ? t("{name} uploaded", { name: brand.fontName ?? "" }) : t("Have a brand font?")}</span>
              <FilePick
                accept=".woff2,.woff,.ttf,.otf"
                label={brand.fontFile ? t("Replace") : t("Upload font")}
                busyLabel={t("Uploading…")}
                onFile={async (f) => set({ fontFile: await uploadFont(f), fontName: f.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").slice(0, 40), font: "custom", headFont: "custom" })}
              />
              {brand.fontFile && (
                <button type="button" className="icon ds-x" aria-label={t("Remove the font")} onClick={() => set({ fontFile: undefined, fontName: undefined, font: brand.font === "custom" ? undefined : brand.font, headFont: brand.headFont === "custom" ? undefined : brand.headFont })}>
                  <X size={16} />
                </button>
              )}
            </div>
          </section>

          <section className="ds-sec">
            <h3>{t("Style")}</h3>
            <div className="ds-line">
              <span className="ds-label">{t("Corners")}</span>
              <Segmented<Radius> label={t("Corners")} value={brand.radius ?? "soft"} onChange={(radius) => set({ radius })} options={[["sharp", t("Sharp")], ["soft", t("Soft")], ["round", t("Round")]]} />
            </div>
          </section>

          <section className="ds-sec">
            <h3>{t("Waiting screen")}</h3>
            <label className="ds-field">
              <span className="ds-label">{t("Welcome message")}</span>
              <input maxLength={WELCOME_MAX} placeholder={t("Welcome to the June offsite!")} value={brand.welcome ?? ""} onChange={(e) => onChange({ ...brand, welcome: e.target.value })} />
            </label>
          </section>
        </aside>

        <main className="ds-canvas">
          <Segmented<View> label={t("Preview")} value={view} onChange={setView} options={[["waiting", t("Waiting screen")], ["question", t("Question")], ["phone", t("Phone")]]} />
          <div className="ds-preview">{view === "phone" ? <Phone brand={brand} /> : <Screen brand={brand} view={view} title={title} />}</div>
          <p className="ds-note">{t("Live preview. The big screen and every phone look like this.")}</p>
        </main>
      </div>
    </div>
  );
}

/* ---------------- In the builder ---------------- */

// The design summary in the builder, with a live thumbnail; opens the studio.
// children: a row under the design, the seasonal decor in the builder.
export function DesignCard({ brand, onChange, title, children }: { brand: Brand; onChange: (b: Brand) => void; title: string; children?: ReactNode }) {
  const t = useAppT();
  const [open, setOpen] = useState(false);
  useBrandFonts(brand);

  const designed = Object.keys(brand).length > 0;
  return (
    <section className="card design-card">
      <button type="button" className="design-thumb" onClick={() => setOpen(true)} aria-label={t("Customize design")}>
        <Screen brand={brand} view="waiting" title={title} />
      </button>
      <div className="design-info">
        <strong><Paintbrush size={17} /> {t("Design")}</strong>
        <span className="muted">{designed ? t("Your brand on the big screen and phones.") : t("Hopvote's default look. Add your logo, colors and fonts.")}</span>
        <div className="design-actions">
          <button type="button" className="primary small" onClick={() => setOpen(true)}>{designed ? t("Edit design") : t("Customize design")}</button>
          {designed && <button type="button" className="ghost small" onClick={() => onChange({})}>{t("Use default")}</button>}
        </div>
      </div>
      {/* Outside the presentation form, so Enter in a field never launches the presentation. */}
      {children}
      {open && createPortal(<Studio brand={brand} onChange={onChange} onClose={() => setOpen(false)} title={title} />, document.body)}
    </section>
  );
}
