import { useEffect, useRef, useState } from "react";

// window.prompt / window.confirm are silent no-ops in the desktop webview —
// wry implements none of the WKUIDelegate JavaScript-dialog handlers on macOS,
// so prompt() always returns null and confirm() always returns false. Every
// rename/delete flow built on them dead-ended on the booth Mac. These are
// drop-in async replacements backed by a small in-app modal, used on web too
// so both builds behave identically.

type Ask =
  | { kind: "text"; title: string; initial: string; resolve: (v: string | null) => void }
  | { kind: "confirm"; title: string; okLabel: string; resolve: (v: boolean) => void };

let push: ((a: Ask) => void) | null = null;

// Ask for a line of text. Resolves the entered string, or null on cancel —
// same contract as window.prompt.
export function askText(title: string, initial = ""): Promise<string | null> {
  return new Promise((resolve) => {
    if (push) push({ kind: "text", title, initial, resolve });
    else resolve(null); // host not mounted (shouldn't happen) — behave like cancel
  });
}

// Ask a yes/no question. Resolves true only on explicit confirm.
export function askConfirm(title: string, okLabel = "OK"): Promise<boolean> {
  return new Promise((resolve) => {
    if (push) push({ kind: "confirm", title, okLabel, resolve });
    else resolve(false);
  });
}

// Mounted once in the Shell. Renders the current dialog (queued if several
// arrive) above everything else.
export function DialogHost() {
  const [queue, setQueue] = useState<Ask[]>([]);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const cur = queue[0] ?? null;

  useEffect(() => {
    push = (a) => setQueue((q) => [...q, a]);
    return () => {
      push = null;
    };
  }, []);

  // Seed the draft + focus when a text dialog surfaces.
  useEffect(() => {
    if (cur?.kind === "text") {
      setDraft(cur.initial);
      // Focus after paint; select so typing replaces the old name.
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [cur]);

  // Escape cancels whichever dialog is up (confirm has no input to key off).
  useEffect(() => {
    if (!cur) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancel();
      if (e.key === "Enter" && cur.kind === "confirm") ok();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur]);

  if (!cur) return null;

  const settle = (fn: () => void) => {
    fn();
    setQueue((q) => q.slice(1));
  };
  const cancel = () =>
    settle(() => (cur.kind === "text" ? cur.resolve(null) : cur.resolve(false)));
  const ok = () =>
    settle(() => (cur.kind === "text" ? cur.resolve(draft) : cur.resolve(true)));

  return (
    <div className="dlg-backdrop" onMouseDown={cancel}>
      <div className="dlg" onMouseDown={(e) => e.stopPropagation()}>
        <div className="dlg-title">{cur.title}</div>
        {cur.kind === "text" && (
          <input
            ref={inputRef}
            className="input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") ok();
            }}
          />
        )}
        <div className="dlg-actions">
          <button className="btn small ghost" onClick={cancel}>
            Cancel
          </button>
          <button className="btn small primary" onClick={ok}>
            {cur.kind === "confirm" ? cur.okLabel : "OK"}
          </button>
        </div>
      </div>
    </div>
  );
}
