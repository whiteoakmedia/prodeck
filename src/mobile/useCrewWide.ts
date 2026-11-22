import { useEffect, useState } from "react";

// The crew layout on a big screen: iPhone Duo opened up (its inner display is
// regular width and height, about 626 by 890 points), an iPad in crew view.
// There the tab bar becomes a sidebar, and with room Chat and More show their list
// beside the open item, as Apple asks for on the inner display, instead of a
// phone layout stretched across it. Folding and unfolding resizes the window
// in place, so this follows the size live; nothing reloads.
//
// Height matters too: a phone on its side (or iPhone Duo closed, in
// landscape) is wide but short, and keeps the phone layout.

export const WIDE_MIN_WIDTH = 600;
export const WIDE_MIN_HEIGHT = 560;
export const WIDE_QUERY = `(min-width: ${WIDE_MIN_WIDTH}px) and (min-height: ${WIDE_MIN_HEIGHT}px)`;

/** Pure form of WIDE_QUERY, for tests and for code without matchMedia. */
export function isCrewWide(width: number, height: number): boolean {
  return width >= WIDE_MIN_WIDTH && height >= WIDE_MIN_HEIGHT;
}

/** Wide enough for a list beside a full phone-width screen (Chat's thread,
 *  More's Leader board and No sound?): iPhone Duo opened and turned, or an
 *  iPad. Upright, the Duo's inner display is 626 points, too narrow for both. */
export const SPLIT_MIN_WIDTH = 760;
export const SPLIT_QUERY = `(min-width: ${SPLIT_MIN_WIDTH}px) and (min-height: ${WIDE_MIN_HEIGHT}px)`;

export function isCrewSplit(width: number, height: number): boolean {
  return width >= SPLIT_MIN_WIDTH && height >= WIDE_MIN_HEIGHT;
}

export function useCrewWide(): boolean {
  return useMatch(WIDE_QUERY);
}

export function useCrewSplit(): boolean {
  return useMatch(SPLIT_QUERY);
}

function useMatch(query: string): boolean {
  const mq = typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(query) : null;
  const [wide, setWide] = useState(() => !!mq?.matches);
  useEffect(() => {
    if (!mq) return;
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return wide;
}
