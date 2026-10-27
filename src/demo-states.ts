// Example rooms for the builder's pictures and the checks: each kind of question with believable answers,
// in English or French, as the big screen shows them once answered and as a phone shows them before answering.
import type { RoomState } from "./room";
import type { UiKind } from "./questions";
import { parseFill } from "./fill";
import { spinTarget } from "./wheel";
import { PUBLIC_URL } from "./site-config";

type Lang = "en" | "fr";

// A simple map of France, to tap on.
const MAP = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="900" viewBox="0 0 1000 900"><rect width="1000" height="900" fill="#cfe6f3"/><path d="M430 60 L520 95 L600 80 L690 150 L770 175 L800 260 L760 330 L790 420 L760 470 L800 560 L790 640 L700 700 L620 720 L560 760 L470 760 L400 790 L330 760 L300 690 L330 600 L320 520 L250 470 L170 420 L120 360 L160 330 L260 330 L310 270 L330 190 L380 120 Z" fill="#f4efe2" stroke="#9aa7b4" stroke-width="5" stroke-linejoin="round"/><path d="M860 700 L885 730 L880 800 L855 830 L840 790 L845 730 Z" fill="#f4efe2" stroke="#9aa7b4" stroke-width="4"/><path d="M600 320 C640 420 610 520 650 640" stroke="#8fc3e3" stroke-width="8" fill="none" stroke-linecap="round"/><path d="M420 240 C470 300 520 330 560 300" stroke="#8fc3e3" stroke-width="8" fill="none" stroke-linecap="round"/><path d="M330 500 C400 520 450 560 520 560" stroke="#8fc3e3" stroke-width="8" fill="none" stroke-linecap="round"/><circle cx="500" cy="250" r="11" fill="#2a2a40"/><text x="520" y="258" font-family="Helvetica, Arial" font-size="30" fill="#2a2a40">Paris</text><circle cx="560" cy="690" r="9" fill="#2a2a40"/><text x="578" y="698" font-family="Helvetica, Arial" font-size="26" fill="#2a2a40">Marseille</text><circle cx="340" cy="600" r="9" fill="#2a2a40"/><text x="250" y="640" font-family="Helvetica, Arial" font-size="26" fill="#2a2a40">Bordeaux</text></svg>`,
)}`;

// The same "random" numbers every time, so the pictures never change between builds.
function seeded(seed: number) {
  let s = seed;
  return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) % 10000) / 10000;
}

// Spots grouped like the room does (cells of 1% of the image): x, y and how many people, one after the other.
function spotsAround(clusters: [number, number, number, number][]) {
  const rnd = seeded(7);
  const cells = new Map<number, number>();
  for (const [cx, cy, spread, n] of clusters) {
    for (let i = 0; i < n; i++) {
      const x = Math.round(cx + (rnd() + rnd() + rnd() - 1.5) * spread);
      const y = Math.round(cy + (rnd() + rnd() + rnd() - 1.5) * spread);
      const cell = Math.min(99, Math.max(0, Math.floor(x / 10))) * 100 + Math.min(99, Math.max(0, Math.floor(y / 10)));
      cells.set(cell, (cells.get(cell) ?? 0) + 1);
    }
  }
  return [...cells].flatMap(([cell, n]) => [Math.floor(cell / 100) * 10 + 5, (cell % 100) * 10 + 5, n]);
}

function numbersAround(center: number, spread: number, n: number) {
  const rnd = seeded(11);
  return Array.from({ length: n }, () => Math.round(center + (rnd() + rnd() + rnd() - 1.5) * spread));
}

