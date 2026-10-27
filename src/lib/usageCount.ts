// Anonymous usage count: about once a day, the booth app tells White Oak Media
// that one copy of ProDeck is still in use, so we know how many churches rely on
// it and which versions are still out there.
//
// What's sent, and nothing else: a random ID made on this computer the first
// time (not derived from the computer, the church or anyone in it), the ProDeck
// version, and whether it's a Mac or Windows. The portal endpoint stores those
// three things and the time; it does not keep the IP address.
//
// On unless a church turns it off in Settings → Help & support. The desktop app
// only: phones and kiosks (IS_WEB), demo mode, screenshots and dev builds never
// send. docs/PRIVACY.md describes it under "What White Oak Media receives".

import { IS_WEB } from "./tauri";

declare const __APP_VERSION__: string;

export const PING_URL =
  "https://us-central1-white-oak-media-client-portal.cloudfunctions.net/prodeckPing";
const ID_KEY = "prodeck.installId";
const LAST_KEY = "prodeck.usageCount.lastSent";
const OFF_KEY = "prodeck.usageCount.off";

/** Send at most this often. Under a day so a booth that sleeps overnight still counts daily. */
export const MIN_GAP_MS = 20 * 3600_000;
/** How often a running booth checks whether a send is due. */
const CHECK_MS = 3 * 3600_000;
/** Wait after launch so the ping never competes with start-up work. */
const FIRST_DELAY_MS = 90_000;

type Store = Pick<Storage, "getItem" | "setItem">;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function read(store: Store, key: string): string | null {
  try {
    return store.getItem(key);
  } catch {
    return null;
  }
}
function write(store: Store, key: string, value: string): void {
  try {
    store.setItem(key, value);
  } catch {
    /* locked profile: worst case this copy counts again tomorrow */
  }
}

export function usageCountEnabled(store: Store = localStorage): boolean {
  return read(store, OFF_KEY) !== "1";
}

export function setUsageCountEnabled(on: boolean, store: Store = localStorage): void {
  write(store, OFF_KEY, on ? "0" : "1");
}

/** This computer's random ID, made once. Never derived from anything about the computer. */
export function installId(store: Store = localStorage, rand: () => string = () => crypto.randomUUID()): string {
  const have = read(store, ID_KEY);
  if (have && UUID.test(have)) return have;
  const id = rand().toLowerCase();
  write(store, ID_KEY, id);
  return id;
}

export function osName(ua: string): "mac" | "windows" | "linux" | "other" {
  if (/Mac OS X|Macintosh/i.test(ua)) return "mac";
  if (/Windows/i.test(ua)) return "windows";
  if (/Linux/i.test(ua)) return "linux";
  return "other";
}

export function isDue(store: Store, now: number): boolean {
  const last = Number(read(store, LAST_KEY));
  return !Number.isFinite(last) || last <= 0 || now - last >= MIN_GAP_MS || last > now;
}

/** The whole payload. Kept in one place so the test can pin exactly what leaves the computer. */
export function payload(store: Store, ua: string, version: string) {
  return { id: installId(store), v: version, os: osName(ua) };
}

/** One send if it's switched on and due. Never throws; returns whether it was counted. */
export async function sendUsageCount(opts: {
  store?: Store;
  fetchImpl?: typeof fetch;
  now?: number;
  ua?: string;
  version?: string;
} = {}): Promise<boolean> {
  const store = opts.store ?? localStorage;
  const now = opts.now ?? Date.now();
  if (!usageCountEnabled(store) || !isDue(store, now)) return false;
  const body = payload(store, opts.ua ?? navigator.userAgent, opts.version ?? __APP_VERSION__);
  try {
    const res = await (opts.fetchImpl ?? fetch)(PING_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return false;
    write(store, LAST_KEY, String(now));
    return true;
  } catch {
    return false; // offline or blocked: try again at the next check
  }
}

let started = false;

/** Called once from main.tsx. Desktop app only. */
export function startUsageCount(opts: { demo: boolean; shots: boolean }): void {
  if (started || IS_WEB || opts.demo || opts.shots || import.meta.env.DEV) return;
  started = true;
  setTimeout(() => void sendUsageCount(), FIRST_DELAY_MS);
  setInterval(() => void sendUsageCount(), CHECK_MS);
}
