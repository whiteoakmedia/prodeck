import { describe, expect, it } from "vitest";
import { dbToRaw, LapelRide, rawToDb, RoomHold } from "../lib/autopilotMix";

describe("fader math", () => {
  it("matches the Avantis scale", () => {
    expect(dbToRaw(-5)).toBe(97);
    expect(dbToRaw(0)).toBe(107);
    expect(rawToDb(107)).toBeCloseTo(0, 0);
    expect(dbToRaw(-80)).toBe(0);
  });
});

describe("the lapel ride", () => {
  it("lifts him when he turns away, never past +6, a dB at a time", () => {
    const r = new LapelRide(-5);
    let t = 0;
    for (; t < 20_000; t += 100) r.onSpeech(-20, t); // his normal level
    for (; t < 23_000; t += 100) r.onSpeech(-30, t); // turned away: 10 dB down
    const moves: number[] = [];
    for (let k = 0; k < 12; k++, t += 500) {
      r.onSpeech(-30, t);
      const m = r.tick(t);
      if (m != null) moves.push(m);
    }
    expect(moves[0]).toBe(-4);
    expect(Math.max(...moves)).toBeLessThanOrEqual(1);
    expect(moves.every((m, i) => i === 0 || m - moves[i - 1] <= 1)).toBe(true);
  });
  it("pulls 3 dB on feedback and holds it", () => {
    const r = new LapelRide(-5);
    expect(r.onRing(1000)).toBe(-8);
    expect(r.tick(5000)).toBeNull();
  });
  it("nudges toward the room target when the room is too quiet", () => {
    const r = new LapelRide(-5);
    let t = 0;
    for (; t < 30_000; t += 100) {
      r.onSpeech(-20, t);
      r.onRoom(60, t, true);
    }
    let last: number | null = null;
    for (; t < 60_000; t += 500) {
      r.onSpeech(-20, t);
      r.onRoom(60, t, true);
      last = r.tick(t) ?? last;
    }
    expect(last).not.toBeNull();
    expect(last!).toBeGreaterThan(-5);
  });
});

describe("the room hold", () => {
  it("steps LR + Sub down half a dB when the room is over 93, within ±3", () => {
    const h = new RoomHold(0);
    let t = 0;
    for (; t < 20_000; t += 250) h.onRoom(96, t);
    expect(h.tick(t)).toBe(-0.5);
    expect(h.tick(t + 1000)).toBeNull(); // waits 8 s between steps
    let v: number | null = null;
    for (let k = 0; k < 20; k++) {
      t += 8000;
      for (let j = 0; j < 32; j++) h.onRoom(96, t + j * 250);
      v = h.tick(t + 8000) ?? v;
    }
    expect(v).toBe(-3);
  });
  it("leaves it alone inside the band", () => {
    const h = new RoomHold(0);
    for (let t = 0; t < 20_000; t += 250) h.onRoom(91.5, t);
    expect(h.tick(20_000)).toBeNull();
  });
});
