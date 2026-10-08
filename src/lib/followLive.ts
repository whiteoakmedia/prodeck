// Keep the live slide in view as ProPresenter moves through a song.
//
// The live card is kept about a third of the way down its scroll box, so the
// slides coming next are on screen. It moves only when the card leaves a
// comfortable band (not on every slide, which would make the grid twitch), and
// it backs off for a few seconds whenever someone scrolls, clicks or keys in
// the box, so an operator looking ahead isn't dragged back mid-read.

import { useEffect, useRef, type RefObject } from "react";

/** Where the live card should sit: this fraction of the box's height from the top. */
const ANCHOR = 0.3;
/** Leave the card alone while its top is inside this band of the box. */
const BAND: [number, number] = [0.1, 0.65];
/** How long a person's own scrolling wins. */
export const HOLD_MS = 6000;

/**
 * The scrollTop that brings the card into place, or null to stay put.
 * Positions are relative to the scroll box's content (offset within it).
 */
export function followTarget(
  cardTop: number,
  cardHeight: number,
  boxHeight: number,
  scrollTop: number,
  scrollHeight: number,
): number | null {
  if (boxHeight <= 0) return null;
  const top = cardTop - scrollTop;
  const inBand = top >= boxHeight * BAND[0] && top <= boxHeight * BAND[1] && top + cardHeight <= boxHeight;
  if (inBand) return null;
  const want = Math.round(cardTop - boxHeight * ANCHOR);
  const max = Math.max(0, scrollHeight - boxHeight);
  const clamped = Math.min(max, Math.max(0, want));
  return Math.abs(clamped - scrollTop) < 4 ? null : clamped;
}

function scrollBox(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === "auto" || oy === "scroll") && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
}

/**
 * Follow the element matching `selector` inside `root` whenever `key` changes
 * (the live slide). `root` is any element inside the scroll box.
 */
export function useFollowLive(root: RefObject<HTMLElement | null>, selector: string, key: unknown): void {
  const heldUntil = useRef(0);

  // A person's own scrolling holds the view for a while.
  useEffect(() => {
    const el = root.current;
    const box = el && scrollBox(el);
    if (!box) return;
    const hold = () => {
      heldUntil.current = Date.now() + HOLD_MS;
    };
    const opts = { passive: true } as const;
    box.addEventListener("wheel", hold, opts);
    box.addEventListener("touchmove", hold, opts);
    box.addEventListener("pointerdown", hold, opts);
    box.addEventListener("keydown", hold);
    return () => {
      box.removeEventListener("wheel", hold);
      box.removeEventListener("touchmove", hold);
      box.removeEventListener("pointerdown", hold);
      box.removeEventListener("keydown", hold);
    };
  });

  useEffect(() => {
    if (Date.now() < heldUntil.current) return;
    const el = root.current;
    const card = el?.querySelector<HTMLElement>(selector);
    const box = card && scrollBox(card);
    if (!card || !box) return;
    const cardTop = card.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
    const to = followTarget(cardTop, card.offsetHeight, box.clientHeight, box.scrollTop, box.scrollHeight);
    if (to === null) return;
    const still = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    box.scrollTo({ top: to, behavior: still ? "auto" : "smooth" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
