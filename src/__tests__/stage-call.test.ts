import { describe, expect, it } from "vitest";
import { stageCallState, nextSongsAfter, fmtClock } from "../lib/stageCall";
import type { PlanItem } from "../pcoStore";

const it_ = (id: string, type: string, length: number, key = "", title = id): PlanItem =>
  ({ id, title, sequence: 0, length, type, description: "", key, leader: "" }) as PlanItem;

// A normal Sunday: opener, message, closing set.
const PLAN: PlanItem[] = [
  it_("h1", "header", 0, "", "Pre-service"),
  it_("s1", "song", 300, "D", "King of Kings"),
  it_("s2", "song", 360, "Ab", "Goodness of God"),
  it_("ann", "item", 240, "", "Announcements"),
  it_("msg", "item", 2100, "", "Message"),
  it_("h2", "header", 0, "", "Response"),
  it_("s3", "song", 320, "G", "Build My Life"),
  it_("s4", "song", 280, "E", "Great Are You Lord"),
  it_("close", "item", 120, "", "Closing"),
];

describe("keys to the stage", () => {
  const T0 = 1_000_000_000;

  // PCO publishes live_start_at (+ length) for the current item; the store turns
  // that into an END time. Every case below hands the widget that end time.
  const MSG_ENDS = T0 + 2100_000;

  it("counts down to Planning Center's end time and lists the songs that follow, with keys", () => {
    const s = stageCallState(PLAN, "msg", MSG_ENDS, T0 + 600_000, 300);
    expect(s.phase).toBe("waiting");
    expect(s.remaining).toBe(2100 - 600);
    expect(s.next.map((x) => `${x.title} (${x.key})`)).toEqual([
      "Build My Life (G)",
      "Great Are You Lord (E)",
    ]);
  });

  it("calls the team five minutes before the sermon ends", () => {
    const fiveMinLeft = MSG_ENDS - 300_000;
    expect(stageCallState(PLAN, "msg", MSG_ENDS, fiveMinLeft - 1000, 300).phase).toBe("waiting");
    expect(stageCallState(PLAN, "msg", MSG_ENDS, fiveMinLeft, 300).phase).toBe("call");
    expect(stageCallState(PLAN, "msg", MSG_ENDS, fiveMinLeft + 200_000, 300).phase).toBe("call");
  });

  it("keeps calling when the sermon runs long", () => {
    const s = stageCallState(PLAN, "msg", MSG_ENDS, T0 + 2200_000, 300);
    expect(s.phase).toBe("over");
    expect(s.remaining).toBeLessThan(0);
  });

  it("skips section headers when finding the next songs", () => {
    // "Response" is a header between the message and the closing set.
    expect(nextSongsAfter(PLAN, 4).map((x) => x.id)).toEqual(["s3", "s4"]);
  });

  it("does not call when nothing musical is next", () => {
    // Closing is live; nothing follows.
    expect(stageCallState(PLAN, "close", T0 + 120_000, T0 + 119_000, 300).phase).toBe("waiting");
    // Announcements is live and the next item is the message, not a song.
    expect(stageCallState(PLAN, "ann", T0 + 240_000, T0 + 239_000, 300).next).toEqual([]);
  });

  it("never calls when Planning Center hasn't published an end time", () => {
    // Nobody holds LIVE control, or the item is excluded: don't guess.
    const s = stageCallState(PLAN, "msg", null, T0, 300);
    expect(s.phase).toBe("waiting");
    expect(s.remaining).toBeNull();
  });

  it("shows the opening set while nothing is live", () => {
    const s = stageCallState(PLAN, null, null, T0, 300);
    expect(s.phase).toBe("idle");
    expect(s.next.map((x) => x.key)).toEqual(["D", "Ab"]);
  });

  it("formats a clock", () => {
    expect(fmtClock(299)).toBe("4:59");
    expect(fmtClock(-61)).toBe("1:01");
    expect(fmtClock(0)).toBe("0:00");
  });
});
