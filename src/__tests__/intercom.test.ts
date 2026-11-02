import { describe, expect, it } from "vitest";
import { audibleIds, cannotJoin, reconcile, shouldOffer, talkers, talkLabel } from "../lib/intercom";
import type { IntercomMember } from "../lib/tauri";

const m = (id: string, name: string, talk: string | null = null, listen = ["All"]): IntercomMember => ({ id, name, talk, listen });

describe("intercom rules", () => {
  // If both phones offered, the two calls collide and neither connects; if
  // neither did, they'd never connect at all.
  it("exactly one side of every pair makes the offer", () => {
    for (const [a, b] of [["u1", "u2"], ["zz", "aa"], ["abc", "abd"]]) {
      expect(shouldOffer(a, b)).not.toBe(shouldOffer(b, a));
    }
  });

  it("opens what this phone should offer and closes people who left", () => {
    const members = [m("b", "Me"), m("a", "Ann"), m("c", "Cal"), m("d", "Dee")];
    const plan = reconcile(members, "b", ["a", "x"]);
    expect(plan.offer).toEqual(["c", "d"]); // "a" is already open, and would offer to us anyway
    expect(plan.close).toEqual(["x"]);
    expect(reconcile(members, "b", ["a", "c", "d"]).offer).toEqual([]);
  });

  it("hears only people talking on a line it listens to, never itself", () => {
    const members = [m("me", "Me", "All"), m("a", "Ann", "Cameras"), m("b", "Bo", "All"), m("c", "Cy", null)];
    expect(audibleIds(members, "me", ["All"])).toEqual(["b"]);
    expect(audibleIds(members, "me", ["All", "Cameras"])).toEqual(["a", "b"]);
    expect(audibleIds(members, "me", [])).toEqual([]);
  });

  it("names who is talking by first name", () => {
    const members = [m("me", "Zach Green", "All"), m("a", "Ann Lee", "Cameras"), m("b", "Bo", null)];
    expect(talkers(members, "me")).toEqual([
      { name: "You", line: "All", me: true },
      { name: "Ann", line: "Cameras", me: false },
    ]);
  });

  it("explains why comms can't start instead of failing silently", () => {
    const ok = { isWeb: true, boothScreen: false, secure: true, hasMic: true, signedIn: true };
    expect(cannotJoin(ok)).toBe("");
    // The booth computer feeds the house: comms must never run there.
    expect(cannotJoin({ ...ok, boothScreen: true })).toMatch(/never on the booth/);
    expect(cannotJoin({ ...ok, isWeb: false })).toMatch(/never on the booth/);
    expect(cannotJoin({ ...ok, signedIn: false })).toMatch(/Sign in/);
    // Plain LAN http: browsers withhold the microphone.
    expect(cannotJoin({ ...ok, secure: false })).toMatch(/https/);
    expect(cannotJoin({ ...ok, hasMic: false })).toMatch(/https/);
  });

  // Open mic turns every Talk button into a mute switch; it must always be
  // obvious whether the line can hear you.
  it("labels the Talk button for hold to talk and open mic", () => {
    expect(talkLabel({ openMic: false, talking: false, line: "All" })).toBe("Hold to talk on All");
    expect(talkLabel({ openMic: false, talking: true, line: "All" })).toBe("Talking on All");
    expect(talkLabel({ openMic: false, talking: true, line: "All", short: "Talk" })).toBe("Talk");
    expect(talkLabel({ openMic: true, talking: true, line: "Cameras" })).toBe("Live on Cameras. Tap to mute");
    expect(talkLabel({ openMic: true, talking: false, line: "Cameras" })).toBe("Muted. Tap to talk on Cameras");
    expect(talkLabel({ openMic: true, talking: true, line: "All", short: "Talk" })).toBe("Mute");
    expect(talkLabel({ openMic: true, talking: false, line: "All", short: "Talk" })).toBe("Unmute");
  });
});
