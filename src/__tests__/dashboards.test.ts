import { describe, expect, it } from "vitest";
import { DASHBOARD_TEMPLATES, defaultDashboards } from "../lib/dashboards";
import { WIDGET_MAP } from "../widgets/registry";

/**
 * Every widget a starter template places must actually exist.
 *
 * Two templates shipped placing a "mic_wall" widget that was never in the
 * registry. The grid rendered an unknown type as a bare <div>, so a new
 * install got a blank 12x6 tile holding its grid space that could not be
 * selected, moved or deleted — with nothing on screen to explain it.
 *
 * Nothing catches that by reading the code; the two files that have to agree
 * are far apart and neither imports the other. This does.
 */
describe("starter dashboards", () => {
  for (const t of DASHBOARD_TEMPLATES) {
    it(`"${t.name}" only places widgets that exist`, () => {
      const missing = t
        .build()
        .map((w) => w.type)
        .filter((type) => !WIDGET_MAP[type]);
      expect(missing, `unknown widget type(s) in the ${t.key} template`).toEqual([]);
    });
  }

  it("the first-run dashboard only places widgets that exist", () => {
    const missing = defaultDashboards()
      .flatMap((d) => d.widgets)
      .map((w) => w.type)
      .filter((type) => !WIDGET_MAP[type]);
    expect(missing).toEqual([]);
  });

  it("gives every widget a unique id, so React keys and deletes behave", () => {
    for (const t of DASHBOARD_TEMPLATES) {
      const ids = t.build().map((w) => w.id);
      expect(new Set(ids).size, `duplicate widget id in ${t.key}`).toBe(ids.length);
    }
  });

  it("keeps every widget inside the 12-column grid", () => {
    for (const t of DASHBOARD_TEMPLATES) {
      for (const w of t.build()) {
        expect(w.x, `${t.key}/${w.type} starts off-grid`).toBeGreaterThanOrEqual(0);
        expect(w.x + w.w, `${t.key}/${w.type} overflows 12 columns`).toBeLessThanOrEqual(12);
      }
    }
  });
});
