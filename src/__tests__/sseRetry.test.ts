import { describe, expect, it } from "vitest";
import { SSE_STALL_MS, sseRetryDelay, sseStalled } from "../lib/sseRetry";

describe("reopening the live stream from the booth", () => {
  it("tries again quickly at first, then backs off to every 30 seconds", () => {
    const mid = () => 0.5; // no jitter
    expect(sseRetryDelay(0, mid)).toBe(1_000);
    expect(sseRetryDelay(1, mid)).toBe(2_000);
    expect(sseRetryDelay(4, mid)).toBe(16_000);
    expect(sseRetryDelay(5, mid)).toBe(30_000);
    expect(sseRetryDelay(50, mid)).toBe(30_000);
  });

  it("spreads a room of phones out instead of all knocking at once", () => {
    expect(sseRetryDelay(3, () => 0)).toBe(6_400);
    expect(sseRetryDelay(3, () => 1)).toBe(9_600);
  });

  it("a phone with a stale password knocks at most a few times in five minutes", () => {
    // The booth's throttle allows 8 failures in 5 minutes. Retries alone must
    // stay well under that once the wait has grown.
    let t = 0;
    let n = 0;
    while (t < 300_000) {
      t += sseRetryDelay(n++, () => 0);
    }
    expect(n).toBeLessThan(20);
    let late = 0;
    for (let i = 6, s = 0; s < 300_000; i++) {
      s += sseRetryDelay(i, () => 0);
      late++;
    }
    expect(late).toBeLessThanOrEqual(13);
  });

  it("treats three missed heartbeats as a dead stream", () => {
    expect(sseStalled(1_000, 1_000 + SSE_STALL_MS - 1)).toBe(false);
    expect(sseStalled(1_000, 1_000 + SSE_STALL_MS + 1)).toBe(true);
  });

  it("never calls a stream that hasn't started dead", () => {
    expect(sseStalled(0, 10 ** 12)).toBe(false);
  });
});
