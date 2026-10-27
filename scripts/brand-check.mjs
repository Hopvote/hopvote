// Checks the big screen with a brand on every kind of question: example brands (src/brand-presets.ts) over the example
// screens (/preview/screen/<kind>?brand=...&host=1) and the waiting screen with a long title, a long welcome, a wide
// logo and a full room. For each screen it reports:
//  - text that does not read on what is really drawn behind it (contrast under 3, measured on a picture of the page
//    with the text hidden), and bars or tracks that vanish into the background;
//  - anything past the window's side, the content zone or the waiting screen running into the footer, words of the
//    word cloud overlapping or leaving their box;
//  - the title, the content zone and the footer not at the same place as on the unbranded screen (no shift).
// Run on the dev server: node scripts/brand-check.mjs [http://localhost:5180] [--lang=fr] [--quick] [--shots=<dir>]
//   [--presets=light;dark,serif] [--kinds=choice,words] [--sizes=1280x720,1920x1080] [--tabs=4]
// Exit 1 when a check fails.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PNG } from "pngjs";
import { PREVIEW_KINDS } from "./previews.mjs";

const args = process.argv.slice(2);
const opt = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const base = args.find((a) => /^https?:/.test(a)) ?? "http://localhost:5180";
const lang = opt("lang") ?? "en";
const quick = args.includes("--quick");
const shots = opt("shots");
if (shots) mkdirSync(shots, { recursive: true });

// Each option alone, and the combinations a presenter is likely to pick.
const PRESETS = opt("presets")?.split(";") ?? (quick
  ? ["light", "dark", "northwind,wideLogo"]
  : ["light", "dark", "gradient", "pastel", "image", "imageLight", "navyText", "whiteText", "light,wideLogo,serif", "dark,wideFont,round", "northwind", "light,sharp,bars,darkCard", "image,smallLogo"]);
// Known limits, listed but not failing: the accent color over a dark photo with a weak darkening (the cream veil keeps
// the text readable, the accent and the bars stay under 3:1).
const KNOWN = new Set(["imageLight"]);
const KINDS = opt("kinds")?.split(",") ?? PREVIEW_KINDS;
const SIZES = (opt("sizes")?.split(",") ?? (quick ? ["1280x720"] : ["1280x720", "1920x1080", "854x480"])).map((s) => s.split("x").map(Number));
// The waiting screen at its worst: the longest title, the longest welcome, a wide large logo, a full room.
const LOBBIES = ["state=lobby", "state=lobby&title=long&people=300", "state=lobby&title=long&people=300&names=1", "state=lobby&title=long&people=40&names=1&host=1"];
const LOBBY_BRANDS = ["", "light,wideLogo,welcome", "northwind,wideLogo,welcome,wideFont", "dark,smallLogo,welcome"];

