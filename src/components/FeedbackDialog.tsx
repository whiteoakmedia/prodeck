import { useEffect, useRef, useState } from "react";
import {
  type Contact,
  type Draft,
  type Kind,
  type OpenRequest,
  OPEN_EVENT,
  LIMITS,
  loadContact,
  problemWith,
  readPicture,
  saveContact,
  submitFeedback,
} from "../lib/feedback";
import { IS_WEB, diagBundle } from "../lib/tauri";

declare const __APP_VERSION__: string;

// "Report a bug" / "Request a feature": a form inside ProDeck that lands in
// Zach's inbox. Opened from the sidebar, the Help page, Settings → Help &
// support, and the crash screen (see openFeedback in lib/feedback).

const URGENCY: Record<Kind, { id: string; label: string }[]> = {
  bug: [
    { id: "service", label: "It stopped a service, or could" },
    { id: "workaround", label: "I can work around it" },
    { id: "minor", label: "Small thing" },
  ],
  feature: [
    { id: "need", label: "We really need this" },
    { id: "nice", label: "Nice to have" },
  ],
};

const COPY: Record<Kind, { heading: string; title: string; titleHint: string; details: string; detailsHint: string; expected: string; expectedHint: string }> = {
  bug: {
    heading: "Report a bug",
    title: "In a few words, what went wrong?",
    titleHint: "Lyrics stopped following on the second song",
    details: "What happened, and what were you doing just before?",
    detailsHint: "Steps help most: which page, what you pressed, what you saw.",
    expected: "What did you expect instead? (optional)",
    expectedHint: "",
  },
  feature: {
    heading: "Request a feature",
    title: "What would you like ProDeck to do?",
    titleHint: "Show the next song's key on the stage display",
    details: "Tell me about it",
    detailsHint: "What's the problem it solves on a Sunday? How do you handle it today?",
    expected: "Anything else that would help? (optional)",
    expectedHint: "Other apps that do it well, your setup, screenshots of how you picture it.",
  },
};

function systemFacts(): { os: string; arch: string } {
  const ua = navigator.userAgent;
  const os = /Windows/.test(ua) ? "Windows" : /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "macOS" : "Unknown";
  return { os, arch: "" };
}

