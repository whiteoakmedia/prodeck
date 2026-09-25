import { describe, expect, it } from "vitest";
import { classify, integrated, REFERENCE_BANDS, summarize, type Row } from "../lib/streamReport";

// A band: wide, with a bottom end, the given tone offset per band.
const band = (t: number, lufs: number, tilt: number[] = []): Row => [t, lufs, lufs + 10, 0.8, ...REFERENCE_BANDS.map((b, i) => b + (tilt[i] ?? 0))];
// The lapel: mono, no bottom end.
const talk = (t: number, lufs: number): Row => [t, lufs, lufs + 12, 0.99, -30, -20, -9, -6, -5, -7, -10, -16, -22];

describe("the stream report", () => {
  it("gated loudness ignores the silence", () => {
    expect(integrated([-20, -20, -20, -80, -80])).toBeCloseTo(-20, 1);
  });
  it("tells the band from the lapel", () => {
    const rows = [...Array.from({ length: 60 }, (_, i) => band(i, -22)), ...Array.from({ length: 60 }, (_, i) => talk(60 + i, -27))];
    const c = classify(rows);
    expect(c.slice(0, 50).every(Boolean)).toBe(true);
    expect(c.slice(70).some(Boolean)).toBe(false);
  });
  it("says it's too quiet, the message sits under, and the tone is bass-heavy and dark", () => {
    const tilt = [4, 4, 0, 0, 0, -4, -4, -4, -4];
    const rows = [...Array.from({ length: 1200 }, (_, i) => band(i, -22 + (i % 20) / 4, tilt)), ...Array.from({ length: 1800 }, (_, i) => talk(1200 + i, -27))];
    const s = summarize({ id: "x", start: 0, rows });
    expect(s.worship! - s.message!).toBeGreaterThan(4);
    expect(s.overall!).toBeLessThan(-18);
    expect(s.bandDiff![0]).toBeCloseTo(4, 0);
    const text = s.tips.map((t) => t.text).join(" ");
    expect(text).toMatch(/under the -14 LUFS/);
    expect(text).toMatch(/message sits/);
    expect(text).toMatch(/Bass-heavy/);
    expect(text).toMatch(/2–4 kHz/);
    // The encoder offset shifts the stream figures, not the balance.
    const s2 = summarize({ id: "x", start: 0, rows }, 6);
    expect(s2.overall! - s.overall!).toBeCloseTo(6, 1);
    expect(s2.gap).toBe(s.gap);
  });
});