const { default: puppeteer } = await import("puppeteer-core");
const chrome = [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find((p) => p && existsSync(p));
const browser = await puppeteer.launch({ executablePath: chrome, headless: true });
const failures = [];
const notes = [];
const fail = (where, text) => failures.push(`${where}  ${text}`);

// Read in the page: what to measure, before the text is hidden for the picture.
function collect() {
  const parse = (c) => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) {
      // color(srgb r g b / a) from color-mix()
      const n = c.match(/color\(srgb ([\d.e-]+) ([\d.e-]+) ([\d.e-]+)(?: \/ ([\d.e-]+))?\)/);
      return n ? [n[1] * 255, n[2] * 255, n[3] * 255, n[4] === undefined ? 1 : Number(n[4])] : [0, 0, 0, 0];
    }
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return [p[0], p[1], p[2], p[3] ?? 1];
  };
  const opacity = (el) => {
    let o = 1;
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) o *= Number(getComputedStyle(e).opacity);
    return o;
  };
  const rect = (r) => ({ x: r.left, y: r.top, w: r.width, h: r.height });
  const seen = (r) => r.width > 2 && r.height > 2 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
  const texts = [];
  const root = document.querySelector(".present");
  for (const el of root.querySelectorAll("*")) {
    if (el.closest("svg, .launch, .who-panel, [aria-hidden=true]")) continue;
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!own) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none") continue;
    const r = el.getBoundingClientRect();
    if (!seen(r)) continue;
    const o = opacity(el);
    // Dimmed on purpose (answers that were not right, a disabled button): not a reading problem.
    if (o < 0.6 || el.closest(":disabled")) continue;
    // The faded last row of a list that shows what fits (the waiting screen's crowd).
    const faded = el.closest(".clipped");
    if (faded && r.bottom > faded.getBoundingClientRect().bottom - 40) continue;
    const size = parseFloat(cs.fontSize);
    texts.push({ text: el.textContent.trim().slice(0, 40), cls: el.className?.toString?.() || el.tagName, color: parse(cs.color), o, size, large: size >= 24 || (size >= 18.6 && Number(cs.fontWeight) >= 700), rect: rect(r) });
  }
  // Bars and tracks: their color against the ground right next to them.
  const tracks = [];
  for (const el of root.querySelectorAll(".bar, .sc-track, .sc-rail, .ssr-track, .countdown-track, .bar > div, .sc-track i, .ssr-track i, .nr-chart i")) {
    const r = el.getBoundingClientRect();
    if (!seen(r)) continue;
    const fill = el.matches(".bar > div, .sc-track i, .ssr-track i, .nr-chart i");
    if (fill && r.width < 6 && r.height < 6) continue;
    // Dimmed on purpose (the wrong answers once the right one shows).
    if (opacity(el) < 0.6) continue;
    tracks.push({ cls: el.className || el.tagName, fill, rect: rect(r) });
  }
  // Layout
  const box = (sel) => {
    const el = document.querySelector(sel);
    return el ? el.getBoundingClientRect() : null;
  };
  const problems = [];
  const doc = document.documentElement;
  if (doc.scrollWidth > innerWidth + 1) problems.push(`page is ${doc.scrollWidth}px wide in a ${innerWidth}px window`);
  if (doc.scrollHeight > innerHeight + 1 && innerWidth > 760) problems.push(`page scrolls: ${doc.scrollHeight}px in a ${innerHeight}px window`);
  const foot = box(".present-foot");
  const body = document.querySelector(".stage-body");
  const fit = document.querySelector(".stage-fit");
  if (body && foot && body.getBoundingClientRect().bottom > foot.top + 1) problems.push("content zone runs into the footer");
  if (fit && body && !body.classList.contains("clipped") && !body.classList.contains("scrolls")) {
    const f = fit.getBoundingClientRect();
    const b = body.getBoundingClientRect();
    if (f.bottom > b.bottom + 1) problems.push(`content is ${Math.round(f.bottom - b.bottom)}px taller than its zone`);
    if (f.right > b.right + 1) problems.push(`content is ${Math.round(f.right - b.right)}px wider than its zone`);
  }
  const card = box(".join-card, .lobby-card");
  if (card && foot && card.bottom > foot.top + 1) problems.push(`join card ends ${Math.round(card.bottom - foot.top)}px into the footer`);
  const lobby = document.querySelector(".lobby");
  if (lobby && foot) {
    for (const el of lobby.querySelectorAll(".lobby-stage > *, .lobby-card, .lobby-card > *")) {
      const r = el.getBoundingClientRect();
      if (r.height && r.bottom > foot.top + 1) problems.push(`${el.className || el.tagName} ends ${Math.round(r.bottom - foot.top)}px into the footer`);
      if (r.width && r.right > innerWidth + 1) problems.push(`${el.className || el.tagName} runs past the window`);
    }
    const h1 = lobby.querySelector("h1");
    // Letters may pass the line box a little (tight line height): only a hidden line counts.
    if (h1 && h1.scrollHeight > h1.clientHeight + parseFloat(getComputedStyle(h1).fontSize) * 0.5) problems.push("waiting screen title is cut");
  }
  // The top bar: the logo stays in it and never covers the buttons.
  const top = box(".present-top");
  const logo = box(".present-top .brand-logo");
  const actions = box(".present-actions");
  if (logo && top && (logo.bottom > top.bottom + 1 || logo.top < top.top - 1)) problems.push(`logo is ${Math.round(logo.height)}px tall in a ${Math.round(top.height)}px top bar`);
  if (logo && actions && actions.width && logo.right > actions.left - 8) problems.push("logo runs into the top bar's buttons");
  // Word cloud: inside its box, no two words over each other.
  const cloud = document.querySelector(".cloud");
  if (cloud) {
    const c = cloud.getBoundingClientRect();
    const words = [...cloud.querySelectorAll("span")].map((s) => s.getBoundingClientRect()).filter((r) => r.width);
    const out = words.filter((r) => r.left < c.left - 1 || r.right > c.right + 1 || r.top < c.top - 1 || r.bottom > c.bottom + 1).length;
    if (out) problems.push(`${out} cloud word(s) outside the cloud`);
    let overlaps = 0;
    // Each word's ink box is a little smaller than its line box (line-height .92 already trims it).
    const ink = (r) => ({ l: r.left + r.width * 0.02, r: r.right - r.width * 0.02, t: r.top + r.height * 0.1, b: r.bottom - r.height * 0.1 });
    for (let i = 0; i < words.length; i++)
      for (let j = i + 1; j < words.length; j++) {
        const a = ink(words[i]);
        const b = ink(words[j]);
        if (a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b) overlaps++;
      }
    if (overlaps) problems.push(`${overlaps} pair(s) of cloud words overlap`);
  }
  const at = (sel) => {
    const r = box(sel);
    return r ? Math.round(r.top * 10) / 10 : null;
  };
  return { texts, tracks, problems, pos: { title: at(".stage-title"), content: at(".stage-body"), foot: at(".present-foot") } };
}

