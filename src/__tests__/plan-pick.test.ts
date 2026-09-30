import { describe, expect, it } from "vitest";
import { autoTargetPlan, freshness, mergePlanPages, pcoWallTime } from "../lib/planPick";

// 20 Sep 2026, 08:00 — a Sunday morning mid-service, which is when this
// misbehaved in the room.
const NOW = Date.parse("September 20, 2026 08:00:00");
const p = (id: string, date: string, sortDate?: string) => ({ id, date, sortDate });
/** A real two-day plan as Planning Center returns it. */
const twoDay = (id: string, date: string, sortDate: string) => ({ id, date, sortDate });

const SUNDAYS = [
  p("s0913", "September 13, 2026"),
  p("s0920", "September 20, 2026"),
  p("s0927", "September 27, 2026"),
  p("s1004", "October 4, 2026"),
];

describe("freshness", () => {
  it("keeps today's plan current all day and into Monday", () => {
    expect(freshness(p("x", "September 20, 2026"), NOW)).toBe("fresh");
    // The 11:00 files against the same plan as the 8:00.
    expect(freshness(p("x", "September 20, 2026"), Date.parse("September 20, 2026 12:30:00"))).toBe("fresh");
    expect(freshness(p("x", "September 20, 2026"), Date.parse("September 21, 2026 09:00:00"))).toBe("fresh");
  });

  it("calls last week's plan stale", () => {
    expect(freshness(p("x", "September 13, 2026"), NOW)).toBe("stale");
  });

  it("refuses to guess at a plan it can't date or doesn't have", () => {
    expect(freshness(p("x", "Multiple Dates"), NOW)).toBe("unknown");
    expect(freshness(p("x", ""), NOW)).toBe("unknown");
    expect(freshness(undefined, NOW)).toBe("unknown");
  });

  /**
   * The bug. Planning Center's `dates` is prose, and JavaScript reads the
   * second day of a two-day event as a year — "December 23 & 24, 2026" parses
   * to 2024, "October 16 & 17, 2026" to 2017. Both are real strings from a
   * live account. Dated from the display text these read as long expired, so
   * the booth refused to stay on them; dated from `sort_date` they are simply
   * upcoming services.
   */
  it("dates two-day events from sort_date, not the display text", () => {
    const xmas = twoDay("xmas", "December 23 & 24, 2026", "2026-12-23T15:00:00Z");
    const conf = twoDay("conf", "October 16 & 17, 2026", "2026-10-16T18:00:59Z");
    expect(freshness(xmas, NOW)).toBe("fresh");
    expect(freshness(conf, NOW)).toBe("fresh");
    // Proof the display text alone would have got both wrong.
    expect(Date.parse("December 23 & 24, 2026")).toBeLessThan(NOW);
    expect(Date.parse("October 16 & 17, 2026")).toBeLessThan(NOW);
    // And so the booth now stays on one when an operator picks it.
    expect(autoTargetPlan([...SUNDAYS, xmas], "xmas", NOW)).toBeNull();
  });
});

describe("mergePlanPages", () => {
  it("de-duplicates and orders oldest first", () => {
    const merged = mergePlanPages([[SUNDAYS[2], SUNDAYS[1]], [SUNDAYS[1], SUNDAYS[0]]]);
    expect(merged.map((x) => x.id)).toEqual(["s0913", "s0920", "s0927"]);
  });

  it("sorts an undated plan last, not first", () => {
    // It would otherwise parse as NaN, sort to the front, and become the thing
    // auto-target picks.
    const merged = mergePlanPages([[p("odd", "Multiple Dates"), SUNDAYS[1]]]);
    expect(merged.map((x) => x.id)).toEqual(["s0920", "odd"]);
  });

  it("tolerates a page that failed to load", () => {
    expect(mergePlanPages([null, [SUNDAYS[1]], undefined]).map((x) => x.id)).toEqual(["s0920"]);
  });
});

