import { describe, expect, it } from "vitest";
import {
  cleanCrewUrl,
  cloudCopyLine,
  cloudPlanSnapshot,
  edgeBases,
  handoffHash,
  isCrewHost,
  readHandoff,
  shouldMoveToCrew,
} from "../lib/crewCloud";

describe("crew address", () => {
  it("knows a crew address when it sees one", () => {
    expect(isCrewHost("cornerstone.crew.prodeck.live")).toBe(true);
    expect(isCrewHost("grace.crew.localhost")).toBe(true);
    expect(isCrewHost("cornerstone.local.prodeck.live")).toBe(false);
    expect(isCrewHost("192.168.1.20")).toBe(false);
  });

  it("only remembers a real crew address", () => {
    expect(cleanCrewUrl("https://Grace.crew.prodeck.live/")).toBe("https://grace.crew.prodeck.live");
    expect(cleanCrewUrl("http://grace.crew.localhost:8787")).toBe("http://grace.crew.localhost:8787");
    expect(cleanCrewUrl("http://grace.crew.prodeck.live")).toBe("");
    expect(cleanCrewUrl("https://evil.com/?x=.crew.prodeck.live")).toBe("");
    expect(cleanCrewUrl("https://a.b.crew.prodeck.live")).toBe("");
    expect(cleanCrewUrl(null)).toBe("");
  });

  it("asks the crew address first from the booth's own address", () => {
    const crew = "https://grace.crew.prodeck.live";
    expect(edgeBases("http://192.168.1.20:8088", crew, "http://192.168.1.20:8088")).toEqual([crew, "http://192.168.1.20:8088"]);
    expect(edgeBases("https://grace.local.prodeck.live", crew, "https://grace.local.prodeck.live")).toEqual([
      crew,
      "https://grace.local.prodeck.live",
    ]);
    // Already on it: just there.
    expect(edgeBases(crew, crew, "")).toEqual([crew]);
    // A church's own domain (crew-edge answers there with the booth off) first.
    expect(edgeBases("https://booth.church.org", crew, "https://booth.church.org")).toEqual(["https://booth.church.org", crew]);
    // No crew address known: as before.
    expect(edgeBases("http://10.0.0.5:8088", "", "https://booth.church.org")).toEqual(["http://10.0.0.5:8088", "https://booth.church.org"]);
  });

  it("moves to the crew address only when the booth is on and out of reach", () => {
    const crew = "https://grace.crew.prodeck.live";
    expect(shouldMoveToCrew("192.168.1.20", crew, true)).toBe(true);
    expect(shouldMoveToCrew("192.168.1.20", crew, false)).toBe(false);
    expect(shouldMoveToCrew("grace.crew.prodeck.live", crew, true)).toBe(false);
    expect(shouldMoveToCrew("192.168.1.20", "", true)).toBe(false);
  });

  it("carries the sign in over in the fragment and back out", () => {
    const h = handoffHash({ token: "crew pw/ü", session: "s1", name: "Zoë", role: "Camera 1", id: "u1" });
    expect(h.startsWith("#pdhandoff=")).toBe(true);
    const { handoff, rest } = readHandoff(h);
    expect(handoff).toEqual({ token: "crew pw/ü", session: "s1", name: "Zoë", role: "Camera 1", id: "u1" });
    expect(rest).toBe("");
    // Other fragment parts (the crew app's #crewpush=) survive.
    const both = readHandoff(`#crewpush=denied&${h.slice(1)}`);
    expect(both.handoff?.token).toBe("crew pw/ü");
    expect(both.rest).toBe("#crewpush=denied");
    expect(readHandoff("#pdhandoff=garbage").handoff).toBeNull();
    expect(readHandoff("#x=1")).toEqual({ handoff: null, rest: "#x=1" });
  });

  it("says plainly that it's the copy, and when it was sent", () => {
    const now = new Date(2026, 10, 8, 22, 0).getTime();
    expect(cloudCopyLine(new Date(2026, 10, 8, 21, 14).getTime(), now)).toBe(
      "The booth is off. Showing the last plan it sent at 9:14 PM.",
    );
    expect(cloudCopyLine(new Date(2026, 10, 7, 21, 14).getTime(), now)).toBe(
      "The booth is off. Showing the last plan it sent yesterday at 9:14 PM.",
    );
    expect(cloudCopyLine(new Date(2026, 10, 1, 9, 5).getTime(), now)).toMatch(/sent on Sunday, Nov 1 at 9:05 AM\.$/);
    expect(cloudCopyLine(0, now)).toBe("The booth is off, and it hasn't sent a plan yet.");
  });

  it("builds the week as phones read it, without Planning Center ids or notes", () => {
    const snap = cloudPlanSnapshot({
      plan: { id: "p1", date: "Nov 9", title: "Sunday" },
      items: [
        { id: "i1", title: "Song", sequence: 1, length: 300, type: "song", key: "A", leader: "Anna", songId: "9", description: "secret note" } as any,
      ],
      serviceTimes: [{ id: "t1", name: "9:00", ts: 5 }, { id: "t2", name: "11:00", ts: 0 }],
      team: [{ name: "Sam", position: "Camera 1", status: "C", timeIds: ["t1"], id: "x", photo: "p" } as any],
      checkinTimes: { "Camera 1": "08:00" },
      positionGuides: { "Camera 1": "Wide" },
    })!;
    expect(snap.items[0]).toEqual({ id: "i1", title: "Song", sequence: 1, length: 300, type: "song", key: "A", leader: "Anna" });
    expect(snap.serviceTimes).toEqual([
      { id: "t1", name: "9:00", type: "service", ts: 5 },
      { id: "t2", name: "11:00", type: "service", ts: null },
    ]);
    expect(snap.team[0]).toEqual({ name: "Sam", position: "Camera 1", status: "C", timeIds: ["t1"] });
    expect(snap.extras.positionGuides).toEqual({ "Camera 1": "Wide" });
    expect(cloudPlanSnapshot({ plan: null, items: [], serviceTimes: [], team: [], checkinTimes: {}, positionGuides: {} })).toBeNull();
  });
});
