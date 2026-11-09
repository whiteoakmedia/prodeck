import { describe, expect, it } from "vitest";
import { apnsPayload, cleanAck, cleanFcmToken, collapses, fcmMessage, fcmVerdict, PAGE_CATEGORY, PAGE_SOUND } from "../../push-edge/src/payload";

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

describe("what the push relay asks Firebase to deliver to Android", () => {
  const token = "dQw4w9WgXcQ:APA91bH" + "x_Y-z0".repeat(24);
  const msg = (m: Record<string, unknown>) => m.message as { token: string; data: Record<string, string>; android: Record<string, unknown> };

  it("a page is data only, high priority, and never collapses so each repeat rings", () => {
    const ack = `http://172.16.1.82:8088/api/page/ack?k=${KEY}`;
    const m = msg(fcmMessage({ title: "ProDeck · Page", body: "Ruth: camera 2", page: true }, token, "page-7", 600, { ack }));
    expect(m.token).toBe(token);
    expect(m.data).toEqual({ kind: "page", title: "ProDeck · Page", body: "Ruth: camera 2", tag: "page-7", ack });
    expect(m.android).toEqual({ priority: "HIGH", ttl: "600s" });
    // No notification block: the app draws it (sound, Got it, app open).
    expect((fcmMessage({ title: "t", body: "b", page: true }, token, "", 600).message as Record<string, unknown>).notification).toBeUndefined();
    // Every value is a string, as Firebase requires.
    expect(Object.values(m.data).every((v) => typeof v === "string")).toBe(true);
  });

  it("chat replaces an older one waiting for the phone, and never carries a confirm link", () => {
    const m = msg(fcmMessage({ title: "Team", body: "running late", page: false }, token, "chat", 86400, { ack: `https://x.example/api/page/ack?k=${KEY}` }));
    expect(m.data.kind).toBe("crew");
    expect(m.data.ack).toBeUndefined();
    expect(m.android.collapse_key).toBe("chat");
  });

  it("only takes real Firebase tokens", () => {
    expect(cleanFcmToken(token)).toBe(token);
    expect(cleanFcmToken("short")).toBeNull();
    expect(cleanFcmToken(`${token}/../x`)).toBeNull();
    expect(cleanFcmToken(42)).toBeNull();
  });

  it("drops a phone only when Firebase says the app is gone", () => {
    const fcmErr = (status: string, errorCode: string, message = "") => ({
      error: { status, message, details: [{ "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError", errorCode }] },
    });
    expect(fcmVerdict(404, fcmErr("NOT_FOUND", "UNREGISTERED"))).toBe("dead");
    expect(fcmVerdict(403, fcmErr("PERMISSION_DENIED", "SENDER_ID_MISMATCH"))).toBe("dead");
    expect(fcmVerdict(400, fcmErr("INVALID_ARGUMENT", "INVALID_ARGUMENT", "The registration token is not a valid FCM registration token"))).toBe("dead");
    expect(fcmVerdict(400, fcmErr("INVALID_ARGUMENT", "INVALID_ARGUMENT", "Invalid value at 'message.data'"))).toBe("failed");
    expect(fcmVerdict(429, fcmErr("RESOURCE_EXHAUSTED", "QUOTA_EXCEEDED"))).toBe("failed");
    expect(fcmVerdict(401, {})).toBe("failed");
    expect(fcmVerdict(503, "nonsense")).toBe("failed");
  });
});
