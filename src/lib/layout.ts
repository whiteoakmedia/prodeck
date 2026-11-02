// Which shell a browser gets: the crew layout (phone tabs, comms, tally light)
// or the full layout (sidebar, every page). By width unless the device chose:
// an iPad is wide enough for the full layout, but on a camera or at the
// director's desk it wants the crew one. The choice is per device.

export type LayoutPref = "crew" | "full";
export const LAYOUT_KEY = "prodeck.layout";

export function crewLayout(o: { isWeb: boolean; shotPhone: boolean; narrow: boolean; pref: LayoutPref | null }): boolean {
  // The booth computer is always the full layout.
  if (!o.isWeb && !o.shotPhone) return false;
  if (o.pref === "crew") return true;
  if (o.pref === "full") return false;
  return o.narrow;
}

export function readLayoutPref(): LayoutPref | null {
  try {
    const v = localStorage.getItem(LAYOUT_KEY);
    return v === "crew" || v === "full" ? v : null;
  } catch {
    return null;
  }
}

/** Switch and reload: the shell is chosen once, at start. */
export function switchLayout(to: LayoutPref) {
  try {
    localStorage.setItem(LAYOUT_KEY, to);
  } catch {
    /* private window: it reverts to the width rule on reload */
  }
  location.reload();
}

/** Whether this screen is wide enough that the full layout is worth offering. */
export function wideScreen(): boolean {
  return typeof window !== "undefined" && !window.matchMedia("(max-width: 760px)").matches;
}
