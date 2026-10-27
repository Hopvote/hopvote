// Checks what the AI writes for every kind of question (worker/ai-kinds.ts).
// (a) Offline, no AI: canned model answers for every kind and broken ones, mapped by fromModel(), and the kinds plans.
// (b) Save path, no AI: a throwaway local account saves the mapped questions and reads them back.
// (c) Only with --live: 6 real calls to /api/ai/generate on the dev server (about 1,000 to 3,000 neurons), every result saved.
// Dev server only (npx vite --port 5180). Run: node scripts/ai-kinds-test.mjs [--live] [--offline]
// The bundle goes to a temporary folder, or to AI_KINDS_OUT when set.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = new URL("..", import.meta.url).pathname;
const BASE = "http://localhost:5180";
const LIVE = process.argv.includes("--live");
const OFFLINE = process.argv.includes("--offline");
let failures = 0;
const ok = (cond, label) => {
  console.log(`${cond ? "✓" : "✗"} ${label}`);
  if (!cond) failures++;
};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---------- (a) offline ----------
const out = process.env.AI_KINDS_OUT ?? mkdtempSync(join(tmpdir(), "ai-kinds-"));
mkdirSync(out, { recursive: true });
const bundle = join(out, "ai-kinds.mjs");
execFileSync(join(ROOT, "node_modules/.bin/esbuild"), [join(ROOT, "worker/ai-kinds.ts"), "--bundle", "--format=esm", "--platform=neutral", `--outfile=${bundle}`, "--log-level=error"]);
const K = await import(pathToFileURL(bundle).href);
// The rules of topic rounds (src/rounds.ts), to check what the AI's rounds become.
const roundsBundle = join(out, "rounds.mjs");
execFileSync(join(ROOT, "node_modules/.bin/esbuild"), [join(ROOT, "src/rounds.ts"), "--bundle", "--format=esm", "--platform=neutral", `--outfile=${roundsBundle}`, "--log-level=error"]);
const R = await import(pathToFileURL(roundsBundle).href);

const ctx = (style, brief = "General knowledge quiz", count = 5) => ({ style, brief, count });
const map = (q, c = ctx("quiz")) => K.fromModel(q, c);
const raw = (q, c) => map(q, c).raw;
const drop = (q, c) => map(q, c).drop;
const mixed = ctx("mixed", "Team day for our sales team");

