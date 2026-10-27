// Checks that every piece of interface text has its translations, without running the app.
// Run: node scripts/check-i18n.mjs [--verbose]   (exit 1 on an error; warnings and dynamic keys are information only)
//
// Three dictionaries are checked:
//  - the app (dashboard, builder, settings, results page): English keys, French in src/i18n/fr-*.ts;
//  - the big screen (src/pages/Present.tsx, src/pages/Lobby.tsx and the shared result views): SCREEN_STRINGS and
//    UI_STRINGS in English, French from the app dictionary, Spanish, German, Italian and Portuguese by hand
//    (src/screen-translations.ts plus src/ui-translations.ts), other languages machine-translated by /api/ui?set=screen;
//  - the phones (src/pages/Vote.tsx and the shared views): UI_STRINGS, by hand in fr/es/de/it/pt (src/ui-translations.ts).
// Rules: R1 app keys in French; R2 phone keys in UI_STRINGS; R3 shared view keys (answers.tsx, kind-views.tsx) on both
// sides; R4 every UI_STRINGS key in the 5 hand-written phone dictionaries; R5 every screen key in French and the 4
// hand-written screen languages; R6 {placeholders} kept in every translation; R7 no em or en dash in any visible string;
// R8 no hard-coded visible text in the room screens; R9 room screen parts never read the app language themselves.
// A line can opt out with an `i18n-ignore` comment on it or on the line above.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

// The parser is rolldown's, the bundler vite 8 is built on. It is found from vite's own folder, so the check keeps
// working wherever npm places rolldown (hoisted at the top of node_modules or nested under vite).
let parseSync, Visitor;
try {
  const fromVite = createRequire(createRequire(import.meta.url).resolve("vite/package.json"));
  ({ parseSync, Visitor } = await import(pathToFileURL(fromVite.resolve("rolldown/utils")).href));
} catch {
  console.error("check-i18n: the parser (rolldown/utils, installed with vite) is missing. Run npm install.");
  process.exit(1);
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");
const verbose = process.argv.includes("--verbose");

// Identical in French: no entry needed.
const SAME_IN_FR = new Set(["Menu", "Type", "Date", "Top {n}"]);
// Shared views that only phones show: no French or screen entry needed.
const PHONE_ONLY = new Set([
  "Your answer", "Correct!", "Not quite", "{n} of {m} right", "You: {n}",
  // A phone's own place on the leaderboard (src/podium.tsx MyStanding, PhoneResults).
  "No points scored", "No points yet", "You are {rank} of {n}", "{n} points", "Watch the big screen",
]);
// Hand-written languages of the phones and of the big screen.
const HAND = ["es", "de", "it", "pt"];
// Room screens: their visible text must go through a translation.
const ROOM_SCREENS = /^src\/(pages\/(Present|Lobby|Vote)|answers|kind-views|launch|podium)\.tsx$/;
// Files whose `t` is the big screen's.
const SCREEN_FILES = /^src\/pages\/(Present|Lobby)\.tsx$/;
// Parts of the big screen: the language comes from Present, never from the app.
const NO_APP_LANG = /^src\/(pages\/Lobby|answers|kind-views|launch|podium)\.tsx$/;
const VISIBLE_ATTRS = new Set(["aria-label", "title", "placeholder", "alt", "label", "aria-valuetext"]);
const SAME_EVERYWHERE = /^(Hopvote|hopvote(\.com)?|OK|[\W\d_]*)$/;

const errors = [];
const warnings = [];
const dynamic = [];
const err = (rule, where, text) => errors.push(`${where}  ${rule}  ${text}`);

const parse = (file, src) => {
  const out = parseSync(file, src, { lang: file.endsWith("x") ? "tsx" : "ts", range: true });
  if (out.errors.length) throw new Error(`${relative(ROOT, file)}: ${out.errors[0].message}`);
  return out;
};
const str = (node) => {
  if (!node) return null;
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) return node.quasis[0].value.cooked;
  return null;
};

