import { describe, expect, it } from "vitest";
import { dayKey, serviceWindows, slotAt, tapWindow, OVERRUN_MS, PRE_SERVICE_MS } from "../lib/serviceWindow";

const at = (h: number, m = 0, day = 1) => new Date(2026, 10, day, h, m).getTime(); // Sunday 1 Nov 2026
const sunday = [
  { id: "t8", ts: at(8) },
  { id: "t930", ts: at(9, 30) },
  { id: "t11", ts: at(11) },
  { id: "t1230", ts: at(12, 30) },
];
const PLAN = 75 * 60_000;

describe("service windows", () => {
  it("never overlap, and the last one ends", () => {
    const w = serviceWindows(sunday, PLAN);
    expect(w.map((x) => x.id)).toEqual(["t8", "t930", "t11", "t1230"]);
    for (let i = 1; i < w.length; i++) expect(w[i].start).toBeGreaterThanOrEqual(w[i - 1].end);
    expect(w[0].start).toBe(at(8) - PRE_SERVICE_MS);
    expect(w[0].end).toBe(at(9, 15)); // the next service's pre-service starts
    expect(w[3].end).toBe(at(12, 30) + PLAN + OVERRUN_MS); // 14:30
  });

  it("files pre-service into the service and a long service up to the next one", () => {
    expect(slotAt(at(7, 50), sunday, PLAN, "t8")).toMatchObject({ kind: "service", timeId: "t8" });
    expect(slotAt(at(9, 14), sunday, PLAN, "t8")).toMatchObject({ kind: "service", timeId: "t8" });
    expect(slotAt(at(9, 16), sunday, PLAN, "t8")).toMatchObject({ kind: "service", timeId: "t930" });
  });

  it("calls everything outside a service practice", () => {
    // Sunday morning run-through.
    expect(slotAt(at(7, 0), sunday, PLAN, "t8").kind).toBe("practice");
    // Sunday afternoon, after the last service.
    expect(slotAt(at(15, 0), sunday, PLAN, "t1230").kind).toBe("practice");
    // Thursday rehearsal with Sunday's plan selected.
    expect(slotAt(at(18, 30, 5), sunday, PLAN, "t1230").kind).toBe("practice");
  });

  it("treats a plan with no times as the selected service", () => {
    expect(slotAt(at(10), [{ id: "x", ts: 0 }], PLAN, "x")).toMatchObject({ kind: "service", timeId: "x" });
  });

  it("keys practice by the local day", () => {
    expect(dayKey(at(18, 30, 5))).toBe("2026-11-05");
  });
});

describe("tap windows", () => {
  it("clips a service to its own window so taps aren't counted twice", () => {
    const w = serviceWindows(sunday, PLAN)[3];
    // Recorded into Wednesday (the old bug): clipped at 14:30 Sunday.
    expect(tapWindow({ rehearsal: false, startedAt: at(12, 15), endedAt: at(12, 0, 4), windowStart: w.start, windowEnd: w.end })).toEqual({ from: at(12, 15), to: w.end });
  });

  it("caps old buckets at three hours and never counts practice", () => {
    expect(tapWindow({ rehearsal: false, startedAt: at(12), endedAt: at(9, 0, 4) })).toEqual({ from: at(12), to: at(15) });
    expect(tapWindow({ rehearsal: true, startedAt: at(7), endedAt: at(7, 40) })).toBeNull();
    expect(tapWindow({ rehearsal: false })).toBeNull();
  });
});
