import { describe, expect, it } from "vitest";
import { crewHost, NAME_MAX } from "../src/names";

describe("crewHost", () => {
  it("is one label under the zone, never anything else", () => {
    expect(crewHost("grace")).toBe("grace-crew.prodeck.live");
    expect(crewHost("st-johns", "example.org")).toBe("st-johns-crew.example.org");
    expect(() => crewHost("www.evil")).toThrow();
    expect(() => crewHost("")).toThrow();
    expect(() => crewHost("crew")).toThrow(); // reserved
  });
  it("stays a legal DNS label at the longest name", () => {
    const longest = "a".repeat(NAME_MAX);
    expect(crewHost(longest).split(".")[0].length).toBeLessThanOrEqual(63);
  });
});
