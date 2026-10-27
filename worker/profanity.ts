// Obvious insults in English and French. A post that matches starts hidden: the presenter sees it greyed and can show it.
const WORDS = [
  "fuck", "fucking", "fucker", "shit", "bullshit", "bitch", "asshole", "dick", "cunt", "bastard", "slut", "whore", "faggot", "nigger", "retard",
  "merde", "putain", "pute", "salope", "connard", "connasse", "encule", "enculer", "batard", "fdp", "ntm", "nique", "niquer", "pd", "bite", "couille", "couilles",
];

const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    // Common disguises: sh1t, @ss (masked letters such as f*ck: see isRudeName).
    .replace(/[@4]/g, "a")
    .replace(/[1!|]/g, "i")
    .replace(/0/g, "o")
    .replace(/[$5]/g, "s")
    .replace(/[^a-z]+/g, " ");

const SET = new Set(WORDS);

export function isProfane(text: string): boolean {
  return fold(text)
    .split(" ")
    .some((w) => w && SET.has(w));
}

// First names go on the big screen, where the presenter cannot read every one before the room does: stricter than posts.
// A name is read the way the room reads it (nameKey): invisible characters dropped, look-alike letters (Cyrillic, Greek,
// small capitals, letters in squares) as Latin. Then a word that starts like an insult counts ("fucks", "shitty"), so do
// masked letters ("f*ck"), repeated ones ("fuuuck"), and words spaced or dotted out ("f u c k", "fu ck"). Real names that
// are also words of the post list (Dick, PD as initials) or start like one (Slutsky, Niggli, Bastardo, Salopek,
// De Cock) still show.
const LOOKALIKE: Record<string, string> = {
  а: "a", е: "e", о: "o", р: "p", с: "c", у: "y", х: "x", і: "i", ї: "i", к: "k", м: "m", т: "t", н: "h", в: "b", ѕ: "s", ј: "j",
  һ: "h", ь: "b", ԁ: "d", ѡ: "w", ս: "u", α: "a", ε: "e", ο: "o", ρ: "p", τ: "t", υ: "u", κ: "k", ν: "v", ι: "i",
  ɑ: "a", ʃ: "s", ƒ: "f", ı: "i", ł: "l", ø: "o", "。": ".",
  ᴀ: "a", ʙ: "b", ᴄ: "c", ᴅ: "d", ᴇ: "e", ꜰ: "f", ɢ: "g", ʜ: "h", ɪ: "i", ᴊ: "j", ᴋ: "k", ʟ: "l", ᴍ: "m", ɴ: "n", ᴏ: "o", ᴘ: "p", ʀ: "r", ꜱ: "s", ᴛ: "t", ᴜ: "u", ᴠ: "v", ᴡ: "w", ʏ: "y", ᴢ: "z",
};
// Letters in circles and squares that NFKC leaves as they are (negative circled and squared, regional indicators).
const BOXED: [number, number][] = [[0x1f150, 0x1f169], [0x1f170, 0x1f189], [0x1f1e6, 0x1f1ff]];
const INVISIBLE = /[\p{Cf}\p{Mn}\p{Me}\u115f\u1160\u3164\uffa0]/gu;

export function nameKey(name: string): string {
  return [...name.normalize("NFKC").replace(INVISIBLE, "").toLowerCase()]
    .map((c) => {
      const code = c.codePointAt(0)!;
      const box = BOXED.find(([from, to]) => code >= from && code <= to);
      return box ? String.fromCharCode(97 + code - box[0]) : (LOOKALIKE[c] ?? c);
    })
    .join("");
}

