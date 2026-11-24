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
    { id: "service", label: "Detuvo un evento o podría hacerlo" },
    { id: "workaround", label: "Puedo resolverlo de otra manera" },
    { id: "minor", label: "Es un detalle menor" },
  ],
  feature: [
    { id: "need", label: "Realmente lo necesitamos" },
    { id: "nice", label: "Sería útil" },
  ],
};

const COPY: Record<Kind, { heading: string; title: string; titleHint: string; details: string; detailsHint: string; expected: string; expectedHint: string }> = {
  bug: {
    heading: "Reportar un error",
    title: "En pocas palabras, ¿qué salió mal?",
    titleHint: "La letra dejó de avanzar en la segunda canción",
    details: "¿Qué pasó y qué estabas haciendo justo antes?",
    detailsHint: "Lo más útil son los pasos: en qué página estabas, qué presionaste y qué viste.",
    expected: "¿Qué esperabas que pasara? (opcional)",
    expectedHint: "",
  },
  feature: {
    heading: "Proponer una función",
    title: "¿Qué te gustaría que hiciera ProDeck?",
    titleHint: "Mostrar la tonalidad de la siguiente canción en la pantalla del escenario",
    details: "Cuéntame más",
    detailsHint: "¿Qué problema resuelve durante un evento? ¿Cómo lo resuelves hoy?",
    expected: "¿Algo más que pueda ayudar? (opcional)",
    expectedHint: "Otras aplicaciones que lo hagan bien, tu configuración o capturas de cómo lo imaginas.",
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
            Cerrar
          </button>
        </div>

        {sentId !== null ? (
          <div className="fb-body fb-done">
            <h3>{kind === "bug" ? "Gracias, tu reporte está en camino." : "Gracias por la idea."}</h3>
            <p>
              Se envió directamente a Zach de White Oak Media, quien lee todos los mensajes.
              {contact.email ? ` Si tiene alguna pregunta, te escribirá a ${contact.email}.` : " No dejaste un correo, así que no podrá responderte, pero tu mensaje cuenta."}
            </p>
            {sentId && <p className="muted small">Referencia {sentId}</p>}
            <div className="fb-actions">
              <button className="btn primary" onClick={onClose}>Listo</button>
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
              <legend>¿Qué tan importante es?</legend>
              {URGENCY[kind].map((u) => (
                <label key={u.id} className={`fb-chip ${urgencyNow === u.id ? "on" : ""}`}>
                  <input type="radio" name="fb-urgency" id={`fb-urgency-${u.id}`} checked={urgencyNow === u.id} onChange={() => setUrgency(u.id)} />
                  {u.label}
                </label>
              ))}
            </fieldset>

            <div className="fb-attach">
              <button className="btn small" type="button" onClick={() => fileRef.current?.click()}>
                {picture ? "Cambiar imagen" : "Adjuntar una captura de pantalla"}
              </button>
              <input ref={fileRef} id="fb-picture" type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => onPicture(e.target.files?.[0])} />
              {picture && (
                <span className="muted small">
                  {picture.name}{" "}
                  <button className="link-btn" type="button" onClick={() => setPicture(null)}>Quitar</button>
                </span>
              )}
              {pictureErr && <span className="error small">{pictureErr}</span>}
            </div>

            <div className="fb-contact">
              <label className="field">
                <span>Tu nombre</span>
                <input id="fb-name" className="input" maxLength={LIMITS.short} value={contact.name} onChange={(e) => setContact({ ...contact, name: e.target.value })} />
              </label>
              <label className="field">
                <span>Iglesia</span>
                <input id="fb-church" className="input" maxLength={LIMITS.short} value={contact.church} onChange={(e) => setContact({ ...contact, church: e.target.value })} />
              </label>
              <label className="field">
                <span>Correo electrónico, si quieres una respuesta</span>
                <input id="fb-email" className="input" type="email" maxLength={LIMITS.short} value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} />
              </label>
            </div>

            <label className="field check">
              <input type="checkbox" id="fb-diag" checked={withDiag} onChange={(e) => setWithDiag(e.target.checked)} />
              <span>
                Incluir diagnóstico: la versión de ProDeck, el sistema de esta computadora, las conexiones activas, la configuración sin contraseñas ni claves y los últimos minutos del registro.{" "}
                <button
                  className="link-btn"
                  type="button"
                  onClick={async () => setShowDiag(showDiag === null ? (await diagnostics()) || "El diagnóstico no está disponible en esta pantalla." : null)}
                >
                  {showDiag === null ? "Ver exactamente qué se envía" : "Ocultar"}
                </button>
              </span>
            </label>
            {showDiag !== null && <pre className="fb-diag">{showDiag}</pre>}

            <p className="muted small">
              Esto se envía de forma privada a White Oak Media, no a una página pública. Tu nombre y correo se guardan en esta computadora para la próxima vez.
            </p>
            {err && <p className="error small">{err}</p>}
            <div className="fb-actions">
              <button className="btn ghost" onClick={onClose} disabled={busy}>Cancelar</button>
              <button className="btn primary" onClick={send} disabled={busy || !title.trim() || !details.trim()}>
                {busy ? "Enviando…" : kind === "bug" ? "Enviar reporte" : "Enviar idea"}
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
