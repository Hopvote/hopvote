// People joining a presentation: the big screen tells them to go to this site's address and type the code, which opens
// the sign-in page (src/App.tsx Start). They type the code here and answer without an account.
import { useState } from "react";
import { useAppT } from "../app-i18n";
import { navigate } from "../router";

export function JoinCode() {
  const t = useAppT();
  const [code, setCode] = useState("");
  const [error, setError] = useState(false);
  return (
    <>
      <p className="auth-or"><span>{t("Joining a presentation?")}</span></p>
      <form
        className="join"
        style={{ justifyContent: "center" }}
        onSubmit={(e) => {
          e.preventDefault();
          const clean = code.trim().toUpperCase();
          if (/^[A-Z0-9]{5}$/.test(clean)) navigate(`/${clean}`);
          else setError(true);
        }}
      >
        <input aria-label={t("Presentation code")} aria-invalid={error} placeholder="K7M2P" maxLength={5} autoCapitalize="characters" autoComplete="off" autoCorrect="off" spellCheck={false} enterKeyHint="go" value={code} onChange={(e) => (setCode(e.target.value.toUpperCase()), setError(false))} />
        <button className="ghost">{t("Join")}</button>
      </form>
      {error && <p className="error" style={{ textAlign: "center" }}>{t("The code has 5 characters.")}</p>}
    </>
  );
}
