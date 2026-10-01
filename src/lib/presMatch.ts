// Which plan item a live ProPresenter presentation is (pure; tested in
// presMatch.test.ts). Used by Follow ProPresenter, the live-song resolver
// (key-send, desk scenes) and Auto-Follow's tempo lookup.

import type { PlanItem } from "../pcoStore";

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
  currentItemId?: string | null,
): string | null {
  const list = items.filter((i) => i.type !== "header" && i.title);
  const pick = (c: PlanItem[]) => nearest(c, items, currentItemId);
  // 1) An item whose link points at this presentation.
  if (presUuid) {
    const linked = list.filter((i) => effectiveLink(i)?.uuid === presUuid);
    if (linked.length) return pick(linked);
  }
  if (presName) {
    // 2) Fuzzy title match with a confidence floor (don't jump on a weak guess).
    let best = 0;
    for (const it of list) best = Math.max(best, score(presName, it.title));
    if (best >= 0.5) return pick(list.filter((it) => score(presName, it.title) === best));
    // 3) Containment fallback for short file names ("Oceans" ⊂ full title).
    const npj = normJoin(presName);
    if (npj.length >= 5) {
      const c = list.filter((i) => {
        const ij = normJoin(i.title);
        return ij.length >= 5 && (ij.includes(npj) || npj.includes(ij));
      });
      if (c.length) return pick(c);
    }
  }
  return null;
}

/**
 * One presentation can match several plan items: the same walk-in loop is
 * "Pre-Service Slides" at the start AND at the end of a plan. Pick the one
 * where the service is: the first at or after the current LIVE item, else the
 * closest before it; with no current item, the first in the plan. Taking the
 * first match always is what dragged LIVE from the Benediction back to item 4
 * when the end-of-service loop came up.
 */
function nearest(candidates: PlanItem[], items: PlanItem[], currentItemId?: string | null): string | null {
  const sorted = [...candidates].sort((a, b) => a.sequence - b.sequence);
  if (!sorted.length) return null;
  const cur = currentItemId ? items.find((i) => i.id === currentItemId) : undefined;
  if (!cur) return sorted[0].id;
  const ahead = sorted.find((i) => i.sequence >= cur.sequence);
  return (ahead ?? sorted[sorted.length - 1]).id;
}

