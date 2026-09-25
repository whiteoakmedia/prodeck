import { describe, expect, it } from "vitest";
import { decide, namesFromSettings, parseNames, formatNames, STOP_AFTER_MS, type AutoState } from "../lib/recorderAuto";

const idle: AutoState = { recording: false, autoStarted: false, lastBusy: 0, suppressed: false };

describe("recording every service", () => {
  it("starts when the service gets busy and stops 20 minutes after it goes quiet", () => {
    let r = decide(idle, true, 1000);
    expect(r.action).toBe("start");
    let s = { ...r.state, recording: true, autoStarted: true };
    r = decide(s, false, 1000 + STOP_AFTER_MS - 1);
    expect(r.action).toBeNull(); // the gap between items, the sermon without Playback
    s = r.state;
    expect(decide(s, false, 1000 + STOP_AFTER_MS).action).toBe("stop");
  });
  it("never stops a recording someone started by hand", () => {
    const s = { ...idle, recording: true, autoStarted: false, lastBusy: 0 };
    expect(decide(s, false, 10 * STOP_AFTER_MS).action).toBeNull();
  });
  it("a hand stop while busy isn't undone until things go quiet", () => {
    const s = { ...idle, suppressed: true, lastBusy: 0 };
    expect(decide(s, true, 60_000).action).toBeNull();
    const quiet = decide(s, false, 60_000 + 5 * 60_000).state;
    expect(quiet.suppressed).toBe(false);
    expect(decide(quiet, true, 60_000 + 6 * 60_000).action).toBe("start");
  });
});

describe("track names", () => {
  it("come from what ProDeck already knows", () => {
    const n = namesFromSettings({ audio_measure_channels: [1, 2], stream_report_channels: [3, 4], follow_click_channel: 5, follow_guide_channel: 6, autopilot_lapel_audio: 7, audio_mic_channels: { "1": 51 }, automix_feeds: "EGs: 17, 18; ch 10: 16" });
    expect(n).toMatchObject({ "1": "Room L", "2": "Room R", "3": "Stream L", "5": "Click", "7": "Lapel", "51": "Vox 1", "17": "EGs 1", "18": "EGs 2", "16": "ch 10" });
  });
  it("round-trip as lines", () => {
    const m = parseNames("9: Kick IN\n10 = SN Top\nnonsense\n");
    expect(m).toEqual({ "9": "Kick IN", "10": "SN Top" });
    expect(formatNames(m)).toBe("9: Kick IN\n10: SN Top");
  });
});
