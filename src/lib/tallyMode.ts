// "Use as tally light" on a crew phone (More tab). The phone stays in tally
// until someone taps Back to ProDeck, even through a reload or the booth
// restarting: a phone clipped to a camera is never touched mid-service, so it
// must come back as a tally, not as the Home tab.

import { useEffect, useState } from "react";
import type { AtemSnapshot } from "./tauri";

export const TALLY_MODE_KEY = "prodeck.tallyMode";
const CHANGED = "prodeck-tally-mode";

export function readTallyMode(store: Pick<Storage, "getItem"> | null = safeStorage()): boolean {
  try {
    return store?.getItem(TALLY_MODE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeTallyMode(on: boolean, store: Pick<Storage, "setItem" | "removeItem"> | null = safeStorage()) {
  try {
    if (on) store?.setItem(TALLY_MODE_KEY, "1");
    else store?.removeItem(TALLY_MODE_KEY);
  } catch {
    /* private window: tally lasts until the page is closed */
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CHANGED));
}

/** Live tally mode, for code outside the phone shell (the page takeover). */
export function useTallyMode(): boolean {
  const [on, setOn] = useState(() => readTallyMode());
  useEffect(() => {
    const f = () => setOn(readTallyMode());
    window.addEventListener(CHANGED, f);
    return () => window.removeEventListener(CHANGED, f);
  }, []);
  return on;
}

/**
 * Whether to offer the tally button at all: the booth has a switcher it has
 * heard from (a camera list to choose from). A booth without one would only
 * offer a light that can never turn red.
 */
export function offersTally(snap: AtemSnapshot | null): boolean {
  return !!snap && (snap.connected || snap.inputs.length > 0);
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}