console.log("Mapping, one kind at a time");
ok(eq(raw({ type: "quiz", question: "Largest planet?", options: ["Mars", "Jupiter", "Venus"], answer: "jupiter" }), { type: "choice", question: "Largest planet?", options: ["Mars", "Jupiter", "Venus"], correct: 1, timer: 20 }), "quiz: right answer found by its text, timer 20");
ok(raw({ type: "choice", question: "Largest planet?", options: ["Mars", "Jupiter"], answer: "Jupiter" })?.correct === 1, "a choice with an answer is a quiz");
ok(raw({ type: "quiz", question: "Year?", options: ["1889", "1901"], answer: 1889 })?.correct === 0, "a quiz answer written as a number matches its option");
ok(raw({ type: "quiz", question: "Pick", options: ["A", "B", "C"], correct: 2 })?.correct === 2, "a quiz answer given as a position");
ok(drop({ type: "quiz", question: "Largest planet?", options: ["Mars", "Venus"], answer: "Jupiter" }) === "quiz answer not among the options", "quiz: answer not among the options is dropped");
ok(raw({ type: "quiz", question: "Q?", options: ["A", "", "B", "a"], answer: "B" })?.correct === 1 && raw({ type: "quiz", question: "Q?", options: ["A", "", "B", "a"], answer: "B" }).options.length === 2, "quiz: empty and repeated options removed, right index follows");
ok(eq(raw({ type: "number", question: "Eiffel Tower year?", answer: 1889 }), { type: "number", question: "Eiffel Tower year?", answer: 1889, timer: 20 }), "number: answer and timer");
ok(raw({ type: "number", question: "Year?", answer: "1 889" })?.answer === 1889, 'number: "1 889" is 1889');
ok(raw({ type: "number", question: "Pi?", answer: "3,14" })?.answer === 3.14, 'number: "3,14" is 3.14');
ok(raw({ type: "number", question: "People?", answer: "1,889" })?.answer === 1889, 'number: "1,889" is 1889');
ok(raw({ type: "number", question: "Big?", answer: "12 000 000" })?.answer === 12000000, "number: thin spaces as thousands separators");
ok(drop({ type: "number", question: "About?", answer: "about 40" }) === "number answer is not a number", 'number: "about 40" dropped in a quiz');
ok(drop({ type: "number", question: "How tall?", answer: "330 m" }) === "number answer is not a number", 'number: "330 m" dropped in a quiz');
ok(drop({ type: "number", question: "How many?" }) === "number without an answer", "number: a quiz needs the answer");
ok(eq(raw({ type: "number", question: "How many coffees today?", answer: 3 }, ctx("poll")), { type: "number", question: "How many coffees today?" }), "number: a poll keeps no answer");
ok(eq(raw({ type: "number", question: "How many?", answer: "about 40" }, mixed), { type: "number", question: "How many?" }), "number: a mixed session keeps an unclear answer as a poll");
ok(eq(raw({ type: "order", question: "Oldest first", items: ["Rome", "Paris", "Berlin", "Ottawa"] }), { type: "rank", question: "Oldest first", options: ["Rome", "Paris", "Berlin", "Ottawa"], ordered: true, timer: 30 }), "order: ordered ranking, items kept in order, timer 30");
ok(eq(raw({ type: "order", question: "Oldest first", items: ["Fall of Rome (476)", "1492: Columbus", "1789 Revolution", "Moon landing (1969)"] })?.options, ["Fall of Rome", "Columbus", "Revolution", "Moon landing"]), "order: dates in brackets or in front that give the order away are removed");
ok(drop({ type: "order", question: "Oldest first", items: ["1re République", "2e République", "3e République", "5e République"] }) === "order items give their order away", "order: ranks in the names (1re, 2e...) dropped");
ok(drop({ type: "order", question: "Oldest first", items: ["First Republic", "Second Republic", "Third Republic"] }) === "order items give their order away", "order: ordinal words in the names dropped");
ok(drop({ type: "order", question: "Biggest first", items: ["Apollo 17", "Apollo 13", "Apollo 11"] }) === "order items give their order away", "order: falling numbers dropped too");
ok(raw({ type: "order", question: "Oldest first", items: ["Windows 95", "Windows XP", "Windows 7", "Windows 11"] })?.options.length === 4, "order: numbers that do not follow the order are kept");
ok(raw({ type: "rank", ordered: true, question: "Steps", options: ["A", "B", "C"] })?.ordered === true, "order: a ranking flagged ordered");
ok(drop({ type: "order", question: "Order", items: ["Rome", "Paris", "rome"] }) === "duplicate order items", "order: duplicate items dropped");
ok(drop({ type: "order", question: "Order", items: ["Rome", "Paris"] }) === "fewer than 3 order items", "order: 2 items dropped");
ok(raw({ type: "order", question: "Order", items: ["A", "B", "C", "D", "E", "F", "G"] })?.options.length === 6, "order: 6 items at most, the first ones");
const fill = raw({ type: "fill", question: "Complete the sentence", text: "The capital of Australia is [Canberra] and its largest city is [Sydney].", extra: ["Melbourne", "Perth", "canberra", "Brisbane, Darwin", "Perth"] });
ok(eq(fill, { type: "fill", question: "Complete the sentence", fill: "The capital of Australia is [Canberra] and its largest city is [Sydney].", fillMode: "words", decoys: ["Melbourne", "Perth"], timer: 30 }), "fill: words to place, decoys without answers, commas or repeats");
ok(drop({ type: "fill", question: "Complete", text: "No blanks here." }) === "fill text has no [blanks]", "fill: no brackets dropped");
ok(drop({ type: "fill", question: "Complete", text: "[a] [b] [c] [d] [e] [f] [g]" }) === "more than 6 blanks", "fill: 7 blanks dropped");
ok(drop({ type: "fill", question: "Complete", text: "It is [ ] here." }) === "empty or long blank", "fill: an empty blank dropped");
ok(raw({ type: "fill_in_the_blanks", question: "Complete", text: "I like [colour/color]." })?.fill === "I like [colour/color].", "fill: alias type, alternatives kept");
ok(raw({ type: "fill", question: "Complete", text: "A [x].", extra: ["a", "b", "c", "d", "e", "f"] })?.decoys.length === 4, "fill: 4 extra words at most");
ok(eq(raw({ type: "match", question: "Match each country to its capital", pairs: [["France", "Paris"], ["Italy", "Rome"], ["Spain", "Madrid"]] }), { type: "match", question: "Match each country to its capital", options: ["France", "Italy", "Spain", "Paris", "Rome", "Madrid"], timer: 30 }), "match: lefts then rights, timer 30");
ok(eq(raw({ type: "matching", question: "Match", pairs: [{ left: "H", right: "Hydrogen" }, { left: "O", right: "Oxygen" }] })?.options, ["H", "O", "Hydrogen", "Oxygen"]), "match: alias type and object pairs");
ok(eq(raw({ type: "match", question: "Match", pairs: [["France", "Paris"], ["Italy", ""], ["Spain", "Madrid"]] })?.options, ["France", "Spain", "Paris", "Madrid"]), "match: a one-sided pair is left out");
ok(drop({ type: "match", question: "Match", pairs: [["France", "Paris"], ["Italy"]] }) === "fewer than 2 full pairs", "match: one full pair dropped");
ok(drop({ type: "match", question: "Match", pairs: [["A", "1"], ["B", "1"], ["C", "3"]] }) === "match sides repeat", "match: repeated sides dropped");
ok(raw({ type: "match", question: "Match", pairs: Array.from({ length: 8 }, (_, i) => [`L${i}`, `R${i}`]) })?.options.length === 12, "match: 6 pairs at most");
ok(eq(raw({ type: "scale", question: "How useful?", labels: ["Not at all", "Very"] }, mixed), { type: "scale", question: "How useful?", max: 5, labels: ["Not at all", "Very"] }), "scale: 1 to 5 with labels");
ok(eq(raw({ type: "rating", question: "How useful?", labels: ["Low"] }, mixed), { type: "scale", question: "How useful?", max: 5 }), "scale: alias, one label alone is ignored");
ok(eq(raw({ type: "scales", question: "Rate the day", statements: ["Clear", "Useful", "Fun"], labels: ["Low", "High"] }, mixed), { type: "scales", question: "Rate the day", options: ["Clear", "Useful", "Fun"], max: 5, labels: ["Low", "High"] }), "scales: statements and labels");
ok(drop({ type: "scales", question: "Rate", statements: ["Only one"] }, mixed) === "fewer than 2 statements", "scales: one statement dropped");
ok(eq(raw({ type: "ranking", question: "Rank these", options: ["A", "B", "C"] }, mixed), { type: "rank", question: "Rank these", options: ["A", "B", "C"] }), "rank: alias, plain ranking");
ok(eq(raw({ type: "prioritize", question: "Share 100 points", options: ["A", "B", "C"] }, mixed), { type: "points", question: "Share 100 points", options: ["A", "B", "C"] }), "points: alias");
ok(eq(raw({ type: "word_cloud", question: "In one word?" }, mixed), { type: "words", question: "In one word?" }), "words: alias");
ok(eq(raw({ type: "open", question: "What next?" }, mixed), { type: "open", question: "What next?" }), "open");
ok(eq(raw({ type: "qa", question: "Your questions?" }, mixed), { type: "qa", question: "Your questions?" }), "qa");
ok(eq(raw({ type: "wheel", question: "Next topic", entries: ["Pricing", "Hiring", "pricing", "Roadmap"] }, mixed), { type: "wheel", question: "Next topic", options: ["Pricing", "Hiring", "Roadmap"] }), "wheel: entries once each");
ok(drop({ type: "wheel", question: "Who?", entries: ["Only one"] }, mixed) === "fewer than 2 wheel entries", "wheel: 1 entry dropped");
const workshop = ctx("mixed", "Workshop with a coffee break", 8);
ok(eq(raw({ type: "slide", question: "Part two", text: "Group work starts now." }, workshop), { type: "slide", question: "Part two", text: "Group work starts now." }), "slide: title and text when the brief mentions a workshop");
ok(eq(raw({ type: "timer", question: "Coffee break", minutes: 10 }, workshop), { type: "countdown", question: "Coffee break", duration: 600 }), "countdown: minutes to seconds");
ok(raw({ type: "countdown", question: "Break", minutes: 90 }, workshop)?.duration === 900 && raw({ type: "countdown", question: "Break", minutes: 0.2 }, workshop)?.duration === 60, "countdown: 1 to 15 minutes");
ok([[1.5, 60], [2, 180], [4, 300], [7, 300], [12, 600], [13, 900]].every(([m, d]) => raw({ type: "countdown", question: "Break", minutes: m }, workshop)?.duration === d) && raw({ type: "countdown", question: "Break", duration: 90 }, workshop)?.duration === 60, "countdown: snapped to 1, 3, 5, 10 or 15 minutes");
ok(drop({ type: "slide", question: "Part two", text: "..." }, mixed) === "kind not allowed in mixed", "slide: never without a break or workshop in the brief");
ok(drop({ type: "countdown", question: "Break", minutes: 5 }, mixed) === "kind not allowed in mixed", "countdown: never without a break or workshop in the brief");
ok(drop({ type: "spot", question: "Where?" }, mixed) === "kind never generated", "spot: never");
ok(drop({ type: "contact", question: "Email?" }, mixed) === "kind never generated", "contact: never");
ok(drop({ type: "link", question: "Our site", url: "https://example.com" }, mixed) === "kind not allowed in mixed", "link: never without a link in the brief");
const linked = ctx("mixed", "Intro, then watch https://youtu.be/dQw4w9WgXcQ and visit https://example.com/pricing.", 8);
ok(eq(raw({ type: "video", question: "Watch", url: "https://youtu.be/dQw4w9WgXcQ" }, linked), { type: "media", question: "Watch", url: "https://youtu.be/dQw4w9WgXcQ" }), "media: the exact video link of the brief");
ok(eq(raw({ type: "link", question: "Pricing", url: "https://example.com/pricing" }, linked), { type: "link", question: "Pricing", url: "https://example.com/pricing" }), "link: the exact link of the brief");
ok(drop({ type: "link", question: "Other", url: "https://example.com/other" }, linked) === "link not written in the brief", "link: an invented link dropped");
ok(eq(raw({ type: "choice", question: "Lunch?", options: ["Pizza", "Salad"], multi: true }, mixed), { type: "choice", question: "Lunch?", options: ["Pizza", "Salad"], multi: true }), "choice: several answers");
ok(eq(raw({ type: "multiple_choice", question: "Lunch?", options: ["Pizza", "Salad"], answer: "Pizza" }, ctx("poll")), { type: "choice", question: "Lunch?", options: ["Pizza", "Salad"] }), "a quiz in a poll becomes a plain choice");
ok(drop({ type: "choice", question: "Lunch?", options: ["Pizza", "Salad"] }) === "kind not allowed in quiz", "a quiz session keeps knowledge checks only");
ok(drop({ type: "fill", question: "Complete", text: "A [b]." }, ctx("poll")) === "kind not allowed in poll", "a poll has no fill in the blanks");
ok(drop({ type: "made_up", question: "?" }, mixed) === "unknown kind", "an unknown kind dropped");
ok(drop({ type: "quiz", options: ["A", "B"], answer: "A" }) === "no question", "a question without a title dropped");
ok(drop(null) === "not an object", "a broken entry dropped");

