import { describe, expect, it } from "vitest";
import { hostLabel, ipBaseUrl, lanBaseUrl } from "../lib/lanUrl";

describe("booth address for phones and kiosks", () => {
  it("never builds Mac.localdomain.local (the kiosk that never loaded)", () => {
    expect(hostLabel("Mac.localdomain")).toBe("Mac.local");
    expect(lanBaseUrl("", null, "Mac.localdomain", 8088)).toBe("http://Mac.local:8088");
  });

  it("uses the booth's real .local name when it has answered", () => {
    expect(lanBaseUrl("", { host: "Booth-Mac.local", ips: [] }, "Mac.localdomain", 8088)).toBe("http://Booth-Mac.local:8088");
  });

  it("prefers the church's own domain", () => {
    expect(lanBaseUrl("https://crew.example.org/", { host: "Booth.local", ips: [] }, "x", 8088)).toBe("https://crew.example.org");
  });

  it("offers the IP address for devices that can't find .local names", () => {
    expect(ipBaseUrl({ host: "Booth.local", ips: ["192.168.1.30"] }, 8088)).toBe("http://192.168.1.30:8088");
    expect(ipBaseUrl({ host: "Booth.local", ips: [] }, 8088)).toBeNull();
    expect(ipBaseUrl(null, 8088)).toBeNull();
  });
});
