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

  it("gives a typed church-network address the gateway's port", () => {
    expect(parseTarget("192.168.1.20")).toEqual({ base: "http://192.168.1.20:8088", open: "/" });
    expect(parseTarget("Booth-Mac.local")?.base).toBe("http://booth-mac.local:8088");
    expect(parseTarget("192.168.1.20:9000")?.base).toBe("http://192.168.1.20:9000");
  });

  it("knows a secure local address is https", () => {
    expect(parseTarget("stjohns.local.prodeck.live")).toEqual({ base: "https://stjohns.local.prodeck.live", open: "/" });
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
