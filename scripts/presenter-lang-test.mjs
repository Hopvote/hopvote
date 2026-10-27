// Local check of the big screen's language: it follows the presentation's language, not the presenter's app language.
// A throwaway account presents decks in English, French, Spanish and an undetectable language ("auto") with the app in
// French; the waiting screen, a question and the presenter's buttons must read in the deck's language ("auto": the app's).
// The example screens (/preview/screen/<kind>?lang=) must keep their own language. The account is deleted at the end.
// Dev server only (npx vite --port 5180), Chrome needed. Run: node scripts/presenter-lang-test.mjs
import puppeteer from "puppeteer-core";

const BASE = "http://localhost:5180";
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
let failures = 0;
const ok = (cond, label, got) => {
  console.log(`${cond ? "✓" : "✗"} ${label}${cond || got === undefined ? "" : `  (got ${JSON.stringify(got)})`}`);
  if (!cond) failures++;
};

let cookie = "";
async function call(path, { method = "GET", body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}), origin: BASE, connection: "close" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

// What each language must show: waiting screen title, its Start button, question 1's kind (next to its step "1 / 2"),
// the wheel's button.
const EXPECT = {
  en: { join: "To join", start: "Start", kind: "Multiple choice", spin: "Spin", qr: "QR code" },
  fr: { join: "Pour participer", start: "Commencer", kind: "Choix multiple", spin: "Tourner", qr: "QR code" },
  es: { join: "Para participar", start: "Empezar", kind: "Opción múltiple", spin: "Girar", qr: "Ocultar QR" },
};
const DECKS = {
  en: { title: "Team offsite", lang: "en", questions: [{ type: "choice", question: "Which session did you enjoy most?", options: ["Strategy", "Workshops"] }, { type: "wheel", question: "Who presents next?", options: ["Ana", "Ben", "Cleo"] }] },
  fr: { title: "Séminaire d'équipe", lang: "fr", questions: [{ type: "choice", question: "Quelle session avez-vous préférée ?", options: ["Stratégie", "Ateliers"] }, { type: "wheel", question: "Qui présente ensuite ?", options: ["Ana", "Ben", "Cléo"] }] },
  es: { title: "Reunión de equipo", lang: "es", questions: [{ type: "choice", question: "¿Qué sesión te gustó más?", options: ["Estrategia", "Talleres"] }, { type: "wheel", question: "¿Quién presenta ahora?", options: ["Ana", "Ben", "Cleo"] }] },
  // No language given and nothing to detect it from: the room keeps "auto".
  auto: { title: "Dededed", questions: [{ type: "choice", question: "Dededed dedede?", options: ["Xq", "Zv"] }, { type: "wheel", question: "Dedede dededed?", options: ["Ana", "Ben", "Cleo"] }] },
};
// The same, presented from an English app (a deck presented once no longer opens on the waiting screen).
DECKS.auto2 = DECKS.auto;

