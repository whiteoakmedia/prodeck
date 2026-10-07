/**
 * The one shape a ProDeck feedback submission may take, checked field by
 * field. Pure (no Worker APIs) so the app's test suite can run it.
 *
 * The endpoint is public and every install knows its address, so everything
 * here is bounded: text lengths, the screenshot's size and type, and a
 * honeypot field a person never sees but a form-filling bot fills in.
 */

export type Kind = "bug" | "feature";

export interface Submission {
  kind: Kind;
  title: string;
  details: string;
  /** Bug: what the person expected instead. Feature: what it would let them do. */
  expected: string;
  /** Bug: "service" | "workaround" | "minor". Feature: "need" | "nice". */
  urgency: string;
  email: string;
  name: string;
  church: string;
  app: { version: string; os: string; arch: string; console: string; web: boolean; page: string };
  diagnostics: string;
  screenshot: { name: string; type: string; data: string } | null;
}

export const LIMITS = {
  title: 140,
  details: 8000,
  expected: 4000,
  short: 120,
  diagnostics: 200_000,
  /** Base64 characters, about 4 MB of image. */
  screenshot: 5_600_000,
};

const URGENCY: Record<Kind, string[]> = {
  bug: ["service", "workaround", "minor"],
  feature: ["need", "nice"],
};

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

export const looksLikeEmail = (s: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.trim());

const str = (v: unknown, max: number): string =>
  typeof v === "string" ? v.replace(/\u0000/g, "").trim().slice(0, max) : "";

export type Checked = { ok: true; value: Submission } | { ok: false; error: string; spam?: boolean };

export function checkSubmission(body: unknown): Checked {
  if (!body || typeof body !== "object") return { ok: false, error: "Nothing was sent." };
  const b = body as Record<string, unknown>;

  // A real form never fills this in.
  if (typeof b.website === "string" && b.website.trim()) return { ok: false, error: "Not accepted.", spam: true };

  const kind = b.kind === "bug" || b.kind === "feature" ? b.kind : null;
  if (!kind) return { ok: false, error: "Choose a bug report or a feature request." };

  const title = str(b.title, LIMITS.title);
  const details = str(b.details, LIMITS.details);
  if (!title) return { ok: false, error: "Add a short title." };
  if (details.length < 10) return { ok: false, error: "Add a few more words about it." };

  const email = str(b.email, LIMITS.short);
  if (email && !looksLikeEmail(email)) return { ok: false, error: "That email address doesn't look right." };

  const urgency = typeof b.urgency === "string" && URGENCY[kind].includes(b.urgency) ? b.urgency : URGENCY[kind][URGENCY[kind].length - 1];

  const a = (b.app && typeof b.app === "object" ? b.app : {}) as Record<string, unknown>;
  const app = {
    version: str(a.version, 40),
    os: str(a.os, 80),
    arch: str(a.arch, 20),
    console: str(a.console, 40),
    web: a.web === true,
    page: str(a.page, 80),
  };

  let screenshot: Submission["screenshot"] = null;
  if (b.screenshot && typeof b.screenshot === "object") {
    const s = b.screenshot as Record<string, unknown>;
    const type = str(s.type, 40);
    const data = typeof s.data === "string" ? s.data : "";
    if (!IMAGE_TYPES.includes(type)) return { ok: false, error: "The picture has to be a PNG, JPEG, WebP or GIF." };
    if (data.length > LIMITS.screenshot) return { ok: false, error: "The picture is too big. Keep it under 4 MB." };
    if (!/^[A-Za-z0-9+/]+=*$/.test(data)) return { ok: false, error: "The picture didn't come through. Try attaching it again." };
    screenshot = { name: str(s.name, 100).replace(/[^\w.\- ]/g, "_") || "screenshot", type, data };
  }

  return {
    ok: true,
    value: {
      kind,
      title,
      details,
      expected: str(b.expected, LIMITS.expected),
      urgency,
      email,
      name: str(b.name, LIMITS.short),
      church: str(b.church, LIMITS.short),
      app,
      diagnostics: typeof b.diagnostics === "string" ? b.diagnostics.slice(0, LIMITS.diagnostics) : "",
      screenshot,
    },
  };
}

const URGENCY_TEXT: Record<string, string> = {
  service: "Stopped or could stop a service",
  workaround: "Has a workaround",
  minor: "Minor",
  need: "We need this",
  nice: "Nice to have",
};

/** The email, as plain text (also the source of the HTML version). */
export function emailText(s: Submission, id: string): { subject: string; text: string } {
  const label = s.kind === "bug" ? "Bug" : "Feature request";
  const subject = `[ProDeck ${s.kind === "bug" ? "bug" : "idea"}] ${s.title}`;
  const who = [s.name, s.church].filter(Boolean).join(", ") || "Not given";
  const lines = [
    `${label}: ${s.title}`,
    "",
    s.kind === "bug" ? "What happened:" : "The idea:",
    s.details,
    "",
    ...(s.expected ? [s.kind === "bug" ? "What they expected:" : "What it would let them do:", s.expected, ""] : []),
    `How much it matters: ${URGENCY_TEXT[s.urgency] ?? s.urgency}`,
    `From: ${who}`,
    `Reply to: ${s.email || "No email given"}`,
    "",
    `ProDeck ${s.app.version || "?"} on ${s.app.os || "?"} ${s.app.arch}`.trim(),
    ...(s.app.console ? [`Console: ${s.app.console}`] : []),
    ...(s.app.page ? [`Page: ${s.app.page}`] : []),
    ...(s.app.web ? ["Sent from a phone or browser connected to the booth"] : []),
    ...(s.diagnostics ? ["Diagnostics attached (passwords and keys removed)."] : []),
    ...(s.screenshot ? ["Picture attached."] : []),
    "",
    `Reference: ${id}`,
  ];
  return { subject, text: lines.join("\n") };
}
