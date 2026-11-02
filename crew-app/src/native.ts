// What the phone itself does, behind one face: on a real phone (Capacitor)
// the camera and the Wi-Fi search are native; in the browser preview they're
// stand-ins, so the screens can be built and seen without a phone.

import { Capacitor } from "@capacitor/core";
import { DEFAULT_PORT, type Church } from "./connect";

export const isNative = () => Capacitor.isNativePlatform();

/** A booth found on this Wi-Fi (Bonjour _prodeck._tcp, announced by the booth). */
export interface Found {
  name: string;
  base: string;
}

/** Scan a QR code with the camera. null = cancelled, or no camera (preview). */
export async function scanCode(): Promise<string | null> {
  if (!isNative()) return null;
  // Native camera plugin arrives with the native projects (phase 1b).
  return null;
}

/** Look for booths on this Wi-Fi for a few seconds. */
export async function findBooths(): Promise<Found[]> {
  if (!isNative()) {
    // Preview: the booth on this computer, so the flow can be tried end to end.
    await new Promise((r) => setTimeout(r, 1200));
    return [{ name: "This computer (preview)", base: `http://127.0.0.1:${DEFAULT_PORT}` }];
  }
  return [];
}

/** Is there a ProDeck booth at this address? Its app manifest says so. */
export async function checkBooth(base: string): Promise<{ ok: true } | { ok: false; why: string }> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 6000);
  try {
    const r = await fetch(`${base}/manifest.json`, { signal: ctl.signal, cache: "no-store" });
    if (!r.ok) return { ok: false, why: "Something answered at that address, but it isn't a ProDeck booth." };
    const m = (await r.json().catch(() => null)) as { name?: string } | null;
    if (m?.name !== "ProDeck") return { ok: false, why: "Something answered at that address, but it isn't a ProDeck booth." };
    return { ok: true };
  } catch {
    return { ok: false, why: "Couldn't reach that address. Check you're on the church Wi-Fi, and that ProDeck is open at the booth." };
  } finally {
    clearTimeout(t);
  }
}

const KEY = "prodeck.crewChurches";

export function loadChurches(): Church[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function saveChurches(list: Church[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* private window */
  }
}
