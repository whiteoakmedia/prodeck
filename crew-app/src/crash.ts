// Crash and error reports from the app's own screens (finding the booth,
// saved churches, notifications) to White Oak Media (Sentry). The crew
// screens a church's booth serves report through the booth's own setup
// (src/lib/crashReports.ts) and follow that booth's "Send crash reports".
//
// Nothing that identifies the church or a person leaves the phone: addresses
// and booth names are blanked, and network and console breadcrumbs (which
// carry the booth's address) are dropped.

import * as Sentry from "@sentry/browser";
import { keepBreadcrumb, scrubEvent, scrubText } from "./scrub";

/** Same project as the booth app, through the same Worker, which church
 *  content filters let through when they block sentry.io itself. */
const DSN = "https://79aebd1fda6a14652e119fabfa555f91@prodeck-feedback.taplink-edge.workers.dev/4512215209869312";

declare const __CREW_VERSION__: string;

let started = false;

export function initCrash(): void {
  if (started || import.meta.env.DEV) return;
  started = true;
  Sentry.init({
    dsn: DSN,
    release: `prodeck-crew@${__CREW_VERSION__}`,
    environment: "production",
    dataCollection: { userInfo: false, cookies: false, httpHeaders: false, urlQueryParams: false },
    tracesSampleRate: 0,
    // Console lines can quote addresses; BrowserSession pings skip beforeSend.
    integrations: (defaults) => defaults.filter((i) => i.name !== "Console" && i.name !== "BrowserSession"),
    beforeSend: (e) => scrubEvent(e),
    beforeBreadcrumb: (b) => keepBreadcrumb(b),
  });
  Sentry.setTag("side", "crew-shell");
}

/** Add the platform and store build number once the app knows them. */
export function tagCrash(tags: Record<string, string>): void {
  if (started) Sentry.setTags(tags);
}

/** An error the screen already handled, kept so it can still be fixed. */
export function captureError(e: unknown): void {
  if (started) Sentry.captureException(e);
}

/**
 * A search that found no booth. Not a crash, but the one failure volunteers
 * hit in the field (church Wi-Fi blocking Bonjour, guest networks), so it is
 * worth counting. The detail is counts only: "509 checked: 0 answered, ...".
 */
export function reportNoBooth(detail: string): void {
  if (!started) return;
  Sentry.captureMessage("Booth search found nothing", {
    level: "warning",
    fingerprint: ["no-booth-found"],
    extra: { detail: scrubText(detail) },
  });
}
