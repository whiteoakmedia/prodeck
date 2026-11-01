import { describe, expect, it } from "vitest";
import { pageReach, reachLine } from "../lib/pageReach";

const crew = [
  { id: "a", name: "Devon Smith", notify: true },
  { id: "b", name: "Sam Lee", nickname: "Sammy", notify: false },
  { id: "c", name: "Ria Patel", notify: false },
  { id: "d", name: "Jo Park", notify: false },
  { id: "e", name: "Al Wu", notify: false },
];

describe("page reach", () => {
  it("counts who will feel it on a locked phone", () => {
    const r = pageReach(crew, ["a", "b"]);
    expect(r).toEqual({ buzzed: 1, quiet: ["Sammy"], unknown: false });
    expect(reachLine(r)).toBe("Sammy hasn't turned on notifications, so they'll only see this with ProDeck open.");
  });
  it("says nothing when everyone will get it, or when an older booth doesn't say", () => {
    expect(reachLine(pageReach(crew, ["a"]))).toBe("");
    expect(reachLine(pageReach([{ id: "x", name: "X" }], ["x"]))).toBe("");
  });
  it("shortens a long list", () => {
    expect(reachLine(pageReach(crew, ["b", "c", "d", "e"]))).toMatch(/^Sammy, Ria Patel, Jo Park and 1 more haven't/);
  });
});
