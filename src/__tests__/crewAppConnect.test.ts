import { describe, expect, it } from "vitest";
import { forget, parseTarget, remember, shortName } from "../../crew-app/src/connect";

// The ProDeck Crew app (crew-app/) finds a church's booth from whatever a
// volunteer scans or types.
describe("crew app: finding the booth", () => {
  it("keeps the crew poster's /join, so the booth hands out the crew link", () => {
    expect(parseTarget("https://booth.stjohns.org/join")).toEqual({ base: "https://booth.stjohns.org", open: "/join" });
  });

  it("keeps an invite or crew link's token, and drops anything else", () => {
    expect(parseTarget("https://booth.stjohns.org/?invite=abc&utm=x")).toEqual({
      base: "https://booth.stjohns.org",
      open: "/?invite=abc",
    });
    expect(parseTarget("http://192.168.1.20:8088/?join=tok")?.open).toBe("/?join=tok");
  });

  // Volunteers never have the booth's password: a bare address goes through
  // the poster's door (in if joining is open, else ask to join).
  it("gives a typed church-network address the gateway's port, through /join", () => {
    expect(parseTarget("192.168.1.20")).toEqual({ base: "http://192.168.1.20:8088", open: "/join" });
    expect(parseTarget("Booth-Mac.local")?.base).toBe("http://booth-mac.local:8088");
    expect(parseTarget("192.168.1.20:9000")?.base).toBe("http://192.168.1.20:9000");
  });

  it("knows a secure local address is https", () => {
    expect(parseTarget("stjohns.local.prodeck.live")).toEqual({ base: "https://stjohns.local.prodeck.live", open: "/join" });
  });

  it("refuses things that aren't a booth address", () => {
    for (const bad of ["", "   ", "javascript:alert(1)", "ftp://x.org", "mailto:a@b.c", "http://"]) {
      expect(parseTarget(bad)).toBeNull();
    }
  });

  it("names a booth by its address", () => {
    expect(shortName("http://192.168.1.20:8088")).toBe("192.168.1.20:8088");
    expect(shortName("https://stjohns.local.prodeck.live")).toBe("stjohns.local.prodeck.live");
  });

  it("remembers each church once, newest first", () => {
    const a = { base: "http://a:8088", name: "A", lastMs: 1 };
    const b = { base: "http://b:8088", name: "B", lastMs: 2 };
    expect(remember([a, b], { ...a, lastMs: 3 }).map((c) => c.base)).toEqual(["http://a:8088", "http://b:8088"]);
    expect(forget([a, b], "http://a:8088")).toEqual([b]);
  });
});

import { crewAppHome } from "../lib/crewApp";

describe("crew app: back to the churches list", () => {
  it("goes to the app's own page, which differs on iPhone and Android", () => {
    expect(crewAppHome("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) ProDeckCrew/0.1")).toBe("capacitor://localhost/?home=1");
    expect(crewAppHome("Mozilla/5.0 (Linux; Android 15) ProDeckCrew/0.1")).toBe("https://localhost/?home=1");
    // An iPad asks for the desktop site and says Macintosh.
    expect(crewAppHome("Mozilla/5.0 (Macintosh; Intel Mac OS X) ProDeckCrew/0.1")).toBe("capacitor://localhost/?home=1");
  });
});
