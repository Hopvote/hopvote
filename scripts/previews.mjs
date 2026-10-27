// Pictures of the big screen of each kind of question, for the builder's menu of kinds and the app's home page: the real
// screen drawn from example answers (/preview/screen/<kind>, src/demo-states.ts), in English and French. Optional:
// without them the builder draws a small example instead. Needs Chrome (set CHROME_PATH if it is not found).
// With the dev server running:
//   node scripts/previews.mjs http://localhost:5180 public/previews
// A page that crashes or does not draw the screen stops the run with an error: a broken picture is never saved.
import { mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

export const PREVIEW_KINDS = ["choice", "scale", "scales", "rank", "points", "words", "open", "qa", "wheel", "quiz", "number", "order", "fill", "match", "spot", "slide", "link", "media", "countdown", "contact"];
// Kinds pictured for the builder's menu only: topic rounds.
export const MENU_KINDS = ["topics"];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// What must be on the page before it is photographed: the presenter's stage, or the phone's page with its header.
const READY = { screen: "main.present", phone: "main.page.narrow header.top" };

// Fails when the page shows the app's error screen (App.tsx Crash), never drew the view, or is still connecting.
export async function checkPage(tab, view, url) {
  try {
    await tab.waitForSelector(READY[view], { timeout: 15_000 });
  } catch {
    // Not drawn in time: the checks below say why.
  }
  const problem = await tab.evaluate((ready) => {
    if (document.querySelector("main.page.narrow.center h1.title")) return `error screen ("${document.querySelector("main.page.narrow.center h1.title").textContent.trim()}")`;
    if (!document.querySelector(ready)) return `missing ${ready}`;
    if (document.querySelector("main .spinner")) return "still connecting";
    return "";
  }, READY[view]);
  if (problem) throw new Error(`Preview broken at ${url}: ${problem}`);
}

export async function shootPreviews(browser, base, outDir, log = console.log) {
  let count = 0;
  for (const lang of ["en", "fr"]) {
    mkdirSync(join(outDir, lang), { recursive: true });
    const tab = await browser.newPage();
    // The big screen, as on a projector.
    await tab.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
    for (const kind of [...PREVIEW_KINDS, ...MENU_KINDS]) {
      const url = `${base}/preview/screen/${kind}?lang=${lang}`;
      const res = await tab.goto(url, { waitUntil: "networkidle0" });
      // 304: the browser kept the page from an earlier shot, which is fine.
      if (!res || res.status() >= 400) throw new Error(`Preview broken at ${url}: HTTP ${res?.status() ?? "no answer"}`);
      await tab.evaluate(() => document.fonts.ready);
      await checkPage(tab, "screen", url);
      await wait(450);
      await tab.screenshot({ path: join(outDir, lang, `${kind}.webp`), type: "webp", quality: 84 });
      count++;
    }
    await tab.close();
    log(`previews/${lang} (${PREVIEW_KINDS.length + MENU_KINDS.length} pictures)`);
  }
  return count;
}

if (process.argv[1]?.endsWith("previews.mjs")) {
  const [base = "http://localhost:5180", out = "public/previews"] = process.argv.slice(2);
  const chrome = [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find((p) => p && existsSync(p));
  if (!chrome) {
    console.error("Chrome not found: set CHROME_PATH to run this script.");
    process.exit(1);
  }
  const { default: puppeteer } = await import("puppeteer-core");
  const browser = await puppeteer.launch({ executablePath: chrome, headless: true });
  try {
    await shootPreviews(browser, base, out);
  } catch (err) {
    console.error(err?.message ?? err);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}
