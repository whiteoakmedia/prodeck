// What leaves the phone in a crash report (crash.ts). Kept free of the Sentry
// package so the booth repo's own tests can check it.

/** The parts of a Sentry event this file touches. */
export interface CrashEvent {
  user?: unknown;
  server_name?: string;
  message?: string;
  exception?: { values?: { value?: string }[] };
  request?: { url?: string };
}

export interface Crumb {
  category?: string;
  message?: string;
}

/** Blank anything that could name the church or find its booth. */
export function scrubText(s: string): string {
  return s
    // Whole links: the host goes, and so does anything after ? or # (join
    // links carry invite tokens there). The app's own address stays.
    .replace(/\b(https?|wss?|capacitor):\/\/([^\s/"'?#]+)([^\s"'?#]*)(?:[?#][^\s"']*)?/gi,
      (_m, scheme: string, host: string, path: string) =>
        `${scheme}://${/^localhost$/i.test(host) ? host : "<host>"}${path}`,
    )
    .replace(/(?<![<\w-])[\w-]+\.local\.prodeck\.live\b/gi, "<booth>.local.prodeck.live")
    .replace(/(?<![<\w-])[\w-]+\.local\b(?!\.prodeck\.live)/gi, "<booth>.local")
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "x.x.x.x");
}

export function scrubEvent<T extends CrashEvent>(e: T): T {
  delete e.user;
  delete e.server_name;
  if (e.message) e.message = scrubText(e.message);
  for (const v of e.exception?.values ?? []) {
    if (v.value) v.value = scrubText(v.value);
  }
  if (e.request) e.request = { url: e.request.url?.replace(/[?#].*$/, "") };
  return e;
}

/** Network and console crumbs quote the booth's address; clicks don't. */
export function keepBreadcrumb<B extends Crumb>(b: B): B | null {
  if (b.category === "fetch" || b.category === "xhr" || b.category === "navigation" || b.category === "console") return null;
  if (b.message) b.message = scrubText(b.message);
  return b;
}