// Dictionaries, read as syntax trees (no TypeScript loader needed).
function objects(file) {
  const path = join(SRC, file);
  const { program } = parse(path, readFileSync(path, "utf8"));
  const out = {};
  new Visitor({
    VariableDeclarator(node) {
      if (node.id.type !== "Identifier" || !node.init) return;
      if (node.init.type === "ObjectExpression") {
        const dict = {};
        for (const p of node.init.properties) {
          if (p.type !== "Property") continue;
          const key = p.key.type === "Identifier" ? p.key.name : str(p.key);
          const value = str(p.value);
          if (key !== null && value !== null) dict[key] = value;
        }
        out[node.id.name] = dict;
      }
      if (node.init.type === "ArrayExpression") out[node.id.name] = node.init.elements.map(str).filter((s) => s !== null);
    },
  }).visit(program);
  return out;
}
const FR = {};
for (const f of readdirSync(join(SRC, "i18n")).filter((f) => /^fr-.*\.ts$/.test(f))) for (const d of Object.values(objects(`i18n/${f}`))) Object.assign(FR, d);
const { UI_STRINGS, SCREEN_STRINGS } = objects("ui-strings.ts");
const PHONE_DICTS = objects("ui-translations.ts");
const SCREEN_DICTS = objects("screen-translations.ts");
const UI = new Set(UI_STRINGS);
const SCREEN = new Set(SCREEN_STRINGS);
const inScreen = (k) => UI.has(k) || SCREEN.has(k);
const screenValue = (lang, k) => SCREEN_DICTS[lang]?.[k] ?? PHONE_DICTS[lang]?.[k];

// R4, R5: the lists are complete in every hand-written language.
for (const k of UI_STRINGS) for (const lang of ["fr", ...HAND]) if (!(k in (PHONE_DICTS[lang] ?? {}))) err("R4", `src/ui-translations.ts ${lang}`, `phone string with no translation: ${JSON.stringify(k)}`);
for (const k of SCREEN_STRINGS) {
  if (UI.has(k)) warnings.push(`src/ui-strings.ts  SCREEN_STRINGS repeats a UI_STRINGS entry: ${JSON.stringify(k)}`);
  if (!(k in FR)) err("R5", "src/i18n/fr-screen.ts", `screen string with no French: ${JSON.stringify(k)}`);
  for (const lang of HAND) if (screenValue(lang, k) === undefined) err("R5", `src/screen-translations.ts ${lang}`, `screen string with no translation: ${JSON.stringify(k)}`);
}
// Entries nobody asks for.
for (const [lang, d] of Object.entries(SCREEN_DICTS)) for (const k of Object.keys(d)) if (!SCREEN.has(k)) warnings.push(`src/screen-translations.ts ${lang}  not in SCREEN_STRINGS: ${JSON.stringify(k)}`);

// R6, R7: placeholders kept, no long dashes.
const holes = (s) => (s.match(/\{\w+\}/g) ?? []).sort().join(",");
const DASH = /[\u2013\u2014]/;
const checkValue = (where, k, v) => {
  if (holes(k) !== holes(v)) err("R6", where, `${JSON.stringify(k)} -> ${JSON.stringify(v)} changes the {placeholders}`);
  if (DASH.test(v)) err("R7", where, `long dash in ${JSON.stringify(v)}`);
};
for (const [k, v] of Object.entries(FR)) checkValue("src/i18n/fr-*.ts", k, v);
for (const [lang, d] of Object.entries(PHONE_DICTS)) for (const [k, v] of Object.entries(d)) checkValue(`src/ui-translations.ts ${lang}`, k, v);
for (const [lang, d] of Object.entries(SCREEN_DICTS)) for (const [k, v] of Object.entries(d)) checkValue(`src/screen-translations.ts ${lang}`, k, v);

