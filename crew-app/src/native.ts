// What the phone itself does, behind one face: on a real phone (Capacitor)
// the camera and the Wi-Fi search are native; in the browser preview they're
// stand-ins, so the screens can be built and seen without a phone.

import { Capacitor, registerPlugin } from "@capacitor/core";
import { hostsToTry, sameNetwork, type PhoneAddress } from "./sweep";
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

const SEARCH_MS = 6000;

/** What a search turned up, and the phone's own address for when it found nothing. */
export interface Search {
  found: Found[];
  phoneIp: string;
  /** How the address check went, for the "No booth found" screen. */
  detail: string;
}

interface ProbeResult {
  open: string[];
  refused: number;
  silent: number;
  errors: Record<string, number>;
  ms: number;
}

/** "509 checked: 0 answered, 4 refused, 505 silent, 2.1s" plus any errors by code. */
export function probeDetail(n: number, r: ProbeResult): string {
  const errs = Object.entries(r.errors ?? {})
    .map(([code, count]) => `${count} error ${code}`)
    .join(", ");
  return `${n} checked: ${r.open.length} answered, ${r.refused} refused, ${r.silent} silent${errs ? `, ${errs}` : ""}, ${(r.ms / 1000).toFixed(1)}s`;
}

/**
 * Look for booths on this Wi-Fi two ways at once: Bonjour (the booth announces
 * itself), and asking every address on the phone's network directly, because
 * plenty of church Wi-Fi drops Bonjour between devices (sweep.ts). The first
 * booth that answers ends the search.
 */
export async function findBooths(onProgress?: (msg: string) => void): Promise<Search> {
  if (!isNative()) {
    // Preview: the booth on this computer, so the flow can be tried end to end.
    await new Promise((r) => setTimeout(r, 1200));
    return { found: [{ name: "This computer (preview)", base: `http://127.0.0.1:${DEFAULT_PORT}` }], phoneIp: "", detail: "" };
  }
  const found = new Map<string, Found>();
  // A booth on two networks (Wi-Fi and Dante, say) answers on both: one entry.
  let onFirst = () => {};
  const first = new Promise<void>((r) => (onFirst = r));
  const add = (f: Found) => {
    if (![...found.values()].some((x) => x.base === f.base || x.name === f.name)) found.set(f.base, f);
    onFirst();
  };
  const addresses = await phoneAddresses();
  const phoneIp = addresses[0]?.ip ?? "";
  const bonjour = bonjourSearch(() => found.size > 0, addresses).then((list) => list.forEach(add));
  const hosts = addresses.flatMap(hostsToTry);
  let detail = "";
  const swept = (async () => {
    if (!hosts.length) return;
    onProgress?.(`Checking ${hosts.length} addresses on this Wi-Fi`);
    let r = await netInfo().probe({ hosts, port: DEFAULT_PORT, timeoutMs: 800, width: 64 });
    // Not one reply of any kind usually means the phone was too quick for the
    // network, not that nobody's there: once more, a few at a time.
    if (!r.open?.length && !r.refused && !found.size) {
      onProgress?.("Checking again, more slowly");
      r = await netInfo().probe({ hosts, port: DEFAULT_PORT, timeoutMs: 1800, width: 24 });
    }
    detail = probeDetail(hosts.length, r);
    // A handful at most: printers, cameras, the booth. Confirm which is ProDeck.
    for (const ip of r.open ?? []) {
      const base = `http://${ip}:${DEFAULT_PORT}`;
      if ((await checkBooth(base, 3000)).ok) add({ name: await boothName(base, ip), base });
    }
  })().catch((e) => {
    detail = `address check failed: ${String((e as Error)?.message ?? e)}`;
  });
  // Done when both are, or a moment after the first booth turns up: the
  // address check can take a while longer and has nothing more to add.
  await Promise.race([Promise.all([bonjour, swept]), first.then(() => new Promise((r) => setTimeout(r, 400)))]);
  return { found: [...found.values()], phoneIp, detail };
}

