import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
const copy: [string, string, number][] = [
  [
    "export const DAY_NAMES = [\"Sun\", \"Mon\", \"Tue\", \"Wed\", \"Thu\", \"Fri\", \"Sat\"];",
    "export const DAY_NAMES = [\"Dom\", \"Lun\", \"Mar\", \"Mié\", \"Jue\", \"Vie\", \"Sáb\"];",
    1
  ],
  [
    "\"Weekly · \" +",
    "\"Semanal · \" +",
    1
  ]
];
it("protects src/checklistStore.tsx outside reviewed presentation", () => {
 let expected = readFileSync("src/__tests__/fixtures/localization/checklistStore-20261123-baseline.txt", "utf8");
 for (const [from, to, count] of copy) { expect(expected.split(from)).toHaveLength(count + 1); expected = expected.split(from).join(to); }
 expect(readFileSync("src/checklistStore.tsx", "utf8")).toBe(expected);
});