describe("autoTargetPlan", () => {
  it("picks this week when nothing is selected", () => {
    expect(autoTargetPlan(SUNDAYS, null, NOW)).toBe("s0920");
  });

  it("leaves today's plan alone", () => {
    expect(autoTargetPlan(SUNDAYS, "s0920", NOW)).toBeNull();
  });

  it("rolls forward off last week's plan", () => {
    expect(autoTargetPlan(SUNDAYS, "s0913", NOW)).toBe("s0920");
  });

  it("does not override a deliberately chosen future plan", () => {
    expect(autoTargetPlan(SUNDAYS, "s1004", NOW)).toBeNull();
  });

  /**
   * The reported bug. Switching service type replaces `plans` with the new
   * type's plans; the plan selected a moment ago belongs to the old type and
   * is not in the list. Treating "not in the list" as "expired" is what jumped
   * the booth to Christmas.
   */
  it("does not jump when the selected plan simply isn't in the loaded list", () => {
    const christmas = [twoDay("xmas", "December 23 & 24, 2026", "2026-12-23T15:00:00Z")];
    expect(autoTargetPlan(christmas, "s0920", NOW)).toBeNull();
    // Nothing selected at all is a different case: there it should pick.
    expect(autoTargetPlan(christmas, null, NOW)).toBe("xmas");
  });

  /**
   * The other half of the same incident. Planning Center drops today's plan
   * from `filter=future` once its service time passes, so mid-Sunday the list
   * can start at next week while the 11:00 is still running against today's.
   */
  it("holds today's plan when the API has already dropped it from the list", () => {
    const afterServiceTime = [SUNDAYS[2], SUNDAYS[3]];
    const noon = Date.parse("September 20, 2026 12:00:00");
    expect(autoTargetPlan(afterServiceTime, "s0920", noon)).toBeNull();
  });

  it("never targets a plan it cannot date", () => {
    expect(autoTargetPlan([p("odd", "Multiple Dates")], null, NOW)).toBeNull();
  });

  it("does nothing when there is no current plan to move to", () => {
    expect(autoTargetPlan([SUNDAYS[0]], "s0913", NOW)).toBeNull();
  });

  /**
   * "PCO skips weeks occasionally." The booth's list is only as current as its
   * last load, and Planning Center leaves a plan with no service time out of
   * both the future and past lists. With the 4 October plan missing, last
   * week going stale used to send the booth straight to 11 October.
   */
  it("won't skip a week that's missing from the list", () => {
    const tuesday = Date.parse("September 29, 2026 10:00:00");
    const gap = [SUNDAYS[2], p("s1011", "October 11, 2026")];
    expect(autoTargetPlan(gap, "s0927", tuesday)).toBeNull();
    // Once the missing week is in the list, it moves there.
    expect(autoTargetPlan([...gap, SUNDAYS[3]].sort((a, b) => Date.parse(a.date) - Date.parse(b.date)), "s0927", tuesday)).toBe("s1004");
  });

  it("still moves to a plan inside the next week", () => {
    const monthly = [p("sep", "September 6, 2026"), p("oct", "October 4, 2026")];
    // A month out: waits.
    expect(autoTargetPlan(monthly, "sep", Date.parse("September 8, 2026 10:00:00"))).toBeNull();
    // Five days out: moves.
    expect(autoTargetPlan(monthly, "sep", Date.parse("September 29, 2026 10:00:00"))).toBe("oct");
  });
});

describe("pcoWallTime", () => {
  /**
   * From a live account in New York: the plan's sort_date says 08:00Z while
   * its first service plan_time says 12:00Z. sort_date is the wall clock.
   */
  it("reads sort_date as the church's local time", () => {
    expect(pcoWallTime("2026-10-04T08:00:00Z")).toBe(new Date(2026, 9, 4, 8, 0).getTime());
    expect(pcoWallTime("2026-09-30T19:00:00.000Z")).toBe(new Date(2026, 8, 30, 19, 0).getTime());
    expect(pcoWallTime("")).toBeNaN();
    expect(pcoWallTime(undefined)).toBeNaN();
  });
});
