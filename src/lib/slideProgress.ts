// "Slide 6 of 25": where the live slide sits in what ProPresenter is playing,
// and how many are left, so the team sees a transition coming. The total is
// ProPresenter's own cue count for the playing arrangement (the same numbering
// as the slide index), not the stored presentation.

export interface SlideProgress {
  /** 1-based slide number. */
  n: number;
  total: number;
  /** Slides after this one. */
  left: number;
  /** This is the final slide. */
  last: boolean;
}

export function slideProgress(index: number | null, total: number | null): SlideProgress | null {
  if (index === null || index < 0) return null;
  const n = index + 1;
  if (!total || total < n) return { n, total: 0, left: 0, last: false };
  return { n, total, left: total - n, last: n === total };
}

/** "6 of 25 · 19 to go", "25 of 25 · last slide", or just "6" with no total. */
export function slideProgressText(p: SlideProgress | null): string {
  if (!p) return "";
  if (!p.total) return `${p.n}`;
  return `${p.n} of ${p.total} · ${p.last ? "last slide" : p.left === 1 ? "1 to go" : `${p.left} to go`}`;
}
