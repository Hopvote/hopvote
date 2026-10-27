// Settings of this copy of Hopvote, read at build time from .env (see .env.example). The worker has its own
// settings in wrangler.jsonc and .dev.vars. An empty address falls back to the one the page is served from.
const read = (value: string | undefined, fallback = "") => (value ?? "").trim() || fallback;
const origin = typeof location === "undefined" ? "" : location.origin;

// The public address, like https://polls.example.com: shown on example screens and in their QR codes.
export const PUBLIC_URL = read(import.meta.env.VITE_PUBLIC_URL, origin).replace(/\/+$/, "");
export const SITE_HOST = PUBLIC_URL.replace(/^https?:\/\//, "") || "localhost";
// The help page's contact address. Empty: the help page shows no contact.
export const CONTACT_EMAIL = read(import.meta.env.VITE_CONTACT_EMAIL);
// Where users can get the source code of this copy (the AGPL asks for it when you change the code). Shown on the
// help page; empty hides it.
export const SOURCE_URL = read(import.meta.env.VITE_SOURCE_URL);