const lum = ([r, g, b]) => {
  const c = [r, g, b].map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const over = (fg, bg, alpha) => fg.map((v, i) => (i < 3 ? v * alpha + bg[i] * (1 - alpha) : 1));

// The colors drawn in a box of the picture: its most common one stands for the ground behind the text.
function ground(png, { x, y, w, h }) {
  const counts = new Map();
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(png.width, Math.ceil(x + w));
  const y1 = Math.min(png.height, Math.ceil(y + h));
  const step = Math.max(1, Math.floor(Math.sqrt(((x1 - x0) * (y1 - y0)) / 400)));
  for (let yy = y0; yy < y1; yy += step)
    for (let xx = x0; xx < x1; xx += step) {
      const i = (yy * png.width + xx) * 4;
      // Quantized, so a gradient or a photo still has a dominant color.
      const key = ((png.data[i] >> 3) << 10) | ((png.data[i + 1] >> 3) << 5) | (png.data[i + 2] >> 3);
      const e = counts.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
      e.n++;
      e.r += png.data[i];
      e.g += png.data[i + 1];
      e.b += png.data[i + 2];
      counts.set(key, e);
    }
  let best = null;
  for (const e of counts.values()) if (!best || e.n > best.n) best = e;
  return best ? [best.r / best.n, best.g / best.n, best.b / best.n] : [0, 0, 0];
}
// Just outside a box: the ground a bar or a track sits on.
const around = (png, { x, y, w, h }) => ground(png, { x: x - 6, y: y + h + 2, w: w + 12, h: 6 });

const HIDE_TEXT = "* { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; caret-color: transparent !important; } .present svg { visibility: hidden !important; } .present img, .present .qr, .present .lobby-qr, .present .link-qr { visibility: visible; }";

async function check(tab, page, where, refs) {
  // The dev server restarts when a worker file changes: a page that did not draw is loaded again.
  for (let attempt = 0; ; attempt++) {
    try {
      await tab.goto(`${base}/preview/screen/${page}${page.includes("?") ? "&" : "?"}lang=${lang}`.replace("?&", "?"), { waitUntil: "networkidle0" });
      await tab.waitForSelector(".present", { timeout: 8000 });
      break;
    } catch (e) {
      if (attempt >= 3) throw e;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  await tab.evaluate(() => document.fonts.ready);
  await new Promise((r) => setTimeout(r, 300));
  const m = await tab.evaluate(collect);
  for (const p of m.problems) fail(where, p);
  if (shots) await tab.screenshot({ path: join(shots, `${where.replace(/[^a-z0-9]+/gi, "_")}.png`) });
  // A picture of the same screen with its text and icons hidden: what really lies behind each text.
  const style = await tab.addStyleTag({ content: HIDE_TEXT });
  const png = PNG.sync.read(Buffer.from(await tab.screenshot({ type: "png" })));
  await style.evaluate((s) => s.remove());
  const low = [];
  const lowKeys = new Set();
  for (const t of m.texts) {
    const bg = ground(png, t.rect);
    const fg = over(t.color, bg, t.color[3] * t.o);
    const c = contrast(fg, bg);
    const key = `${t.cls.split(" ")[0] || "text"} "${t.text}"`;
    // Already so without a brand: Hopvote's own look, reported once as a note, not a brand problem.
    if (c < 3 && (!refs || refs.lowKeys.has(key))) notes.push(`${where}  ${refs ? "same without a brand" : "Hopvote's own look"}: ${key} ${c.toFixed(2)}`);
    else if (c < 3) low.push(`${key} ${c.toFixed(2)}`);
    if (c < 3) lowKeys.add(key);
    else if (c < 4.5 && !t.large) notes.push(`${where}  small text ${t.cls.split(" ")[0]} "${t.text}" ${c.toFixed(2)}`);
  }
  const known = [...KNOWN].some((k) => where.split(/[=,\s]/).includes(k));
  const report = (text) => (known ? notes.push(`${where}  known limit: ${text}`) : fail(where, text));
  if (low.length) report(`text under 3:1: ${[...new Set(low)].slice(0, 6).join("; ")}${low.length > 6 ? ` (+${low.length - 6})` : ""}`);
  const faint = [];
  for (const tr of m.tracks) {
    const inside = ground(png, { x: tr.rect.x + 1, y: tr.rect.y + 1, w: Math.max(1, tr.rect.w - 2), h: Math.max(1, tr.rect.h - 2) });
    const c = contrast(inside, around(png, tr.rect));
    // A track only needs to show where it runs; a filled bar must stand out.
    if (c < (tr.fill ? 1.5 : 1.08)) faint.push(`${String(tr.cls).split(" ")[0] || "bar"} ${c.toFixed(2)}`);
  }
  if (faint.length) report(`bars or tracks that vanish: ${[...new Set(faint)].slice(0, 4).join("; ")}`);
  // No shift: the branded screen keeps the unbranded one's rows.
  if (refs?.pos) for (const key of ["title", "content", "foot"]) if (refs.pos[key] !== null && m.pos[key] !== null && Math.abs(refs.pos[key] - m.pos[key]) > 1) fail(where, `${key} at ${m.pos[key]}px, ${refs.pos[key]}px without a brand`);
  return { pos: m.pos, lowKeys };
}

// Several tabs at once: each takes a kind (its unbranded screen first, then every brand) or a waiting screen.
const TABS = Number(opt("tabs") ?? 4);
try {
  let screens = 0;
  for (const [width, height] of SIZES) {
    const jobs = KINDS.map((kind) => async (tab) => {
      const refs = await check(tab, `${kind}?host=1`, `${width}x${height} ${kind} (no brand)`, null);
      screens++;
      for (const preset of PRESETS) {
        await check(tab, `${kind}?host=1&brand=${preset}`, `${width}x${height} ${kind} brand=${preset}`, refs);
        screens++;
      }
    });
    if (!opt("kinds"))
      for (const lobby of LOBBIES)
        jobs.push(async (tab) => {
          let refs = null;
          for (const b of quick ? LOBBY_BRANDS.slice(0, 2) : LOBBY_BRANDS) {
            const r = await check(tab, `choice?${lobby}${b ? `&brand=${b}` : ""}`, `${width}x${height} lobby ${lobby}${b ? ` brand=${b}` : ""}`, refs);
            refs ??= { lowKeys: r.lowKeys };
            screens++;
          }
        });
    await Promise.all(
      Array.from({ length: Math.min(TABS, jobs.length) }, async () => {
        const tab = await browser.newPage();
        tab.on("pageerror", (e) => fail("page", e.message));
        await tab.setViewport({ width, height, deviceScaleFactor: 1 });
        while (jobs.length) await jobs.shift()(tab);
        await tab.close();
      }),
    );
    console.log(`${width}x${height}: ${screens} screens so far, ${failures.length} problem(s)`);
  }
} finally {
  await browser.close();
}
if (shots) writeFileSync(join(shots, "report.txt"), [...failures, "", ...notes].join("\n"));
const knownCount = notes.filter((n) => n.includes("known limit:")).length;
if (knownCount) console.log(`${knownCount} known limit(s): ${[...KNOWN].join(", ")} (accent and bars under 3:1 over a dark photo, text readable)`);
if (notes.length > knownCount) console.log(`${notes.length - knownCount} note(s): small text between 3:1 and 4.5:1, or Hopvote's own look${shots ? " (listed in report.txt)" : ""}`);
if (failures.length) {
  console.error(`\n${failures.length} problem(s):\n${failures.join("\n")}`);
  process.exit(1);
}
console.log("brand-check: OK");