// Keys used in the code.
const files = [];
(function walk(d) {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) {
      if (n !== "i18n") walk(p);
    } else if (/\.(ts|tsx)$/.test(n) && !n.endsWith(".d.ts")) files.push(p);
  }
})(SRC);

const used = { app: new Map(), phone: new Map(), shared: new Map(), screen: new Map() };
const add = (kind, key, where) => (used[kind].get(key) ?? used[kind].set(key, []).get(key)).push(where);

for (const file of files) {
  const rel = relative(ROOT, file);
  const src = readFileSync(file, "utf8");
  const { program, comments } = parse(file, src);
  const lineOf = (pos) => src.slice(0, pos).split("\n").length;
  const ignored = new Set();
  for (const c of comments) if (/i18n-ignore/.test(c.value)) {
    const l = lineOf(c.start);
    ignored.add(l);
    ignored.add(l + 1);
  }
  const skip = (node) => ignored.has(lineOf(node.start));

  // What `t` means in this file.
  const imports = program.body.filter((n) => n.type === "ImportDeclaration");
  const from = (name) => imports.find((d) => d.specifiers.some((s) => s.local?.name === name))?.source.value ?? "";
  const phoneT = /\/translate$/.test(from("useT"));
  const appTranslate = /app-i18n$/.test(from("translate"));
  const appT = /app-i18n$/.test(from("useAppT")) || appTranslate;
  const screenFile = SCREEN_FILES.test(rel);
  const shared = /^src\/(answers|kind-views)\.tsx$/.test(rel);
  // The leaderboard views (src/podium.tsx) get their `t` from the big screen or from a phone: shared, like answers.tsx.
  const podium = rel === "src/podium.tsx";
  const tKind = screenFile ? "screen" : podium ? "shared" : phoneT ? (shared ? "shared" : "phone") : appT ? "app" : null;

  // String values a name can hold in this file: consts made only of literals, and parameter defaults.
  const values = new Map();
  const literals = (node) => {
    if (!node) return null;
    const s = str(node);
    if (s !== null) return [s];
    if (node.type === "ParenthesizedExpression" || node.type === "TSAsExpression" || node.type === "TSSatisfiesExpression") return literals(node.expression);
    if (node.type === "ArrayExpression") {
      const all = node.elements.map(literals);
      return all.every(Boolean) ? all.flat() : null;
    }
    if (node.type === "ObjectExpression") {
      const all = node.properties.map((p) => (p.type === "Property" ? literals(p.value) : null));
      return all.every(Boolean) ? all.flat() : null;
    }
    if (node.type === "ConditionalExpression") {
      const a = literals(node.consequent);
      const b = literals(node.alternate);
      return a && b ? [...a, ...b] : null;
    }
    return null;
  };
  // Local helpers that pass one of their parameters to translate() as the text: their calls are keys too.
  const wrappers = new Set();
  new Visitor({
    VariableDeclarator(node) {
      if (node.id.type !== "Identifier") return;
      const l = literals(node.init);
      if (l) values.set(node.id.name, [...(values.get(node.id.name) ?? []), ...l]);
      const fn = node.init;
      if (appTranslate && fn && (fn.type === "ArrowFunctionExpression" || fn.type === "FunctionExpression")) {
        const params = fn.params.map((p) => (p.type === "Identifier" ? p.name : null));
        new Visitor({
          CallExpression(c) {
            const arg = c.arguments[1];
            if (c.callee.type === "Identifier" && c.callee.name === "translate" && arg?.type === "Identifier" && params.includes(arg.name)) wrappers.add(node.id.name);
          },
        }).visit(fn.body);
      }
    },
    AssignmentPattern(node) {
      const s = str(node.right);
      if (node.left.type === "Identifier" && s !== null) values.set(node.left.name, [...(values.get(node.left.name) ?? []), s]);
    },
  }).visit(program);
  if (screenFile) wrappers.delete("t");

  // Every string a key expression can take; exact is false when part of it is unknown here.
  const keysOf = (node) => {
    if (!node) return { keys: [], exact: false };
    const s = str(node);
    if (s !== null) return { keys: [s], exact: true };
    if (node.type === "ParenthesizedExpression") return keysOf(node.expression);
    if (node.type === "ConditionalExpression") {
      const a = keysOf(node.consequent);
      const b = keysOf(node.alternate);
      return { keys: [...a.keys, ...b.keys], exact: a.exact && b.exact };
    }
    if (node.type === "LogicalExpression") return { keys: keysOf(node.right).keys, exact: false };
    if (node.type === "Identifier" && values.has(node.name)) return { keys: values.get(node.name), exact: true };
    if (node.type === "MemberExpression" && node.object.type === "Identifier" && values.has(node.object.name)) return { keys: values.get(node.object.name), exact: true };
    return { keys: [], exact: false };
  };

  // A text written in the code shown as a child: {"Words"} or {`${n} people`} (attributes such as className are not text).
  const childText = (el) => {
    if (!ROOM_SCREENS.test(rel)) return;
    for (const c of el.children) {
      if (c.type !== "JSXExpressionContainer" || skip(c)) continue;
      const e = c.expression;
      const text = str(e) ?? (e.type === "TemplateLiteral" ? e.quasis.map((q) => q.value.cooked).join("{}") : null);
      if (text && /\p{L}{3,}/u.test(text.replace(/\{\}/g, "")) && !SAME_EVERYWHERE.test(text)) err("R8", `${rel}:${lineOf(c.start)}`, `hard-coded text: ${text}`);
    }
  };

  new Visitor({
    CallExpression(node) {
      if (node.callee.type !== "Identifier" || skip(node)) return;
      const name = node.callee.name;
      let kind = null;
      let arg = null;
      // Vote.tsx also reads the person's own language through `mine` (the language picker, "See translation").
      if ((name === "t" || (name === "mine" && tKind === "phone")) && tKind) (kind = tKind), (arg = node.arguments[0]);
      else if (name === "translate" && appTranslate) (kind = "app"), (arg = node.arguments[1]);
      else if (wrappers.has(name)) (kind = "app"), (arg = node.arguments[0]);
      if (!kind || !arg) return;
      const { keys, exact } = keysOf(arg);
      const where = `${rel}:${lineOf(node.start)}`;
      for (const k of keys) if (k) add(kind, k, where);
      if (!exact) dynamic.push(`${where}  ${kind}  ${src.slice(arg.start, arg.end).slice(0, 90)}`);
    },
    ImportDeclaration(node) {
      if (!NO_APP_LANG.test(rel) || !/app-i18n$/.test(node.source.value)) return;
      for (const s of node.specifiers) if (["useAppT", "useAppLang", "appLang", "appStrings"].includes(s.local?.name)) err("R9", `${rel}:${lineOf(node.start)}`, `${s.local.name}: this part of the big screen must get its language from Present`);
    },
    Literal(node) {
      if (typeof node.value === "string" && DASH.test(node.value) && !skip(node)) err("R7", `${rel}:${lineOf(node.start)}`, `long dash in ${JSON.stringify(node.value)}`);
    },
    JSXText(node) {
      if (!ROOM_SCREENS.test(rel) || skip(node)) return;
      const text = node.value.replace(/\s+/g, " ").trim();
      if (DASH.test(text)) err("R7", `${rel}:${lineOf(node.start)}`, `long dash in ${JSON.stringify(text)}`);
      if (text && !SAME_EVERYWHERE.test(text) && /\p{L}{2,}/u.test(text)) err("R8", `${rel}:${lineOf(node.start)}`, `hard-coded text: ${text}`);
    },
    JSXAttribute(node) {
      if (!ROOM_SCREENS.test(rel) || skip(node)) return;
      const name = node.name.type === "JSXIdentifier" ? node.name.name : "";
      if (!VISIBLE_ATTRS.has(name) || !node.value) return;
      let text = null;
      if (node.value.type === "Literal") text = node.value.value;
      else if (node.value.type === "JSXExpressionContainer") {
        const e = node.value.expression;
        if (e.type === "Literal" && typeof e.value === "string") text = e.value;
        if (e.type === "TemplateLiteral") text = e.quasis.map((q) => q.value.cooked).join("{}");
      }
      if (text && /\p{L}{2,}/u.test(text.replace(/\{\}/g, "")) && !SAME_EVERYWHERE.test(text)) err("R8", `${rel}:${lineOf(node.start)}`, `hard-coded ${name}: ${text}`);
    },
    JSXElement(node) {
      childText(node);
    },
    JSXFragment(node) {
      childText(node);
    },
  }).visit(program);
}

