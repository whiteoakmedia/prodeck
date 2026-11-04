import { IS_DEMO, IS_SHOTS, IS_WEB, pushAppSubscribe, pushAppUnsubscribe, pushPublicKey, pushSubscribe, pushUnsubscribe } from "./tauri";
import { CREW_SESSION_KEY } from "../chatStore";
import { appPush, crewAppHome, IN_CREW_APP } from "./crewApp";

// Web push registration, phone side.
//
// Why a page can fail to arrive, in the order you'll hit them:
//  1. Not a secure context — browsers refuse push over plain http://. On the
//     LAN URL this is simply unavailable until the HTTPS hostname exists.
//  2. iOS refuses push entirely until the PWA is installed to the Home Screen
//     (S01 exists for exactly this reason), and reports itself as "denied"
//     rather than explaining.
//  3. Permission not granted.
// `pushState()` reports which of these applies so the UI can say something
// true instead of "notifications off".

export type PushStatus =
  | "unsupported" // no service worker / PushManager in this browser
  | "insecure" // http:// — the browser will not allow it
  | "needs-install" // iOS Safari, not yet added to the Home Screen
  | "denied"
  | "off" // available, not yet subscribed
  | "on";

const isIos = () =>
  typeof navigator !== "undefined" &&
  /iP(hone|ad|od)/.test(navigator.userAgent) &&
  !("MSStream" in window);

const isStandalone = () =>
  (typeof window !== "undefined" &&
    window.matchMedia?.("(display-mode: standalone)").matches) ||
  (typeof navigator !== "undefined" &&
    (navigator as unknown as { standalone?: boolean }).standalone === true);

// ---- Inside the ProDeck Crew app
// Web push doesn't exist in an app's web view. The app gets the phone's own
// push token and hands it over as this page opens (crewApp.ts appPush); the
// booth sends pages to it through White Oak's relay (push.rs). Allowing
// notifications in the app is the consent, so once you're signed in it's
// registered without another tap, unless you turned pages off here.

const APP_OFF_KEY = "prodeck.appPushOff";
/** Set when the volunteer turns pages off themselves (More), app or browser. */
const CHOSE_OFF_KEY = "prodeck.pushChoseOff";

/** Did this phone's volunteer turn page notifications off on purpose? Home
 *  stops asking them to turn it back on. */
export function choseOff(): boolean {
  return ls(CHOSE_OFF_KEY) === "1";
}

function markChoseOff(on: boolean) {
  try {
    if (on) localStorage.setItem(CHOSE_OFF_KEY, "1");
    else localStorage.removeItem(CHOSE_OFF_KEY);
  } catch {
    /* private storage */
  }
}
/** Registered this page load, as session|token, so it isn't sent every read. */
let appSent = "";

const ls = (k: string) => {
  try {
    return localStorage.getItem(k) ?? "";
  } catch {
    return "";
  }
};

async function appState(): Promise<PushStatus> {
  // The app's pretend Sunday: the switch works, nothing is sent.
  if (IS_DEMO || IS_SHOTS) return ls(APP_OFF_KEY) === "1" ? "off" : "on";
  if (!appPush) return "unsupported";
  if (appPush === "denied") return "denied";
  if (appPush === "prompt" || ls(APP_OFF_KEY) === "1") return "off";
  const session = ls(CREW_SESSION_KEY);
  if (!session) return "off";
  const mark = `${session}|${appPush}`;
  if (appSent !== mark) {
    try {
      await pushAppSubscribe(session, "apns", appPush.slice("apns:".length));
    } catch {
      return "unsupported"; // a booth from before the app could get pages
    }
    appSent = mark;
  }
  return "on";
}

/** The app asks the phone; this page can't. Back here once it has. */
function askTheApp(): Promise<PushStatus> {
  location.href = crewAppHome(undefined, "notify");
  return new Promise(() => {}); // the page is going away
}

