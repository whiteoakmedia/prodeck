import { describe, expect, it } from "vitest";
import { isRealTap, tapperKey } from "../../taplink-edge/src/count";

const h = (o: Record<string, string>) => ({ get: (k: string) => o[k.toLowerCase()] ?? null });
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1";

describe("TapLink counts real taps once", () => {
  it("counts a phone opening the link", () => {
    expect(isRealTap("GET", h({ "user-agent": IPHONE }))).toBe(true);
  });

  it("ignores HEAD, prefetches and link-preview bots", () => {
    expect(isRealTap("HEAD", h({ "user-agent": IPHONE }))).toBe(false);
    expect(isRealTap("GET", h({ "user-agent": IPHONE, "sec-purpose": "prefetch;prerender" }))).toBe(false);
    expect(isRealTap("GET", h({ "user-agent": IPHONE, purpose: "prefetch" }))).toBe(false);
    expect(isRealTap("GET", h({ "user-agent": "facebookexternalhit/1.1" }))).toBe(false);
    expect(isRealTap("GET", h({ "user-agent": "WhatsApp/2.23" }))).toBe(false);
    expect(isRealTap("GET", h({ "user-agent": "Mozilla/5.0 (compatible; Discordbot/2.0)" }))).toBe(false);
    expect(isRealTap("GET", h({}))).toBe(false);
  });

  it("knows the same phone within a day, and nobody across days", async () => {
    const t = Date.UTC(2026, 10, 1, 15);
    const a = await tapperKey("203.0.113.5", IPHONE, t);
    expect(await tapperKey("203.0.113.5", IPHONE, t + 30_000)).toBe(a);
    expect(await tapperKey("203.0.113.6", IPHONE, t)).not.toBe(a);
    expect(await tapperKey("203.0.113.5", IPHONE, t + 86_400_000)).not.toBe(a);
    expect(a).toMatch(/^[0-9a-f]{24}$/);
  });
});
