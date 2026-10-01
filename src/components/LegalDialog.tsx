import { useEffect, useState } from "react";
import privacyText from "../../docs/PRIVACY.md?raw";
import { Markdown } from "../lib/markdown";

// Settings → About: the privacy notice and the third-party licence notices,
// readable offline inside the app (the notices file ships with it).

export type LegalKind = "privacy" | "licences";

export function LegalDialog({ kind, onClose }: { kind: LegalKind; onClose: () => void }) {
  const [notices, setNotices] = useState<string | null>(null);
  useEffect(() => {
    if (kind !== "licences") return;
    fetch("/THIRD_PARTY_NOTICES.txt")
      .then((r) => (r.ok ? r.text() : Promise.reject(r.status)))
      .then(setNotices)
      .catch(() => setNotices("The notices file is missing from this build. It's at github.com/whiteoakmedia/prodeck/blob/master/public/THIRD_PARTY_NOTICES.txt"));
  }, [kind]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  return (
    <div className="wz-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="legal" role="dialog" aria-modal="true" aria-label={kind === "privacy" ? "Privacy" : "Licences"}>
        <div className="legal-head">
          <h3>{kind === "privacy" ? "Privacy" : "Licences and trademarks"}</h3>
          <button className="btn small ghost" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="legal-body">
          {kind === "privacy" ? (
            <div className="legal-md">
              <Markdown text={privacyText} />
            </div>
          ) : (
            <pre className="legal-pre">{notices ?? "Loading…"}</pre>
          )}
        </div>
      </div>
    </div>
  );
}
