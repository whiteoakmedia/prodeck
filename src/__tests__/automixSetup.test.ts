import { describe, expect, it } from "vitest";
import { DEFAULT_RULES, parseRules } from "../lib/automix";
import { formatFeeds, formatRules, guessRoles, nudgeNames, parseChannels, retargetRules, roleNames } from "../lib/automixSetup";

describe("guessRoles", () => {
  it("keeps a desk that already uses the default names", () => {
    const g = guessRoles(["EGs", "KEYs", "AGs", "Drums", "BGVs", "Lead Voc", "All FX", "TRX", "Pad"]);
    expect(g).toMatchObject({ eg: "EGs", keys: "KEYs", ag: "AGs", drums: "Drums", bgv: "BGVs", lead: "Lead Voc", fx: "All FX", trx: "TRX", pad: "Pad" });
  });

  it("reads another church's names", () => {
    const g = guessRoles(["Elec Gtr", "Piano", "Acoustic", "Kit", "Bass DI", "Backing Vox", "Lead", "Reverb", "Playback"]);
    expect(g).toMatchObject({ eg: "Elec Gtr", keys: "Piano", ag: "Acoustic", drums: "Kit", bass: "Bass DI", bgv: "Backing Vox", lead: "Lead", fx: "Reverb", trx: "Playback" });
  });

  it("uses a fader for one part only", () => {
    const g = guessRoles(["Guitars"]);
    expect(g.eg).toBe("Guitars");
    expect(g.ag).toBeUndefined();
  });

  it("finds bass on an input channel when there's no bass fader", () => {
    expect(guessRoles(["EGs"], [{ no: "9", name: "Kick" }, { no: "10", name: "Bass DI" }]).bass).toBe("ch 10");
    expect(guessRoles(["Bass"], [{ no: "10", name: "Bass DI" }]).bass).toBe("Bass");
  });

  it("leaves a part out when nothing fits", () => {
    expect(guessRoles(["Pastor", "Video"]).eg).toBeUndefined();
  });
});

describe("retargetRules", () => {
  it("renames each part to this desk's fader, in every moment", () => {
    const out = retargetRules(DEFAULT_RULES, {}, { eg: "Guitars", keys: "Piano", bass: "ch 12" });
    const r = parseRules(out);
    expect(r.verse.Guitars).toBe(-3);
    expect(r.verse.Piano).toBe(-2);
    expect(r.verse.EGs).toBeUndefined();
    expect(r.breakdown["ch 12"]).toBe(-2);
    expect(r.breakdown["ch 10"]).toBeUndefined();
    // Parts not answered keep their names.
    expect(r.verse.BGVs).toBe(-2);
  });

  it("drops a part the desk doesn't have", () => {
    const r = parseRules(retargetRules(DEFAULT_RULES, {}, { pad: "-", trx: "-" }));
    expect(Object.values(r).some((m) => "Pad" in m || "TRX" in m)).toBe(false);
    // A moment left empty disappears rather than becoming "outro:".
    expect(r.verse.EGs).toBe(-3);
  });

  it("renames from the previous answer on a second run", () => {
    const first = retargetRules(DEFAULT_RULES, {}, { eg: "Guitars" });
    const second = retargetRules(first, { eg: "Guitars" }, { eg: "Elec" });
    expect(parseRules(second).verse.Elec).toBe(-3);
    expect(parseRules(second).verse.Guitars).toBeUndefined();
  });

  it("starts from the defaults when there are no rules yet", () => {
    expect(parseRules(retargetRules("", {}, {})).verse.EGs).toBe(-3);
  });

  it("round-trips through the rules format", () => {
    const text = formatRules(parseRules(DEFAULT_RULES));
    expect(parseRules(text)).toEqual(parseRules(DEFAULT_RULES));
  });
});

describe("feeds and names", () => {
  it("writes feeds the way parseFeeds reads them", () => {
    expect(formatFeeds({ Guitars: [17, 18], Piano: [20], Empty: [] })).toBe("Guitars: 17, 18; Piano: 20");
  });

  it("reads a channel list", () => {
    expect(parseChannels("17, 18 x 0 300 20")).toEqual([17, 18, 20]);
  });

  it("nudges guitars, keys and acoustics by this desk's names", () => {
    expect(nudgeNames(undefined)).toEqual(["EGs", "KEYs", "AGs"]);
    expect(nudgeNames({ eg: "Guitars", ag: "-" })).toEqual(["Guitars", "KEYs"]);
    expect(roleNames({ bgv: "Choir" }).bgv).toBe("Choir");
  });
});
