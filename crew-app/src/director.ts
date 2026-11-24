// Director's Face ID (the booth's src/lib/directorLock.ts). A booth page
// can't reach Face ID itself, so it sends the app here with
// ?director=<one time code>&back=<booth address>; the app asks for Face ID and
// goes straight back with #crewdirector=<the same code>, or "pin" when this
// phone has no Face ID set up, or nothing when the person cancels.
// Pure, so it's tested without a phone.

import type { Church } from "./connect";

/** Only back to a booth this phone already knows, never to wherever a link says. */
export function directorBack(back: string, churches: Church[]): string | null {
  let u: URL;
  try {
    u = new URL(back);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  const origins = new Set<string>();
  for (const c of churches) {
    for (const a of [c.base, c.crew]) {
      if (!a) continue;
      try {
        origins.add(new URL(a).origin);
      } catch {
        /* a bad saved address: skip it */
      }
    }
  }
  const secureLocal = u.protocol === "https:" && /^[a-z0-9-]+\.local\.prodeck\.live$/i.test(u.hostname);
  if (!origins.has(u.origin) && !secureLocal) return null;
  u.hash = "";
  return u.toString();
}

/** Where to go after Face ID: back, with the answer in the address. */
export function directorAnswer(back: string, answer: string): string {
  return answer ? `${back}#crewdirector=${encodeURIComponent(answer)}` : back;
}

/** The one time code is short hex from the booth; anything else is ignored. */
export function directorCode(v: string | null): string {
  return v && /^[0-9a-f]{8,64}$/i.test(v) ? v : "";
}