export async function pushState(): Promise<PushStatus> {
  if (IN_CREW_APP) return appState();
  if (!IS_WEB) return "unsupported";
  if (typeof window === "undefined") return "unsupported";
  if (!window.isSecureContext) return "insecure";
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    // iOS only exposes PushManager once installed, so distinguish the two.
    return isIos() && !isStandalone() ? "needs-install" : "unsupported";
  }
  if (Notification.permission === "denied") return "denied";
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!reg || !sub) return "off";
  await healSubscription(reg, sub).catch(() => {});
  return "on";
}

/** Does this subscription belong to the booth's current key? */
export function sameKey(subKey: ArrayBuffer | null | undefined, boothKey: string): boolean {
  if (!subKey || !boothKey) return false;
  const a = new Uint8Array(subKey);
  const b = urlB64ToBytes(boothKey);
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

let healed = false;

/**
 * The phone can believe pages are on while the booth has forgotten it: the
 * booth's keys were replaced (2 November 2026, a test overwrote them), or its
 * list was lost. Nothing failed anywhere you'd see; pages just stopped
 * reaching locked phones. So once per visit, with notifications already
 * allowed, the phone checks its subscription against the booth's key, makes
 * a new one if they differ (no prompt: permission is already granted), and
 * hands it to the booth again.
 */
async function healSubscription(reg: ServiceWorkerRegistration, sub: PushSubscription): Promise<void> {
  if (healed) return;
  const session = ls(CREW_SESSION_KEY);
  if (!session) return; // not signed in yet; try again next read
  healed = true;
  const { key } = await pushPublicKey();
  if (!key) return;
  let current = sub;
  if (!sameKey(sub.options?.applicationServerKey, key)) {
    await sub.unsubscribe().catch(() => false);
    current = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToBytes(key) });
  }
  const json = current.toJSON() as { endpoint?: string; keys?: Record<string, string> };
  await pushSubscribe(session, json.endpoint ?? "", json.keys?.p256dh ?? "", json.keys?.auth ?? "");
}

// base64url → Uint8Array, the format pushManager.subscribe demands.
function urlB64ToBytes(b64: string): Uint8Array {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Ask for permission and register this device against the crew identity. */
export async function enablePush(): Promise<PushStatus> {
  markChoseOff(false);
  if (IN_CREW_APP) {
    try {
      localStorage.removeItem(APP_OFF_KEY);
    } catch {
      /* private storage */
    }
    // Never asked, or blocked and maybe allowed in Settings since.
    if (appPush === "prompt" || appPush === "denied") return askTheApp();
    return appState();
  }
  const state = await pushState();
  if (state === "on") return "on";
  if (state !== "off") return state; // nothing to ask for — surface the reason

  const perm = await Notification.requestPermission();
  if (perm !== "granted") return perm === "denied" ? "denied" : "off";

  const reg =
    (await navigator.serviceWorker.getRegistration()) ??
    (await navigator.serviceWorker.register("/sw.js"));
  await navigator.serviceWorker.ready;

  const { key } = await pushPublicKey();
  if (!key) throw new Error("the booth has no push key yet");

  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      // Required by every browser now — a push you can't see isn't allowed.
      userVisibleOnly: true,
      applicationServerKey: urlB64ToBytes(key),
    }));

  const json = sub.toJSON() as { endpoint?: string; keys?: Record<string, string> };
  await pushSubscribe(
    localStorage.getItem(CREW_SESSION_KEY) ?? "",
    json.endpoint ?? "",
    json.keys?.p256dh ?? "",
    json.keys?.auth ?? "",
  );
  return "on";
}

export async function disablePush(): Promise<PushStatus> {
  markChoseOff(true);
  if (IN_CREW_APP) {
    try {
      localStorage.setItem(APP_OFF_KEY, "1");
    } catch {
      /* private storage */
    }
    appSent = "";
    if (appPush.startsWith("apns:")) {
      await pushAppUnsubscribe(ls(CREW_SESSION_KEY), appPush.slice("apns:".length)).catch(() => {});
    }
    return "off";
  }
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    await sub?.unsubscribe();
  } catch {
    /* the booth-side removal below is what actually stops the sends */
  }
  await pushUnsubscribe(localStorage.getItem(CREW_SESSION_KEY) ?? "").catch(() => {});
  return "off";
}
