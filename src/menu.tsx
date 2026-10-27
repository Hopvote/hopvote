// A small popover anchored to its trigger. Closes on outside click and Escape.
import { useEffect, useRef, useState } from "react";

export function Popover({
  trigger,
  children,
  align = "left",
  className = "",
}: {
  trigger: (open: boolean, toggle: () => void) => React.ReactNode;
  children: (close: () => void) => React.ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    addEventListener("mousedown", away);
    addEventListener("keydown", esc);
    return () => {
      removeEventListener("mousedown", away);
      removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div className={`pop ${className}`} ref={box}>
      {trigger(open, () => setOpen((o) => !o))}
      {open && (
        <div className={`pop-menu ${align}`} role="menu">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
