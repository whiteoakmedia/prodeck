import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
const copy: [string, string, number][] = [
  [
    "\"The booth is off, and it hasn't sent a plan yet.\"",
    "\"Control está apagado y todavía no envió un plan.\"",
    1
  ],
  [
    "`at ${time}`",
    "`a las ${time}`",
    1
  ],
  [
    "`yesterday at ${time}`",
    "`ayer a las ${time}`",
    1
  ],
  [
    "`on ${sent.toLocaleDateString(\"en-US\", { weekday: \"long\", month: \"short\", day: \"numeric\" })} at ${time}`",
    "`el ${sent.toLocaleDateString(\"es-419\", { weekday: \"long\", month: \"short\", day: \"numeric\" })} a las ${time}`",
    1
  ],
  [
    "`The booth is off. Showing the last plan it sent ${when}.`",
    "`Control está apagado. Mostrando el último plan enviado ${when}.`",
    1
  ]
];
it("preserves behavior and data outside reviewed copy", () => {
 let expected = readFileSync("src/__tests__/fixtures/localization/crewCloudCommsBaseline.txt", "utf8");
 for (const [from, to, count] of copy) { expect(expected.split(from)).toHaveLength(count + 1); expected = expected.split(from).join(to); }
 expect(readFileSync("src/lib/crewCloud.ts", "utf8")).toBe(expected);
});
