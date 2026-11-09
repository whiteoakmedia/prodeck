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
