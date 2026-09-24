import { describe, expect, it } from "vitest";
import {
  align,
  askBody,
  buildIdf,
  flatten,
  FollowEngine,
  heardTokens,
  makeSlide,
  parsePick,
  tokenize,
  wordSim,
  type Action,
  type FSong,
  type Heard,
} from "../lib/follow";

// Public-domain hymns only in fixtures. This one reproduces the trap that
// lost "Build My Life" in the first live test: Verse 2 ends on the same line
// as Verse 1, and that line sits on two identical slides back to back.
const holy: FSong = {
  id: "holy",
  name: "Holy, Holy, Holy",
  itemIdx: 1,
  bpm: 60, // two bars at 60 BPM = 8 s a line
  slides: [
    makeSlide(0, "", ""),
    makeSlide(1, "Verse 1", "Holy holy holy\nLord God almighty"),
    makeSlide(2, "Verse 1", "Early in the morning\nour song shall rise to thee"),
    makeSlide(3, "Verse 1", "God in three persons"),
    makeSlide(4, "Verse 2", "Holy holy holy\nall the saints adore thee"),
    makeSlide(5, "Verse 2", "God in three persons"),
    makeSlide(6, "Verse 2", "God in three persons"),
    makeSlide(7, "Chorus", "Blessed trinity"),
  ],
};
const grace: FSong = {
  id: "grace",
  name: "Amazing Grace",
  itemIdx: 3,
  bpm: 80,
  slides: [
    makeSlide(0, "Verse 1", "Amazing grace how sweet the sound\nThat saved a wretch like me"),
    makeSlide(1, "Verse 1", "I once was lost but now am found\nWas blind but now I see"),
  ],
};

/** A Whisper window whose words are spread from t0 at `gap` ms each. */
function win(text: string, t0: number, gap = 600, extra: Partial<Heard> = {}): Heard {
  const ws = text.split(/\s+/).filter(Boolean);
  const words = ws.map((w, k) => ({ w, t0: t0 + k * gap, t1: t0 + k * gap + gap * 0.8 }));
  const end = words[words.length - 1].t1 + 300;
  return { text, start: end - 4000, end, langP: 0.93, logprob: -0.1, words, ...extra };
}
const triggers = (a: Action[]) => a.filter((x) => x.type === "trigger") as Extract<Action, { type: "trigger" }>[];
/** Feed a window, then tick every 250 ms up to `until`; return all triggers. */
function play(e: FollowEngine, h: Heard, until = h.end + 1500) {
  const out = triggers(e.onHeard(h, h.end + 1500));
  for (let t = h.end + 1750; t <= until; t += 250) out.push(...triggers(e.onTick(t)));
  return out;
}

describe("words", () => {
  it("normalises apostrophes, plurals, -ing and punctuation", () => {
    expect(tokenize("Sweetly singing o'er the plains!")).toEqual(["sweetly", "sing", "oer", "the", "plain"]);
    expect(tokenize("Echoing")).toEqual(tokenize("echo"));
  });
  it("hears 'pain' for 'plain' as close, 'king' for 'lord' as not", () => {
    expect(wordSim("plain", "pain")).toBeGreaterThan(0.7);
    expect(wordSim("king", "lord")).toBe(0);
  });
  it("drops the words Whisper squashed into the window's last instant (a line it finished itself)", () => {
    const h: Heard = {
      text: "gloria in excelsis deo gloria in excelsis deo",
      start: 0,
      end: 4000,
      words: [
        { w: "gloria", t0: 500, t1: 900 },
        { w: "in", t0: 1200, t1: 1400 },
        { w: "excelsis", t0: 1500, t1: 2100 },
        { w: "deo", t0: 2600, t1: 3000 },
        { w: "gloria", t0: 3500, t1: 3600 },
        { w: "in", t0: 3520, t1: 3600 },
        { w: "excelsis", t0: 3530, t1: 3600 },
        { w: "deo", t0: 3540, t1: 3600 },
      ],
    };
    expect(heardTokens(h).map((t) => t.tok)).toEqual(["gloria", "in", "excelsi", "deo", "gloria"]);
  });
});

