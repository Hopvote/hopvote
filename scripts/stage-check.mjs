// Checks the big screen's layout on every kind of question: the title, the content zone and the footer start at the
// same place whatever the kind, nothing runs off the side, nothing runs into the footer.
// Uses the example screens (/preview/screen/<kind>, src/demo-states.ts) and their variants (src/pages/PreviewPage.tsx).
// Run on the dev server: node scripts/stage-check.mjs [http://localhost:5180] [--lang=fr] [--quick]
// Exit 1 when a check fails; prints each measure that differs.
import { existsSync } from "node:fs";
import { PREVIEW_KINDS } from "./previews.mjs";

const args = process.argv.slice(2);
const base = args.find((a) => /^https?:/.test(a)) ?? "http://localhost:5180";
const lang = args.find((a) => a.startsWith("--lang="))?.slice(7) ?? "en";
const quick = args.includes("--quick");
// A laptop, a TV, and the small landscape windows: a slide or a meeting panel (embed=1), an old 854x480 projector.
const SIZES = [
  [1280, 720],
  [1920, 1080],
  [854, 480],
  [720, 405],
];
// Each kind as its example screen shows it, with a long question, before any answer, and with a picture on a
// one-question presentation, the join card hidden and the presenter's buttons shown.
const VARIANTS = quick ? [""] : ["", "long=1", "empty=1", "image=1&single=1&qr=0&host=1"];
// Screens that are not a question: the waiting screen and the count-in of a timed quiz.
const EXTRA = ["choice?state=lobby", "quiz?countin=1", "quiz?countin=1&long=1&host=1"];
// The Halloween decor (src/decor.ts) on every kind and on the screens that are not a question: the same pixels, and no
// drawing over text, buttons, cards or pictures. Drawn only until the decor's end date, like a real presentation.
const DECOR = quick
  ? ["decor=halloween"]
  : ["decor=halloween", "long=1&host=1&decor=halloween", "image=1&single=1&qr=0&host=1&decor=halloween"];
const DECOR_EXTRA = quick
  ? []
  : ["choice?state=lobby&decor=halloween", "choice?state=lobby&people=40&names=1&decor=halloween", "quiz?countin=1&decor=halloween", "quiz?countin=1&long=1&host=1&decor=halloween", "quiz?board=podium&decor=halloween&host=1", "quiz?board=standings&decor=halloween&host=1", "quiz?board=list&decor=halloween&host=1"];
// Topic rounds' picker (src/demo-states.ts demoTopics): the wheel stopped, the presenter's choice on
// the wheel, the room's vote under way and closed (bars and the topic chosen side by side), 8 topics with the longest
// name chosen, the last round; with the presenter's buttons, whose labels must fit one footer line.
const TOPICS = ["topics?", "topics?host=1", "topics?topics=host&host=1", "topics?topics=open&host=1", "topics?topics=vote", "topics?topics=vote&host=1", "topics?topics=long&host=1", "topics?topics=last&host=1"];
// The final podium is checked only from 760px wide.
const skip = (page, width) => width < 760 && page.includes("board=podium");