export function demoState(kind: UiKind, lang: Lang, view: "screen" | "phone"): RoomState {
  const L = <T,>(en: T, fr: T) => (lang === "fr" ? fr : en);
  const now = Date.now();
  // The big screen shows the answers (and the right one); a phone shows the question, ready to answer.
  const shown = view === "screen";
  const base: RoomState = {
    round: 1,
    title: "Hopvote",
    lang,
    index: 1,
    count: 6,
    kind: "choice",
    question: "",
    options: [],
    image: null,
    max: 5,
    labels: null,
    style: "bars",
    fields: [],
    multi: false,
    quiz: false,
    hasQuiz: false,
    hasBoard: false,
    timer: 0,
    startedAt: null,
    now,
    receivedAt: now,
    correct: null,
    revealed: false,
    counts: [],
    text: "",
    url: "",
    ordered: false,
    numbers: [],
    answer: null,
    closest: null,
    orderResults: null,
    words: [],
    answers: [],
    answered: 48,
    board: null,
    lobby: false,
    locked: false,
    names: false,
    people: [],
    online: 52,
    langs: [lang],
    launch: null,
  };
  const game = { quiz: true, hasQuiz: true, revealed: shown };
  switch (kind) {
    case "choice":
      return {
        ...base,
        question: L("What format for the June offsite?", "Quel format pour le séminaire de juin ?"),
        options: L(["Workshops in small groups", "Talks by guest speakers", "An open debate", "Outdoor activities"], ["Ateliers en petits groupes", "Conférences d'invités", "Un débat ouvert", "Activités en plein air"]),
        counts: [21, 12, 9, 6],
      };
    case "scale":
      return { ...base, kind: "scale", question: L("How was today's session?", "Comment était la séance d'aujourd'hui ?"), max: 5, counts: [1, 2, 5, 22, 18], labels: L(["Poor", "Great"], ["Décevante", "Excellente"]) as [string, string] };
    case "scales":
      return {
        ...base,
        kind: "scales",
        question: L("Your feedback on the training", "Votre avis sur la formation"),
        options: L(["I learned new things", "The explanations were clear", "The length was right", "I would recommend it"], ["J'ai appris des choses", "Les explications étaient claires", "La durée était bonne", "Je la recommanderais"]),
        max: 5,
        labels: L(["Not at all", "Completely"], ["Pas du tout", "Tout à fait"]) as [string, string],
        counts: [1, 2, 6, 20, 19, 1, 3, 8, 22, 14, 3, 9, 18, 12, 6, 1, 1, 4, 18, 24],
      };
    case "rank":
      return {
        ...base,
        kind: "rank",
        question: L("Our priorities for next year", "Nos priorités pour l'an prochain"),
        options: L(["Training", "Remote work", "Pay", "A new office"], ["Formation", "Télétravail", "Salaires", "Nouveaux locaux"]),
        counts: [118, 96, 52, 22],
      };
    case "points":
      return {
        ...base,
        kind: "points",
        question: L("Where should next year's budget go?", "Où mettre le budget de l'an prochain ?"),
        options: L(["Training", "Better tools", "Team events", "Hiring"], ["Formation", "Meilleurs outils", "Moments d'équipe", "Recrutement"]),
        counts: [1968, 1392, 864, 576],
      };
    case "words":
      return {
        ...base,
        kind: "words",
        question: L("In one word, how do you feel today?", "En un mot, comment vous sentez-vous aujourd'hui ?"),
        words: L<[string, number][]>(
          [["motivated", 14], ["curious", 10], ["focused", 8], ["inspired", 7], ["ready", 6], ["tired", 5], ["happy", 5], ["calm", 4], ["busy", 3], ["excited", 3], ["hopeful", 2], ["creative", 2], ["grateful", 2], ["relaxed", 2]],
          [["motivé", 14], ["curieux", 10], ["concentré", 8], ["inspiré", 7], ["prêt", 6], ["fatigué", 5], ["content", 5], ["serein", 4], ["débordé", 3], ["enthousiaste", 3], ["confiant", 2], ["créatif", 2], ["reconnaissant", 2], ["détendu", 2]],
        ),
      };
    case "open":
      return {
        ...base,
        kind: "open",
        question: L("One idea to improve our meetings?", "Une idée pour améliorer nos réunions ?"),
        answered: 6,
        answers: L(
          ["Start with the decisions to make", "Shorter meetings on Fridays", "Share the agenda the day before", "One person takes notes for everyone", "A stand-up format on Mondays", "Laptops closed, except for the speaker"],
          ["Commencer par les décisions à prendre", "Des réunions plus courtes le vendredi", "Envoyer l'ordre du jour la veille", "Une personne prend les notes pour tous", "Un format debout le lundi", "Ordinateurs fermés, sauf pour l'orateur"],
        ).map((text, i) => ({ id: `o${i}`, text, at: now - i * 20000 })),
      };
    case "qa":
      return {
        ...base,
        kind: "qa",
        question: L("Your questions for the speaker", "Vos questions pour l'intervenante"),
        answered: 4,
        answers: L(
          ["How do you keep a remote team motivated?", "Which tools do you use every day?", "What would you do differently today?", "How did you start?"],
          ["Comment garder une équipe à distance motivée ?", "Quels outils utilisez-vous au quotidien ?", "Que feriez-vous autrement aujourd'hui ?", "Comment avez-vous commencé ?"],
        ).map((text, i) => ({ id: `q${i}`, text, at: now - i * 30000, votes: [24, 17, 9, 12][i], done: i === 3 })),
      };
    case "wheel": {
      // Tom was picked before; this spin stopped on Sarah.
      const list = ["Léa", "Inès", "Hugo", "Sarah", "Malik", "Zoé", "Nina", "Paul", "Emma", "Yanis", "Chloé"];
      return {
        ...base,
        kind: "wheel",
        question: L("Who answers the next question?", "Qui répond à la prochaine question ?"),
        names: true,
        answered: 0,
        wheel: { list, spin: { at: now - 9000, from: 0, to: spinTarget(0, 3, list.length, 5, 0.15), win: 3, n: 2, tag: "" }, picked: ["Tom", "Sarah"] },
      };
    }
    case "quiz":
      return {
        ...base,
        ...game,
        question: L("Which planet is the largest?", "Quelle est la plus grande planète ?"),
        options: L(["Saturn", "Jupiter", "Neptune", "Uranus"], ["Saturne", "Jupiter", "Neptune", "Uranus"]),
        counts: [11, 31, 4, 2],
        correct: shown ? 1 : null,
      };
    case "number":
      return {
        ...base,
        ...game,
        kind: "number",
        question: L("When did the Eiffel Tower open?", "En quelle année la tour Eiffel a-t-elle été inaugurée ?"),
        numbers: shown ? numbersAround(1889, 60, 48) : [],
        answer: shown ? 1889 : null,
        closest: shown ? { value: 1888, name: "" } : null,
      };
    case "order":
      return {
        ...base,
        ...game,
        kind: "rank",
        ordered: true,
        question: L("From the oldest to the newest", "Du plus ancien au plus récent"),
        options: L(["Romanesque", "Gothic", "Renaissance", "Art Deco"], ["Art roman", "Gothique", "Renaissance", "Art déco"]),
        orderResults: shown ? { right: 29, placed: [41, 34, 33, 44] } : null,
      };
    case "fill": {
      const fill = parseFill(L("The capital of Australia is [Canberra] and Canada's is [Ottawa].", "La capitale de l'Australie est [Canberra] et celle du Canada est [Ottawa]."));
      return {
        ...base,
        ...game,
        kind: "fill",
        question: L("Complete the sentence", "Complétez la phrase"),
        gaps: fill.pieces,
        blanks: shown ? fill.answers : [],
        orderResults: shown ? { right: 26, placed: [39, 31] } : null,
        // Words to place: the two answers and two extra words.
        fillTop: shown ? [[["canberra", 39], ["sydney", 6], ["toronto", 2], ["ottawa", 1]], [["ottawa", 31], ["toronto", 14], ["canberra", 2], ["sydney", 1]]] : [],
        bank: ["Sydney", "Ottawa", "Toronto", "Canberra"],
      };
    }
    case "match":
      return {
        ...base,
        ...game,
        kind: "match",
        question: L("Match each country to its capital", "Associez chaque pays à sa capitale"),
        options: L(["France", "Italy", "Spain", "Germany", "Paris", "Rome", "Madrid", "Berlin"], ["France", "Italie", "Espagne", "Allemagne", "Paris", "Rome", "Madrid", "Berlin"]),
        orderResults: shown ? { right: 30, placed: [45, 40, 37, 42] } : null,
      };
    case "spot":
      return {
        ...base,
        ...game,
        kind: "spot",
        question: L("Where is Lyon on this map?", "Où est Lyon sur cette carte ?"),
        image: MAP,
        spots: shown ? spotsAround([[645, 568, 50, 36], [500, 470, 260, 12]]) : [],
        zone: shown ? [590, 520, 110, 100] : null,
        found: 36,
      };
    case "slide":
      return {
        ...base,
        kind: "slide",
        question: L("10-minute break", "Pause de 10 minutes"),
        text: L("Coffee is at the back of the room.\nWe start again at 10:45 with the quiz.", "Le café est au fond de la salle.\nOn reprend à 10 h 45 avec le quiz."),
        image: "/photos/seminar.webp",
        answered: 0,
      };
    case "link":
      return { ...base, kind: "link", question: L("Get the slides", "Récupérez le support"), url: PUBLIC_URL, answered: 23 };
    case "media":
      return { ...base, kind: "media", question: L("Watch the trailer", "Regardez la bande-annonce"), url: "https://www.youtube.com/watch?v=aqz-KE-bpKQ", answered: 0 };
    case "countdown":
      return { ...base, kind: "countdown", question: L("Group work", "Travail en groupe"), answered: 0, clock: { run: true, end: now + 287000, left: 0, total: 300000 } };
    case "contact":
      return { ...base, kind: "contact", question: L("Let's stay in touch", "Restons en contact"), fields: ["name", "email"], answered: 31 };
    case "topics": {
      // Round 1 of 3: the wheel stopped on Cinema.
      const list = L(["History", "Geography", "Cinema", "Sport"], ["Histoire", "Géographie", "Cinéma", "Sport"]);
      return {
        ...base,
        kind: "wheel",
        question: L("What will the next topic be?", "Quel sera le prochain thème ?"),
        options: list,
        answered: 0,
        wheel: { list, spin: { at: now - 9000, from: 0, to: spinTarget(0, 2, list.length, 5, 0.15), win: 2, n: 1, tag: "" }, picked: [] },
        topics: {
          list: list.map((label, i) => ({ label, n: [4, 4, 3, 4][i], done: false, scored: true })),
          how: "wheel",
          at: "picker",
          topic: null,
          chosen: 2,
          chosenHow: "wheel",
          roundNo: 1,
          of: 3,
          pos: 0,
          size: 0,
          locked: false,
          left: true,
          hasNext: true,
          hasPrev: true,
          tie: false,
          empty: false,
          pass: 1,
          order: [],
          hows: [],
        },
      };
    }
  }
}

