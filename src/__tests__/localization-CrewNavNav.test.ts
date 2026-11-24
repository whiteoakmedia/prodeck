import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
const copy: [string, string][] = [
  [
    "checklist: \"Checklist\"",
    "checklist: \"Lista de tareas\""
  ],
  [
    "dashboards: \"Dashboards\"",
    "dashboards: \"Paneles de control\""
  ],
  [
    "more: \"More\"",
    "more: \"Más\""
  ]
];
it("preserves mobile navigation and actions outside reviewed copy", () => {
 let expected = readFileSync("src/__tests__/fixtures/localization/CrewNavNavBaseline.txt", "utf8");
 for (const [from, to] of copy) { expect(expected.split(from)).toHaveLength(2); expected = expected.replace(from, to); }
 expect(readFileSync("src/mobile/CrewNav.tsx", "utf8")).toBe(expected);
});
