import { describe, expect, it, vi } from "vitest";
import {
  PING_URL,
  MIN_GAP_MS,
  installId,
  isDue,
  osName,
  payload,
  sendUsageCount,
  setUsageCountEnabled,
  usageCountEnabled,
} from "../lib/usageCount";

/**
 * The usage count is the one thing ProDeck sends White Oak Media on its own, so
 * what it sends is pinned here: a random ID, the version and Mac or Windows.
 * docs/PRIVACY.md promises exactly that, and the off switch must hold.
 */
const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};
const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)";
const WIN = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Edg/130.0.0.0";
const ok = () => vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));

describe("anonymous usage count", () => {
  it("sends only a random ID, the version and the OS", async () => {
    const s = mem();
    const f = ok();
    await expect(sendUsageCount({ store: s, fetchImpl: f as unknown as typeof fetch, now: 1_000_000, ua: MAC, version: "0.9.109" })).resolves.toBe(true);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(PING_URL);
    const body = JSON.parse(String(init.body));
    expect(Object.keys(body).sort()).toEqual(["id", "os", "v"]);
    expect(body).toEqual({ id: installId(s), v: "0.9.109", os: "mac" });
    expect(body.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("keeps the same ID on this computer and ignores junk in storage", () => {
    const s = mem();
    const first = installId(s);
    expect(installId(s)).toBe(first);
    const junk = mem();
    junk.setItem("prodeck.installId", "Zachs-MacBook / Cornerstone");
    expect(installId(junk, () => "11111111-2222-4333-8444-555555555555")).toBe("11111111-2222-4333-8444-555555555555");
  });

  it("sends at most about once a day, and retries after a failure", async () => {
    const s = mem();
    const f = ok();
    const t0 = 5_000_000;
    expect(await sendUsageCount({ store: s, fetchImpl: f as unknown as typeof fetch, now: t0, ua: MAC, version: "1" })).toBe(true);
    expect(await sendUsageCount({ store: s, fetchImpl: f as unknown as typeof fetch, now: t0 + 3600_000, ua: MAC, version: "1" })).toBe(false);
    expect(f).toHaveBeenCalledTimes(1);
    expect(isDue(s, t0 + MIN_GAP_MS)).toBe(true);

    const s2 = mem();
    const offline = vi.fn(async () => { throw new TypeError("fetch failed"); });
    expect(await sendUsageCount({ store: s2, fetchImpl: offline as unknown as typeof fetch, now: t0, ua: MAC, version: "1" })).toBe(false);
    expect(isDue(s2, t0 + 1)).toBe(true); // a failed send isn't recorded, so the next check tries again
    const refused = vi.fn(async () => new Response("no", { status: 429 }));
    expect(await sendUsageCount({ store: s2, fetchImpl: refused as unknown as typeof fetch, now: t0, ua: MAC, version: "1" })).toBe(false);
    expect(isDue(s2, t0 + 1)).toBe(true);
  });

  it("a clock set backwards doesn't stop it for good", () => {
    const s = mem();
    s.setItem("prodeck.usageCount.lastSent", String(9_000_000_000_000));
    expect(isDue(s, 1_000_000)).toBe(true);
  });

  it("sends nothing when switched off", async () => {
    const s = mem();
    expect(usageCountEnabled(s)).toBe(true);
    setUsageCountEnabled(false, s);
    expect(usageCountEnabled(s)).toBe(false);
    const f = ok();
    expect(await sendUsageCount({ store: s, fetchImpl: f as unknown as typeof fetch, now: 1, ua: MAC, version: "1" })).toBe(false);
    expect(f).not.toHaveBeenCalled();
    setUsageCountEnabled(true, s);
    expect(usageCountEnabled(s)).toBe(true);
  });

  it("names the OS from the webview", () => {
    expect(osName(MAC)).toBe("mac");
    expect(osName(WIN)).toBe("windows");
    expect(osName("Mozilla/5.0 (X11; Linux x86_64)")).toBe("linux");
    expect(payload(mem(), WIN, "2").os).toBe("windows");
  });
});
