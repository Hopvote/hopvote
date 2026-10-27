// Pictures of the real big screen of each kind, taken from example answers by scripts/previews.mjs (optional, needs
// Chrome) into public/previews. Used by the app's home page, which does without them when they are missing.
import { useEffect, useRef, useState } from "react";
import type { UiKind } from "./questions";

// `name`: a page's own picture in place of the kind's (scripts/previews.mjs PAGE_SHOTS, e.g. "halloween").
export const shotSrc = (kind: UiKind, lang: "en" | "fr", phone?: boolean, name?: string) => `/previews/${lang}/${name ?? kind}${phone ? "-phone" : ""}.webp`;

// `failed` when a picture is missing, to draw the example instead (also when it failed before the page came alive).
export function useShot() {
  const ref = useRef<HTMLImageElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const img = ref.current;
    if (img?.complete && !img.naturalWidth) setFailed(true);
  }, []);
  return { ref, failed, onError: () => setFailed(true) };
}
