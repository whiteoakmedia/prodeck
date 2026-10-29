import { describe, expect, it } from "vitest";
import { boardSources, cardLabel, findSource, liveAndNext, tallyOf, tallyQuery, tallySources, tallyView } from "../lib/tally";
import type { AtemSnapshot } from "../lib/tauri";

/**
 * A camera operator trusts this colour. Red when it isn't on air sends them
 * still; dark when it is lets them pan across the pastor live.
 */
const snap = (over: Partial<AtemSnapshot> = {}): AtemSnapshot => ({
  connected: true, ready: true, product: "ATEM", me: 0, mes: 1,
  program: 1, preview: 2, inTransition: false, error: null,
  inputs: [
    { id: 0, name: "Black", short: "BLK", camera: false },
    { id: 1, name: "Camera 1 Wide", short: "CAM1", camera: true },
    { id: 2, name: "Camera 2 Pulpit", short: "CAM2", camera: true },
    { id: 3, name: "Camera 3", short: "CAM3", camera: true },
  ],
  ...over,
});

describe("camera tally", () => {
  it("follows the switcher's own tally when it has sent one", () => {
    // Camera 3 is on air through a key even though Program is camera 1.
    const s = snap({ tally: { "1": 1, "3": 1, "2": 2 } });
    expect(tallyOf(s, 3)).toBe("program");
    expect(tallyOf(s, 1)).toBe("program");
    expect(tallyOf(s, 2)).toBe("preview");
    expect(tallyOf(s, 0)).toBe("off");
    expect(tallyOf(snap({ tally: { "2": 3 } }), 2)).toBe("program");
  });

  it("falls back to Program and Preview, both on air mid-transition", () => {
    expect(tallyOf(snap(), 1)).toBe("program");
    expect(tallyOf(snap(), 2)).toBe("preview");
    expect(tallyOf(snap(), 3)).toBe("off");
    expect(tallyOf(snap({ inTransition: true }), 2)).toBe("program");
    expect(tallyOf(snap({ tally: {} }), 1)).toBe("program");
    expect(tallyOf(null, 1)).toBe("off");
  });

  it("uses the tally link's M/E for the fallback", () => {
    const two = snap({ mes: 2, buses: [{ program: 1, preview: 2, inTransition: false }, { program: 3, preview: 1, inTransition: false }] });
    expect(tallyOf(two, 3, 1)).toBe("program");
    expect(tallyOf(two, 3)).toBe("off");
  });

  it("finds the camera by number or name", () => {
    expect(findSource(snap(), "2")?.name).toBe("Camera 2 Pulpit");
    expect(findSource(snap(), "cam3")?.id).toBe(3);
    expect(findSource(snap(), "camera 1 wide")?.id).toBe(1);
    expect(findSource(snap(), "9")).toBeNull();
    expect(findSource(snap(), " ")).toBeNull();
  });

  it("lists cameras first and builds a link that keeps its options", () => {
    expect(tallySources(snap()).map((i) => i.id)).toEqual([1, 2, 3, 0]);
    expect(tallyQuery(2, "pw")).toBe("/?tally=2&token=pw");
    expect(tallyQuery(2, "a b", { preview: false, dim: true, me: 1 })).toBe("/?tally=2&token=a+b&preview=0&dim=1&me=2");
    expect(tallyQuery(2, "pw", { me: 0 })).toBe("/?tally=2&token=pw");
  });
});

describe("tally views", () => {
  it("knows what's live and next, keys included", () => {
    const s = snap({ tally: { "1": 1, "3": 1, "2": 2 } });
    const ln = liveAndNext(s);
    expect(ln.live.map((i) => i.id)).toEqual([1, 3]);
    expect(ln.next.map((i) => i.id)).toEqual([2]);
    expect(liveAndNext(null)).toEqual({ live: [], next: [] });
  });

  it("picks the view from the link", () => {
    expect(tallyView(null, "2")).toBe("light");
    expect(tallyView("operator", "2")).toBe("operator");
    expect(tallyView("board", "2")).toBe("board");
    expect(tallyView(null, "ALL")).toBe("board");
    expect(tallyView("nonsense", "2")).toBe("light");
  });

  it("writes board and operator links", () => {
    expect(tallyQuery(null, "pw")).toBe("/?tally=all&token=pw");
    expect(tallyQuery(2, "pw", { view: "board" })).toBe("/?tally=all&token=pw");
    expect(tallyQuery(2, "pw", { view: "operator" })).toBe("/?tally=2&token=pw&view=operator");
  });
});

describe("the board on a real switcher", () => {
  // Shaped like the Constellation at Cornerstone: unused inputs named "--".
  const big = snap({
    inputs: [
      { id: 1, name: "Cam 1 (FOH)", short: "CAM1", camera: true },
      { id: 5, name: "--", short: "--", camera: true },
      { id: 10, name: "Main", short: "MAIN", camera: true },
      { id: 13, name: "Drum Cam", short: "DRUM", camera: true },
      { id: 3010, name: "Media Player 1", short: "MP1", camera: false },
    ],
    tally: { "10": 1, "5": 1, "1": 2 },
  });

  it("leaves unused inputs off the board and out of LIVE", () => {
    expect(boardSources(big, null).map((i) => i.id)).toEqual([1, 10, 13]);
    expect(liveAndNext(big).live.map((i) => i.name)).toEqual(["Main"]);
    expect(tallySources(big).map((i) => i.id)).toEqual([1, 10, 13, 3010]);
  });

  it("shows just the cameras the link names, in its order", () => {
    expect(boardSources(big, [13, 1, 99]).map((i) => i.id)).toEqual([13, 1]);
    expect(tallyQuery(null, "pw", { cams: [13, 1] })).toBe("/?tally=all&token=pw&cams=13%2C1");
  });

  it("labels a card once when the short name is the name", () => {
    expect(cardLabel({ id: 1, name: "Cam 1 (FOH)", short: "CAM1", camera: true })).toEqual({ big: "CAM1", small: "Cam 1 (FOH)" });
    expect(cardLabel({ id: 4, name: "Keys", short: "Keys", camera: true })).toEqual({ big: "Keys", small: "" });
    expect(cardLabel({ id: 4, name: "Keys", short: "", camera: true })).toEqual({ big: "Keys", small: "" });
  });
});
