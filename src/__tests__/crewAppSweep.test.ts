import { describe, expect, it } from "vitest";
import { hostsToTry, prefixOf } from "../../crew-app/src/sweep";

// When church Wi-Fi drops Bonjour, the crew app asks every address on the
// phone's network whether it's a ProDeck booth.
describe("crew app: finding the booth address by address", () => {
  it("reads iPhone netmasks and Android prefixes alike", () => {
    expect(prefixOf({ ip: "172.20.1.9", netmask: "255.255.254.0" })).toBe(23);
    expect(prefixOf({ ip: "192.168.1.9", prefix: 24 })).toBe(24);
  });

  it("tries the whole network, its own block first, never itself", () => {
    const hosts = hostsToTry({ ip: "172.20.1.9", netmask: "255.255.254.0" });
    expect(hosts).toHaveLength(509); // 510 usable, minus the phone
    expect(hosts[0]).toBe("172.20.1.0"); // a real address in a /23
    expect(hosts).not.toContain("172.20.1.9");
    expect(hosts).toContain("172.20.0.40");
    expect(hosts).not.toContain("172.20.0.0");
    expect(hosts).not.toContain("172.20.1.255");
  });

  it("caps a huge network at about a thousand addresses", () => {
    expect(hostsToTry({ ip: "10.4.7.20", prefix: 16 }).length).toBe(1021);
  });

  it("doesn't search public or cellular addresses", () => {
    expect(hostsToTry({ ip: "100.64.3.2", prefix: 24 })).toEqual([]);
    expect(hostsToTry({ ip: "8.8.8.8", prefix: 24 })).toEqual([]);
    expect(hostsToTry({ ip: "192.168.1.9" })).toEqual([]);
  });
});

import { probeDetail } from "../../crew-app/src/native";

describe("crew app: what the address check says when it finds nothing", () => {
  it("counts each kind of answer, and errors by code", () => {
    expect(probeDetail(509, { open: [], refused: 4, silent: 505, errors: {}, ms: 2100 })).toBe(
      "509 checked: 0 answered, 4 refused, 505 silent, 2.1s",
    );
    expect(probeDetail(10, { open: [], refused: 0, silent: 0, errors: { "65": 10 }, ms: 40 })).toBe(
      "10 checked: 0 answered, 0 refused, 0 silent, 10 error 65, 0.0s",
    );
  });
});
