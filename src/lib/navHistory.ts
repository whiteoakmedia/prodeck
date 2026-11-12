// Back goes to where you were. Every page change (desktop Shell, phone shell)
// is a browser history entry in the same document, so a swipe back on the
// phone, Android's back gesture, Cmd+[ and a mouse's back button all return to
// the screen before, not to the first one (Mikael: More, Leader board, swipe
// back did nothing). The URL never changes: only history.state carries the view.

import { useCallback, useEffect, useRef, useState } from "react";

/** How many in-app steps lie behind the entry we're on. 0 = the first screen,
 *  where going back would leave the app (or do nothing), so we don't. */
export function navDepth(state: unknown = typeof history !== "undefined" ? history.state : null): number {
  const d = (state as { navDepth?: unknown } | null)?.navDepth;
  return typeof d === "number" && d > 0 ? Math.floor(d) : 0;
}

export const canGoBack = () => navDepth() > 0;

/** Back one screen, if there is one inside the app. */
export function goBack(): boolean {
  if (!canGoBack()) return false;
  history.back();
  return true;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The entry to push for `value` on top of `state`, one step deeper. */
export function nextEntry(state: unknown, key: string, value: unknown): Record<string, unknown> {
  const base = state && typeof state === "object" ? (state as Record<string, unknown>) : {};
  return { ...base, [key]: value, navDepth: navDepth(base) + 1 };
}

/**
 * A view value kept in history. `go` moves to a new view (one step back
 * returns here); `replace` swaps the current one without a step, for
 * redirects the person didn't ask for. Starts at `initial`, never at whatever
 * a reload left in history, so the booth still opens where it always has.
 *
 * `canLeave` runs before a back/forward lands; false puts the person back
 * (Settings with unsaved edits).
 */
export function useNavHistory<T>(
  key: string,
  initial: T,
  canLeave?: (from: T, to: T) => boolean | Promise<boolean>,
): { value: T; go: (v: T) => void; replace: (v: T) => void; depth: number } {
  const [value, setValue] = useState<T>(initial);
  const [depth, setDepth] = useState(0);
  const cur = useRef(value);
  const leave = useRef(canLeave);
  leave.current = canLeave;

  useEffect(() => {
    // Stamp the entry we start on, so coming back to it restores this view.
    history.replaceState({ ...(history.state ?? {}), [key]: cur.current, navDepth: navDepth() }, "");
    setDepth(navDepth());
    const onPop = async (e: PopStateEvent) => {
      const to = (e.state as Record<string, unknown> | null)?.[key] as T | undefined;
      if (to === undefined || same(to, cur.current)) {
        setDepth(navDepth());
        return;
      }
      const from = cur.current;
      if (leave.current && !(await leave.current(from, to))) {
        // Stay: put this view back on top.
        history.pushState(nextEntry(history.state, key, from), "");
        setDepth(navDepth());
        return;
      }
      cur.current = to;
      setValue(to);
      setDepth(navDepth());
    };
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, [key]);

  const go = useCallback(
    (v: T) => {
      if (same(v, cur.current)) return;
      cur.current = v;
      history.pushState(nextEntry(history.state, key, v), "");
      setValue(v);
      setDepth(navDepth());
    },
    [key],
  );
  const replace = useCallback(
    (v: T) => {
      cur.current = v;
      history.replaceState({ ...(history.state ?? {}), [key]: v, navDepth: navDepth() }, "");
      setValue(v);
    },
    [key],
  );
  return { value, go, replace, depth };
}

/**
 * Is a swipe from the left edge a "back"? Starts within `edge` px of the left,
 * travels right at least `min` px, and mostly sideways.
 */
export function isBackSwipe(startX: number, dx: number, dy: number, edge = 28, min = 70): boolean {
  return startX <= edge && dx >= min && Math.abs(dy) < dx * 0.6;
}
