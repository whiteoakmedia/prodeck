import { describe, expect, it } from "vitest";
import { cueKey, DEFAULT_RULES, faderAt, parseRules, plan } from "../lib/automix";

const rules = parseRules(DEFAULT_RULES);
const home = { EGs: -5, KEYs: -8, Pad: -12, Drums: -3 };

describe("rules", () => {
  it("parses the operator's lines", () => {
    expect(rules.verse).toMatchObject({ EGs: -3, KEYs: -2, Pad: -2, TRX: -2, "Lead Voc": 1, BGVs: -2 });
    expect(rules.verse.Drums).toBeUndefined(); // drums and bass are the rock
    expect(rules.breakdown).toMatchObject({ Drums: -2, "ch 10": -2 });
    expect(parseRules("breakdown: channel 10 -2, Ch10 -1")).toEqual({ breakdown: { "ch 10": -1 } });
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
    expect(p.targets).toEqual({ EGs: -8, KEYs: -10, Pad: -14 }); // only the ones it names and has a home for
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
    expect(p.targets).toEqual({ Drums: -5 }); // breakdown: drums only -2 now
  });
});

import { barBeat, confirms, recordSection } from "../lib/automix";

describe("the song's map", () => {
  it("records sections on bar lines and ignores the guide repeating itself", () => {
    const P = 857; // 70 BPM
    expect(barBeat(10_000 + 31.6 * P, 10_000, P)).toBe(32);
    let run = recordSection([], { beat: 8, key: "verse" });
    run = recordSection(run, { beat: 12, key: "verse" }); // same call a bar later
    run = recordSection(run, { beat: 40, key: "chorus" });
    expect(run).toEqual([
      { beat: 8, key: "verse" },
      { beat: 40, key: "chorus" },
    ]);
  });
  it("a guide call confirms the map within four bars, or tells us the band went elsewhere", () => {
    const map = [
      { beat: 8, key: "verse" },
      { beat: 40, key: "chorus" },
      { beat: 72, key: "verse" },
    ];
    expect(confirms(map, "chorus", 44)).toBe(1);
    expect(confirms(map, "bridge", 72)).toBe(-1);
  });
});

import { BgvRider, effectiveRules, FeedWatch, observe, parseFeeds, repeatBoost, repeatIndex, suggestions, type Observations } from "../lib/automix";

describe("repeats climb", () => {
  it("uses the guide's number, else counts passes in a row, and caps at +3", () => {
    expect(repeatIndex("bridge", 1, "bridge", null)).toBe(2);
    expect(repeatIndex("verse", 1, "bridge", null)).toBe(1);
    expect(repeatIndex("bridge", 1, "bridge", 3)).toBe(3);
    expect(repeatBoost(rules, "bridge", 3)).toMatchObject({ EGs: 2, BGVs: 2, KEYs: 1 });
    expect(repeatBoost(rules, "bridge", 9).EGs).toBe(3);
    expect(repeatBoost(rules, "verse", 3)).toEqual({});
  });
});

describe("per-song learning", () => {
  it("suggests the operator's number where he keeps overriding, per song", () => {
    let obs: Observations = {};
    obs = observe(obs, "bml", "verse", "EGs", -8.2);
    obs = observe(obs, "bml", "verse", "EGs", -7.9);
    obs = observe(obs, "bml", "verse", "KEYs", -2.1); // agrees with the rule
    const s = suggestions(obs, rules, {}, { bml: "Build My Life" }, new Set());
    expect(s).toEqual([{ song: "bml", songName: "Build My Life", key: "verse", fader: "EGs", current: -3, suggested: -8, n: 2 }]);
    // accepted → the song's own rule, and the suggestion goes away
    const songRules = { bml: { verse: { EGs: -8 } } };
    expect(effectiveRules(rules, songRules.bml).verse.EGs).toBe(-8);
    expect(effectiveRules(rules, songRules.bml).verse.KEYs).toBe(-2);
    expect(suggestions(obs, rules, songRules, {}, new Set())).toEqual([]);
    // dismissed stays dismissed
    expect(suggestions(obs, rules, {}, {}, new Set(["bml|verse|EGs|-8"]))).toEqual([]);
  });
});

describe("the BGV rider", () => {
  it("up when a backing singer sings (not the lead), holds through a breath, down after", () => {
    const r = new BgvRider();
    for (let t = 0; t < 3000; t += 100) r.update({ "1": -60, "2": -62, "3": -61 }, "1", t);
    expect(r.update({ "1": -15, "2": -62, "3": -61 }, "1", 3100)).toBe(false); // only the lead
    expect(r.update({ "1": -15, "2": -20, "3": -61 }, "1", 3200)).toBe(true); // mic 2 sings
    expect(r.update({ "1": -15, "2": -62, "3": -61 }, "1", 4500)).toBe(true); // a breath
    expect(r.update({ "1": -15, "2": -62, "3": -61 }, "1", 6000)).toBe(false);
  });
});

describe("instruments by their feeds", () => {
  it("parses the feed map", () => {
    expect(parseFeeds("EGs: 17, 18; KEYs: 20; ch 10: 16")).toEqual({ EGs: [17, 18], KEYs: [20], "ch 10": [16] });
  });
  it("finds the one carrying an instrumental and trims one that dug in", () => {
    const w = new FeedWatch();
    let t = 0;
    for (; t < 30_000; t += 83) w.update({ EGs: -30, KEYs: -32, AGs: -35 }, t);
    for (; t < 33_000; t += 83) w.update({ EGs: -22, KEYs: -32, AGs: -35 }, t); // EG solo
    expect(w.leading(["EGs", "KEYs", "AGs"])).toBe("EGs");
    let trims: string[] = [];
    for (; t < 40_000; t += 83) {
      w.update({ EGs: -22, KEYs: -32, AGs: -35 }, t);
      trims = trims.concat(w.checkTrims(["EGs", "KEYs", "AGs"], t).trim);
    }
    expect(trims).toEqual(["EGs"]);
    expect(w.playing("AGs")).toBe(true);
  });
});
