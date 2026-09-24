import { describe, expect, it } from "vitest";
import { BeatClock, parseCue, parseSection, sectionMatches } from "../lib/rig";
import { FollowEngine, makeSlide, type Action, type FSong } from "../lib/follow";

const beats = (bpm: number, n: number, t0 = 0, accentEvery = 4, eighths = false) => {
  const P = 60_000 / bpm;
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({ t: t0 + i * P, strength: 0.3, zcr: i % accentEvery === 0 ? 9 : 4 });
    if (eighths) out.push({ t: t0 + i * P + P / 2, strength: 0.1, zcr: 4 });
  }
  return out.sort((a, b) => a.t - b.t);
};

describe("the click as a clock", () => {
  it("finds the tempo and the bar from the accented downbeat", () => {
    const c = new BeatClock();
    for (const b of beats(98, 16)) c.onBeat(b);
    expect(c.bpm()).toBeCloseTo(98, 0);
    expect(c.hasBar()).toBe(true);
    const P = 60_000 / 98;
    expect(c.nextDownbeat(8 * P + 10)).toBeCloseTo(12 * P, -1);
  });
  it("picks quarter notes out of an eighth-note click using the song's BPM", () => {
    const c = new BeatClock();
    c.prior = 98;
    for (const b of beats(98, 16, 0, 4, true)) c.onBeat(b);
    expect(c.bpm()).toBeCloseTo(98, 0);
  });
  it("knows when the click has stopped", () => {
    const c = new BeatClock();
    for (const b of beats(120, 8)) c.onBeat(b);
    expect(c.running(3600)).toBe(true);
    expect(c.running(9000)).toBe(false);
  });
});

describe("guide cues", () => {
  it("reads section calls, count-ins, and ignores band calls", () => {
    expect(parseCue("Verse two.")).toEqual({ section: { kind: "verse", n: 2 } });
    expect(parseCue("Pre-Chorus")).toEqual({ section: { kind: "prechorus" } });
    expect(parseCue("1, 2, 1, 2, 3, 4.")).toEqual({ count: true });
    expect(parseCue("Breakdown.")).toEqual({});
    expect(parseCue("All in.")).toEqual({});
  });
  it("matches ProPresenter group names", () => {
    expect(sectionMatches(parseSection("Verse 2"), { kind: "verse", n: 2 })).toBe(true);
    expect(sectionMatches(parseSection("Verse 1"), { kind: "verse", n: 2 })).toBe(false);
    expect(sectionMatches(parseSection("Verse 1"), { kind: "verse" })).toBe(true);
    expect(sectionMatches(parseSection("-"), { kind: "instrumental" })).toBe(true);
    expect(sectionMatches(parseSection("Chorus"), { kind: "bridge" })).toBe(false);
  });
});

// Public-domain lyrics.
const song: FSong = {
  id: "s",
  name: "Holy",
  itemIdx: 0,
  bpm: 120,
  slides: [
    makeSlide(0, "", ""),
    { ...makeSlide(1, "Verse 1", "Holy holy holy\nLord God almighty"), groupStart: true },
    makeSlide(2, "Verse 1", "Early in the morning\nour song shall rise to thee"),
    { ...makeSlide(3, "Chorus", "God in three persons\nblessed trinity"), groupStart: true },
    { ...makeSlide(4, "Verse 2", "Holy holy holy\nall the saints adore thee"), groupStart: true },
    { ...makeSlide(5, "Chorus", "God in three persons\nblessed trinity"), groupStart: true },
  ],
};
const trig = (a: Action[]) => a.filter((x) => x.type === "trigger") as Extract<Action, { type: "trigger" }>[];

describe("a section call lands on its downbeat", () => {
  it("'Chorus' goes to the chorus now — no waiting — and anchors its beat map on the downbeat it announces", () => {
    const e = new FollowEngine([song], {});
    for (const b of beats(120, 40)) e.onBeat(b); // 500 ms beats, bar = 2 s, downbeats at 0, 2000, …
    e.onLive("s", 2, 10_000);
    const t = trig(e.onCue({ text: "Chorus.", t0: 16_000, t1: 16_600 }, 17_000));
    expect(t[0]).toMatchObject({ slide: 3, via: "cue" });
    expect(e.view.cueTarget).toMatchObject({ slide: 3, at: 18_000 });
  });
  it("with nothing locked, a cue locks the song ProPresenter has up", () => {
    const e = new FollowEngine([song, { ...song, id: "other", name: "Other" }], {});
    e.activeSongId = "s";
    const t = trig(e.onCue({ text: "Verse 2", t0: 1000, t1: 1500 }, 2000));
    expect(t[0]).toMatchObject({ slide: 4 });
    expect(t[0].song.id).toBe("s");
  });
  it("the band repeating a section ProPresenter doesn't have ahead: the guide wins, back it goes", () => {
    const e = new FollowEngine([song], {});
    e.onLive("s", 5, 0);
    expect(trig(e.onCue({ text: "Verse one", t0: 1000, t1: 1400 }, 2000))[0]).toMatchObject({ slide: 1 });
  });
  it("the second time through a section, its slides change on the beat", () => {
    const e = new FollowEngine([song], {});
    for (const b of beats(120, 200)) e.onBeat(b);
    // First verse: a person clicks slide 2 eight beats into the section.
    e.onCue({ text: "Verse 1", t0: 2000, t1: 2400 }, 3000); // → slide 1, section downbeat 4.0 s
    e.onLive("s", 1, 3000);
    e.onLive("s", 2, 7500); // 4.0 + 8 beats = 8.0 s, clicked 0.5 s early
    expect(e.timing["s"].slides["b:2"]).toEqual([8]);
    // Next time (a new run of the song): cue, and slide 2 comes up by itself.
    e.onLive("s", 5, 40_000);
    e.onCue({ text: "Verse 1", t0: 42_000, t1: 42_400 }, 43_000); // downbeat 44.0 → slide 2 due 48.0
    e.onLive("s", 1, 43_100);
    expect(trig(e.onTick(47_000))).toHaveLength(0);
    expect(trig(e.onTick(47_550))[0]).toMatchObject({ slide: 2, via: "beat" }); // a beat (0.5 s) early
  });
  it("a numbered call skips a look-alike: 'Verse 2' never lands Verse 1", () => {
    const e = new FollowEngine([song], {});
    for (const b of beats(120, 40)) e.onBeat(b);
    e.onLive("s", 3, 10_000);
    e.onCue({ text: "Verse two", t0: 12_000, t1: 12_500 }, 13_000);
    expect(e.view.cueTarget?.slide).toBe(4);
  });
  it("a call that matches no section in the song does nothing", () => {
    const e = new FollowEngine([song], {});
    e.onLive("s", 4, 0);
    e.onCue({ text: "Bridge", t0: 1000, t1: 1400 }, 2000);
    expect(e.view.cueTarget).toBeNull();
  });
  it("learns how many beats after the cue a person lands the section", () => {
    const e = new FollowEngine([song], {});
    e.practice = true;
    for (const b of beats(120, 80)) e.onBeat(b);
    for (const base of [10_000, 30_000]) {
      e.onLive("s", 2, base);
      e.onCue({ text: "Chorus", t0: base + 4000, t1: base + 4500 }, base + 5000);
      e.onLive("s", 3, base + 7500); // the person: 7 beats after the cue
      e.onLive("s", 4, base + 12_000);
    }
    expect(e.timing["__rig"].slides["cueBeats"]).toEqual([7, 7]);
  });
});
