import { useState } from "react";
import { IS_WEB } from "../lib/tauri";
import { getChoice, setChoice, subscribe, type OptInChoice } from "../lib/releaseNotes";

/**
 * "Get release notes by email". Optional, one line, asked once per computer.
 * Hidden in the browser (phones and kiosks): only the booth computer asks.
 * `compact` drops the heading for the Settings card.
 */
export function ReleaseNotesOptIn({ compact = false }: { compact?: boolean }) {
  const [choice, setLocal] = useState<OptInChoice | null>(() => getChoice());
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  if (IS_WEB) return null;
  if (choice === "declined") return null;
  if (choice === "subscribed") {
    return msg ? <p className="hint">✓ {msg}</p> : compact ? <p className="hint">✓ Release notes come to your inbox.</p> : null;
  }

  const decide = (c: OptInChoice) => {
    setChoice(c);
    setLocal(c);
  };

  return (
    <div className="release-optin">
      {!compact && <strong>Get release notes by email</strong>}
      <span className="muted small">
        {compact ? "Get release notes by email: " : ""}About once a month, only when there's something worth telling you.
      </span>
      <form
        className="release-optin-row"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setErr("");
          try {
            const m = await subscribe(email);
            setMsg(m);
            decide("subscribed");
          } catch (x) {
            setErr((x as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <input
          className="input"
          type="email"
          placeholder="you@yourchurch.org"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-label="Email for release notes"
        />
        <button className="btn small primary" type="submit" disabled={busy || !email.trim()}>
          {busy ? "Sending…" : "Send me updates"}
        </button>
        <button className="btn small ghost" type="button" onClick={() => decide("declined")}>
          No thanks
        </button>
      </form>
      {err && <span className="release-optin-err">{err}</span>}
    </div>
  );
}
