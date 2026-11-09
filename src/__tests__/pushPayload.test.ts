import { describe, expect, it } from "vitest";
import { apnsPayload, cleanAck, collapses, PAGE_CATEGORY, PAGE_SOUND } from "../../push-edge/src/payload";

const KEY = "0123456789abcdef0123456789abcdef";

describe("what the push relay asks Apple to show", () => {
  it("a page rings with its own sound and carries a Got it button", () => {
    const p = apnsPayload({ title: "ProDeck · Page", body: "Ruth: camera 2 to the booth", page: true });
    const aps = p.aps as Record<string, unknown>;
    expect(aps.sound).toBe(PAGE_SOUND);
    expect(aps.category).toBe(PAGE_CATEGORY);
    expect(aps["interruption-level"]).toBe("time-sensitive");
  });

  it("chat and reminders stay ordinary notifications", () => {
    const aps = apnsPayload({ title: "Team", body: "running late", page: false }).aps as Record<string, unknown>;
    expect(aps.sound).toBe("default");
    expect(aps.category).toBeUndefined();
    expect(aps["interruption-level"]).toBe("active");
  });

  it("every repeat of a page alerts again instead of quietly replacing the last", () => {
    expect(collapses(true)).toBe(false);
    expect(collapses(false)).toBe(true);
  });

  it("passes on a page's confirm link, and only a real one", () => {
    const ack = `https://cornerstone.local.prodeck.live/api/page/ack?k=${KEY}`;
    expect(apnsPayload({ title: "t", body: "b", page: true }, { ack }).ack).toBe(ack);
    expect(cleanAck(`http://172.16.1.82:8088/api/page/ack?k=${KEY}`)).not.toBeNull();
    expect(cleanAck("javascript:alert(1)")).toBeNull();
    expect(cleanAck(`https://evil.example/elsewhere?k=${KEY}`)).toBeNull();
    expect(cleanAck(42)).toBeNull();
    // Never on anything that isn't a page.
    expect(apnsPayload({ title: "t", body: "b", page: false }, { ack }).ack).toBeUndefined();
  });
});
