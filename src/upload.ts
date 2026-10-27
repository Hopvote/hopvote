import { appLang, translate } from "./app-i18n";

// Errors read in the app's language, like the rest of the dashboard.
const fail = (text: string) => new Error(translate(appLang(), text));

// Shrinks the photo in the browser so it loads fast on phones and stays small to store.
async function compress(file: File) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  for (const type of ["image/webp", "image/jpeg"]) {
    for (const quality of [0.82, 0.7, 0.55]) {
      const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, type, quality));
      if (blob && blob.size <= 1_400_000) return blob;
      // Safari cannot write WebP and hands back a PNG, which ignores the quality: JPEG instead.
      if (blob?.type !== type) break;
    }
  }
  throw fail("Image too large");
}

export async function uploadImage(file: File) {
  const blob = await compress(file);
  const res = await fetch("/api/images", {
    method: "POST",
    headers: { "content-type": blob.type },
    body: blob,
    credentials: "same-origin",
  });
  const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!res.ok) throw fail(data.error ?? "Couldn't upload the image");
  return data.url as string;
}

// Logos keep their exact pixels and transparency: only shrunk when very large.
export async function uploadLogo(file: File) {
  const body = file.size <= 1_400_000 ? file : await compress(file);
  const type = body === file ? file.type : (body as Blob).type;
  const res = await fetch("/api/images", { method: "POST", headers: { "content-type": type }, body, credentials: "same-origin" });
  const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!res.ok) throw fail(data.error ?? "Couldn't upload the logo");
  return data.url as string;
}

// Brand fonts are stored as they are.
const FONT_TYPE: Record<string, string> = { woff2: "font/woff2", woff: "font/woff", ttf: "font/ttf", otf: "font/otf" };
export async function uploadFont(file: File) {
  const type = FONT_TYPE[file.name.split(".").pop()?.toLowerCase() ?? ""];
  if (!type) throw fail("Use a .woff2, .woff, .ttf or .otf file");
  if (file.size > 1_500_000) throw fail("Font too large (1.5 MB max)");
  const res = await fetch("/api/images", { method: "POST", headers: { "content-type": type }, body: file, credentials: "same-origin" });
  const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!res.ok) throw fail(data.error ?? "Couldn't upload the font");
  return data.url as string;
}
