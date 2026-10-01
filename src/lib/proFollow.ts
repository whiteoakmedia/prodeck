import { useEffect, useRef } from "react";
import { useProDeck } from "../store";
import { usePco } from "../pcoStore";
import { IS_WEB } from "./tauri";

import { matchPresentationToItem } from "./presMatch";

export { matchPresentationToItem };

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
        pco.liveItemId,
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
