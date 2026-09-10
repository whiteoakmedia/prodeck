import type { PlanItem } from "../pcoStore";

/**
 * "Keys to the stage" — the worship team's cue.
 *
 * While an item is live, count down its planned length. When the items that
 * follow it are songs and the countdown is inside the lead time, it's a CALL:
 * the team should be walking, and what they need to know is the keys. The
 * classic case is the closing set after the sermon, but it is deliberately
 * generic — any run of songs after any timed item — so it also fires before
 * the opening set if a pre-service countdown item is live.
 *
 * Pure so it can be tested against a clock we control.
 */

export type StageCallPhase = "idle" | "waiting" | "call" | "over";

export interface StageCallState {
  phase: StageCallPhase;
  /** The live item, if any. */
  live: PlanItem | null;
  /** Seconds until the live item's planned end; negative = over. null = unknown start. */
  remaining: number | null;
  /** The songs coming up next (the contiguous run after the live item). */
  next: PlanItem[];
}

export function nextSongsAfter(items: PlanItem[], fromIdx: number): PlanItem[] {
  const out: PlanItem[] = [];
  for (let i = fromIdx + 1; i < items.length; i++) {
    const t = items[i].type;
    if (t === "header") continue; // section headings carry no time and no key
    if (t !== "song") break;
    out.push(items[i]);
  }
  return out;
}

export function stageCallState(
  items: PlanItem[],
  liveItemId: string | null,
  startedAt: number | null,
  now: number,
  leadSec: number,
): StageCallState {
  const liveIdx = liveItemId ? items.findIndex((i) => i.id === liveItemId) : -1;
  if (liveIdx < 0) {
    // Nothing live: show the first songs of the plan so the team still sees
    // their keys while they wait.
    const first = items.findIndex((i) => i.type === "song");
    const next = first >= 0 ? nextSongsAfter(items, first - 1) : [];
    return { phase: "idle", live: null, remaining: null, next };
  }
  const live = items[liveIdx];
  const next = nextSongsAfter(items, liveIdx);
  const remaining =
    startedAt !== null && live.length > 0 ? live.length - (now - startedAt) / 1000 : null;
  if (next.length === 0 || remaining === null) {
    return { phase: "waiting", live, remaining, next };
  }
  if (remaining < 0) return { phase: "over", live, remaining, next };
  if (remaining <= leadSec) return { phase: "call", live, remaining, next };
  return { phase: "waiting", live, remaining, next };
}

export function fmtClock(sec: number): string {
  const s = Math.max(0, Math.round(Math.abs(sec)));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}
