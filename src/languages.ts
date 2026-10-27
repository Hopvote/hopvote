// Languages phones can show, shared by the app and the server: code, name in the language itself, name in English.
export const LANGUAGE_LIST: [code: string, native: string, english: string][] = [
  ["fr", "Français", "French"],
  ["en", "English", "English"],
  ["es", "Español", "Spanish"],
  ["de", "Deutsch", "German"],
  ["it", "Italiano", "Italian"],
  ["pt", "Português", "Portuguese"],
  ["nl", "Nederlands", "Dutch"],
  ["pl", "Polski", "Polish"],
  ["ro", "Română", "Romanian"],
  ["hu", "Magyar", "Hungarian"],
  ["cs", "Čeština", "Czech"],
  ["sk", "Slovenčina", "Slovak"],
  ["sl", "Slovenščina", "Slovenian"],
  ["hr", "Hrvatski", "Croatian"],
  ["bg", "Български", "Bulgarian"],
  ["el", "Ελληνικά", "Greek"],
  ["sv", "Svenska", "Swedish"],
  ["da", "Dansk", "Danish"],
  ["nb", "Norsk", "Norwegian"],
  ["fi", "Suomi", "Finnish"],
  ["et", "Eesti", "Estonian"],
  ["lv", "Latviešu", "Latvian"],
  ["lt", "Lietuvių", "Lithuanian"],
  ["tr", "Türkçe", "Turkish"],
  ["ru", "Русский", "Russian"],
  ["uk", "Українська", "Ukrainian"],
  ["ar", "العربية", "Arabic"],
  ["he", "עברית", "Hebrew"],
  ["hi", "हिन्दी", "Hindi"],
  ["id", "Bahasa Indonesia", "Indonesian"],
  ["vi", "Tiếng Việt", "Vietnamese"],
  ["th", "ไทย", "Thai"],
  ["zh", "中文", "Simplified Chinese"],
  ["ja", "日本語", "Japanese"],
  ["ko", "한국어", "Korean"],
];

export const LANG_CODES = LANGUAGE_LIST.map(([code]) => code);
export const ENGLISH_NAME: Record<string, string> = Object.fromEntries(LANGUAGE_LIST.map(([code, , english]) => [code, english]));
// Written right to left.
export const RTL = ["ar", "he"];
// Older codes some phones still report.
export const LANG_ALIASES: Record<string, string> = { no: "nb", nn: "nb", iw: "he", in: "id" };
