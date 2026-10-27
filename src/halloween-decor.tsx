// The Halloween decor of a presentation (src/decor.ts), drawn with the Halloween page's drawings (src/halloween-art.tsx).
// Big screen (src/pages/Present.tsx, the waiting screen included): a night sky with stars, the moon and bats in the top
// bar's empty middle, carved pumpkins in the bottom left corner. Everything sits behind the screen's content and never
// moves it; each piece goes only where nothing is drawn (text, buttons, cards, bars, pictures), else it stays hidden.
// Phones (src/pages/Vote.tsx): a pumpkin next to the logo and two small bats in the header.
// Styles: src/halloween-decor.css. Every animation is off with prefers-reduced-motion.
import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { Bat, Moon, Pumpkin, Stars } from "./halloween-art";
import "./halloween-decor.css";

type Box = { left: number; top: number; right: number; bottom: number };
const box = (r: DOMRect | Box): Box => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
const grow = (b: Box, x: number, y = x): Box => ({ left: b.left - x, top: b.top - y, right: b.right + x, bottom: b.bottom + y });
const cut = (a: Box, b: Box): Box | null => {
  const r = { left: Math.max(a.left, b.left), top: Math.max(a.top, b.top), right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom) };
  return r.right > r.left && r.bottom > r.top ? r : null;
};
const hits = (a: Box, list: Box[]) => list.some((b) => cut(a, b));
const inside = (a: Box, b: Box) => a.left >= b.left - 1 && a.right <= b.right + 1 && a.top >= b.top - 1 && a.bottom <= b.bottom + 1;

// Drawn as a whole: its box counts and what it holds is not read.
const SOLID = new Set(["BUTTON", "A", "IMG", "svg", "CANVAS", "VIDEO", "IFRAME", "INPUT", "SELECT", "TEXTAREA"]);

// Everything visible on the screen, as boxes: each line of text, each control, picture or drawing, and each block with
// a background of its own (cards, bars, chips). Clipped by the scrolling or clipping blocks that hold them.
export function contentBoxes(root: Element, skip: Element | null): Box[] {
  const out: Box[] = [];
  const area = (b: Box) => (b.right - b.left) * (b.bottom - b.top);
  const rootBox = box(root.getBoundingClientRect());
  const big = area(rootBox) * 0.4;
  const range = document.createRange();
  const walk = (el: Element, clip: Box) => {
    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE) {
        if (!node.textContent?.trim()) continue;
        range.selectNodeContents(node);
        for (const r of Array.from(range.getClientRects())) {
          const b = cut(box(r), clip);
          if (b) out.push(b);
        }
        continue;
      }
      if (node.nodeType !== Node.ELEMENT_NODE || node === skip) continue;
      const child = node as Element;
      const cs = getComputedStyle(child);
      if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) continue;
      const r = box(child.getBoundingClientRect());
      if (SOLID.has(child.tagName)) {
        const b = cut(r, clip);
        if (b && area(b) < big) out.push(b);
        continue;
      }
      const painted = (!/rgba\(.*, 0\)$|transparent/.test(cs.backgroundColor) && cs.backgroundColor !== "") || cs.backgroundImage !== "none";
      if (painted) {
        const b = cut(r, clip);
        if (b && area(b) < big) out.push(b);
      }
      const clips = cs.overflowX !== "visible" || cs.overflowY !== "visible";
      const next = clips ? cut(clip, r) : clip;
      if (next) walk(child, next);
    }
  };
  walk(root, rootBox);
  return out;
}

// The ink of a drawing piece, without the transparent margins of its picture: the pumpkins' bodies and stems,
// the moon's disc, a bat's box with the room it flies in.
export function inkBoxes(piece: Element): Box[] {
  if (piece.classList.contains("hwd-moon")) {
    const r = piece.getBoundingClientRect();
    const k = 0.25;
    return [{ left: r.left + r.width * k, top: r.top + r.height * k, right: r.right - r.width * k, bottom: r.bottom - r.height * k }];
  }
  const r = box(piece.getBoundingClientRect());
  // A bat flies up to 35% of its width each way (src/halloween-decor.css, hwd-fly).
  if (piece.classList.contains("hwd-bat")) return [grow(r, (r.right - r.left) * 0.36, 6)];
  const parts = Array.from(piece.querySelectorAll(".hw-body, .hw-stem")).map((el) => box(el.getBoundingClientRect()));
  return (parts.length ? parts : [r]).filter((b) => b.right > b.left && b.bottom > b.top);
}

