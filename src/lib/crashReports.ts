// Crash and error reports from the window to White Oak Media (Sentry).
//
// The Rust side (src-tauri/src/crashreport.rs) covers panics in the app
// itself; this covers the screens. Both follow the same Settings switch,
// "Send crash reports", which is on unless a church turns it off, and both
// strip anything that identifies the church or a person before sending.

import * as Sentry from "@sentry/react";
import { IS_WEB } from "./tauri";

declare const __APP_VERSION__: string;

/** Same project as the Rust side, through the same Worker (see crashreport.rs for why). */
const OFFICIAL_DSN = "https://79aebd1fda6a14652e119fabfa555f91@prodeck-feedback.taplink-edge.workers.dev/4512215209869312";

let enabled = false;
let started = false;

export function setCrashReportsEnabled(on: boolean): void {
  enabled = on;
}

/** Query strings can carry kiosk passwords and join tokens; fragments too. */
export function stripUrl(u: string): string {
  return u.replace(/[?#].*$/, "");
}

/** Every event and breadcrumb passes through here on its way out. */
export function scrubEvent<T extends Sentry.ErrorEvent>(e: T): T | null {
  if (!enabled) return null;
  delete e.user;
  delete e.server_name;
  if (e.request) {
    e.request = { url: e.request.url ? stripUrl(e.request.url) : undefined };
  }
  for (const b of e.breadcrumbs ?? []) {
    if (b.data && typeof b.data.url === "string") b.data.url = stripUrl(b.data.url);
    if (b.data && typeof b.data.from === "string") b.data.from = stripUrl(b.data.from);
    if (b.data && typeof b.data.to === "string") b.data.to = stripUrl(b.data.to);
  }
  return e;
}

export function initCrashReports(opts: { demo: boolean; shots: boolean }): void {
  const dsn = (import.meta.env.VITE_SENTRY_DSN as string | undefined) ?? OFFICIAL_DSN;
  if (started || !dsn || import.meta.env.DEV || opts.demo || opts.shots) return;
  started = true;
  Sentry.init({
    dsn,
    release: `prodeck@${__APP_VERSION__}`,
    environment: "production",
    dataCollection: { userInfo: false, cookies: false, httpHeaders: false, urlQueryParams: false },
    tracesSampleRate: 0,
    // Left out on purpose. Console: its lines can quote plan items, names and
    // messages. BrowserSession: its start-up pings go out without passing
    // beforeSend, so they would ignore the off switch.
    integrations: (defaults) => defaults.filter((i) => i.name !== "Console" && i.name !== "BrowserSession"),
    beforeSend: (e) => scrubEvent(e),
    beforeBreadcrumb: (b) => (enabled ? b : null),
  });
  Sentry.setTag("side", IS_WEB ? "browser" : "app");
}

export function reportRenderCrash(error: Error, componentStack: string | null | undefined): void {
  if (!started || !enabled) return;
  Sentry.captureException(error, { contexts: { react: { componentStack: componentStack ?? "" } } });
}