// R1: app keys in French.
for (const [k, w] of used.app) if (!(k in FR) && !SAME_IN_FR.has(k)) err("R1", w[0], `no French for ${JSON.stringify(k)}${w.length > 1 ? ` (+${w.length - 1} more)` : ""}`);
// R2: phone keys in the phones' list.
for (const [k, w] of used.phone) if (!UI.has(k)) err("R2", w[0], `not in UI_STRINGS: ${JSON.stringify(k)}`);
// R3: shared views show on the big screen and on phones.
for (const [k, w] of used.shared) {
  if (PHONE_ONLY.has(k)) {
    if (!UI.has(k)) err("R3", w[0], `phone-only text not in UI_STRINGS: ${JSON.stringify(k)}`);
    continue;
  }
  if (!inScreen(k)) err("R3", w[0], `not in UI_STRINGS or SCREEN_STRINGS: ${JSON.stringify(k)}`);
  if (!(k in FR)) err("R3", w[0], `no French for the big screen: ${JSON.stringify(k)}`);
}
// R5: big screen keys in every list and hand-written language.
for (const [k, w] of used.screen) {
  if (!inScreen(k)) err("R5", w[0], `not in SCREEN_STRINGS: ${JSON.stringify(k)}`);
  if (!(k in FR)) err("R5", w[0], `no French: ${JSON.stringify(k)}`);
}
for (const k of [...used.screen.keys(), ...used.shared.keys()]) {
  if (PHONE_ONLY.has(k) || !inScreen(k)) continue;
  for (const lang of HAND) if (screenValue(lang, k) === undefined) err("R5", `src/screen-translations.ts ${lang}`, `no translation for ${JSON.stringify(k)}`);
}
// Warnings: list entries nobody uses (each costs a machine translation per language).
const everyKey = new Set([...used.app.keys(), ...used.phone.keys(), ...used.shared.keys(), ...used.screen.keys()]);
for (const k of UI_STRINGS) if (!everyKey.has(k)) warnings.push(`src/ui-strings.ts  UI_STRINGS entry not used through t(): ${JSON.stringify(k)}`);
for (const k of SCREEN_STRINGS) if (!everyKey.has(k)) warnings.push(`src/ui-strings.ts  SCREEN_STRINGS entry not used through t(): ${JSON.stringify(k)}`);

const unique = [...new Set(errors)];
if (verbose || unique.length) {
  for (const w of warnings) console.log(`warning  ${w}`);
  if (verbose) for (const d of dynamic) console.log(`dynamic  ${d}`);
}
for (const e of unique) console.error(`error  ${e}`);
console.log(
  `check-i18n: ${used.app.size} app, ${used.screen.size} screen, ${used.shared.size} shared, ${used.phone.size} phone keys; ` +
    `${unique.length} error(s), ${warnings.length} warning(s), ${dynamic.length} dynamic key(s) not checked${verbose ? "" : " (--verbose lists them)"}`,
);
process.exit(unique.length ? 1 : 0);