const { default: puppeteer } = await import("puppeteer-core");
const chrome = [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find((p) => p && existsSync(p));
const browser = await puppeteer.launch({ executablePath: chrome, headless: true });
const failures = [];
const fail = (where, text) => failures.push(`${where}  ${text}`);

// Positions in CSS pixels, read once the page settled (fonts loaded, the screen's own fit done).
function measure() {
  const top = (sel) => {
    const el = document.querySelector(sel);
    return el ? Math.round(el.getBoundingClientRect().top * 10) / 10 : null;
  };
  const foot = document.querySelector(".present-foot")?.getBoundingClientRect();
  const body = document.querySelector(".stage-body");
  const fit = document.querySelector(".stage-fit");
  const title = document.querySelector(".stage-title");
  const question = document.querySelector(".stage-title .question");
  const problems = [];
  const doc = document.documentElement;
  if (doc.scrollWidth > innerWidth + 1) problems.push(`page is ${doc.scrollWidth}px wide in a ${innerWidth}px window`);
  if (doc.scrollHeight > innerHeight + 1) problems.push(`page scrolls: ${doc.scrollHeight}px in a ${innerHeight}px window`);
  if (foot && foot.bottom > innerHeight + 1) problems.push(`footer ends at ${Math.round(foot.bottom)}px, under the window`);
  if (body && foot) {
    const b = body.getBoundingClientRect();
    if (b.bottom > foot.top + 1) problems.push(`content zone ends at ${Math.round(b.bottom)}px, footer starts at ${Math.round(foot.top)}px`);
    if (b.right > innerWidth + 1) problems.push(`content zone ends at ${Math.round(b.right)}px, past the window`);
    // The answers keep a real share of the window, even in a small one.
    if (b.height < innerHeight * 0.3) problems.push(`content zone is ${Math.round(b.height)}px tall, under 30% of the ${innerHeight}px window`);
  }
  // The content itself stays inside its zone (only long lists may fade out at the bottom, marked .clipped, or scroll, .scrolls).
  if (fit && body && !body.classList.contains("clipped") && !body.classList.contains("scrolls")) {
    const f = fit.getBoundingClientRect();
    const b = body.getBoundingClientRect();
    if (f.bottom > b.bottom + 1) problems.push(`content is ${Math.round(f.bottom - b.bottom)}px taller than its zone`);
    if (f.right > b.right + 1) problems.push(`content is ${Math.round(f.right - b.right)}px wider than its zone`);
  }
  if (title && question && question.scrollHeight > title.clientHeight + 1) problems.push(`title is ${question.scrollHeight}px tall in a ${title.clientHeight}px zone`);
  const card = document.querySelector(".join-card, .lobby-card")?.getBoundingClientRect();
  if (card && foot && card.bottom > foot.top + 1) problems.push(`join card ends at ${Math.round(card.bottom)}px, footer starts at ${Math.round(foot.top)}px`);
  const lobby = document.querySelector(".lobby");
  if (lobby && foot) for (const el of lobby.querySelectorAll(".lobby-stage > *, .lobby-card")) {
    const r = el.getBoundingClientRect();
    if (r.height && r.bottom > foot.top + 1) problems.push(`${el.className || el.tagName} ends at ${Math.round(r.bottom)}px, footer starts at ${Math.round(foot.top)}px`);
  }
  // The decor's drawings (src/halloween-decor.tsx) stay off everything the screen shows.
  const scene = document.querySelector(".hwd-scene");
  if (scene) {
    const main = scene.parentElement;
    const boxes = [];
    const cut = (a, b) => {
      const r = { left: Math.max(a.left, b.left), top: Math.max(a.top, b.top), right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom) };
      return r.right > r.left + 0.5 && r.bottom > r.top + 0.5 ? r : null;
    };
    const frame = main.getBoundingClientRect();
    const range = document.createRange();
    const walk = (el, clip) => {
      for (const node of el.childNodes) {
        if (node.nodeType === 3) {
          if (!node.textContent.trim()) continue;
          range.selectNodeContents(node);
          for (const r of range.getClientRects()) {
            const b = cut(r, clip);
            if (b) boxes.push([b, `"${node.textContent.trim().slice(0, 20)}"`]);
          }
          continue;
        }
        if (node.nodeType !== 1 || node === scene) continue;
        const cs = getComputedStyle(node);
        if (cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0") continue;
        const r = node.getBoundingClientRect();
        const solid = ["BUTTON", "A", "IMG", "svg", "CANVAS", "VIDEO", "IFRAME", "INPUT"].includes(node.tagName);
        const painted = solid || !/rgba\(.*, 0\)$|transparent/.test(cs.backgroundColor) || cs.backgroundImage !== "none";
        const b = painted && r.width * r.height < frame.width * frame.height * 0.4 ? cut(r, clip) : null;
        if (b) boxes.push([b, node.className?.baseVal ?? node.className ?? node.tagName]);
        if (solid) continue;
        const next = cs.overflowX !== "visible" || cs.overflowY !== "visible" ? cut(clip, r) : clip;
        if (next) walk(node, next);
      }
    };
    walk(main, frame);
    for (const piece of scene.querySelectorAll(".hwd-piece:not(.is-off), .hwd-patch:not(.is-off) > svg:not(.is-gone)")) {
      const parts = piece.classList.contains("hwd-moon") || piece.classList.contains("hwd-piece") ? [piece] : [...piece.querySelectorAll(".hw-body, .hw-stem")];
      for (const part of parts) {
        let r = part.getBoundingClientRect();
        // The moon's disc is the middle 42% of its picture.
        if (part.classList.contains("hwd-moon")) r = { left: r.left + r.width * 0.29, right: r.right - r.width * 0.29, top: r.top + r.height * 0.29, bottom: r.bottom - r.height * 0.29 };
        if (r.right > frame.right + 1 || r.left < frame.left - 1 || r.bottom > frame.bottom + 1 || r.top < frame.top - 1) problems.push(`decor ${piece.className.baseVal ?? piece.className} runs off the screen`);
        const hit = boxes.find(([b]) => cut(r, b));
        if (hit) problems.push(`decor ${piece.className.baseVal ?? piece.className} touches ${String(hit[1]).slice(0, 40)}`);
      }
    }
  }
  return { title: top(".stage-title"), content: top(".stage-body"), foot: foot ? Math.round(foot.top * 10) / 10 : null, zoom: fit ? Number(fit.style.zoom || 1) : null, problems };
}

try {
  const tab = await browser.newPage();
  tab.on("pageerror", (e) => fail("page", e.message));
  for (const [width, height] of SIZES) {
    await tab.setViewport({ width, height, deviceScaleFactor: 1 });
    const rows = [];
    const pages = [...PREVIEW_KINDS.flatMap((kind) => [...VARIANTS, ...DECOR].map((v) => `${kind}?${v}`)), ...(quick ? [] : [...EXTRA, ...DECOR_EXTRA, ...TOPICS])];
    for (const page of pages.filter((p) => !skip(p, width))) {
      const url = `${base}/preview/screen/${page}${page.includes("?") ? "&" : "?"}lang=${lang}`.replace("?&", "?");
      await tab.goto(url, { waitUntil: "networkidle0" });
      await tab.evaluate(() => document.fonts.ready);
      // The decor places its drawings once the screen's own entrance is done (src/halloween-decor.tsx).
      await new Promise((r) => setTimeout(r, page.includes("decor=") ? 1000 : 250));
      const m = await tab.evaluate(measure);
      rows.push({ page, ...m });
      for (const p of m.problems) fail(`${width}x${height} ${page}`, p);
    }
    // Every question screen starts its title, its content and its footer at the same place.
    for (const key of ["title", "content", "foot"]) {
      const seen = rows.filter((r) => r[key] !== null);
      const ref = seen.find((r) => r.page === "choice?")?.[key] ?? seen[0]?.[key];
      for (const r of seen) if (Math.abs(r[key] - ref) > 1) fail(`${width}x${height} ${r.page}`, `${key} top ${r[key]}px, expected ${ref}px`);
    }
    const small = rows.filter((r) => r.zoom !== null && r.zoom < 0.8);
    console.log(`${width}x${height}: ${rows.length} screens, title ${rows[0].title}px, content ${rows[0].content}px, footer ${rows[0].foot}px${small.length ? `, shrunk below 80%: ${small.map((r) => `${r.page} ${r.zoom.toFixed(2)}`).join(", ")}` : ""}`);
  }
} finally {
  await browser.close();
}
if (failures.length) {
  console.error(`\n${failures.length} problem(s):\n${failures.join("\n")}`);
  process.exit(1);
}
console.log("stage-check: OK");
