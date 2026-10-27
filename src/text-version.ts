// A short fingerprint of the texts of one question (title, question, options, scale labels, slide text).
// The phone and the room compute the same one: a translation asked ahead of time is used only if the texts did not change since.
export function textHash(text: string) {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = (h * 33) ^ text.charCodeAt(i);
  return (h >>> 0).toString(36);
}

export const textVersion = (t: { title: string; question: string; options: string[]; labels: string[] | null; text?: string }) =>
  textHash([t.title, t.question, ...t.options, ...(t.labels ?? []), ...(t.text ? [t.text] : [])].join("\u0001"));
