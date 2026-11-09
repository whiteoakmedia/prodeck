// What Apple is asked to show, per phone (pure, tested in the main repo's
// src/__tests__/pushPayload.test.ts, so no imports here).

/** The Crew app's page alert sound (crew-app public/page.caf, copied into
 *  Library/Sounds at launch). A phone without it plays the default sound. */
export const PAGE_SOUND = "page.caf";
/** Notification category the Crew app registers with a "Got it" button. */
export const PAGE_CATEGORY = "PAGE";

export interface PayloadInput {
  title: string;
  body: string;
  page: boolean;
}

/** Extra fields for one phone only: a page's own confirm link. */
export interface TargetExtras {
  ack?: unknown;
}

/** A confirm link worth passing on: an http(s) address the booth made. */
export function cleanAck(ack: unknown): string | null {
  if (typeof ack !== "string" || ack.length > 300) return null;
  return /^https?:\/\/[^\s"'<>]+\/api\/page\/ack\?k=[0-9a-f]{32}$/i.test(ack) ? ack : null;
}

export function apnsPayload(input: PayloadInput, extras?: TargetExtras): Record<string, unknown> {
  const aps: Record<string, unknown> = {
    alert: { title: input.title, body: input.body },
    sound: input.page ? PAGE_SOUND : "default",
    "thread-id": input.page ? "pages" : "crew",
    // Pages break through Focus, the way a page on a radio would.
    "interruption-level": input.page ? "time-sensitive" : "active",
  };
  if (input.page) aps.category = PAGE_CATEGORY;
  const out: Record<string, unknown> = { aps };
  const ack = input.page ? cleanAck(extras?.ack) : null;
  if (ack) out.ack = ack;
  return out;
}

/** Whether repeats of this notification should replace each other. Pages
 *  must not: a replaced notification doesn't ring or buzz again, so the
 *  booth's re-buzz went unfelt (first real test, 2026-11-09). */
export function collapses(page: boolean): boolean {
  return !page;
}

// ------------------------------------------------------------- Android (FCM)

/** Firebase tokens: letters, digits, "_", "-" and ":". */
export function cleanFcmToken(t: unknown): string | null {
  return typeof t === "string" && /^[A-Za-z0-9_:-]{32,512}$/.test(t) ? t : null;
}

/**
 * One FCM HTTP v1 message for one Android phone. Data only, never a
 * "notification" block: the app draws every one itself (crew-app android
 * PageAlerts.java), which is the only way a page gets its own channel and
 * sound, a "Got it" button, and shows while the app is open. High priority
 * so a sleeping phone wakes for it.
 */
export function fcmMessage(
  input: PayloadInput,
  token: string,
  tag: string,
  ttlSeconds: number,
  extras?: TargetExtras,
): Record<string, unknown> {
  const data: Record<string, string> = {
    kind: input.page ? "page" : "crew",
    title: input.title,
    body: input.body,
  };
  if (tag) data.tag = tag;
  const ack = input.page ? cleanAck(extras?.ack) : null;
  if (ack) data.ack = ack;
  const android: Record<string, unknown> = { priority: "HIGH", ttl: `${ttlSeconds}s` };
  // Pages never collapse (each repeat must ring); a newer chat replaces the
  // older one waiting for a phone that's offline.
  if (tag && collapses(input.page)) android.collapse_key = tag.slice(0, 64);
  return { message: { token, data, android } };
}

/** What an FCM refusal means: drop the token, or just a failed send. */
export function fcmVerdict(status: number, body: unknown): "dead" | "failed" {
  const err = (body as { error?: { status?: string; message?: string; details?: { errorCode?: string }[] } })?.error;
  const code = err?.details?.find((d) => d?.errorCode)?.errorCode ?? err?.status ?? "";
  if (status === 404 || code === "UNREGISTERED" || code === "SENDER_ID_MISMATCH") return "dead";
  // INVALID_ARGUMENT is also a bad message, so only a token Firebase says is bad.
  if (code === "INVALID_ARGUMENT" && /registration token/i.test(err?.message ?? "")) return "dead";
  return "failed";
}
