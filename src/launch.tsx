import { useEffect, useRef, useState } from "react";
import type { RoomState } from "./room";

// The launch animation (a presentation setting): when the presenter starts, the curtain closes over the waiting screen,
// "Here we go!" pops letter by letter with confetti, then the curtain opens on question 1. The page keeps showing the
// waiting screen until the curtain is shut, so question 1 is never seen through it. Played by the big screen and the
// phones if the start was a moment ago: a phone joining later goes straight to the question.
const SHUT = 1100;
const LENGTH = 4200;

export type Launch = { phase: "closing" | "covered"; start: number } | null;

export function useLaunch(state: RoomState | null): Launch {
  const [launch, setLaunch] = useState<Launch>(null);
  const seen = useRef<number | null>(null);
  const at = state?.launch ?? null;
  useEffect(() => {
    if (!at || seen.current === at) return;
    seen.current = at;
    // Both times come from the room's clock.
    if ((state?.now ?? Date.now()) - at > 4000) return;
    const start = performance.now();
    setLaunch({ phase: "closing", start });
    navigator.vibrate?.(120);
    const shut = setTimeout(() => setLaunch({ phase: "covered", start }), SHUT);
    const done = setTimeout(() => setLaunch(null), LENGTH);
    return () => {
      clearTimeout(shut);
      clearTimeout(done);
    };
  }, [at]);
  return launch;
}

// Drawn again when the page underneath changes (waiting screen, then question): it carries on where it was.
export function LaunchCurtain({ text, start }: { text: string; start: number }) {
  // Read once when drawn: recomputed on every render, it would push the animation forward.
  const [offset] = useState(() => Math.round(Math.min(0, start - performance.now())));
  return (
    <div className="launch" style={{ "--t0": `${offset}ms` } as React.CSSProperties} aria-live="polite">
      <i className="launch-l" />
      <i className="launch-r" />
      <span className="launch-ring" />
      <div className="launch-go">
        <strong aria-label={text}>
          {Array.from(text).map((c, i) => (
            <span key={i} style={{ "--i": i } as React.CSSProperties} aria-hidden>
              {c}
            </span>
          ))}
        </strong>
        {Array.from({ length: 40 }, (_, i) => {
          // Two bursts: 24 pieces, then 16 more a moment later; each flies out, then falls.
          const second = i >= 24;
          const angle = ((second ? i - 24 : i) / (second ? 16 : 24)) * Math.PI * 2 + (second ? 0.2 : 0);
          const reach = (second ? 30 : 20) + (i % 4) * 6;
          return (
            <b
              key={i}
              className={second ? "late" : ""}
              style={{ "--x": `${Math.cos(angle) * reach}vmin`, "--y": `${Math.sin(angle) * reach * 0.7}vmin`, "--r": `${(i % 2 ? 1 : -1) * (180 + i * 17)}deg` } as React.CSSProperties}
            />
          );
        })}
      </div>
    </div>
  );
}
