// Video and audio a question can play: a link to YouTube, Vimeo, SoundCloud, Spotify or Google Drive,
// or to a video or audio file. Shared by the builder, the big screen, the phones and the room (which refuses other links).
export type MediaKind = "youtube" | "vimeo" | "soundcloud" | "spotify" | "drive" | "video" | "audio";
// `src`: what the player loads. `audio`: no picture, a shorter player.
export type Media = { kind: MediaKind; src: string; label: string; audio: boolean };

const VIDEO_FILE = /\.(mp4|m4v|webm|ogv|mov)$/i;
const AUDIO_FILE = /\.(mp3|m4a|wav|ogg|oga|aac|flac|opus)$/i;

// "1m30s", "90", "90s" or "1h2m3s" in seconds.
function seconds(raw: string | null) {
  if (!raw) return 0;
  if (/^\d+$/.test(raw)) return Number(raw);
  const m = raw.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) : 0;
}

function youtube(url: URL) {
  const host = url.hostname.replace(/^(www|m|music)\./, "");
  let id = "";
  if (host === "youtu.be") id = url.pathname.slice(1).split("/")[0];
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    id = url.searchParams.get("v") ?? url.pathname.match(/^\/(?:shorts|embed|live|v)\/([^/?#]+)/)?.[1] ?? "";
  }
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return null;
  const start = seconds(url.searchParams.get("t") ?? url.searchParams.get("start"));
  return `https://www.youtube-nocookie.com/embed/${id}?rel=0&playsinline=1${start ? `&start=${start}` : ""}`;
}

export function mediaOf(raw: string): Media | null {
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.replace(/^www\./, "");
  const yt = youtube(url);
  if (yt) return { kind: "youtube", src: yt, label: "YouTube", audio: false };
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    // vimeo.com/123, vimeo.com/channels/x/123, vimeo.com/123/hash (unlisted), player.vimeo.com/video/123
    const parts = url.pathname.split("/").filter(Boolean);
    const at = parts.findIndex((p) => /^\d{5,}$/.test(p));
    if (at < 0) return null;
    const hash = url.searchParams.get("h") ?? (parts[at + 1] && /^[a-f0-9]{6,}$/i.test(parts[at + 1]) ? parts[at + 1] : "");
    return { kind: "vimeo", src: `https://player.vimeo.com/video/${parts[at]}${hash ? `?h=${hash}` : ""}`, label: "Vimeo", audio: false };
  }
  if (host === "soundcloud.com" || host === "on.soundcloud.com") {
    if (url.pathname.split("/").filter(Boolean).length < 1) return null;
    const page = `https://${url.hostname}${url.pathname}`;
    return { kind: "soundcloud", src: `https://w.soundcloud.com/player/?url=${encodeURIComponent(page)}&color=%23ff5436&visual=true&show_comments=false`, label: "SoundCloud", audio: true };
  }
  if (host === "open.spotify.com") {
    const m = url.pathname.match(/^\/(?:intl-[a-z-]+\/)?(track|episode|album|playlist|show)\/([A-Za-z0-9]+)/);
    if (!m) return null;
    return { kind: "spotify", src: `https://open.spotify.com/embed/${m[1]}/${m[2]}`, label: "Spotify", audio: true };
  }
  if (host === "drive.google.com") {
    const id = url.pathname.match(/^\/file\/d\/([A-Za-z0-9_-]+)/)?.[1] ?? url.searchParams.get("id");
    if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) return null;
    return { kind: "drive", src: `https://drive.google.com/file/d/${id}/preview`, label: "Google Drive", audio: false };
  }
  if (VIDEO_FILE.test(url.pathname)) return { kind: "video", src: url.toString(), label: "Video", audio: false };
  if (AUDIO_FILE.test(url.pathname)) return { kind: "audio", src: url.toString(), label: "Audio", audio: true };
  return null;
}