describe("alignment", () => {
  const f = flatten(holy, buildIdf([holy, grace]));
  it("tags every word with its slide and line", () => {
    expect(f.toks.slice(0, 5)).toEqual(["holy", "holy", "holy", "lord", "god"]);
    expect(f.slide[f.first.get(5)!]).toBe(5);
    expect(f.line[f.first.get(2)!]).toBe(2);
  });
  it("places a repeated line at the occurrence nearest where the singers should be", () => {
    const h = heardTokens(win("God in three persons", 0));
    const near5 = align(h, f, 0, f.toks.length - 1, f.last.get(5)!)!;
    expect(f.slide[near5.path[near5.path.length - 1][1]]).toBe(5);
    const near3 = align(h, f, 0, f.toks.length - 1, f.last.get(3)!)!;
    expect(f.slide[near3.path[near3.path.length - 1][1]]).toBe(3);
  });
  it("won't leap a phrase to reach a look-alike", () => {
    // "holy holy holy … holy" — the last "holy" must not jump to Verse 2.
    const a = align(heardTokens(win("holy holy holy holy", 0)), f, 0, f.toks.length - 1, 0)!;
    expect(Math.max(...a.path.map(([, l]) => l))).toBeLessThan(f.first.get(4)!);
  });
});

describe("song lock", () => {
  it("locks onto the song being sung and lands on the right slide", () => {
    const e = new FollowEngine([holy, grace], {});
    const t = play(e, win("early in the morning our song", 10_000));
    expect(t[0]).toMatchObject({ slide: 2, via: "heard" });
    expect(t[0].song.id).toBe("holy");
  });
  it("ignores what Whisper 'hears' in an instrumental", () => {
    const e = new FollowEngine([holy, grace], {});
    expect(play(e, win("amazing grace how sweet the sound", 10_000, 600, { langP: 0.38, logprob: -0.41 }))).toHaveLength(0);
    expect(e.view.hearing).toBe("music");
  });
  it("follows ProPresenter when a person picks the song", () => {
    const e = new FollowEngine([holy, grace], {}, { prompt: "current" });
    const a = e.onLive("grace", 0, 1000);
    expect(e.view.song).toBe("Amazing Grace");
    expect(a.find((x) => x.type === "prompt")).toMatchObject({ text: expect.stringMatching(/how sweet the sound/) });
  });
});

describe("the Build My Life trap", () => {
  it("walks Verse 2's shared, duplicated ending in order and lands the chorus", () => {
    const e = new FollowEngine([holy, grace], {});
    e.onLive("holy", 4, 0);
    const moves: number[] = [];
    const go = (h: Heard, until?: number) => moves.push(...play(e, h, until).map((t) => t.slide));
    go(win("holy holy holy", 500, 800));
    go(win("all the saints adore thee", 8500, 800), 16_500); // last line of slide 4 → 5 as it ends
    expect(moves).toEqual([5]);
    go(win("God in three persons", 16_500, 800), 24_000); // slide 5 — NOT back to Verse 1's slide 3
    expect(moves).toEqual([5, 6]);
    go(win("God in three persons", 24_500, 800), 32_000); // the duplicate slide 6
    expect(moves).toEqual([5, 6, 7]);
  });
  it("hears one sung line in two overlapping windows as one line, not two", () => {
    const e = new FollowEngine([holy, grace], {});
    e.onLive("holy", 5, 0);
    // The same words re-heard 2 s later, times drifted by a second.
    play(e, win("God in three persons", 500, 700), 3500);
    const second = play(e, win("God in three persons", 1500, 700), 4500);
    expect(second.map((t) => t.slide)).not.toContain(7);
  });
});