console.log("Dashes and plain characters");
const dashed = raw({ type: "quiz", question: "Paris — the capital?", options: ["Yes — sure", "No", "1990–2000"], answer: "No" });
ok(dashed.question === "Paris, the capital?" && dashed.options[0] === "Yes, sure" && dashed.options[2] === "1990-2000", "em and en dashes become a comma, or a hyphen between numbers");
const dfill = raw({ type: "fill", question: "Complete — now", text: "Rome – the [capital].", extra: ["city — town"] });
ok(!/[–—]/.test(JSON.stringify(dfill)), "no dash left in a fill question");

console.log("Answers that go out of date, French spacing");
ok(drop({ type: "fill", question: "Complétez la phrase", text: "Jupiter a [79] lunes connues.", extra: ["82", "96"] }) === "fill answer changes over time", "fill: a count of moons is dropped");
ok(!!raw({ type: "fill", question: "Complete", text: "The Eiffel Tower opened in [1889].", extra: ["1901"] }), "fill: a fixed year is kept");
ok(drop({ type: "number", question: "How many moons does Saturn have?", answer: 146 }) === "number answer changes over time", "number: a count of moons is dropped in a quiz");
ok(eq(raw({ type: "number", question: "Population of Paris?", answer: 2100000 }, mixed), { type: "number", question: "Population of Paris?" }), "number: a population becomes a plain guess outside a quiz");
ok(raw({ type: "number", question: "In what year did the Berlin Wall fall?", answer: 1989 })?.answer === 1989, "number: a fixed year is kept");
ok(drop({ type: "quiz", question: "Combien de lunes a Jupiter ?", options: ["12", "79", "95"], answer: "95" }) === "quiz answer changes over time", "quiz: a count of moons is dropped");
const nb = "\u00a0";
ok(K.frenchSpaces("Quelle planète est la plus proche du Soleil?") === `Quelle planète est la plus proche du Soleil${nb}?`, "fr: no-break space added before ?");
ok(K.frenchSpaces("Prêts ? Partez !") === `Prêts${nb}? Partez${nb}!`, "fr: a plain space before ? and ! becomes a no-break one");
ok(K.frenchSpaces("Vraiment?!") === `Vraiment${nb}?!`, "fr: ?! keeps one space only");
ok(K.frenchSpaces("Rendez-vous à 10:45 sur https://example.com/x?a=1") === "Rendez-vous à 10:45 sur https://example.com/x?a=1", "fr: times and links untouched");
ok(K.frenchSpaces("Le thème : la sécurité") === `Le thème${nb}: la sécurité`, "fr: no-break space before :");
const frq = K.frenchQuestion({ type: "choice", question: "Prêts?", options: ["Oui!", "Non"], correct: 0 });
ok(eq(frq, { type: "choice", question: `Prêts${nb}?`, options: [`Oui${nb}!`, "Non"], correct: 0 }), "fr: title and options spaced, the right answer kept");
ok(!/[–—]/.test(JSON.stringify(raw({ type: "match", question: "Match — pairs", pairs: [["A — a", "1"], ["B", "2 – two"]] }))), "no dash left in match pairs");
ok(!/[–—]/.test(JSON.stringify(raw({ type: "wheel", question: "Spin — now", entries: ["One — 1", "Two"] }, mixed))), "no dash left in wheel entries");
ok(K.str("Non‑breaking", 40) === "Non-breaking", "non-breaking hyphens become plain");

