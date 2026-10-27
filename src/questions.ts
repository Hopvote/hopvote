// Question kinds as the builder shows them. A quiz is a choice question with a right answer.
import {
  ArrowLeftRight,
  ArrowUpDown,
  BarChart3,
  Clapperboard,
  Cloud,
  Coins,
  Contact,
  Crosshair,
  Gauge,
  Hash,
  Hourglass,
  ListOrdered,
  Layers,
  LoaderPinwheel,
  MessageCircleQuestion,
  MessageSquareText,
  Presentation,
  QrCode,
  SlidersHorizontal,
  TextCursorInput,
  Trophy,
  type LucideIcon,
} from "lucide-react";
import { COUNTDOWN_DEFAULT, type Zone } from "./kinds";

// "order" is a ranking with a right order to find; "topics" the question that picks the next topic of topic rounds
// (src/rounds.ts), stored as a wheel or a poll; the others match the stored type.
export type UiKind =
  | "choice" | "quiz" | "words" | "open" | "scale" | "rank" | "qa" | "contact" | "scales" | "number" | "order" | "slide" | "link"
  | "points" | "fill" | "match" | "spot" | "wheel" | "countdown" | "media" | "topics";
export type Category = "Poll" | "Engage" | "Knowledge check" | "Present" | "Collect";

export const KINDS: { id: UiKind; label: string; hint: string; icon: LucideIcon; category: Category }[] = [
  { id: "choice", category: "Poll", label: "Multiple choice", hint: "The room picks from your options.", icon: BarChart3 },
  { id: "scale", category: "Poll", label: "Rating", hint: "A score from 1 to 5 or 1 to 10, with the average.", icon: Gauge },
  { id: "scales", category: "Poll", label: "Rating scale", hint: "Several statements, each rated at once.", icon: SlidersHorizontal },
  { id: "rank", category: "Poll", label: "Ranking", hint: "Everyone puts the items in order of preference.", icon: ListOrdered },
  { id: "points", category: "Poll", label: "Prioritize", hint: "Everyone shares 100 points between the items.", icon: Coins },
  { id: "words", category: "Engage", label: "Word cloud", hint: "Everyone sends up to 3 words. The most cited grow bigger.", icon: Cloud },
  { id: "open", category: "Engage", label: "Open text", hint: "Everyone writes an answer. You can hide any of them.", icon: MessageSquareText },
  { id: "qa", category: "Engage", label: "Audience Q&A", hint: "The room asks questions and upvotes the ones to answer first.", icon: MessageCircleQuestion },
  { id: "wheel", category: "Engage", label: "Spin the wheel", hint: "Picks a name or an idea at random, on every screen at once.", icon: LoaderPinwheel },
  { id: "quiz", category: "Knowledge check", label: "Quiz", hint: "One right answer, revealed when you choose.", icon: Trophy },
  { id: "number", category: "Knowledge check", label: "Guess a number", hint: "Everyone answers with a number. With a right answer, the closest wins.", icon: Hash },
  { id: "order", category: "Knowledge check", label: "Right order", hint: "Put the items in the right order. Phones get them shuffled.", icon: ArrowUpDown },
  { id: "fill", category: "Knowledge check", label: "Fill in the blanks", hint: "A sentence with words to find. Each right blank earns points.", icon: TextCursorInput },
  { id: "match", category: "Knowledge check", label: "Match pairs", hint: "Link each item to its pair. Phones get them shuffled.", icon: ArrowLeftRight },
  { id: "spot", category: "Knowledge check", label: "Find on the image", hint: "Everyone taps a spot on your image. Mark the right zone for a game.", icon: Crosshair },
  { id: "slide", category: "Present", label: "Slide", hint: "A title, a text and an image between two questions.", icon: Presentation },
  { id: "link", category: "Present", label: "Link to scan", hint: "A big QR code to your link. Phones get a button to open it.", icon: QrCode },
  { id: "media", category: "Present", label: "Video or audio", hint: "Plays a YouTube, Vimeo or SoundCloud link, or a file, on the big screen.", icon: Clapperboard },
  { id: "countdown", category: "Present", label: "Timer", hint: "A big countdown on the screen and the phones, for a break or group work.", icon: Hourglass },
  {
    id: "contact",
    category: "Collect",
    label: "Contact details",
    hint: "People leave their details, with consent. They stay private: only you see them in the results.",
    icon: Contact,
  },
];

// Topic rounds: kept out of KINDS (the menus list KINDS); the builder adds it to its own menu.
export const TOPICS_KIND: (typeof KINDS)[number] = {
  id: "topics",
  category: "Knowledge check",
  label: "Topic rounds",
  hint: "The wheel or the room picks the topic, then its questions.",
  icon: Layers,
};

export const CATEGORIES: Category[] = ["Poll", "Engage", "Knowledge check", "Present", "Collect"];

