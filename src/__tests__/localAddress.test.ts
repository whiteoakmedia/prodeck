import { describe, expect, it } from "vitest";
import { isPrivateIPv4, nameProblem, suggestName } from "../../local-edge/src/names";
import { secureBase } from "../lib/lanUrl";
import { localPhaseLabel } from "../lib/localHttps";

// The same rules run in the Settings card and in the Worker that hands out
// names (local-edge/), so a name the card accepts is one the Worker accepts.
describe("secure local address names", () => {
  it("accepts plain church names", () => {
    for (const n of ["stjohns", "cornerstone-cheshire", "grace-2", "abc"]) expect(nameProblem(n)).toBe("");
  });

  it("explains what's wrong with a bad one", () => {
    expect(nameProblem("ab")).toMatch(/At least 3/);
    expect(nameProblem("x".repeat(33))).toMatch(/At most 32/);
    expect(nameProblem("St Johns")).toMatch(/lowercase/);
    expect(nameProblem("-grace")).toMatch(/hyphen/);
    expect(nameProblem("grace--church")).toMatch(/double/);
    expect(nameProblem("www")).toMatch(/reserved/);
    expect(nameProblem("prodeck")).toMatch(/reserved/);
  });

  it("suggests a name from what the computer is called", () => {
    expect(suggestName("St. John's Church")).toBe("st-johns-church");
    expect(suggestName("Iglesia Bautista Peñuelas")).toBe("iglesia-bautista-penuelas");
    expect(suggestName("Booth-Mac")).toBe("booth-mac");
    expect(nameProblem(suggestName("A very long church name that goes on and on forever"))).toBe("");
  });

  // Only addresses inside a building: otherwise prodeck.live becomes free DNS
  // for anyone, pointing anywhere.
  it("only ever points at a church network address", () => {
    for (const ip of ["10.0.0.5", "172.16.0.20", "172.31.1.1", "192.168.1.20"]) expect(isPrivateIPv4(ip)).toBe(true);
    for (const ip of ["8.8.8.8", "172.32.0.1", "127.0.0.1", "169.254.0.1", "192.168.1.256", "1.2.3", "::1"])
      expect(isPrivateIPv4(ip)).toBe(false);
  });
});

describe("which secure address links use", () => {
  it("prefers the church's public address, then the secure local one", () => {
    expect(secureBase({ public_url: "https://booth.example.org", local_url: "https://x.local.prodeck.live" })).toBe(
      "https://booth.example.org",
    );
    expect(secureBase({ public_url: " ", local_url: "https://x.local.prodeck.live" })).toBe("https://x.local.prodeck.live");
    expect(secureBase({})).toBe("");
    expect(secureBase(null)).toBe("");
  });

  it("labels the card's state", () => {
    expect(localPhaseLabel("serving").text).toBe("on");
    expect(localPhaseLabel("certifying").text).toBe("setting up");
    expect(localPhaseLabel("error").tone).toBe("bad");
    expect(localPhaseLabel("off").text).toBe("off");
  });
});