/** The app's own plugin (ios/App/App/NetInfoPlugin.swift, android NetInfoPlugin.java). */
type NetInfoPlugin = {
  wifi(): Promise<{ addresses: PhoneAddress[] }>;
  probe(o: { hosts: string[]; port: number; timeoutMs: number; width: number }): Promise<ProbeResult>;
};
let netInfoPlugin: NetInfoPlugin | null = null;
const netInfo = () => (netInfoPlugin ??= registerPlugin<NetInfoPlugin>("NetInfo"));

/** The phone's Wi-Fi addresses. */
async function phoneAddresses(): Promise<PhoneAddress[]> {
  try {
    return (await netInfo().wifi()).addresses ?? [];
  } catch {
    return []; // an older app build without the plugin: Bonjour only
  }
}

/** What the booth calls itself; older booths don't say, so its address stands in. */
async function boothName(base: string, ip: string): Promise<string> {
  try {
    const r = await fetch(`${base}/api/origin`, { cache: "no-store" });
    // As Bonjour shows it: "Booth-Mac", not "Booth-Mac.local".
    const name = ((await r.json()) as { name?: string })?.name?.trim().replace(/\.local\.?$/i, "");
    if (name) return name;
  } catch {
    /* fall through */
  }
  return `ProDeck at ${ip}`;
}

/**
 * Bonjour, for a few seconds or until the sweep finds something. The booth
 * announces every address it has, including a Dante network the phone can't
 * reach, so each one is tried and the first that answers is used.
 */
async function bonjourSearch(done: () => boolean, phone: PhoneAddress[]): Promise<Found[]> {
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
    for (let t = 0; t < SEARCH_MS && !done() && seen.size === 0; t += 250) await new Promise((r) => setTimeout(r, 250));
    // Found something: give its address a moment to resolve fully.
    if (seen.size) await new Promise((r) => setTimeout(r, 500));
  } catch {
    /* no Wi-Fi, or the search wasn't allowed */
  } finally {
    // Not awaited: the plugin never confirms a stop on iOS, and waiting for
    // it left the search on "Looking…" forever whenever Bonjour found a booth.
    void ZeroConf.unwatch(req).catch(() => {});
  }
  const out: Found[] = [];
  for (const b of seen.values()) {
    for (const ip of orderAddresses(b.ips, phone)) {
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

/**
 * The booth's address on the phone's own network first, then the usual Wi-Fi
 * ranges (192.168, then 10), so a Dante address is tried last.
 */
export function orderAddresses(ips: string[], phone: PhoneAddress[] = []): string[] {
  const rank = (ip: string) =>
    phone.some((p) => sameNetwork(ip, p)) ? -1 : ip.startsWith("192.168.") ? 0 : ip.startsWith("10.") ? 1 : ip.startsWith("172.") ? 2 : 3;
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

/**
 * Page notifications. The booth's page has no way to reach the phone's own
 * notifications, so the app gets the phone's push token here and hands it to
 * the page as it opens (#crewpush=, read by the booth's lib/pushClient.ts),
 * which registers it once you're signed in. What's handed over:
 * "apns:<token>", "denied", or "prompt" (never asked; the page's Turn on
 * button comes back here with ?notify to ask). Android needs a push project
 * of its own first, so nothing is handed over there yet.
 */
export async function pushToken(ask: boolean): Promise<string> {
  if (Capacitor.getPlatform() !== "ios") return "";
  try {
    const { PushNotifications: P } = await import("@capacitor/push-notifications");
    let perm = (await P.checkPermissions()).receive;
    if (ask && perm !== "granted" && perm !== "denied") perm = (await P.requestPermissions()).receive;
    if (perm === "denied") return "denied";
    if (perm !== "granted") return "prompt";
    return await new Promise<string>((resolve) => {
      const handles: Promise<{ remove: () => Promise<void> }>[] = [];
      let settled = false;
      const done = (v: string) => {
        if (settled) return;
        settled = true;
        handles.forEach((h) => void h.then((x) => x.remove()));
        resolve(v);
      };
      handles.push(P.addListener("registration", (t) => done(`apns:${t.value}`)));
      handles.push(P.addListener("registrationError", () => done("")));
      void P.register();
      setTimeout(() => done(""), 8000);
    });
  } catch {
    return "";
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
