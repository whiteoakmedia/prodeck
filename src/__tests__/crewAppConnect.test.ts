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

import { crewAppHome, readAppPush } from "../lib/crewApp";

describe("crew app: back to the churches list", () => {
  it("goes to the app's own page, which differs on iPhone and Android", () => {
    expect(crewAppHome("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) ProDeckCrew/0.1")).toBe("capacitor://localhost/?home=1");
    expect(crewAppHome("Mozilla/5.0 (Linux; Android 15) ProDeckCrew/0.1")).toBe("https://localhost/?home=1");
    // An iPad asks for the desktop site and says Macintosh.
    expect(crewAppHome("Mozilla/5.0 (Macintosh; Intel Mac OS X) ProDeckCrew/0.1")).toBe("capacitor://localhost/?home=1");
  });
});

import { orderAddresses } from "../../crew-app/src/sweep";

describe("crew app: booths found on the Wi-Fi", () => {
  // The booth also announces its Dante network, which the phone isn't on.
  it("tries the usual Wi-Fi ranges first, each address once", () => {
    expect(orderAddresses(["172.20.4.40", "192.168.1.20", "10.0.0.5", "192.168.1.20"])).toEqual([
      "192.168.1.20",
      "10.0.0.5",
      "172.20.4.40",
    ]);
  });
});

import { readLink } from "../../crew-app/src/links";

describe("crew app: links that open it", () => {
  it("connects to the booth a link names", () => {
    expect(readLink("prodeckcrew://connect?to=https%3A%2F%2Fbooth.stjohns.org%2Fjoin")).toEqual({
      kind: "connect",
      to: "https://booth.stjohns.org/join",
    });
    expect(readLink("prodeckcrew://connect?to=192.168.1.20")).toEqual({ kind: "connect", to: "192.168.1.20" });
  });

  it("opens the demo or the churches list", () => {
    expect(readLink("prodeckcrew://demo")).toEqual({ kind: "demo" });
    expect(readLink("prodeckcrew://home")).toEqual({ kind: "home" });
  });

  it("ignores anything else", () => {
    for (const bad of ["prodeckcrew://connect", "prodeckcrew://wipe", "https://evil.example/demo", "nonsense"]) {
      expect(readLink(bad)).toBeNull();
    }
  });
});

describe("crew app: page notifications handed over by the app", () => {
  const tok = "ab".repeat(32);
  it("takes the token from the address and leaves the rest of it alone", () => {
    expect(readAppPush(`#crewpush=apns%3A${tok}`, "")).toEqual({ value: `apns:${tok}`, rest: "" });
    expect(readAppPush(`#crewpush=denied&x=1`, "")).toEqual({ value: "denied", rest: "#x=1" });
    expect(readAppPush(`#x=1&crewpush=prompt`, "")).toEqual({ value: "prompt", rest: "#x=1" });
  });
  it("keeps what it was told before when the address says nothing", () => {
    expect(readAppPush("", `apns:${tok}`)).toEqual({ value: `apns:${tok}`, rest: "" });
    expect(readAppPush("#plan", "denied")).toEqual({ value: "denied", rest: "#plan" });
  });
  it("ignores anything that isn't a token or an answer", () => {
    expect(readAppPush("#crewpush=apns%3Azz", "x").value).toBe("");
    expect(readAppPush("#crewpush=%E0%A4%A", "x").value).toBe("");
  });
  it("asks the app for notifications at its own page", () => {
    expect(crewAppHome("Mozilla/5.0 (iPhone) ProDeckCrew/0.1", "notify")).toBe("capacitor://localhost/?notify=1");
  });
});

describe("crew app: the crew address", () => {
  it("keeps only a real crew address", async () => {
    const { cleanCrew } = await import("../../crew-app/src/connect");
    expect(cleanCrew("https://Grace.crew.prodeck.live/")).toBe("https://grace.crew.prodeck.live");
    expect(cleanCrew("http://grace.crew.prodeck.live")).toBe("");
    expect(cleanCrew("https://grace.crew.prodeck.live.evil.com")).toBe("");
    expect(cleanCrew(undefined)).toBe("");
  });

  it("remembers a church's crew address and doesn't lose it on the next open", () => {
    const a = { base: "http://10.0.0.5:8088", name: "Grace", lastMs: 1, crew: "https://grace.crew.prodeck.live" };
    const list = remember([a], { base: a.base, name: "Grace", lastMs: 2 });
    expect(list).toHaveLength(1);
    expect(list[0].crew).toBe("https://grace.crew.prodeck.live");
    expect(list[0].lastMs).toBe(2);
  });

  it("opens the booth when it answers, the crew address when it doesn't", async () => {
    const { pickBase } = await import("../../crew-app/src/connect");
    const c = { base: "http://10.0.0.5:8088", name: "Grace", lastMs: 1, crew: "https://grace.crew.prodeck.live" };
    expect(await pickBase(c, async () => true)).toBe(c.base);
    expect(await pickBase(c, async (b) => b === c.crew)).toBe(c.crew);
    expect(await pickBase(c, async () => false)).toBeNull();
    expect(await pickBase({ ...c, crew: undefined }, async (b) => b !== c.base)).toBeNull();
  });
});
