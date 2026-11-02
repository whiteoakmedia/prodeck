import { describe, expect, it } from "vitest";
import { leaderLine } from "../lib/leaderLine";

describe("the leader line under a song", () => {
  it("says who leads", () => {
    expect(leaderLine("Maria Delgado")).toBe("Maria Delgado leads");
    expect(leaderLine("  ")).toBe("");
  });
  it("leaves a PCO note that already says it alone", () => {
    expect(leaderLine("Maria lead")).toBe("Maria lead");
    expect(leaderLine("Led by Josh")).toBe("Led by Josh");
    expect(leaderLine("Josh leading, Maria harmony")).toBe("Josh leading, Maria harmony");
  });
  it("isn't fooled by words that merely start the same", () => {
    expect(leaderLine("Leah Park")).toBe("Leah Park leads");
  });
});