// Kinds that hold their own picture (the image to tap) or none (wheel, timer, video): the builder hides the image field.
export const hasImageField = (kind: UiKind) => !["spot", "wheel", "countdown", "media"].includes(kind);

export const CONTACT_FIELDS = [
  { id: "name", label: "Full name" },
  { id: "email", label: "Email" },
  { id: "phone", label: "Phone" },
  { id: "company", label: "Company" },
] as const;
export type ContactField = (typeof CONTACT_FIELDS)[number]["id"];

export const TIMERS = [0, 10, 20, 30, 60];
// A time of one's own, in seconds.
export const TIMER_MIN = 5;
export const TIMER_MAX = 600;

export type Draft = {
  kind: UiKind;
  question: string;
  options: string[];
  image?: string;
  correct?: number;
  multi?: boolean;
  timer?: number;
  max?: number;
  labels?: [string, string];
  fields?: ContactField[];
  style?: ScaleStyle;
  // Slides: the text under the title. Links and videos: the address. Number: the right answer, as typed (empty for none).
  text?: string;
  url?: string;
  answer?: string;
  // Fill in the blanks: the text, answers between brackets, and whether people place words (with extra ones) or type them.
  // Match pairs: each pair. Find on the image: the right zone.
  fill?: string;
  fillMode?: "words" | "type";
  decoys?: string[];
  pairs?: [string, string][];
  zone?: Zone;
  // Timer: its length in seconds.
  duration?: number;
  // Topic rounds: who picks the topic (the wheel or the room's vote) and how many rounds to play (all when missing).
  // On a topic's question: the index of its topic in the picker's options.
  pickedBy?: "wheel" | "vote";
  rounds?: number;
  topic?: number;
};

// How a rating's results show: bars (the default), a slider, a gauge, or a dot per vote.
export type ScaleStyle = "bars" | "slider" | "gauge" | "dots";
export const SCALE_STYLES: ScaleStyle[] = ["bars", "slider", "gauge", "dots"];

// What the server stores, as sent by the builder or read back from a presentation.
export type Stored = {
  type?: "choice" | "scale" | "words" | "open" | "rank" | "qa" | "contact" | "scales" | "number" | "slide" | "link" | "points" | "fill" | "match" | "spot" | "wheel" | "countdown" | "media";
  question: string;
  options: string[];
  image?: string | null;
  correct?: number;
  multi?: boolean;
  timer?: number;
  max?: number;
  labels?: [string, string];
  fields?: ContactField[];
  style?: ScaleStyle;
  text?: string;
  url?: string;
  answer?: number;
  ordered?: boolean;
  fill?: string;
  fillMode?: "words";
  decoys?: string[];
  zone?: Zone;
  duration?: number;
  topics?: true;
  rounds?: number;
  topic?: number;
};

export const emptyDraft = (kind: UiKind = "choice"): Draft => ({
  kind,
  question: "",
  options: ["", ""],
  correct: kind === "quiz" ? 0 : undefined,
  timer: 0,
  max: 5,
  labels: ["", ""],
  fields: ["name", "email"],
  pairs: [["", ""], ["", ""], ["", ""]],
  // People place words by default; typing them is the other way.
  fillMode: "words",
  decoys: [],
  // A wheel starts empty: it then spins among the first names of the people connected.
  ...(kind === "wheel" ? { options: [] } : {}),
  // Topic rounds start with three topics to name, picked by the wheel.
  ...(kind === "topics" ? { options: ["", "", ""], pickedBy: "wheel" as const } : {}),
  duration: COUNTDOWN_DEFAULT,
});

export function toDraft(q: Stored): Draft {
  const type = q.type ?? "choice";
  const picker = q.topics === true && (type === "wheel" || type === "choice");
  const kind: UiKind = picker ? "topics" : type === "choice" && q.correct !== undefined ? "quiz" : type === "rank" && q.ordered ? "order" : type;
  return {
    kind,
    question: q.question,
    options: q.options.length || type === "wheel" ? [...q.options] : ["", ""],
    image: q.image ?? undefined,
    correct: q.correct,
    multi: q.multi,
    timer: q.timer ?? 0,
    max: q.max ?? 5,
    labels: q.labels ?? ["", ""],
    fields: q.fields ?? ["name", "email"],
    style: q.style ?? "bars",
    text: q.text ?? "",
    url: q.url ?? "",
    answer: typeof q.answer === "number" ? String(q.answer) : "",
    fill: q.fill ?? "",
    // Blanks saved before words to place existed are typed.
    fillMode: type === "fill" && q.fillMode !== "words" ? "type" : "words",
    decoys: q.decoys ?? [],
    pairs: type === "match" && q.options.length >= 4 ? q.options.slice(0, q.options.length / 2).map((left, i) => [left, q.options[q.options.length / 2 + i]] as [string, string]) : [["", ""], ["", ""], ["", ""]],
    zone: q.zone,
    duration: q.duration ?? COUNTDOWN_DEFAULT,
    ...(picker ? { pickedBy: type === "wheel" ? ("wheel" as const) : ("vote" as const), ...(q.rounds ? { rounds: q.rounds } : {}) } : {}),
    ...(q.topic !== undefined ? { topic: q.topic } : {}),
  };
}

