import { describe, expect, it } from "vitest";
import { parseLiveEndsAt } from "../pcoStore";

/**
 * Planning Center's live countdown, as it actually arrives.
 *
 * Read from a real current_item_time on this church's account: while an item
 * is LIVE, live_start_at is set and live_end_at is NULL — PCO fills the end
 * only once the item has been advanced past. Guessing that live_end_at would
 * always be there would have produced a widget that never counted down.
 */
const T = "2026-09-07T10:11:40Z";
const T_MS = Date.parse(T);
const cit = (attributes: Record<string, unknown>) => ({ data: { attributes } });

describe("parseLiveEndsAt", () => {
  it("computes the end from start + length while the item is live (the normal case)", () => {
    expect(parseLiveEndsAt(cit({ live_start_at: T, live_end_at: null, length: 2100, length_offset: 0 })))
      .toBe(T_MS + 2100_000);
  });

  it("applies length_offset the way LIVE does", () => {
    expect(parseLiveEndsAt(cit({ live_start_at: T, live_end_at: null, length: 600, length_offset: -60 })))
      .toBe(T_MS + 540_000);
  });

  it("prefers live_end_at when PCO has filled it", () => {
    const end = "2026-09-07T10:40:00Z";
    expect(parseLiveEndsAt(cit({ live_start_at: T, live_end_at: end, length: 2100 }))).toBe(Date.parse(end));
  });

  it("refuses to guess", () => {
    // Excluded from this service time; no start; zero length; nothing at all.
    expect(parseLiveEndsAt(cit({ live_start_at: T, length: 600, exclude: true }))).toBeNull();
    expect(parseLiveEndsAt(cit({ live_end_at: null, length: 600 }))).toBeNull();
    expect(parseLiveEndsAt(cit({ live_start_at: T, length: 0 }))).toBeNull();
    expect(parseLiveEndsAt(null)).toBeNull();
    expect(parseLiveEndsAt({})).toBeNull();
  });
});