describe("on time", () => {
  it("changes as the slide's last line ends — not when it starts, not when the next begins", () => {
    const e = new FollowEngine([holy, grace], {});
    e.onLive("holy", 1, 0);
    play(e, win("holy holy holy", 500, 800), 7000);
    // The last line is sung 8.5–10.7 s. A line is 8 s; the earlier of "a
    // line after it started" (16.5) and "half a line after its last word"
    // (14.7) is 14.7, shown 0.4 s early.
    expect(play(e, win("Lord God almighty", 8500, 800), 14_000)).toHaveLength(0);
    expect(triggers(e.onTick(14_500))[0]).toMatchObject({ slide: 2 });
  });
  it("a slow line whose last word is held: moves a line after the line began", () => {
    const e = new FollowEngine([holy, grace], {});
    e.onLive("holy", 1, 0);
    play(e, win("holy holy holy", 500, 800), 7000);
    // "Lord God …" drawn out; "almighty" not heard yet. Due = 8.5 + 8 = 16.5.
    expect(play(e, win("Lord God", 8500, 2600), 15_900)).toHaveLength(0);
    expect(triggers(e.onTick(16_200))[0]).toMatchObject({ slide: 2 });
  });
  it("catches up when the next slide is already being sung", () => {
    const e = new FollowEngine([holy, grace], {});
    e.onLive("holy", 1, 0);
    const t = play(e, win("early in the morning our song", 9000));
    expect(t[0]).toMatchObject({ slide: 2, reason: "heard the next slide" });
  });
  it("won't skip ahead on a window Whisper was unsure of", () => {
    const e = new FollowEngine([holy, grace], {});
    e.onLive("holy", 1, 0);
    expect(play(e, win("our song shall rise to thee", 9000, 600, { langP: 0.34 }))).toHaveLength(0);
    // Whisper's repetition loop is noise, however confident.
    expect(play(e, win("the name of the Lord is the name of the Lord is the name of the Lord", 14_000, 200))).toHaveLength(0);
  });
  it("learns slide lengths from a person's clicks only, and moves a blank slide on time", () => {
    const e = new FollowEngine([holy, grace], {});
    e.onLive("holy", 0, 0);
    e.onLive("holy", 1, 6000); // a person: blank slide lasted 6 s
    expect(e.dwell(holy, 0)).toBe(6000);
    expect(e.timingDirty).toBe(true);
    // Next time the blank is up and the band is playing: it moves at ~5.6 s.
    e.onLive("grace", 0, 50_000);
    e.onLive("holy", 0, 100_000);
    e.onHeard({ text: "", start: 100_500, end: 104_500, quiet: false, langP: 0.2 }, 104_600);
    expect(triggers(e.onTick(105_000))).toHaveLength(0);
    expect(triggers(e.onTick(105_700))[0]).toMatchObject({ slide: 1, via: "clock" });
  });
  it("in practice, a person's click after Follow's would-be move still teaches", () => {
    const e = new FollowEngine([holy, grace], {});
    e.practice = true;
    e.onLive("holy", 1, 0);
    play(e, win("early in the morning our song", 9000)); // Follow would move to 2 now
    e.onLive("holy", 2, 12_000); // the person clicks 2 at 12 s
    expect(e.dwell(holy, 1)).toBe(12_000);
  });
  it("rescales learned lengths when the tempo changes", () => {
    const e = new FollowEngine([{ ...holy, bpm: 80 }], { holy: { bpm: 60, slides: { "2": [8000, 8000] } } });
    expect(e.dwell({ ...holy, bpm: 80 }, 2)).toBeCloseTo(6000);
  });
  it("prompts Whisper with the current slide only — never the lines still to come", () => {
    const e = new FollowEngine([holy, grace], {}, { prompt: "current" });
    expect(e.onLive("holy", 2, 0)[0]).toMatchObject({ type: "prompt", text: "Early in the morning our song shall rise to thee" });
    expect(new FollowEngine([holy], {}).onLive("holy", 2, 0)).toEqual([]);
  });
});

describe("the model", () => {
  it("builds a numbered lyric and parses the one-line answer", () => {
    const body = askBody({ type: "ask", song: holy, current: 3, transcript: "", expect: 4 }, "god in three persons");
    expect(body.messages[0].content).toMatch(/\[3\] \(Verse 1\) God in three persons/);
    expect(body.messages[0].content).toMatch(/Current slide: 3/);
    expect(parsePick({ content: [{ type: "text", text: 'Sure: {"slide": 6, "confidence": 0.8, "noise": false}' }] })).toEqual({ slide: 6, confidence: 0.8, noise: false });
    expect(parsePick({ content: [{ type: "text", text: "no idea" }] })).toBeNull();
  });
});
