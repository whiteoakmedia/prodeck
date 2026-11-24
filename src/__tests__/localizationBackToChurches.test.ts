import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("translates the return link without changing its destination", () => {
  const baseline = readFileSync("src/__tests__/fixtures/localization/backToChurchesBaseline.txt", "utf8");
  const original = "Not your church? Back to your churches";
  expect(baseline.split(original)).toHaveLength(2);
  expect(readFileSync("src/components/BackToChurches.tsx", "utf8")).toBe(
    baseline.replace(original, "¿No es tu iglesia? Volver a tus iglesias"),
  );
});
