import { describe, expect, it } from "vitest";
import { WIDGETS } from "../widgets/registry";
import { WIDGET_BLURBS } from "../widgets/previews";

describe("widget library", () => {
  it("has a one line description for every widget", () => {
    const missing = WIDGETS.filter((w) => !WIDGET_BLURBS[w.type]).map((w) => w.type);
    expect(missing).toEqual([]);
  });
  it("keeps descriptions short, plain and without dashes", () => {
    for (const [type, text] of Object.entries(WIDGET_BLURBS)) {
      expect(text.length, type).toBeLessThanOrEqual(80);
      expect(text, type).not.toMatch(/[—–]| - /);
    }
  });
});
