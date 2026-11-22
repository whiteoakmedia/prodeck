// Director mode's lock (crew app Director tab). The booth enforces who may do
// what (web.rs member_gate, the "director" grant); this lock is for the phone
// in a pocket or left on a music stand: open it once with Face ID, or the
// crew PIN where there's no Face ID, and it stays open for the service.
// Pure, so it's tested without a phone.

import { serviceWindows, type ServiceSlot } from "./serviceWindow";

export const DIRECTOR_UNTIL_KEY = "prodeck.directorUntil";
const NONCE_KEY = "prodeck.directorNonce";

/** Outside a service, an unlock lasts this long. */
export const DIRECTOR_IDLE_MS = 60 * 60 * 1000;
/** And never longer than this, whatever the plan says. */
export const DIRECTOR_MAX_MS = 4 * 60 * 60 * 1000;

/**
 * Until when an unlock at `now` holds: the end of the service window we're in
 * (or about to be in), else an hour. A rehearsal on Thursday gets its hour;
 * Sunday at 9:50 gets the whole 10:00 service.
 */
export function directorUntil(now: number, times: ServiceSlot[], planMs: number): number {
  const w = serviceWindows(times, planMs).find((x) => now >= x.start && now < x.end);
  const until = w ? w.end : now + DIRECTOR_IDLE_MS;
  return Math.min(until, now + DIRECTOR_MAX_MS);
}

export function directorOpen(until: number, now: number): boolean {
  return until > now;
}

export function readUntil(): number {
  try {
    return Number(localStorage.getItem(DIRECTOR_UNTIL_KEY)) || 0;
  } catch {
    return 0;
  }
}

export function saveUntil(until: number) {
  try {
    if (until > 0) localStorage.setItem(DIRECTOR_UNTIL_KEY, String(until));
    else localStorage.removeItem(DIRECTOR_UNTIL_KEY);
  } catch {
    /* private storage: the lock simply asks again next time */
  }
}

/** ProDeck Crew 1.5 and later can do Face ID: it says so in its user agent. */
export function appHasFaceId(ua: string = typeof navigator !== "undefined" ? navigator.userAgent : ""): boolean {
  return /\bProDeckCrew\/[\d.]+\b/.test(ua) && /\bBiometric\b/.test(ua);
}

/**
 * Face ID happens in the app's own page (the booth page can't reach it), so
 * the booth hands off and the app comes straight back with the same one time
 * code in the address. `home` is crewAppHome()'s address.
 */
export function faceIdHandoff(home: string, nonce: string, back: string): string {
  const base = home.replace(/\?.*$/, "");
  return `${base}?director=${encodeURIComponent(nonce)}&back=${encodeURIComponent(back)}`;
}

/**
 * The app's answer in the address (#crewdirector=<code>), and the rest of it.
 * "pin" means this phone can't do Face ID (none set up): ask for the PIN.
 */
export function readFaceIdReturn(hash: string, nonce: string): { ok: boolean; pin: boolean; rest: string } {
  const m = /(^#|&)crewdirector=([^&]*)/.exec(hash);
  if (!m) return { ok: false, pin: false, rest: hash };
  let rest = hash.slice(0, m.index) + hash.slice(m.index + m[0].length);
  if (m[1] === "#") rest = rest ? `#${rest.replace(/^&/, "")}` : "";
  let code = "";
  try {
    code = decodeURIComponent(m[2]);
  } catch {
    /* mangled */
  }
  return { ok: !!nonce && code === nonce, pin: code === "pin", rest };
}

const USE_PIN_KEY = "prodeck.directorUsePin";
/** This phone said it has no Face ID: the gate asks for the PIN from now on. */
export function readUsePin(): boolean {
  try {
    return localStorage.getItem(USE_PIN_KEY) === "1";
  } catch {
    return false;
  }
}
export function saveUsePin(on: boolean) {
  try {
    if (on) localStorage.setItem(USE_PIN_KEY, "1");
    else localStorage.removeItem(USE_PIN_KEY);
  } catch {
    /* ignore */
  }
}

export function newNonce(): string {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function saveNonce(n: string) {
  try {
    if (n) localStorage.setItem(NONCE_KEY, n);
    else localStorage.removeItem(NONCE_KEY);
  } catch {
    /* ignore */
  }
}

export function readNonce(): string {
  try {
    return localStorage.getItem(NONCE_KEY) ?? "";
  } catch {
    return "";
  }
}

/** "12:30 PM" for the header. */
export function untilLabel(until: number): string {
  return new Date(until).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