export function FeedbackDialog({
  initial,
  page,
  console: deskName,
  onClose,
}: {
  initial: OpenRequest;
  page?: string;
  console?: string;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<Kind>(initial.kind);
  const [title, setTitle] = useState(initial.title ?? "");
  const [details, setDetails] = useState(initial.details ?? "");
  const [expected, setExpected] = useState("");
  const [urgency, setUrgency] = useState("");
  const [contact, setContact] = useState<Contact>(() => loadContact());
  const [withDiag, setWithDiag] = useState(!IS_WEB);
  const [picture, setPicture] = useState<Draft["screenshot"]>(null);
  const [pictureErr, setPictureErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [sentId, setSentId] = useState<string | null>(null);
  const [showDiag, setShowDiag] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const copy = COPY[kind];

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose, busy]);

  const urgencyNow = URGENCY[kind].some((u) => u.id === urgency) ? urgency : "";

  async function diagnostics(): Promise<string> {
    try {
      return await diagBundle({ web: IS_WEB, page: page ?? "", from: "feedback" });
    } catch {
      return "";
    }
  }

  async function send() {
    setErr("");
    const sys = systemFacts();
    const draft: Draft = {
      kind,
      title,
      details,
      expected,
      urgency: urgencyNow || URGENCY[kind][URGENCY[kind].length - 1].id,
      contact,
      app: { version: __APP_VERSION__, os: sys.os, arch: sys.arch, console: deskName ?? "", web: IS_WEB, page: page ?? "" },
      diagnostics: "",
      screenshot: picture,
    };
    const problem = problemWith(draft);
    if (problem) {
      setErr(problem);
      return;
    }
    setBusy(true);
    try {
      if (withDiag) {
        draft.diagnostics = await diagnostics();
        try {
          const j = JSON.parse(draft.diagnostics);
          const s = j?.system;
          if (s?.os) draft.app.os = `${s.os} ${s.version ?? ""}`.trim();
          if (s?.arch) draft.app.arch = s.arch;
          if (j?.prodeck?.version) draft.app.version = j.prodeck.version;
        } catch {
          /* the bundle is optional; the form still goes */
        }
      }
      saveContact(contact);
      setSentId(await submitFeedback(draft));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onPicture(f: File | undefined) {
    setPictureErr("");
    if (!f) return;
    try {
      setPicture(await readPicture(f));
    } catch (e) {
      setPicture(null);
      setPictureErr(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="wz-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="fb" role="dialog" aria-modal="true" aria-label={copy.heading}>
        <div className="legal-head">
          <div className="fb-tabs" role="tablist">
            {(["bug", "feature"] as Kind[]).map((k) => (
              <button
                key={k}
                role="tab"
                id={`fb-tab-${k}`}
                aria-selected={kind === k}
                className={`fb-tab ${kind === k ? "on" : ""}`}
                disabled={!!sentId}
                onClick={() => setKind(k)}
              >
                {COPY[k].heading}
              </button>
            ))}
          </div>
          <button className="btn small ghost" onClick={onClose} disabled={busy}>
            Close
          </button>
        </div>

        {sentId !== null ? (
          <div className="fb-body fb-done">
            <h3>{kind === "bug" ? "Thanks, that's on its way." : "Thanks for the idea."}</h3>
            <p>
              It went straight to Zach at White Oak Media, who reads every one.
              {contact.email ? ` If he has a question he'll write to ${contact.email}.` : " You didn't leave an email, so he can't reply, but it still counts."}
            </p>
            {sentId && <p className="muted small">Reference {sentId}</p>}
            <div className="fb-actions">
              <button className="btn primary" onClick={onClose}>Done</button>
            </div>
          </div>
        ) : (
          <div className="fb-body">
            <label className="field wide">
              <span>{copy.title}</span>
              <input
                id="fb-title"
                className="input"
                maxLength={LIMITS.title}
                placeholder={copy.titleHint}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                autoFocus
              />
            </label>
            <label className="field wide">
              <span>{copy.details}</span>
              <textarea
                id="fb-details"
                className="input"
                rows={5}
                maxLength={LIMITS.details}
                placeholder={copy.detailsHint}
                value={details}
                onChange={(e) => setDetails(e.target.value)}
              />
            </label>
            <label className="field wide">
              <span>{copy.expected}</span>
              <textarea
                id="fb-expected"
                className="input"
                rows={2}
                maxLength={LIMITS.expected}
                placeholder={copy.expectedHint}
                value={expected}
                onChange={(e) => setExpected(e.target.value)}
              />
            </label>

            <fieldset className="fb-urgency">
              <legend>How much does it matter?</legend>
              {URGENCY[kind].map((u) => (
                <label key={u.id} className={`fb-chip ${urgencyNow === u.id ? "on" : ""}`}>
                  <input type="radio" name="fb-urgency" id={`fb-urgency-${u.id}`} checked={urgencyNow === u.id} onChange={() => setUrgency(u.id)} />
                  {u.label}
                </label>
              ))}
            </fieldset>

            <div className="fb-attach">
              <button className="btn small" type="button" onClick={() => fileRef.current?.click()}>
                {picture ? "Change picture" : "Attach a screenshot"}
              </button>
              <input ref={fileRef} id="fb-picture" type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => onPicture(e.target.files?.[0])} />
              {picture && (
                <span className="muted small">
                  {picture.name}{" "}
                  <button className="link-btn" type="button" onClick={() => setPicture(null)}>Remove</button>
                </span>
              )}
              {pictureErr && <span className="error small">{pictureErr}</span>}
            </div>

            <div className="fb-contact">
              <label className="field">
                <span>Your name</span>
                <input id="fb-name" className="input" maxLength={LIMITS.short} value={contact.name} onChange={(e) => setContact({ ...contact, name: e.target.value })} />
              </label>
              <label className="field">
                <span>Church</span>
                <input id="fb-church" className="input" maxLength={LIMITS.short} value={contact.church} onChange={(e) => setContact({ ...contact, church: e.target.value })} />
              </label>
              <label className="field">
                <span>Email, if you'd like a reply</span>
                <input id="fb-email" className="input" type="email" maxLength={LIMITS.short} value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} />
              </label>
            </div>

            <label className="field check">
              <input type="checkbox" id="fb-diag" checked={withDiag} onChange={(e) => setWithDiag(e.target.checked)} />
              <span>
                Include diagnostics: ProDeck's version, this computer's system, which connections are up, settings with every password and key removed, and the last few minutes of the log.{" "}
                <button
                  className="link-btn"
                  type="button"
                  onClick={async () => setShowDiag(showDiag === null ? (await diagnostics()) || "Diagnostics aren't available from this screen." : null)}
                >
                  {showDiag === null ? "See exactly what's sent" : "Hide"}
                </button>
              </span>
            </label>
            {showDiag !== null && <pre className="fb-diag">{showDiag}</pre>}

            <p className="muted small">
              This goes privately to White Oak Media, not to a public page. Your name and email are saved on this computer for next time.
            </p>
            {err && <p className="error small">{err}</p>}
            <div className="fb-actions">
              <button className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
              <button className="btn primary" onClick={send} disabled={busy || !title.trim() || !details.trim()}>
                {busy ? "Sending…" : kind === "bug" ? "Send report" : "Send idea"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Mounted once in the app: opens the form whenever openFeedback() is called. */
export function FeedbackHost({ page, console: deskName }: { page?: string; console?: string }) {
  const [req, setReq] = useState<OpenRequest | null>(null);
  useEffect(() => {
    const on = (e: Event) => setReq((e as CustomEvent<OpenRequest>).detail);
    window.addEventListener(OPEN_EVENT, on);
    return () => window.removeEventListener(OPEN_EVENT, on);
  }, []);
  if (!req) return null;
  return <FeedbackDialog key={JSON.stringify(req)} initial={req} page={page} console={deskName} onClose={() => setReq(null)} />;
}
