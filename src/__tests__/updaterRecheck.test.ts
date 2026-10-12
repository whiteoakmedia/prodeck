import { describe, expect, it } from "vitest";
import { RECHECK_MS, shouldRecheck } from "../updaterStore";

describe("update re-check", () => {
  it("looks again every few hours, not just at launch", () => {
    expect(RECHECK_MS).toBe(3 * 60 * 60 * 1000);
  });
  it("never interrupts an update that's showing or installing", () => {
    expect(shouldRecheck("uptodate")).toBe(true);
    expect(shouldRecheck("idle")).toBe(true);
    expect(shouldRecheck("error")).toBe(true);
    expect(shouldRecheck("available")).toBe(false);
    expect(shouldRecheck("downloading")).toBe(false);
    expect(shouldRecheck("ready")).toBe(false);
  });
});
