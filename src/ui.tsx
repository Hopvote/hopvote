import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { navigate } from "./router";
import { useAppT } from "./app-i18n";
// Wordmark: ink follows currentColor, the check follows --accent.
export function Wordmark({ bounce = false, className = "" }: { bounce?: boolean; className?: string }) {
  return (
    <svg className={`wordmark ${bounce ? "bounce" : ""} ${className}`} viewBox="-28 -20 568 168" role="img" aria-label="hopvote">
      <g fill="none" stroke="currentColor" strokeWidth="18" strokeLinecap="round" strokeLinejoin="round">
        <ellipse className="wm-shadow" cx="44" cy="116" rx="21" ry="4" fill="currentColor" stroke="none" opacity=".2" />
        <g className="wm-waves" strokeWidth="4">
          <path d="M-7 -11c-5 5-6 13-2 19" />
          <path d="M-16 -16c-8 8-9 20-3 29" />
        </g>
        <g className="wm-h">
          <path d="M22 100V8" />
          <path d="M22 68c0-18 11-28 25-28s25 10 25 26v34" />
        </g>
        <circle cx="127" cy="70" r="30" />
        <path d="M183 42v90" />
        <circle cx="213" cy="70" r="30" />
        <path d="M268 68l17 29 33-65" stroke="var(--accent)" />
        <circle cx="364" cy="70" r="30" />
        <path d="M420 16v66c0 12 6 18 18 18" />
        <path d="M404 42h32" />
        <path d="M458 70h60a30 30 0 1 0-8.8 21.2" />
      </g>
    </svg>
  );
}

export function Logo({ bounce = false, to = "/" }: { bounce?: boolean; to?: string }) {
  return (
    <Link to={to} className="logo">
      <Wordmark bounce={bounce} />
    </Link>
  );
}

export function Results({ options, counts, mine }: { options: string[]; counts: number[]; mine?: number }) {
  const total = counts.reduce((a, b) => a + b, 0);
  const max = Math.max(1, ...counts);
  return (
    <ol className="results">
      {options.map((label, i) => {
        const pct = total ? Math.round((counts[i] / total) * 100) : 0;
        return (
          <li key={i} className={[mine === i && "mine", total > 0 && counts[i] === max && "win"].filter(Boolean).join(" ")}>
            <div className="result-label">
              <span className="truncate">{label}</span>
              <strong>{pct}%</strong>
            </div>
            <div className="bar">
              <div style={{ width: `${(counts[i] / max) * 100}%` }} />
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function Message({ title, text, children, back }: { title: string; text?: string; children?: React.ReactNode; back?: string }) {
  const t = useAppT();
  return (
    <main className="page narrow center">
      <Logo />
      <h1 className="title">{title}</h1>
      {text && <p className="muted">{text}</p>}
      {children}
      <Link to="/" className="ghost button">{back ?? t("Back to home")}</Link>
    </main>
  );
}

// In-app link: keeps the page loaded instead of a full reload.
export function Link({ to, className, title, label, children }: { to: string; className?: string; title?: string; label?: string; children: React.ReactNode }) {
  return (
    <a
      href={to}
      className={className}
      title={title}
      aria-label={label}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}

// Password field with an eye to show what was typed.
export function PasswordInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const t = useAppT();
  const [shown, setShown] = useState(false);
  return (
    <span className="pw">
      <input {...props} type={shown ? "text" : "password"} autoCapitalize="off" autoCorrect="off" spellCheck={false} />
      <button type="button" className="pw-eye" onClick={() => setShown(!shown)} aria-label={shown ? t("Hide password") : t("Show password")} aria-pressed={shown}>
        {shown ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>
    </span>
  );
}