const email = `lang-${crypto.randomUUID().slice(0, 8)}@hopvote.test`;
let browser;
try {
  const pending = await call("/api/auth/signup", { method: "POST", body: { name: "Lang", email, password: crypto.randomUUID() } });
  const verified = await call("/api/auth/verify", { method: "POST", body: { token: pending.data?.devToken } });
  ok(verified.status === 200, "test account created");

  const rooms = {};
  for (const [id, deck] of Object.entries(DECKS)) {
    const made = await call("/api/rooms", { method: "POST", body: deck });
    ok(made.status === 200 && !!made.data.hostKey, `deck ${id} saved`, made.status);
    rooms[id] = made.data;
  }
  const stored = await call(`/api/polls/${rooms.auto.code}`);
  ok(stored.data?.lang === "auto", "the undetectable deck keeps the language unknown", stored.data?.lang);

  browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--lang=fr-FR"] });

  // Opens the big screen as its presenter with the app in `appLang`, then reads the waiting screen, question 1 and question 2.
  async function present(room, appLang) {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.setViewport({ width: 1440, height: 900 });
    await page.evaluateOnNewDocument(
      (code, key, app) => {
        localStorage.setItem(`hopvote:host:${code}`, key);
        localStorage.setItem("hopvote:app-lang", app);
      },
      room.code,
      room.hostKey,
      appLang,
    );
    await page.goto(`${BASE}/present/${room.code}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".lobby .lobby-k", { timeout: 15000 });
    // The waiting screen and the dictionary of the language can arrive a moment apart.
    await new Promise((r) => setTimeout(r, 600));
    const read = () =>
      page.evaluate(() => ({
        html: document.documentElement.lang,
        join: document.querySelector(".lobby-k")?.textContent?.trim() ?? "",
        start: document.querySelector(".lobby-start")?.textContent?.trim() ?? "",
        step: document.querySelector(".present-step")?.textContent?.trim() ?? "",
        kind: document.querySelector(".stage-kind")?.textContent?.trim() ?? "",
        tools: [...document.querySelectorAll(".present-tools button")].map((b) => b.textContent.trim()).join(" | "),
      }));
    const lobby = await read();
    await page.click(".lobby-start");
    await page.waitForFunction(() => !document.querySelector(".lobby") && document.querySelector(".present-step"), { timeout: 10000 });
    const first = await read();
    await page.keyboard.press("ArrowRight");
    await page.waitForFunction(() => document.querySelector(".wheel"), { timeout: 10000 });
    const second = await read();
    await context.close();
    return { lobby, first, second, errors };
  }

  async function expectLang(id, appLang, lang) {
    const e = EXPECT[lang];
    const { lobby, first, second, errors } = await present(rooms[id], appLang);
    const label = `deck ${id}, app in ${appLang}:`;
    ok(lobby.join === e.join, `${label} waiting screen says "${e.join}"`, lobby.join);
    ok(lobby.start === e.start, `${label} Start button says "${e.start}"`, lobby.start);
    ok(lobby.html === lang, `${label} <html lang> is ${lang}`, lobby.html);
    ok(first.step === "1 / 2", `${label} question step says "1 / 2"`, first.step);
    ok(first.kind === e.kind, `${label} question kind says "${e.kind}"`, first.kind);
    ok(first.tools.includes(e.qr), `${label} presenter buttons in ${lang}`, first.tools);
    ok(second.tools.split(" | ").includes(e.spin), `${label} wheel button says "${e.spin}"`, second.tools);
    ok(first.html === lang && second.html === lang, `${label} <html lang> stays ${lang} on the questions`, [first.html, second.html]);
    ok(!errors.length, `${label} no page error`, errors);
  }

  await expectLang("en", "fr", "en");
  await expectLang("fr", "en", "fr");
  await expectLang("es", "fr", "es");
  await expectLang("auto", "fr", "fr");
  await expectLang("auto2", "en", "en");

  // The example screens keep the language of their address.
  for (const [lang, step] of [["fr", "Choix multiple"], ["en", "Multiple choice"]]) {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    await page.goto(`${BASE}/preview/screen/choice?lang=${lang}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".stage-kind", { timeout: 15000 });
    const got = await page.evaluate(() => [document.querySelector(".stage-kind")?.textContent?.trim(), document.documentElement.lang]);
    ok(got[0] === step && got[1] === lang, `/preview/screen/choice?lang=${lang} reads "${step}"`, got);
    await context.close();
  }

  // A language that only came from detection is offered as "Detect" again by the builders (lang equals detected),
  // so a deck first written in French and rewritten in English is detected again on save. Reuses the English deck,
  // already presented above.
  const target = `/api/polls/${rooms.en.code}`;
  const french = { title: "Séminaire", questions: [{ type: "choice", question: "Quelle est la session que vous avez le plus aimée ?", options: ["Les ateliers", "La stratégie"] }], force: true };
  const savedFr = await call(target, { method: "PUT", body: french });
  const readFr = await call(target);
  ok(savedFr.status === 200 && readFr.data?.lang === "fr" && readFr.data?.detected === "fr", "a detected language is reported as detected", [savedFr.status, readFr.data?.lang, readFr.data?.detected]);
  const english = { title: "Offsite", questions: [{ type: "choice", question: "Which is the session that you liked the most?", options: ["The workshops", "The strategy"] }], force: true };
  const savedEn = await call(target, { method: "PUT", body: english });
  const readEn = await call(target);
  ok(savedEn.status === 200 && readEn.data?.lang === "en", "rewritten in English and saved with Detect, it reads as English", [savedEn.status, readEn.data?.lang]);
  const chosen = await call(`/api/polls/${rooms.es.code}`);
  ok(chosen.data?.lang === "es" && typeof chosen.data?.detected === "string", "the editor gets the detected language next to the stored one", [chosen.data?.lang, chosen.data?.detected]);
} catch (err) {
  console.error(err);
  failures++;
} finally {
  await browser?.close();
  if (cookie) {
    const gone = await call("/api/account", { method: "DELETE", body: { confirm: "DELETE" } });
    ok(gone.status === 200, "test account deleted", gone.status);
  }
}
console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
