import { describe, expect, it, vi } from "vitest";
import { getChoice, setChoice, subscribe, looksLikeEmail, SIGNUP_URL } from "../lib/releaseNotes";

/**
 * The release-notes ask is optional and asked once: "No thanks" must stick
 * forever, and a failed signup must say why instead of silently vanishing.
 */
const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

describe("release notes opt-in", () => {
  it("remembers No thanks", () => {
    const s = mem();
    expect(getChoice(s)).toBe(null);
    setChoice("declined", s);
    expect(getChoice(s)).toBe("declined");
  });

  it("ignores junk in storage", () => {
    const s = mem();
    s.setItem("prodeck.releaseNotes", "maybe");
    expect(getChoice(s)).toBe(null);
  });

  it("posts only the address and the app as the source", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ ok: true, message: "You're on the list." }), { status: 200 }));
    await expect(subscribe(" tech@church.org ", f as unknown as typeof fetch)).resolves.toBe("You're on the list.");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(SIGNUP_URL);
    expect(JSON.parse(String(init.body))).toEqual({ email: "tech@church.org", source: "prodeck-app" });
  });

  it("says why when it fails", async () => {
    const bad = vi.fn(async () => new Response(JSON.stringify({ ok: false, error: "Too many signups from here." }), { status: 429 }));
    await expect(subscribe("a@b.org", bad as unknown as typeof fetch)).rejects.toThrow("Too many signups from here.");
    const offline = vi.fn(async () => { throw new TypeError("fetch failed"); });
    await expect(subscribe("a@b.org", offline as unknown as typeof fetch)).rejects.toThrow(/internet connection/);
    await expect(subscribe("nope")).rejects.toThrow(/email address/);
  });

  it("checks addresses", () => {
    expect(looksLikeEmail("a@b.org")).toBe(true);
    expect(looksLikeEmail("a@b")).toBe(false);
  });
});