// Places the pieces of the scene on the free parts of the screen, again whenever the screen changes.
function usePlacement(sceneRef: React.RefObject<HTMLDivElement | null>) {
  useLayoutEffect(() => {
    const scene = sceneRef.current;
    const main = scene?.parentElement;
    if (!scene || !main) return;
    const place = () => {
      const frame = box(main.getBoundingClientRect());
      const taken = contentBoxes(main, scene).map((b) => grow(b, 10, 5));
      const free = (piece: Element) => inkBoxes(piece).every((b) => inside(b, frame) && !hits(b, taken));
      const show = (piece: HTMLElement, on: boolean) => {
        piece.classList.toggle("is-off", !on);
        if (on) taken.push(...inkBoxes(piece).map((b) => grow(b, 8)));
      };
      // The moon and the bats: the middle of the top bar, a little to the right, else a little to the left.
      const moon = scene.querySelector<HTMLElement>(".hwd-moon");
      if (moon) {
        let spot = "";
        for (const x of ["56%", "46%", "66%", "36%"]) {
          scene.style.setProperty("--hwd-x", x);
          if (free(moon)) {
            spot = x;
            break;
          }
        }
        if (!spot) scene.style.setProperty("--hwd-x", "56%");
        show(moon, !!spot);
        for (const bat of Array.from(scene.querySelectorAll<HTMLElement>(".hwd-bat"))) {
          bat.classList.remove("is-off");
          show(bat, free(bat));
        }
      }
      // The pumpkins: on the footer's line in the bottom left corner, else down in the footer's row; the smaller ones go
      // first when the corner is short of room.
      const foot = main.querySelector(".present-foot")?.getBoundingClientRect();
      const floors = [foot ? frame.bottom - foot.top : null, 4].filter((v): v is number => v !== null);
      for (const patch of Array.from(scene.querySelectorAll<HTMLElement>(".hwd-patch"))) {
        const pumpkins = Array.from(patch.children) as HTMLElement[];
        let placed = false;
        for (const keep of [pumpkins.length, 1]) {
          pumpkins.forEach((p) => p.classList.toggle("is-gone", keep === 1 && !p.classList.contains("is-main")));
          for (const floor of floors) {
            patch.style.bottom = `${floor}px`;
            patch.classList.remove("is-off");
            if (free(patch)) {
              placed = true;
              break;
            }
          }
          if (placed) break;
        }
        show(patch, placed);
      }
    };
    // At most every 400 ms while votes come in, and once more when the screen's own entrance animations are done.
    let timer = 0;
    let last = 0;
    const later = () => {
      if (timer) return;
      const wait = Math.max(0, 400 - (Date.now() - last));
      timer = window.setTimeout(() => {
        timer = 0;
        last = Date.now();
        place();
      }, wait);
    };
    place();
    last = Date.now();
    const settle = [700, 1600].map((ms) => window.setTimeout(place, ms));
    const resize = new ResizeObserver(later);
    resize.observe(main);
    const changes = new MutationObserver((list) => {
      if (list.some((m) => !scene.contains(m.target))) later();
    });
    changes.observe(main, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["class", "style"] });
    document.fonts?.ready.then(later);
    return () => {
      window.clearTimeout(timer);
      settle.forEach((id) => window.clearTimeout(id));
      resize.disconnect();
      changes.disconnect();
    };
  }, [sceneRef]);
}

// The big screen's night: put as the first child of the screen's <main> (which gets the class decor-halloween).
export function HalloweenScene() {
  const ref = useRef<HTMLDivElement>(null);
  usePlacement(ref);
  return (
    <div className="hwd-scene" ref={ref} aria-hidden>
      <Stars className="hwd-stars" />
      <div className="hwd-piece hwd-moon"><Moon /></div>
      <Flying className="hwd-b1" />
      <Flying className="hwd-b2" />
      <Flying className="hwd-b3" />
      <div className="hwd-patch is-left">
        <Pumpkin shape="wide" className="hwd-p1" />
        <Pumpkin shape="round" face lit className="hwd-p2 is-main" />
        <Pumpkin shape="squat" className="hwd-p3" />
      </div>
    </div>
  );
}

// A bat that drifts slowly around its spot and beats its wings.
function Flying({ className }: { className: string }) {
  return (
    <div className={`hwd-piece hwd-bat ${className}`}>
      <span className="hwd-fly">
        <Bat />
      </span>
    </div>
  );
}

// Phones: the logo with a small carved pumpkin beside it, and two bats in the header's free middle.
export function PhoneMark({ children }: { children: ReactNode }) {
  return (
    <span className="hwd-mark">
      {children}
      <Pumpkin shape="round" face lit className="hwd-mark-pumpkin" />
    </span>
  );
}
export function PhoneBats() {
  return (
    <span className="hwd-phone-bats" aria-hidden>
      <span className="hwd-fly"><Bat /></span>
      <span className="hwd-fly"><Bat /></span>
    </span>
  );
}

// Phones: the whole page at night while the decor is on (the class on <body>).
export function useBodyDecor(on: boolean) {
  useEffect(() => {
    if (!on) return;
    document.body.classList.add("decor-halloween");
    return () => document.body.classList.remove("decor-halloween");
  }, [on]);
}
