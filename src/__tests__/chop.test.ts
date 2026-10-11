import { describe, expect, it, vi } from "vitest";
import { chopSignature, sameString, slimEvent } from "../../feedback-edge/src/chopEvents";
import { chopHost, fetchCurrentService, foldEvents, pageFor, phaseOf, summarize, type ServiceTally } from "../lib/chop";

const NOW = Date.parse("2026-10-11T13:45:00Z");
const svcEvent = (type: string, id: string, data: Record<string, unknown>, time = "2026-10-11T13:40:00Z") => ({
  specversion: "1.0",
  type,
  source: "chop",
  id,
  time,
  data: { user: { id: "u-" + id, firstName: "Jane", lastName: "doe", email: "jane@example.com" }, service: { id: "svc1" }, ...data },
});

describe("slimEvent", () => {
  it("keeps who, which service and the count, never the email", () => {
    const e = slimEvent(svcEvent("church.online.service.chatted", "a", { channels: [{ messageCount: 3 }, { messageCount: 2 }] }), NOW)!;
    expect(e).toMatchObject({ kind: "chatted", who: "Jane D.", serviceId: "svc1", count: 5, userId: "u-a" });
    expect(JSON.stringify(e)).not.toContain("example.com");
  });

  it("reads a salvation moment and an anonymous prayer request", () => {
    const m = slimEvent(svcEvent("church.online.moment.interacted", "b", { moment: { type: "Response", options: { salvationMomentFollowUpType: "salvation" } } }), NOW)!;
    expect(m.kind).toBe("moment");
    expect(m.detail).toMatch(/salvation/);
    const p = slimEvent({ ...svcEvent("church.online.prayer.requested", "c", {}), data: { service: { id: "svc1" }, channel: { type: "prayer" } } }, NOW)!;
    expect(p.who).toBe("");
  });

  it("refuses something that isn't a CloudEvent", () => {
    expect(slimEvent({ hello: 1 }, NOW)).toBeNull();
  });
});

describe("webhook signatures", () => {
  it("matches ChOP's sha1=<hex> HMAC of the raw body", async () => {
    // HMAC-SHA1("key", "The quick brown fox jumps over the lazy dog")
    expect(await chopSignature("key", "The quick brown fox jumps over the lazy dog")).toBe("sha1=de7c9b85b8b78aa6bc8a7a36f70a90701c9db4d9");
    expect(sameString("sha1=ab", "sha1=ab")).toBe(true);
    expect(sameString("sha1=ab", "sha1=ac")).toBe(false);
  });
});

describe("foldEvents", () => {
  const ev = (o: Partial<ReturnType<typeof slimEvent> & object>) => ({ id: "x", kind: "attended" as const, at: NOW, serviceId: "svc1", who: "Jane D.", userId: "u1", count: 0, detail: "", ...o });

  it("counts each person once and each event once, however often ChOP retries", () => {
    let t: Record<string, ServiceTally> = {};
    const batch = [
      ev({ id: "1", kind: "attended", userId: "u1" }),
      ev({ id: "2", kind: "attended", userId: "u2" }),
      ev({ id: "3", kind: "chatted", userId: "u1", count: 4 }),
      ev({ id: "4", kind: "prayer", userId: "u3", who: "Sam K." }),
      ev({ id: "5", kind: "moment", userId: "u4", who: "Lee P.", detail: "salvation" }),
    ];
    let r = foldEvents(t, batch);
    t = r.tallies;
    expect(r.fresh).toHaveLength(5);
    r = foldEvents(t, batch); // the retry
    expect(r.fresh).toHaveLength(0);
    const s = r.tallies.svc1;
    expect([s.attendees.length, s.chatters.length, s.messages, s.prayers, s.salvations]).toEqual([2, 1, 4, 1, 1]);
    expect(s.recent.map((m) => m.kind)).toEqual(["salvation", "prayer"]);
  });

  it("keeps services apart", () => {
    const r = foldEvents({}, [ev({ id: "1", serviceId: "a" }), ev({ id: "2", serviceId: "b" })]);
    expect(Object.keys(r.tallies).sort()).toEqual(["a", "b"]);
  });
});

describe("pageFor", () => {
  const prayer = { id: "p", kind: "prayer" as const, at: NOW, serviceId: "s", who: "Sam K.", userId: "u", count: 0, detail: "" };
  it("pages for a new prayer request, by name", () => {
    expect(pageFor(prayer, { prayer: true, salvation: true }, NOW)).toMatch(/Prayer request on Church Online from Sam K\./);
  });
  it("stays quiet when switched off or when the event is old (a backlog after setup)", () => {
    expect(pageFor(prayer, { prayer: false, salvation: true }, NOW)).toBeNull();
    expect(pageFor(prayer, { prayer: true, salvation: true }, NOW + 60 * 60_000)).toBeNull();
  });
  it("names someone who wasn't signed in plainly", () => {
    expect(pageFor({ ...prayer, who: "" }, { prayer: true, salvation: true }, NOW)).toMatch(/from Someone who isn't signed in/);
  });
});

describe("service", () => {
  it("normalises whatever address is pasted", () => {
    expect(chopHost("https://YourChurch.online.church/live?x=1")).toBe("yourchurch.online.church");
    expect(chopHost(" church.example.org/ ")).toBe("church.example.org");
  });

  it("reads currentService and the phase around it", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ data: { currentService: { id: "s1", startTime: "2026-10-11T13:30:00Z", endTime: "2026-10-11T14:35:00Z", content: { title: "Sunday Morning Service" } } } })),
    );
    const s = await fetchCurrentService("x.online.church", fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledWith("https://x.online.church/graphql", expect.objectContaining({ method: "POST" }));
    expect(s?.title).toBe("Sunday Morning Service");
    expect(phaseOf(s, Date.parse("2026-10-11T13:00:00Z"))).toBe("upcoming");
    expect(phaseOf(s, NOW)).toBe("live");
    expect(phaseOf(s, Date.parse("2026-10-11T15:00:00Z"))).toBe("ended");
    expect(phaseOf(null, NOW)).toBe("none");
  });

  it("is null when nothing is scheduled", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ data: { currentService: { id: null } } })));
    expect(await fetchCurrentService("x.online.church", f as unknown as typeof fetch)).toBeNull();
  });

  it("summarizes the service on screen, or the last one with activity", () => {
    const { tallies } = foldEvents({}, [{ id: "1", kind: "prayer", at: NOW, serviceId: "old", who: "A", userId: "u", count: 0, detail: "" }]);
    const sum = summarize("x", { id: "new", title: "Next", start: NOW + 1, end: NOW + 2 }, "", tallies, { connected: true, lastEventAt: 0, lastBadSignatureAt: 0, hasSecret: true, error: "" }, NOW);
    expect(sum.tally?.serviceId).toBe("old");
    expect(sum.tally?.prayers).toBe(1);
    expect(JSON.stringify(sum)).not.toContain('"seen"');
  });
});
