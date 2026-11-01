import { describe, expect, it } from "vitest";
import { parseProMacros, proMacroButtons, textOn } from "../lib/proMacros";

const pro = [
  { id: { uuid: "a", name: "Walk-in", index: 0 }, color: { red: 1, green: 0, blue: 0, alpha: 1 } },
  { id: { uuid: "b", name: "Sermon", index: 1 }, color: { red: 0.9, green: 0.9, blue: 0.2, alpha: 1 } },
  { id: { uuid: "c", name: "Clear to Logo", index: 2 } },
];

describe("ProPresenter macros", () => {
  it("reads Pro's list with its colours, in any wrapper", () => {
    const m = parseProMacros(pro);
    expect(m.map((x) => x.name)).toEqual(["Walk-in", "Sermon", "Clear to Logo"]);
    expect(m[0].color).toBe("rgb(255, 0, 0)");
    expect(m[2].color).toBeNull();
    expect(parseProMacros({ macros: pro })).toHaveLength(3);
    expect(parseProMacros(null)).toEqual([]);
    expect(parseProMacros([{ id: { name: "no uuid" } }])).toEqual([]);
  });

  it("keeps the tile's order and hides what it hides", () => {
    const m = parseProMacros(pro);
    expect(proMacroButtons(m, { order: ["c"] }).map((x) => x.uuid)).toEqual(["c", "a", "b"]);
    expect(proMacroButtons(m, { hidden: ["a"] }).map((x) => x.uuid)).toEqual(["b", "c"]);
    expect(proMacroButtons(m, { hidden: ["a"] }, { includeHidden: true })).toHaveLength(3);
  });

  it("picks readable text for the colour", () => {
    expect(textOn("rgb(255, 0, 0)")).toBe("#fff");
    expect(textOn("rgb(230, 230, 51)")).toBe("#111");
    expect(textOn(null)).toBeUndefined();
  });
});