// Variants of an example screen, for the checks and the reviews (/preview/screen/<kind>?empty=1&single=1...).
// Without any flag the example is left exactly as above.
export type DemoFlags = { empty?: boolean; single?: boolean; long?: boolean; image?: boolean; lobby?: boolean; countin?: boolean; entries?: number; spin?: boolean };

const LONG = {
  en: "Looking back at the whole quarter, which of these initiatives had the biggest positive impact on the way our teams work together every single day?",
  fr: "Avec le recul sur tout le trimestre, laquelle de ces initiatives a eu le plus d'effet positif sur la façon dont nos équipes travaillent ensemble au quotidien ?",
};
const NAMES = ["Léa", "Inès", "Hugo", "Sarah", "Malik", "Zoé", "Nina", "Paul", "Emma", "Yanis", "Chloé", "Lucas", "Jade", "Adam", "Louise", "Gabriel", "Alice", "Arthur", "Rose", "Jules", "Lina", "Maël", "Anna", "Noah", "Mia"];

export function demoVariant(state: RoomState, lang: Lang, flags: DemoFlags): RoomState {
  let s = { ...state };
  if (flags.single) s = { ...s, index: 0, count: 1 };
  if (flags.long) s = { ...s, question: LONG[lang] };
  if (flags.image) s = { ...s, image: "/photos/seminar.webp" };
  if (flags.entries !== undefined && s.kind === "wheel") {
    const n = Math.max(0, Math.min(50, flags.entries));
    const list = Array.from({ length: n }, (_, i) => (n > NAMES.length ? `${NAMES[i % NAMES.length]} ${Math.floor(i / NAMES.length) + 1}` : NAMES[i]));
    const win = Math.min(3, Math.max(0, n - 1));
    s = { ...s, wheel: { list, spin: n && flags.spin !== false ? { at: s.now - 9000, from: 0, to: spinTarget(0, win, n, 5, 0.15), win, n: 1, tag: "" } : null, picked: n && flags.spin !== false ? [list[win]] : [] } };
  } else if (flags.spin === false && s.wheel) {
    s = { ...s, wheel: { ...s.wheel, spin: null, picked: [] } };
  }
  if (flags.empty) {
    s = {
      ...s,
      answered: 0,
      counts: s.counts.map(() => 0),
      words: [],
      answers: [],
      numbers: [],
      spots: [],
      found: 0,
      orderResults: null,
      fillTop: [],
      blanks: [],
      closest: null,
      answer: null,
      correct: null,
      revealed: false,
      people: [],
      wheel: s.wheel && flags.entries === undefined ? { list: [], spin: null, picked: [] } : s.wheel,
    };
  }
  if (flags.countin) s = { ...s, quiz: true, hasQuiz: true, timer: 20, startedAt: s.now + 3_600_000, revealed: false, correct: null };
  if (flags.lobby) s = { ...s, lobby: true, title: lang === "fr" ? "Réunion d'équipe du trimestre" : "Quarterly team meeting", online: 23, answered: 0 };
  return s;
}

