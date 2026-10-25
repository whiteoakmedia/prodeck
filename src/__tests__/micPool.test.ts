import { describe, expect, it } from "vitest";
import { micPool } from "../lib/micPool";

const team = [
  { id: "a", position: "Soprano" },
  { id: "b", position: "Alto" },
  { id: "c", position: "Broadcast Audio Engineer" },
];

describe("micPool", () => {
  it("keeps everyone on the tile after the first mic is assigned, with no mic positions chosen", () => {
    // The report: give one person a mic and everyone else disappeared.
    expect(micPool(team, [], (m) => m.id === "a").map((m) => m.id)).toEqual(["a", "b", "c"]);
    expect(micPool(team, [], () => false).map((m) => m.id)).toEqual(["a", "b", "c"]);
  });

  it("with mic positions chosen, shows those positions plus anyone already given a mic", () => {
    expect(micPool(team, ["Soprano", "Alto"], () => false).map((m) => m.id)).toEqual(["a", "b"]);
    expect(micPool(team, ["Soprano"], (m) => m.id === "c").map((m) => m.id)).toEqual(["a", "c"]);
  });
});
