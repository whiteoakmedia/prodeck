import { describe, expect, it } from "vitest";
import { DEFAULT_LAPEL_WORDS, DEFAULT_MC_WORDS, micFor, SpeechKeeper } from "../lib/speechMics";

const cfg = { lapelWords: DEFAULT_LAPEL_WORDS, mcWords: DEFAULT_MC_WORDS };

describe("which speech mic a plan item needs", () => {
  it("reads the plan", () => {
    expect(micFor({ type: "item", title: "Message" }, cfg)).toBe("lapel");
    expect(micFor({ type: "item", title: "Sermon — Pastor Joe" }, cfg)).toBe("lapel");
    expect(micFor({ type: "item", title: "Welcome & Announcements" }, cfg)).toBe("mc");
    expect(micFor({ type: "item", title: "Offering" }, cfg)).toBe("mc");
    expect(micFor({ type: "song", title: "Build My Life" }, cfg)).toBeNull();
    expect(micFor({ type: "item", title: "Countdown" }, cfg)).toBeNull();
    // whole words only: "mc" inside a word doesn't count
    expect(micFor({ type: "item", title: "McDonald family video" }, cfg)).toBeNull();
  });
});

describe("the keeper", () => {
  it("opens the lapel for the message and closes it only once it's been quiet", () => {
    const k = new SpeechKeeper({ lapel: true, mc: true });
    expect(k.onItem("lapel", 0)).toEqual([{ type: "open", mic: "lapel", reason: "the message started" }]);
    k.onItem(null, 60_000); // plan moved to a song
    k.onLevel("lapel", -20, 64_000); // pastor still talking into the song
    expect(k.onTick(70_000)).toEqual([]);
    expect(k.onTick(72_100)).toEqual([expect.objectContaining({ type: "close", mic: "lapel" })]);
  });
  it("with no feed routed it never closes a mic — it reminds", () => {
    const k = new SpeechKeeper({ lapel: false, mc: false });
    k.onItem("mc", 0);
    k.onItem(null, 10_000);
    expect(k.onTick(30_000)).toEqual([]);
    expect(k.onTick(56_000)).toEqual([expect.objectContaining({ type: "remind", mic: "mc" })]);
    expect(k.onTick(90_000)).toEqual([]); // once
  });
  it("a person touching the mute takes that mic over until the next item", () => {
    const k = new SpeechKeeper({ lapel: true, mc: true });
    k.onItem("lapel", 0);
    k.onItem(null, 60_000);
    k.onDeskMute("lapel", 61_000); // someone pressed it
    expect(k.onTick(90_000)).toEqual([]);
  });
  it("our own open isn't mistaken for a person's press", () => {
    const k = new SpeechKeeper({ lapel: true, mc: true });
    k.onItem("lapel", 0);
    k.onDeskMute("lapel", 800); // the desk echoing our unmute
    k.onItem(null, 60_000);
    expect(k.onTick(69_000)).toEqual([expect.objectContaining({ type: "close" })]);
  });
});
