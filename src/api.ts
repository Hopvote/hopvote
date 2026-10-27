import { useEffect, useState } from "react";
import { appLang, translate } from "./app-i18n";

// `teamRole` says whether they lead their own team or joined someone else's.
export type User = { id: string; email: string; name: string; plan: string; ownPlan?: string; teamRole?: "owner" | "member" | null };

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: init.body ? { "content-type": "application/json" } : undefined,
    body: init.body ? JSON.stringify(init.body) : undefined,
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => ({}));
  // Server messages are written in English: shown in the app's language when a translation exists.
  if (!res.ok) throw new ApiError(serverMessage((data as { error?: string }).error ?? "No connection"), data as Record<string, unknown>);
  return data as T;
}

// A message naming a question (Add at least 2 options to "Lunch?") is looked up with the name set aside, then put back.
function serverMessage(text: string) {
  const lang = appLang();
  const named = /"(.*)"/s.exec(text);
  if (named) {
    const template = text.replace(named[0], '"{q}"');
    const out = translate(lang, template);
    if (out !== template) return out.replace("{q}", named[1]);
  }
  return translate(lang, text);
}

// A refused request, with what the server said besides the message (its `code`, for instance).
export class ApiError extends Error {
  constructor(
    message: string,
    readonly data: Record<string, unknown>,
  ) {
    super(message);
  }
}

// Tiny shared store for the signed-in user.
let current: User | null | undefined;
const listeners = new Set<(u: User | null | undefined) => void>();

export function setUser(user: User | null) {
  current = user;
  listeners.forEach((l) => l(user));
}

let loading: Promise<void> | null = null;
function loadUser() {
  loading ??= api<{ user: User | null }>("/api/me").then(
    (d) => setUser(d.user),
    () => setUser(null),
  );
  return loading;
}

// undefined while loading, null when signed out.
export function useUser() {
  const [user, set] = useState(current);
  useEffect(() => {
    listeners.add(set);
    if (current === undefined) loadUser();
    return () => void listeners.delete(set);
  }, []);
  return user;
}

// Signed out on this device even if the server can't be reached. Presenter keys go too:
// on a shared computer, the next person must not be able to drive the presentations.
export async function signOut() {
  try {
    await api("/api/auth/logout", { method: "POST" });
  } catch {
    // The session ends on its own; this device forgets it now.
  }
  try {
    for (const key of Object.keys(localStorage)) if (key.startsWith("hopvote:host:")) localStorage.removeItem(key);
  } catch {
    // Storage blocked: nothing was kept.
  }
  setUser(null);
}

// Names from Google can arrive as "alex." : trim stray punctuation and capitalize for display.
export function displayName(name: string) {
  const clean = name.trim().replace(/[.,;:!?]+$/, "").trim();
  return clean ? clean[0].toLocaleUpperCase() + clean.slice(1) : name;
}
