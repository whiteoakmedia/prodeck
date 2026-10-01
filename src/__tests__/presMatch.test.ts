import { describe, expect, it } from "vitest";
import { matchPresentationToItem } from "../lib/presMatch";
import type { PlanItem } from "../pcoStore";

// The 4 October plan as Planning Center has it: the walk-in loop is
// "Pre-Service Slides" both at the start (4) and after the Benediction (23).
const item = (sequence: number, title: string, type = "item"): PlanItem =>
  ({ id: `i${sequence}`, title, sequence, length: 0, type, description: "", key: "", leader: "" }) as PlanItem;
const PLAN = [
  item(3, "COUNTDOWN VIDEO", "header"),
  item(4, "Pre-Service Slides"),
  item(5, "Count Down Video"),
  item(8, "Welcome"),
  item(9, "I Believe"),
  item(21, "Benediction"),
  item(22, "SERVICE END", "header"),
  item(23, "Pre-Service Slides"),
];
const WALK_IN = "526AE58E-1A17-4021-925E-16ABAB7638F0";
// Both Pre-Service items link to the same presentation (a link rule by title).
const link = (i: PlanItem) => (i.title === "Pre-Service Slides" ? { uuid: WALK_IN } : null);

describe("matchPresentationToItem", () => {
  it("before LIVE starts, the walk-in loop is the first Pre-Service item", () => {
    expect(matchPresentationToItem(PLAN, link, WALK_IN, "Beginning of Service", null)).toBe("i4");
  });

  it("after the Benediction, the walk-in loop is the closing Pre-Service item, not item 4", () => {
    expect(matchPresentationToItem(PLAN, link, WALK_IN, "Beginning of Service", "i21")).toBe("i23");
  });

  it("stays put when LIVE is already on the matching item", () => {
    expect(matchPresentationToItem(PLAN, link, WALK_IN, "Beginning of Service", "i23")).toBe("i23");
    expect(matchPresentationToItem(PLAN, link, WALK_IN, "Beginning of Service", "i4")).toBe("i4");
  });

  it("still goes back to an earlier item when that is the only match", () => {
    expect(matchPresentationToItem(PLAN, () => null, null, "I Believe", "i21")).toBe("i9");
  });

  it("applies the same rule to title matches with no link", () => {
    expect(matchPresentationToItem(PLAN, () => null, null, "Pre-Service Slides", "i9")).toBe("i23");
    expect(matchPresentationToItem(PLAN, () => null, null, "Pre-Service Slides", null)).toBe("i4");
  });

  it("never matches a header, and gives up on a weak guess", () => {
    expect(matchPresentationToItem(PLAN, () => null, null, "Countdown Video", null)).toBe("i5");
    expect(matchPresentationToItem(PLAN, () => null, null, "Beginning of Service", null)).toBeNull();
  });
});