// Inside any word: no real name holds them (Fučík reads fucik).
const INSIDE = ["fuck", "bitch", "whore", "faggot", "nigger", "asshole"];
// At the start of a word only (Scunthorpe, Dikshit).
const STEMS = ["cunt", "nigga", "dickhead", "putain", "connard", "connass", "conass", "encul", "enkul"];
// Whole words only: they start real names (Shital, Slutsky, Bastardo, Cockburn, Couillard).
const NAME_WORDS = new Set([
  ...WORDS.filter((w) => w !== "dick" && w !== "pd"),
  "shits", "shitty", "shithead", "shitheads", "shitface", "shithole", "dipshit", "shite", "dickface", "cocksucker", "cocksuckers",
  "pussy", "pussies", "wanker", "wankers", "twat", "twats", "nazi", "nazis", "hitler", "penis", "boobs",
  "slut", "sluts", "slutty", "slutz", "bastards", "retards", "retarded", "fck", "phuck", "phuk", "fvck", "stfu", "kys", "fag", "fags",
  "biatch", "dumbass", "jackass", "arsehole", "tosser", "bollocks", "kunt",
  "bites", "putes", "batards", "batarde", "batardes", "batar", "salopes", "connards", "conard", "conards", "konnard", "conasse", "conasses",
  "conne", "connes", "merdes", "merdeux", "couillon", "pede", "pedes", "pedale", "tapette", "gouine", "negres", "bougnoule", "petasse",
  "pouffiasse", "enfoire", "salaud", "branleur", "niktamer",
]);
// Two or three words that read as one (joke names quiz players type).
const PHRASES = new Set(["mikehunt", "bendover", "hughjass", "mikeoxlong", "dickhead", "bigdick", "asshole", "groscon", "tagueule", "trouducul"]);
// Spelled out in short pieces ("f u c k", "fu ck", "f.d.p").
const SPELLED = ["fuck", "cunt", "nigg", "fagg", "whore", "bitch", "asshole", "shit", "dick", "salope", "connard", "encul", "putain", "pute", "fdp", "ntm"];

const rudeWord = (w: string) => NAME_WORDS.has(w) || INSIDE.some((s) => w.includes(s)) || STEMS.some((s) => w.startsWith(s));
// Forms a masked word may stand for: every listed word, and the stems with their usual endings.
const MASKABLE = [...NAME_WORDS, ...INSIDE, ...STEMS, ...SPELLED].flatMap((w) => [w, ...["s", "er", "ers", "ing", "ed", "y", "es", "e"].map((e) => w + e)]);

export function isRudeName(name: string): boolean {
  // Digits and signs read as letters, here only: "Table 3" spells nothing.
  const latin = nameKey(name).replace(/3/g, "e").replace(/7/g, "t").replace(/8/g, "b").replace(/€/g, "e");
  const words = fold(latin).split(" ").filter(Boolean);
  if (words.some((w) => rudeWord(w) || rudeWord(w.replace(/(.)\1{2,}/g, "$1")))) return true;
  for (let i = 0; i < words.length; i++) {
    if (PHRASES.has(words[i] + (words[i + 1] ?? "")) || PHRASES.has(words[i] + (words[i + 1] ?? "") + (words[i + 2] ?? ""))) return true;
  }
  // Masked letters: "f*ck", "f**k", "sh*t". No real name holds a star between letters (stars around one are decoration).
  for (const token of latin.normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/\s+/)) {
    const mask = token.replace(/[@4]/g, "a").replace(/[1!|]/g, "i").replace(/0/g, "o").replace(/[$5]/g, "s").replace(/[^a-z*]/g, "").replace(/^\*+|\*+$/g, "");
    if (!/[a-z]\*+[a-z]/.test(mask)) continue;
    const re = new RegExp(`^${mask.replace(/\*+/g, "[a-z]{1,3}")}$`);
    if (MASKABLE.some((w) => re.test(w))) return true;
  }
  // Runs of short pieces read as one word; pieces inside real words never join up.
  let run = "";
  let pieces = 0;
  for (const w of [...words, ""]) {
    if (w && w.length <= 2) {
      run += w;
      pieces++;
      continue;
    }
    if (pieces > 1 && (SPELLED.some((s) => run.includes(s)) || NAME_WORDS.has(run))) return true;
    run = "";
    pieces = 0;
  }
  return false;
}
