// Shared title matching for linking PCO plan items to ProPresenter presentations
// (and for Follow-ProPresenter). Normalizes away keys/arrangements/credits so
// "Goodness of God (Key of A)" matches "Goodness of God".

export const normTitle = (s: string): string =>
  s
    .toLowerCase()
    // Fold accents to their base letters ("Días" → "dias") — the [^a-z0-9]
    // strip below would otherwise DELETE them and mangle the tokens.
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\b(feat|ft|featuring)\b.*$/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const normJoin = (s: string): string => normTitle(s).replace(/\s+/g, "");
const tokens = (s: string): string[] => normTitle(s).split(" ").filter(Boolean);

// Token-overlap score in 0..1 (intersection over the larger token set).
export function scoreTitle(a: string, b: string): number {
  const ta = new Set(tokens(a));
  const tb = new Set(tokens(b));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / Math.max(ta.size, tb.size);
}

// Best candidate (by `.name`) for `name`, above a confidence threshold. Falls
// back to whole-string containment for short names ("Oceans" ⊂ full title).
// Returns null rather than guessing on a weak match.
export function bestMatch<T extends { name: string }>(
  name: string,
  candidates: T[],
  threshold = 0.5,
): T | null {
  if (!name || candidates.length === 0) return null;
  let best: { c: T; s: number } | null = null;
  for (const c of candidates) {
    const s = scoreTitle(name, c.name);
    if (!best || s > best.s) best = { c, s };
  }
  if (best && best.s >= threshold) return best.c;
  const npj = normJoin(name);
  if (npj.length >= 5) {
    const c = candidates.find((x) => {
      const xj = normJoin(x.name);
      return xj.length >= 5 && (xj.includes(npj) || npj.includes(xj));
    });
    if (c) return c;
  }
  return null;
}
