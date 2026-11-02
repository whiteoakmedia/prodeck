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
  try {
    const { CapacitorBarcodeScanner, CapacitorBarcodeScannerTypeHint } = await import("@capacitor/barcode-scanner");
    const r = await CapacitorBarcodeScanner.scanBarcode({
      hint: CapacitorBarcodeScannerTypeHint.QR_CODE,
      scanInstructions: "Point at the crew code",
      scanButton: false,
    });
    return r?.ScanResult?.trim() || null;
  } catch {
    return null; // cancelled, or the camera wasn't allowed
  }
}

const SEARCH_MS = 4000;

/**
 * Look for booths on this Wi-Fi for a few seconds. The booth announces every
 * address it has, including a Dante network the phone can't reach, so each
 * one is tried and the first that answers is used.
 */
export async function findBooths(): Promise<Found[]> {
  if (!isNative()) {
    // Preview: the booth on this computer, so the flow can be tried end to end.
    await new Promise((r) => setTimeout(r, 1200));
    return [{ name: "This computer (preview)", base: `http://127.0.0.1:${DEFAULT_PORT}` }];
  }
  const { ZeroConf } = await import("@mhaberler/capacitor-zeroconf-nsd");
  const req = { type: "_prodeck._tcp.", domain: "local." };
  const seen = new Map<string, { name: string; ips: string[]; port: number }>();
  try {
    await ZeroConf.watch(req, (r) => {
      const svc = r?.service;
      if (!svc || r.action === "removed") return;
      const ips = (svc.ipv4Addresses ?? []).filter(Boolean);
      if (ips.length) seen.set(svc.name, { name: svc.name, ips, port: svc.port || DEFAULT_PORT });
    });
    await new Promise((r) => setTimeout(r, SEARCH_MS));
  } catch {
    /* no Wi-Fi, or the search wasn't allowed */
  } finally {
    await ZeroConf.unwatch(req).catch(() => {});
  }
  const out: Found[] = [];
  for (const b of seen.values()) {
    for (const ip of orderAddresses(b.ips)) {
      const base = `http://${ip}:${b.port}`;
      // Short: an address on a network the phone isn't on just never answers.
      if ((await checkBooth(base, 2500)).ok) {
        out.push({ name: b.name, base });
        break;
      }
    }
  }
  return out;
}

/** Usual Wi-Fi ranges first (192.168, then 10), so the phone's network is tried before a Dante one. */
export function orderAddresses(ips: string[]): string[] {
  const rank = (ip: string) => (ip.startsWith("192.168.") ? 0 : ip.startsWith("10.") ? 1 : ip.startsWith("172.") ? 2 : 3);
  return [...new Set(ips)].sort((a, b) => rank(a) - rank(b));
}

/** Is there a ProDeck booth at this address? Its app manifest says so. */
export async function checkBooth(base: string, timeoutMs = 6000): Promise<{ ok: true } | { ok: false; why: string }> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
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

/**
 * The booth's secure address, if it has one and this phone can reach it.
 * Inside the app a plain http page gets no microphone, so comms needs https:
 * the church's public address or its secure local one (localhttps.rs). If a
 * web filter blocks it, the plain address still works for everything else.
 */
export async function secureBase(base: string): Promise<string> {
  if (base.startsWith("https://")) return base;
  try {
    const r = await fetch(`${base}/api/origin`, { cache: "no-store" });
    const secure = ((await r.json()) as { secure?: string })?.secure ?? "";
    if (/^https:\/\/[^/]+$/.test(secure) && (await checkBooth(secure, 4000)).ok) return secure;
  } catch {
    /* an older booth without /api/origin: plain it is */
  }
  return base;
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
