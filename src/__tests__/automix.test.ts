import { describe, expect, it } from "vitest";
import { cueKey, DEFAULT_RULES, faderAt, parseRules, plan } from "../lib/automix";

const rules = parseRules(DEFAULT_RULES);
const home = { EGs: -5, KEYs: -8, Pad: -12, Drums: -3 };

describe("rules", () => {
  it("parses the operator's lines", () => {
    expect(rules.verse).toMatchObject({ EGs: -3, KEYs: -2, Pad: -2, Drums: -1, TRX: -2, "Lead Voc": 1, BGVs: -2 });
    expect(rules.breakdown.Drums).toBe(-8);
    expect(parseRules("pre-chorus: EGs -1.5\n# note\nbogus")).toEqual({ prechorus: { EGs: -1.5 } });
  });
  it("maps guide calls to rules", () => {
    expect(cueKey("Verse two.")).toBe("verse");
    expect(cueKey("Chorus")).toBe("chorus");
    expect(cueKey("Break down.")).toBe("breakdown");
    expect(cueKey("All in.")).toBe("allin");
    expect(cueKey("Tag")).toBe("chorus");
    expect(cueKey("1, 2, 3, 4")).toBeNull();
  });
});

describe("a move", () => {
  it("lands on the downbeat, fades over one bar, relative to the operator's own positions", () => {
    const p = plan("verse", rules, home, new Set(), 10_000, 500)!;
    expect(p.targets).toEqual({ EGs: -8, KEYs: -10, Pad: -14, Drums: -4 }); // only the ones with a home
    expect(p.fadeMs).toBe(2000);
    const from = { EGs: -5, KEYs: -8, Pad: -12, Drums: -3 };
    expect(faderAt(p, from, 9_000).EGs).toBe(-5); // before the downbeat: nothing yet
    expect(faderAt(p, from, 11_000).EGs).toBeCloseTo(-6.5); // half-way through the bar
    expect(faderAt(p, from, 13_000).EGs).toBe(-8);
  });
  it("Build ramps home over four bars", () => {
    expect(plan("build", rules, home, new Set(), 0, 500)!.fadeMs).toBe(8000);
  });
  it("never touches a DCA it has no home for, or one a person took over", () => {
    const p = plan("breakdown", rules, { Drums: -3, EGs: -5 }, new Set(["EGs"]), 0, 500)!;
    expect(p.targets).toEqual({ Drums: -11 });
  });
});
