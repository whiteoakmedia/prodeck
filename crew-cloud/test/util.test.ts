import { describe, expect, it } from "vitest";
import { churchFor, forwardHeaders, relayRefuses, responseHeaders, verifier } from "../src/util";

describe("churchFor", () => {
  it("reads the church from its crew address", () => {
    expect(churchFor("cornerstone.crew.prodeck.live", null)).toBe("cornerstone");
    expect(churchFor("St-Johns.crew.prodeck.live", null)).toBe("st-johns");
    expect(churchFor("grace.crew.localhost:8787", null)).toBe("grace");
  });
  it("refuses anything that isn't a name under the base", () => {
    expect(churchFor("crew.prodeck.live", null)).toBeNull();
    expect(churchFor("a.b.crew.prodeck.live", null)).toBeNull();
    expect(churchFor("prodeck.live", null)).toBeNull();
    expect(churchFor("evil.com", null)).toBeNull();
    expect(churchFor("x--y.crew.prodeck.live", null)).toBeNull();
  });
  it("takes the header only when the host has no name", () => {
    expect(churchFor("prodeck-crew.example.workers.dev", "grace")).toBe("grace");
    expect(churchFor("cornerstone.crew.prodeck.live", "grace")).toBe("cornerstone");
    expect(churchFor("x.workers.dev", "../etc")).toBeNull();
  });
});

describe("verifier", () => {
  // PBKDF2-HMAC-SHA256 published vectors; the booth's Rust copy
  // (crewcloud.rs) checks the same ones, so both sides always agree.
  it("matches PBKDF2-HMAC-SHA256", async () => {
    expect(await verifier("password", "salt", 1)).toBe("120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b");
    expect(await verifier("password", "salt", 4096)).toBe("c5e478d59288c841aa530db6845c4c8d962893a001ce4e11a4963873aa98134a");
  });
});

describe("relay header rules", () => {
  it("forwards only harmless request headers and never a line break", () => {
    const h = new Headers({
      "content-type": "application/json",
      cookie: "a=b",
      "cf-connecting-ip": "1.2.3.4",
      "x-prodeck-peer": "10.0.0.1",
      accept: "text/event-stream",
    });
    expect(forwardHeaders(h)).toEqual({ "content-type": "application/json", accept: "text/event-stream" });
  });
  it("drops hop by hop response headers", () => {
    const h = responseHeaders({ "Content-Type": "text/html", Connection: "close", "Content-Length": "5", "Cache-Control": "no-store" });
    expect(h.get("content-type")).toBe("text/html");
    expect(h.get("connection")).toBeNull();
    expect(h.get("content-length")).toBeNull();
  });
  it("keeps TV pairing and overflow audio on the church network", () => {
    expect(relayRefuses("/api/tv/hello?code=1")).toBe(true);
    expect(relayRefuses("/api/listen.mp3?token=x")).toBe(true);
    expect(relayRefuses("/api/cmd")).toBe(false);
    expect(relayRefuses("/api/events?token=x")).toBe(false);
  });
});
