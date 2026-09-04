import { useEffect, useRef } from "react";
import { useProDeck } from "../store";
import { usePco, type PlanItem } from "../pcoStore";
import { IS_WEB } from "./tauri";

// Normalize a title for matching: drop (parentheticals) and [brackets] — which
// usually hold keys/arrangements — strip "feat./ft." credits, and reduce to
// lowercase words.
const norm = (s: string) =>
  s
    .toLowerCase()
    // Fold accents ("Días" → "dias") — the strip below would delete them.
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\b(feat|ft|featuring)\b.*$/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const normJoin = (s: string) => norm(s).replace(/\s+/g, "");
const tokens = (s: string) => norm(s).split(" ").filter(Boolean);

// Token-overlap score in 0..1 (intersection over the larger set).
function score(a: string, b: string): number {
  const ta = new Set(tokens(a));
  const tb = new Set(tokens(b));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / Math.max(ta.size, tb.size);
}

/**
 * Resolve which plan item a live ProPresenter presentation corresponds to:
 *   1. an item whose (saved or auto-detected) link points at this UUID,
 *   2. else the best fuzzy title match above a confidence floor,
 *   3. else a containment match for short file names.
 * Pure + synchronous (no network), so callers can use it for instant decisions:
 * the key-send resolves the live song with this the moment Pro goes live,
 * without waiting for the settle that protects the PCO time-tracker.
 */
export function matchPresentationToItem(
  items: PlanItem[],
  effectiveLink: (i: PlanItem) => { uuid: string } | null,
  presUuid: string | null,
  presName: string | null,
): string | null {
  const list = items.filter((i) => i.type !== "header" && i.title);
  // 1) An item whose link points at this presentation.
  if (presUuid) {
    const linked = list.find((i) => effectiveLink(i)?.uuid === presUuid);
    if (linked) return linked.id;
  }
  if (presName) {
    // 2) Fuzzy title match with a confidence floor (don't jump on a weak guess).
    let best: { id: string; s: number } | null = null;
    for (const it of list) {
      const s = score(presName, it.title);
      if (!best || s > best.s) best = { id: it.id, s };
    }
    if (best && best.s >= 0.5) return best.id;
    // 3) Containment fallback for short file names ("Oceans" ⊂ full title).
    const npj = normJoin(presName);
    if (npj.length >= 5) {
      const c = list.find((i) => {
        const ij = normJoin(i.title);
        return ij.length >= 5 && (ij.includes(npj) || npj.includes(ij));
      });
      if (c) return c.id;
    }
  }
  return null;
}

/**
 * "Follow ProPresenter" — when the live ProPresenter presentation changes,
 * advance PCO Live to the matching plan item. Matching order:
 *   1. Exact: a plan item the operator already linked to this presentation UUID.
 *   2. Fuzzy: best token-overlap title match above a confidence threshold.
 *   3. Containment: short Pro file name contained in (or containing) a title.
 * Used when the operator drives ProPresenter directly (no PCO→Pro import).
 */
// How long the live ProPresenter presentation must hold before Follow advances
// PCO Live (and the service-time tracker). This keeps a momentary roll past a
// song boundary, a quick preview, or a fast correction from starting the next
// item's clock before the operator has actually moved on. Items run for minutes,
// so this small settle is invisible in normal use.
const SETTLE_MS = 2500;

export function useProFollow() {
  const { status } = useProDeck();
  const pco = usePco();
  const lastKey = useRef<string | null>(null);
  const prevFollow = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Follow watches BOTH layers: the presentation layer and the announcements
  // layer (where pre-service loops run — triggering a deck there never touches
  // activePresentation). Whichever layer's deck changed most recently is "what
  // the operator did last" and drives Follow; a cleared layer never wins.
  const presDoc = (status.activePresentation as any)?.presentation?.id ?? null;
  const annDoc = (status.activeAnnouncement as any)?.announcement?.id ?? null;
  const presSeen = useRef<{ uuid: string | null; at: number }>({ uuid: null, at: 0 });
  const annSeen = useRef<{ uuid: string | null; at: number }>({ uuid: null, at: 0 });
  if ((presDoc?.uuid ?? null) !== presSeen.current.uuid) {
    presSeen.current = { uuid: presDoc?.uuid ?? null, at: presDoc ? Date.now() : 0 };
  }
  if ((annDoc?.uuid ?? null) !== annSeen.current.uuid) {
    annSeen.current = { uuid: annDoc?.uuid ?? null, at: annDoc ? Date.now() : 0 };
  }
  const active =
    annSeen.current.at > presSeen.current.at ? annDoc ?? presDoc : presDoc ?? annDoc;
  const presName: string | null = active?.name ?? null;
  const presUuid: string | null = active?.uuid ?? null;
  const key = presUuid ?? presName;

  useEffect(() => {
    // The BOOTH drives Follow — a phone running this too would be a second
    // concurrent controller stepping PCO Live (both fire go_to_next/previous,
    // overshooting and oscillating around the target).
    if (IS_WEB) return;
    const justEnabled = pco.followPro && !prevFollow.current;
    prevFollow.current = pco.followPro;
    // Any change to the live presentation cancels a pending follow — so a brief
    // roll into the next item that's corrected within the settle window never
    // advances PCO Live or starts the next item's clock.
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (!pco.followPro || !key) {
      lastKey.current = key;
      return;
    }
    // Re-sync when the live presentation changes, or right when Follow is turned
    // on (so flipping it mid-song catches up immediately).
    if (lastKey.current === key && !justEnabled) return;

    // Resolve + advance only once the live presentation has settled (immediately
    // when Follow was just toggled on, so it catches up at once).
    const doFollow = () => {
      timer.current = null;
      lastKey.current = key;
      const targetId = matchPresentationToItem(
        pco.items,
        pco.effectiveLink,
        presUuid,
        presName,
      );
      pco.setFollowStatus({ presName: presName ?? "", matched: !!targetId });
      if (targetId) pco.goToItem(targetId);
    };

    if (justEnabled) doFollow();
    else timer.current = setTimeout(doFollow, SETTLE_MS);

    return () => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, pco.followPro]);
}
