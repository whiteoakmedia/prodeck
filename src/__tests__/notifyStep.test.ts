import { describe, expect, it } from "vitest";
import { notifyStep, secureLink, SNOOZE_MS } from "../lib/notifyStep";
import { homeScreenManifestHref } from "../lib/homeScreen";

const base = { ios: true, secureUrl: "", snoozedUntil: 0, now: 1_000_000 };

describe("the notifications step on Home", () => {
  it("asks until notifications are on, then disappears", () => {
    expect(notifyStep("off", base)?.action).toBe("enable");
    expect(notifyStep("on", base)).toBeNull();
    // Nothing a volunteer can do about a browser without push.
    expect(notifyStep("unsupported", base)).toBeNull();
  });

  it("sends an iPhone in Safari to the Home Screen first", () => {
    const s = notifyStep("needs-install", base)!;
    expect(s.action).toBe("install");
    expect(s.body).toMatch(/Add to Home Screen/);
  });

  it("explains how to unblock, per platform, without a dead button", () => {
    const ios = notifyStep("denied", base)!;
    expect(ios.action).toBe("none");
    expect(ios.button).toBeUndefined();
    expect(ios.body).toMatch(/iPhone's Settings/);
    expect(notifyStep("denied", { ...base, ios: false })!.body).toMatch(/phone's Settings/);
  });

  it("offers the secure address when the booth has one", () => {
    expect(notifyStep("insecure", { ...base, secureUrl: "https://booth.example.org/?join=x" })!.action).toBe("secure");
    expect(notifyStep("insecure", base)!.action).toBe("none");
  });

  it("Not now hides it for a while, then it asks again", () => {
    const snoozed = { ...base, snoozedUntil: base.now + SNOOZE_MS };
    expect(notifyStep("off", snoozed)).toBeNull();
    expect(notifyStep("off", { ...snoozed, now: snoozed.snoozedUntil + 1 })).not.toBeNull();
  });

  it("never writes a dash into what volunteers read", () => {
    for (const st of ["off", "needs-install", "denied", "insecure"] as const) {
      for (const ios of [true, false]) {
        const s = notifyStep(st, { ...base, ios, secureUrl: "https://x.example" })!;
        expect(`${s.title} ${s.body} ${s.button ?? ""}`).not.toMatch(/[—–]/);
      }
    }
  });
});

describe("the secure address link", () => {
  it("carries the sign-in so it isn't asked for again", () => {
    expect(secureLink("https://booth.example.org/", "tok en")).toBe("https://booth.example.org/?join=tok%20en");
    expect(secureLink("https://booth.example.org", "")).toBe("https://booth.example.org/");
  });

  // Never hand a password to a plain http address.
  it("is only ever https", () => {
    expect(secureLink("http://booth.local", "tok")).toBe("");
    expect(secureLink("", "tok")).toBe("");
  });
});

describe("Add to Home Screen carries the sign-in", () => {
  it("points the manifest at the signed-in start", () => {
    expect(homeScreenManifestHref("abc123", "", true)).toBe("/app.webmanifest?hs=abc123");
    expect(homeScreenManifestHref("a&b", "", false)).toBe("/app.webmanifest?hs=a%26b");
  });

  it("takes an unclaimed personal invite along, but not once signed in", () => {
    expect(homeScreenManifestHref("tok", "inv", false)).toBe("/app.webmanifest?hs=tok&hsi=inv");
    expect(homeScreenManifestHref("tok", "inv", true)).toBe("/app.webmanifest?hs=tok");
  });

  it("falls back to the plain manifest with no sign-in", () => {
    expect(homeScreenManifestHref("", "inv", false)).toBe("/manifest.json");
  });
});
