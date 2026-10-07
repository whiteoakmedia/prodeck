// "Report a bug" and "Request a feature", sent from inside ProDeck.
//
// Submissions go to White Oak Media's feedback Worker (feedback-edge/), which
// keeps a copy and emails it to Zach. Nothing goes to GitHub, so a church can
// describe its setup without publishing it. The Worker checks every field
// again; the limits here only save a round trip.

import { checkSubmission, LIMITS, type Kind } from "../../feedback-edge/src/validate";

export const FEEDBACK_URL = "https://prodeck-feedback.taplink-edge.workers.dev/submit";
export type { Kind };
export { LIMITS };

/** Remembered on this computer so nobody types their name and email twice. */
const CONTACT_KEY = "prodeck.feedbackContact";

export interface Contact {
  name: string;
  church: string;
  email: string;
}

export function loadContact(store: Pick<Storage, "getItem"> = localStorage): Contact {
  try {
    const j = JSON.parse(store.getItem(CONTACT_KEY) || "{}");
    return { name: String(j.name ?? ""), church: String(j.church ?? ""), email: String(j.email ?? "") };
  } catch {
    return { name: "", church: "", email: "" };
  }
}

export function saveContact(c: Contact, store: Pick<Storage, "setItem"> = localStorage): void {
  try {
    store.setItem(CONTACT_KEY, JSON.stringify(c));
  } catch {
    /* private mode: they type it again next time */
  }
}

export interface Draft {
  kind: Kind;
  title: string;
  details: string;
  expected: string;
  urgency: string;
  contact: Contact;
  app: { version: string; os: string; arch: string; console: string; web: boolean; page: string };
  diagnostics: string;
  screenshot: { name: string; type: string; data: string } | null;
}

/** Read an attached picture as base64, refusing what the Worker would refuse. */
export async function readPicture(file: File): Promise<{ name: string; type: string; data: string }> {
  if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type)) {
    throw new Error("Attach a PNG, JPEG, WebP or GIF picture.");
  }
  if (file.size > 4 * 1024 * 1024) throw new Error("That picture is over 4 MB. Try a smaller screenshot.");
  const buf = new Uint8Array(await file.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return { name: file.name || "screenshot.png", type: file.type, data: btoa(bin) };
}

/** The body the Worker expects. */
export function toPayload(d: Draft): Record<string, unknown> {
  return {
    kind: d.kind,
    title: d.title,
    details: d.details,
    expected: d.expected,
    urgency: d.urgency,
    name: d.contact.name,
    church: d.contact.church,
    email: d.contact.email,
    app: d.app,
    diagnostics: d.diagnostics,
    screenshot: d.screenshot,
  };
}

/** The first problem with a draft, worded for the person filling it in, or null. */
export function problemWith(d: Draft): string | null {
  const c = checkSubmission(toPayload(d));
  return c.ok ? null : c.error;
}

/** Send it. Resolves to the reference id; rejects with a message to show. */
export async function submitFeedback(d: Draft, fetchImpl: typeof fetch = fetch): Promise<string> {
  const problem = problemWith(d);
  if (problem) throw new Error(problem);
  let res: Response;
  try {
    res = await fetchImpl(FEEDBACK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(toPayload(d)),
    });
  } catch {
    throw new Error("Couldn't reach White Oak Media just now. Check the internet connection and try again. Your words are still here.");
  }
  const j = (await res.json().catch(() => ({}))) as { ok?: boolean; id?: string; error?: string };
  if (!res.ok || !j.ok) throw new Error(j.error || "That didn't go through. Try again in a minute.");
  return j.id ?? "";
}

/** Ask the feedback form to open from anywhere (sidebar, Help, the crash screen). */
export interface OpenRequest {
  kind: Kind;
  title?: string;
  details?: string;
}
export const OPEN_EVENT = "prodeck:feedback";
export function openFeedback(req: OpenRequest): void {
  window.dispatchEvent(new CustomEvent<OpenRequest>(OPEN_EVENT, { detail: req }));
}