// Other states of topic rounds' picker, for the checks (scripts/stage-check.mjs, /preview/screen/topics?topics=...):
// "vote" (the room's vote closed on Geography), "open" (the vote under way), "long" (8 topics, the longest name chosen),
// "host" (the presenter chose on the wheel, no spin), "last" (the only topic left).
export function demoTopics(state: RoomState, lang: Lang, variant: string | null): RoomState {
  const L = <T,>(en: T, fr: T) => (lang === "fr" ? fr : en);
  const topics = state.topics;
  if (!topics || !variant) return state;
  if (variant === "host") return { ...state, wheel: state.wheel && { ...state.wheel, spin: null }, topics: { ...topics, chosenHow: "host" } };
  if (variant === "last") {
    const list = topics.list.map((x, i) => ({ ...x, done: i !== 2 }));
    return { ...state, wheel: { list: [list[2].label], spin: null, picked: [] }, topics: { ...topics, list, chosenHow: "last", roundNo: 4, of: 4, order: [0, 1, 3], hows: ["wheel", "wheel", "wheel"] } };
  }
  // The room's vote: 8 topics with a name of 40 characters (the longest allowed) chosen, or the usual 4.
  const long = variant === "long";
  const list = long
    ? L(
        ["Contemporary art and design of the world", "History", "Geography", "Cinema", "Sport", "Music", "Science", "Cooking"],
        ["Culture générale et art moderne du monde", "Histoire", "Géographie", "Cinéma", "Sport", "Musique", "Sciences", "Cuisine"],
      )
    : topics.list.map((x) => x.label);
  const chosen = variant === "open" ? null : long ? 0 : 1;
  const counts = long ? [6, 2, 1, 3, 0, 1, 2, 0] : [2, 5, 1, 0];
  return {
    ...state,
    kind: "choice",
    options: list,
    counts,
    answered: counts.reduce((a, b) => a + b, 0),
    wheel: null,
    topics: {
      ...topics,
      list: list.map((label, i) => ({ label, n: 3 + (i % 2), done: false, scored: true })),
      how: "vote",
      chosen,
      chosenHow: chosen === null ? null : "vote",
    },
  };
}
