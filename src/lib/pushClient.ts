import { IS_WEB, pushPublicKey, pushSubscribe, pushUnsubscribe } from "./tauri";
import { CREW_SESSION_KEY } from "../chatStore";

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

export async function pushState(): Promise<PushStatus> {
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
  return sub ? "on" : "off";
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