console.log("Plans");
const kinds = (p) => p.map((s) => s.kind);
let seed = 1;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
for (const style of K.STYLES) {
  for (const count of [3, 4, 4.5, 5, 7, 8, 10]) {
    const p = K.planKinds(ctx(style, "Our company onboarding, with a coffee break and https://example.com", count), rand);
    const allowed = K.allowedKinds(ctx(style, "Our company onboarding, with a coffee break and https://example.com", count));
    ok(p.length === Math.round(count) && p.every((s) => allowed.has(s.kind)), `${style} ${count}: ${count} planned kinds, all allowed (${kinds(p).join(", ")})`);
  }
}
for (const count of [5, 8, 10]) {
  const p = kinds(K.planKinds(ctx("quiz", "x", count), rand));
  ok(K.KNOWLEDGE.every((k) => p.includes(k)) && p[0] === "quiz", `quiz ${count}: every knowledge check, quiz first`);
}
const q3 = kinds(K.planKinds(ctx("quiz", "x", 3), rand));
ok(q3[0] === "quiz" && new Set(q3).size === 3, `quiz 3: quiz and 2 other knowledge checks (${q3.join(", ")})`);
const m5 = K.planKinds(ctx("mixed", "Sales kickoff", 5), rand);
ok(m5[0].role === "icebreaker" && m5[4].role === "close" && m5.filter((s) => s.role === "knowledge").length === 1, "mixed 5: icebreaker, one knowledge check, closing question");
ok(K.planKinds(ctx("mixed", "Sales kickoff", 8), rand).filter((s) => s.role === "knowledge").length === 2, "mixed 8: two knowledge checks");
const plain = Array.from({ length: 40 }, () => kinds(K.planKinds(ctx("mixed", "Sales kickoff", 10)))).flat();
ok(!plain.some((k) => ["slide", "countdown", "link", "media", "spot", "contact"].includes(k)), "mixed: no slide, timer, link, video, image or contact unless the brief calls for one");
const breakPlan = kinds(K.planKinds(ctx("mixed", "Atelier avec une pause café", 10), rand));
ok(breakPlan.includes("countdown") && breakPlan.includes("slide") && breakPlan.includes("qa"), "mixed 10 with a break (French brief): a timer, a slide and a Q&A");
ok(kinds(K.planKinds(ctx("mixed", "Workshop after the break", 5), rand)).filter((k) => ["countdown", "slide", "qa"].includes(k)).join() === "countdown", "mixed 5 with a break: one timer, nothing else extra");
ok(kinds(K.planKinds(ctx("poll", "Watch https://youtu.be/dQw4w9WgXcQ first", 5), rand)).includes("media"), "a video link in the brief gets a video question");
const tries = new Set(Array.from({ length: 6 }, () => kinds(K.planKinds(ctx("mixed", "Sales kickoff", 8))).join(",")));
ok(tries.size > 1, `"Try again" gives another mix (${tries.size} different plans out of 6)`);
const lines = K.kindLines(K.planKinds(ctx("quiz", "x", 5), rand));
ok(["quiz", "number", "order", "fill", "match"].every((k) => lines.includes(`"${k}"`)) && !/[–—]/.test(lines), "the prompt describes every planned kind, with no dashes");
ok(/Question 1: type "quiz"/.test(K.planText(K.planKinds(ctx("quiz", "x", 5), rand))), "the prompt holds the numbered plan");

