// The overflow "Listen" stream as a module-level singleton. The audio element
// used to live inside the widget, so switching tabs on the phone unmounted it
// and killed the stream mid-song. Here the element outlives every component:
// widgets are just remote controls, and MobileShell shows a persistent stop
// chip while it plays.

import { IS_WEB, getWebToken } from "./tauri";

export type ListenState = "idle" | "loading" | "playing";

let el: HTMLAudioElement | null = null;
let state: ListenState = "idle";
let err = "";
let kioskRetry = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
const subs = new Set<() => void>();

function set(next: ListenState, e = "") {
  state = next;
  err = e;
  subs.forEach((f) => f());
}

export function listenSnapshot(): { state: ListenState; err: string } {
  return { state, err };
}

/** Subscribe to state changes; returns the unsubscribe. */
export function onListen(f: () => void): () => void {
  subs.add(f);
  return () => {
    subs.delete(f);
  };
}

function ensureEl(): HTMLAudioElement {
  if (!el) {
    el = new Audio();
    el.preload = "none";
    const bounce = () => {
      if (kioskRetry) scheduleRetry();
      else if (state !== "idle") set("idle", "stream ended — tap Listen to reconnect");
    };
    el.addEventListener("error", bounce);
    el.addEventListener("stalled", bounce);
    el.addEventListener("ended", bounce);
    el.addEventListener("playing", () => set("playing"));
  }
  return el;
}

function scheduleRetry() {
  if (retryTimer) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    startListen(kioskRetry);
  }, 5000);
}

export function startListen(kiosk = false) {
  if (!IS_WEB) {
    set("idle", "Open ProDeck in a browser on a phone or tablet (on the church network) to listen.");
    return;
  }
  kioskRetry = kiosk;
  const a = ensureEl();
  set("loading");
  a.src = `/api/listen.mp3?token=${encodeURIComponent(getWebToken())}`;
  a.play()
    .then(() => set("playing"))
    .catch((e: any) => {
      // Autoplay refusal won't fix itself — retrying would just spam.
      if (e?.name === "NotAllowedError") {
        set(
          "idle",
          kiosk
            ? "Autoplay blocked — launch Chrome with --autoplay-policy=no-user-gesture-required (see OFFICE_KIOSK.md)."
            : String(e?.message ?? e),
        );
        return;
      }
      set("idle", String(e?.message ?? e));
      if (kiosk) scheduleRetry();
    });
}

export function stopListen() {
  kioskRetry = false;
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  if (el) {
    el.pause();
    el.removeAttribute("src");
    el.load();
  }
  set("idle");
}
