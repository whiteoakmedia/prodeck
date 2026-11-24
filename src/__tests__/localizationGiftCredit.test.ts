import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const original = readFileSync("src/__tests__/fixtures/localization/giftCreditBaseline.txt", "utf8");
const actual = readFileSync("src/components/GiftCredit.tsx", "utf8");

describe("gift credit localization", () => {
  it("changes only the reviewed visible copy, preserving links and behavior", () => {
    expect(actual).toBe(original
      .replace("A gift to every church from", "Un regalo para cada iglesia de")
      .replace("Support ProDeck", "Apoyar a ProDeck"));
  });
});