console.log("Topic rounds");
ok(eq(K.roundsAsk({}), { how: "wheel", topics: [], perTopic: 3 }), "rounds: the wheel and 3 questions per topic by default");
ok(eq(K.roundsAsk({ how: "vote", perTopic: 9, topics: ["History", " history ", "Sport", "", "Cinema", "Music", "Art"] }), { how: "vote", topics: ["History", "Sport", "Cinema", "Music"], perTopic: 5 }), "rounds: a vote, 5 per topic at most, topics once each and 4 at most");
ok(K.roundsAsk({ perTopic: 1 }).perTopic === 2, "rounds: 2 questions per topic at least");
ok(K.cleanTopics(["A very long topic name that goes past forty characters for sure"])[0].length === 40, "rounds: a topic name is cut at 40 characters");
ok(K.cleanTopics(["Sport — fun", "Ciné."]).join("|") === "Sport, fun|Ciné", "rounds: no dash and no final period in a topic name");
const tctx = K.topicContext("Quiz night for the office", "Geography", 2);
ok(tctx.style === "quiz" && tctx.count === 2 && /Geography/.test(tctx.brief), "rounds: each topic's call is a quiz on its topic");
ok(K.topicPlan(tctx, rand).length === 2 && K.topicPlan(tctx, rand)[0].kind === "quiz", "rounds: 2 per topic plans 2 knowledge checks, a quiz first");
ok(K.topicPlan(K.topicContext("x", "y", 5), rand).length === 5, "rounds: 5 per topic plans 5");
const q = (question, options, answer) => ({ type: "quiz", question, options, answer });
const sets = [
  [q("Capital of Italy?", ["Rome", "Milan", "Turin"], "Rome"), q("Longest river in Africa?", ["Nile", "Congo", "Niger"], "Nile"), q("Extra?", ["A", "B"], "A")],
  [q("Who directed Jaws?", ["Spielberg", "Lucas", "Scorsese"], "Spielberg"), { type: "number", question: "Year of the first Oscars ceremony?", answer: 1929 }],
  [{ type: "choice", question: "Favourite sport?", options: ["Tennis", "Golf"] }, q("Bad", ["A", "B"], "C")],
];
const ctxOf = (label) => K.topicContext("Office quiz night", label, 2);
const built = K.roundsFromModel({ how: "wheel", perTopic: 2 }, { question: "What will the next topic be?", topics: ["Geography", "Cinema", "Sport"] }, sets, ctxOf);
ok(!!built && built.questions.length === 5, `rounds: picker and 2 questions in each usable topic (${built?.questions.length})`);
ok(eq(built?.questions[0], { type: "wheel", question: "What will the next topic be?", options: ["Geography", "Cinema"], topics: true }), "rounds: the picker is a wheel among the topics kept");
ok(eq(built?.dropped, ["Sport"]), "rounds: a topic without a usable quiz question is left out");
ok(eq(built?.questions.slice(1).map((x) => x.topic), [0, 0, 1, 1]), "rounds: each question carries its topic, in order");
ok(built?.questions[3].correct === 0 && built?.questions[4].answer === 1929, "rounds: questions keep their right answers");
ok(R.validRounds(built.questions) === null && !!R.roundsOf(built.questions), "rounds: the result holds together as topic rounds");
const vote = K.roundsFromModel({ how: "vote", perTopic: 3 }, { question: "Which topic next?", topics: ["Geography", "Cinema"] }, sets, ctxOf);
ok(vote?.questions[0].type === "choice" && vote.questions[0].topics === true && vote.questions[0].correct === undefined, "rounds: a room vote is a poll among the topics, no right answer");
ok(K.roundsFromModel({ how: "wheel", perTopic: 2 }, { question: "Next?", topics: ["Sport", "Cinema"] }, [sets[2], sets[1]], ctxOf) === null, "rounds: fewer than 2 usable topics gives nothing");
ok(K.roundsFromModel({ how: "wheel", perTopic: 2 }, { question: "", topics: ["Geography", "Cinema"] }, sets, ctxOf) === null, "rounds: a picker without its question gives nothing");
const refused = K.roundsFromModel({ how: "wheel", perTopic: 2 }, { question: "Next?", topics: ["Geography", "Cinema"] }, sets, ctxOf, (raw) => (raw.type === "number" ? "refused" : raw));
ok(refused?.questions.filter((x) => x.topic === 1).length === 1, "rounds: a question the save refuses is left out, its topic stays with the others");
ok(!/[–—]/.test(JSON.stringify(built)), "rounds: no dash in the result");
// Cut to a cap: 5 questions keep the picker and 2 topics of 2.
const big = K.roundsFromModel({ how: "wheel", perTopic: 3 }, { question: "Next?", topics: ["Geography", "Cinema", "History"] }, [
  [q("G1?", ["A", "B"], "A"), q("G2?", ["A", "B"], "A"), q("G3?", ["A", "B"], "A")],
  [q("C1?", ["A", "B"], "A"), q("C2?", ["A", "B"], "A"), q("C3?", ["A", "B"], "A")],
  [q("H1?", ["A", "B"], "A"), q("H2?", ["A", "B"], "A"), q("H3?", ["A", "B"], "A")],
], (label) => K.topicContext("x", label, 3)).questions;
ok(big.length === 10, "rounds: 3 topics of 3 make 10 questions");
const free = R.fitRounds(big, 5);
ok(free?.length === 5 && eq(free[0].options, ["Geography", "Cinema"]) && eq(free.slice(1).map((x) => x.question), ["G1?", "G2?", "C1?", "C2?"]), "rounds: a cap of 5 keeps the picker and 2 topics of 2");
ok(R.validRounds(free) === null, "rounds: the cut rounds hold together");
const seven = R.fitRounds(big, 7);
ok(seven?.length === 7 && seven[0].options.length === 3 && seven.slice(1).every((x) => ["G1?", "G2?", "C1?", "C2?", "H1?", "H2?"].includes(x.question)), "rounds: 7 questions keep 3 topics of 2");
ok(R.fitRounds(big, 50) === big, "rounds: a cap of 50 keeps everything");
ok(R.fitRounds(big, 2) === null, "rounds: no room for 2 topics gives nothing");
ok(R.fitRounds([{ ...big[0], rounds: 3 }, ...big.slice(1)], 5)[0].rounds === undefined, "rounds: rounds to play stay within the topics kept");
const kept = R.keepRounds(big, big.map((x, i) => !(x.topic === 1)));
ok(eq(kept[0].options, ["Geography", "History"]) && eq(kept.slice(1).map((x) => x.topic), [0, 0, 0, 1, 1, 1]), "rounds: a topic left without a ticked question goes, the next moves up");
ok(R.keepRounds(big, big.map((_, i) => i !== 0)).every((x) => x.topic === undefined && !x.topics), "rounds: the picker unticked leaves plain questions");