// The right answer of a number question as typed ("1 889", "3,14"), or undefined when there is none.
export function parseNumber(text: string | undefined) {
  const clean = (text ?? "").trim().replace(/[\s\u00a0\u202f]/g, "").replace(",", ".");
  if (!clean) return undefined;
  const n = Number(clean);
  return Number.isFinite(n) ? n : undefined;
}

// A topic's question keeps its topic, whatever its kind.
export function toStored(d: Draft): Stored {
  const out = storedOf(d);
  return d.topic !== undefined && d.kind !== "topics" ? { ...out, topic: d.topic } : out;
}

function storedOf(d: Draft): Stored {
  const base = { question: d.question, options: [] as string[], image: d.image };
  if (d.kind === "topics") {
    // A wheel or a poll among the topics: an older app reads a valid wheel or poll.
    const options = d.options.map((o) => o.trim()).filter(Boolean);
    return { ...base, type: d.pickedBy === "vote" ? "choice" : "wheel", options, topics: true, ...(d.rounds ? { rounds: d.rounds } : {}) };
  }
  if (d.kind === "choice") return { ...base, type: "choice", options: d.options, multi: !!d.multi };
  if (d.kind === "quiz") return { ...base, type: "choice", options: d.options, correct: d.correct ?? 0, timer: d.timer || undefined };
  if (d.kind === "rank") return { ...base, type: "rank", options: d.options };
  if (d.kind === "order") return { ...base, type: "rank", options: d.options, ordered: true, timer: d.timer || undefined };
  if (d.kind === "scales") return { ...base, type: "scales", options: d.options, max: d.max ?? 5, labels: d.labels };
  if (d.kind === "number") {
    const answer = parseNumber(d.answer);
    return answer === undefined ? { ...base, type: "number" } : { ...base, type: "number", answer, timer: d.timer || undefined };
  }
  if (d.kind === "slide") return { ...base, type: "slide", text: d.text?.trim() || undefined };
  if (d.kind === "link") return { ...base, type: "link", url: d.url?.trim() };
  if (d.kind === "contact") return { ...base, type: "contact", fields: d.fields?.length ? d.fields : ["email"] };
  if (d.kind === "scale") return { ...base, type: "scale", max: d.max ?? 5, labels: d.labels, ...(d.style && d.style !== "bars" ? { style: d.style } : {}) };
  if (d.kind === "points") return { ...base, type: "points", options: d.options };
  if (d.kind === "fill") {
    const words = d.fillMode !== "type" ? { fillMode: "words" as const, decoys: (d.decoys ?? []).map((w) => w.trim()).filter(Boolean) } : {};
    return { ...base, type: "fill", fill: d.fill?.trim(), ...words, timer: d.timer || undefined };
  }
  if (d.kind === "match") {
    // Pairs left empty are dropped; the left items come first, then the right ones in the same order.
    const pairs = (d.pairs ?? []).filter(([a, b]) => a.trim() || b.trim());
    return { ...base, type: "match", options: [...pairs.map(([a]) => a), ...pairs.map(([, b]) => b)], timer: d.timer || undefined };
  }
  if (d.kind === "spot") return { ...base, type: "spot", ...(d.zone ? { zone: d.zone, timer: d.timer || undefined } : {}) };
  if (d.kind === "wheel") return { ...base, type: "wheel", options: d.options.map((o) => o.trim()).filter(Boolean) };
  if (d.kind === "countdown") return { ...base, type: "countdown", duration: d.duration ?? COUNTDOWN_DEFAULT };
  if (d.kind === "media") return { ...base, type: "media", url: d.url?.trim() };
  return { ...base, type: d.kind };
}

// A question changing kind keeps its text; its options fit the new kind (a wheel drops the empty ones, a list keeps two rows).
export function switchKind(d: Draft, kind: UiKind): Draft {
  const filled = d.options.filter((o) => o.trim());
  const options = kind === "wheel" ? filled : d.options.length >= 2 ? d.options : [...filled, "", ""].slice(0, Math.max(2, filled.length));
  return { ...d, kind, options, correct: kind === "quiz" ? (d.correct ?? 0) : d.correct };
}

export const kindOf = (q: Stored): UiKind => toDraft(q).kind;
export const kindLabel = (q: Stored) => [...KINDS, TOPICS_KIND].find((k) => k.id === kindOf(q))!.label;
