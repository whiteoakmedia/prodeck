import { useMemo } from "react";
import { usePco, type PlanItem } from "../pcoStore";
import { useProDeck } from "../store";
import { matchPresentationToItem } from "./proFollow";

// The song on screen right now, for everything that reacts to it (the key
// sent to Waves, the lead-vocal desk scene). ProPresenter's active
// presentation first — matched the instant Pro reports it — and Planning
// Center LIVE only when Follow ProPresenter is off or nothing matches.
// Both features used to disagree: the key followed Pro, the desk scene only
// moved when someone advanced PCO LIVE, so a service driven from Pro alone
// changed keys but never switched the lead mic.
export function useLiveSong(): { item: PlanItem | null; via: "pro" | "pco" | null } {
  const { items, liveItemId, followPro, effectiveLink, library } = usePco();
  const { status } = useProDeck();
  const active = (status.activePresentation as any)?.presentation?.id ?? null;
  const presUuid: string | null = active?.uuid ?? null;
  const presName: string | null = active?.name ?? null;
  // Memoized: the provider re-renders ~12×/s while audio meters run, and the
  // matcher is O(plan items × PP library).
  const followedId = useMemo(
    () => (followPro ? matchPresentationToItem(items, effectiveLink, presUuid, presName) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [followPro, items, library, presUuid, presName],
  );
  const id = followedId ?? liveItemId;
  const item = items.find((i) => i.id === id) ?? null;
  return { item, via: followedId ? "pro" : liveItemId ? "pco" : null };
}