if (OFFLINE) finish();

// ---------- (b) save path ----------
let cookie = "";
async function call(path, { method = "GET", body } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(BASE + path, { method, headers: { "content-type": "application/json", origin: BASE, connection: "close", ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
      const set = res.headers.get("set-cookie");
      if (set) cookie = set.split(";")[0];
      return { status: res.status, data: await res.json().catch(() => null) };
    } catch (err) {
      // The dev server restarts when worker files change.
      if (attempt >= 4) throw err;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}
const sql = (command) => JSON.parse(execFileSync("npx", ["wrangler", "d1", "execute", "hopvote-db", "--local", "--json", "--command", command], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }))[0]?.results ?? [];
// Sets are saved in parts of 5 questions, each read back then deleted.
async function saveAll(questions, title) {
  const saved = [];
  for (let i = 0; i < questions.length; i += 5) {
    const part = questions.slice(i, i + 5);
    const made = await call("/api/rooms", { method: "POST", body: { title, questions: part } });
    if (made.status !== 200) return { error: `${made.status} ${made.data?.error}`, saved };
    saved.push(...((await call(`/api/polls/${made.data.code}`)).data?.questions ?? []));
    await call(`/api/polls/${made.data.code}`, { method: "DELETE" });
  }
  return { saved };
}

const email = `ai-kinds-${crypto.randomUUID().slice(0, 8)}@hopvote.test`;
try {
  console.log("Saving mapped questions");
  const pending = await call("/api/auth/signup", { method: "POST", body: { name: "AI kinds", email, password: crypto.randomUUID() } });
  await call("/api/auth/verify", { method: "POST", body: { token: pending.data?.devToken } });
  ok(pending.status === 200 && !!cookie, "throwaway local account created");
  const set = [
    raw({ type: "quiz", question: "Largest planet?", options: ["Mars", "Jupiter", "Venus"], answer: "Jupiter" }),
    raw({ type: "number", question: "Eiffel Tower year?", answer: "1 889" }),
    raw({ type: "order", question: "Sort from oldest to newest", items: ["Pyramids", "Colosseum", "Eiffel Tower"] }),
    fill,
    raw({ type: "match", question: "Match each country to its capital", pairs: [["France", "Paris"], ["Italy", "Rome"], ["Spain", "Madrid"]] }),
    raw({ type: "scales", question: "Rate the day", statements: ["Clear", "Useful"], labels: ["Low", "High"] }, mixed),
    raw({ type: "points", question: "Share 100 points", options: ["A", "B", "C"] }, mixed),
    raw({ type: "wheel", question: "Next topic", entries: ["Pricing", "Hiring", "Roadmap"] }, mixed),
    raw({ type: "slide", question: "Part two", text: "Group work starts now." }, workshop),
    raw({ type: "countdown", question: "Coffee break", minutes: 10 }, workshop),
    raw({ type: "video", question: "Watch", url: "https://youtu.be/dQw4w9WgXcQ" }, linked),
    raw({ type: "link", question: "Pricing", url: "https://example.com/pricing" }, linked),
    raw({ type: "scale", question: "How useful?", labels: ["Not at all", "Very"] }, mixed),
    raw({ type: "words", question: "In one word?" }, mixed),
    raw({ type: "qa", question: "Your questions?" }, mixed),
  ];
  const { saved, error } = await saveAll(set, "AI kinds");
  ok(!error && saved.length === set.length, `every mapped kind saves (${error ?? saved.length})`);
  const [quiz, number, order, f, match, scales, points, wheel, slide, countdown, media, link] = saved;
  ok(quiz?.type === "choice" && quiz.correct === 1 && quiz.timer === 20, "quiz read back with its answer and timer");
  ok(number?.type === "number" && number.answer === 1889 && number.timer === 20, "number read back with 1889");
  ok(order?.type === "rank" && order.ordered === true && order.options[0] === "Pyramids" && order.timer === 30, "right order read back in order");
  ok(f?.type === "fill" && f.fillMode === "words" && eq(f.decoys, ["Melbourne", "Perth"]) && f.timer === 30, "fill read back with words to place and extra words");
  ok(match?.type === "match" && match.options.length === 6 && match.options[3] === "Paris", "match read back as pairs");
  ok(scales?.type === "scales" && scales.labels?.[1] === "High", "rating scale read back");
  ok(points?.type === "points" && points.options.length === 3, "prioritize read back");
  ok(wheel?.type === "wheel" && wheel.options.length === 3, "wheel read back with its entries");
  ok(slide?.text === "Group work starts now." && countdown?.duration === 600, "slide text and timer length read back");
  ok(media?.type === "media" && link?.url === "https://example.com/pricing", "video and link read back");

  console.log("Saving AI topic rounds (5 questions)");
  for (const [how, rounds] of [["wheel", free], ["vote", [{ ...free[0], type: "choice" }, ...free.slice(1)]]]) {
    const made = await call("/api/rooms", { method: "POST", body: { title: `AI rounds ${how}`, names: true, boardMode: "round", questions: rounds } });
    ok(made.status === 200, `${how}: the AI's rounds cut to 5 questions save (${made.status} ${made.data?.error ?? ""})`);
    if (made.status !== 200) continue;
    const back = (await call(`/api/polls/${made.data.code}`)).data;
    ok(back?.questions?.[0]?.topics === true && back.questions[0].type === (how === "vote" ? "choice" : "wheel") && eq(back.questions.slice(1).map((x) => x.topic), [0, 0, 1, 1]), `${how}: read back as topic rounds`);
    ok(back?.boardMode === "round" && back?.rounds?.topics?.length === 2, `${how}: the leaderboard after each round, 2 topics in the results`);
    await call(`/api/polls/${made.data.code}`, { method: "DELETE" });
  }
  const short = await call("/api/ai/generate", { method: "POST", body: { mode: "rounds", topic: "x" } });
  ok(short.status === 400, "rounds request without a brief refused before any AI call");
  const tiny = await call("/api/ai/generate", { method: "POST", body: { mode: "rounds", topic: "Office quiz night", max: 2 } });
  ok(tiny.status === 400, "rounds request with room for fewer than 3 questions refused before any AI call");

  // ---------- (c) live ----------
  if (LIVE) {
    console.log("Live generation (6 calls)");
    const spent = () => sql(`SELECT neurons FROM ai_budget WHERE day = '${new Date().toISOString().slice(0, 10)}'`)[0]?.neurons ?? 0;
    const start = spent();
    const live = [];
    const runs = [
      { style: "quiz", lang: "en", count: 5, topic: "General knowledge about European geography and history, for a team evening" },
      { style: "quiz", lang: "fr", count: 8, topic: "Quiz de culture générale sur l'espace et le système solaire, pour une classe de lycée" },
      { style: "mixed", lang: "en", count: 8, topic: "Kickoff of our yearly sales conference, 120 people, we launch a new CRM and want to hear their priorities" },
      { style: "poll", lang: "fr", count: 5, topic: "Retour des équipes sur le télétravail et l'organisation des bureaux" },
      { style: "icebreaker", lang: "en", count: 5, topic: "First meeting of a new product team, mixed remote and office" },
      { style: "feedback", lang: "en", count: 5, topic: "Feedback on a two-day leadership training" },
    ];
    for (const r of runs) {
      const res = await call("/api/ai/generate", { method: "POST", body: { ...r, tone: "friendly" } });
      const qs = res.data?.questions ?? [];
      live.push({ ...r, status: res.status, data: res.data });
      const ks = qs.map((q) => (q.type === "choice" && q.correct !== undefined ? "quiz" : q.type === "rank" && q.ordered ? "order" : q.type));
      console.log(`  ${r.style} ${r.lang} ${r.count}: ${res.status} "${res.data?.title ?? res.data?.error}" [${ks.join(", ")}]`);
      ok(res.status === 200 && qs.length >= Math.ceil(r.count / 2), `${r.style} ${r.lang}: ${qs.length} of ${r.count} questions`);
      ok(!ks.some((k) => ["spot", "contact", "link", "media"].includes(k)), `${r.style} ${r.lang}: no image, contact, link or video`);
      ok(!/[–—]/.test(JSON.stringify(res.data ?? {})), `${r.style} ${r.lang}: no dash in the generated text`);
      const { error } = await saveAll(qs, res.data?.title || "AI");
      ok(!error, `${r.style} ${r.lang}: the result saves${error ? ` (${error})` : ""}`);
      for (const q of qs) {
        if (q.type === "fill") ok(q.fillMode === "words" && /\[/.test(q.fill), `fill "${q.fill}" (${(q.decoys ?? []).join(" | ")})`);
        if (q.type === "match") ok(q.options.length >= 4 && q.options.length <= 12, `match ${q.options.length / 2} pairs`);
        if (q.type === "rank" && q.ordered) ok(new Set(q.options).size >= 3, `order "${q.question}": ${q.options.join(" > ")}`);
        if (q.type === "match") console.log(`    "${q.question}": ${q.options.slice(0, q.options.length / 2).map((l, k) => `${l} = ${q.options[q.options.length / 2 + k]}`).join(", ")}`);
        if (q.type === "choice" && q.correct !== undefined) console.log(`    quiz "${q.question}": ${q.options[q.correct]}`);
        if (q.type === "number" && r.style === "quiz") ok(Number.isFinite(q.answer), `number "${q.question}" = ${q.answer}`);
      }
      if (r.style === "quiz") ok(new Set(ks).size >= 3 && ks.every((k) => ["quiz", "number", "order", "fill", "match"].includes(k)), `quiz ${r.lang}: ${new Set(ks).size} distinct knowledge checks`);
    }
    console.log(`  local neurons spent: ${spent() - start}`);
    writeFileSync(join(out, "live.json"), JSON.stringify(live, null, 2));
    console.log(`  answers kept in ${join(out, "live.json")}`);
  }
} catch (err) {
  ok(false, `crashed: ${err instanceof Error ? err.message : err}`);
} finally {
  if (cookie) ok((await call("/api/account", { method: "DELETE", body: { confirm: "DELETE" } })).status === 200, "throwaway account deleted");
}
finish();

function finish() {
  console.log(failures ? `\n${failures} check(s) failed` : "\nAll AI kinds checks passed");
  process.exit(failures ? 1 : 0);
}
