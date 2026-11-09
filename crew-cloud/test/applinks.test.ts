import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { appStepPage, wantsAppStep } from "../src/applinks";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
const IPAD = "Mozilla/5.0 (iPad; CPU OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
const IN_APP = `${IPHONE.replace(" Safari/604.1", "")} ProDeckCrew/0.1`;
const ANDROID = "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36";
const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15";

describe("apple-app-site-association", () => {
  it("is served on every crew address, as JSON, claiming only the join links", async () => {
    for (const host of ["grace-crew.prodeck.live", "cornerstone-crew.prodeck.live", "prodeck-crew.taplink-edge.workers.dev"]) {
      const r = await SELF.fetch(`https://${host}/.well-known/apple-app-site-association`);
      expect(r.status).toBe(200);
      expect(r.headers.get("content-type")).toBe("application/json");
      const j = (await r.json()) as any;
      const d = j.applinks.details[0];
      expect(d.appIDs).toEqual(["2B77WL3HZ6.app.prodeck.crew"]);
      expect(d.components).toEqual([
        { "/": "/join", "?": { web: "?*" }, exclude: true, comment: "Chose the browser" },
        { "/": "/join", comment: "The church's crew code" },
        { "/": "/", "?": { join: "?*" }, comment: "The crew link" },
        { "/": "/", "?": { invite: "?*" }, comment: "A personal invite" },
      ]);
    }
  });

  it("has no Android file until there's an Android app", async () => {
    expect((await SELF.fetch("https://grace-crew.prodeck.live/.well-known/assetlinks.json")).status).toBe(404);
  });
});

describe("a crew code on each kind of phone", () => {
  const join = (ua: string, q = "") => SELF.fetch(`https://grace-crew.prodeck.live/join${q}`, { headers: { "user-agent": ua } });

  it("offers the app on an iPhone or iPad, with the browser one tap away", async () => {
    for (const ua of [IPHONE, IPAD]) {
      const r = await join(ua);
      expect(r.status).toBe(200);
      const html = await r.text();
      expect(html).toContain('href="https://apps.apple.com/app/id6829868156"');
      expect(html).toContain("Get ProDeck Crew");
      expect(html).toContain('href="https://grace-crew.prodeck.live/join?web=1"');
      expect(html).toContain('name="apple-itunes-app" content="app-id=6829868156, app-argument=https://grace-crew.prodeck.live/join"');
      // Plain words: no dashes in what people read.
      const visible = html.replace(/<style>[\s\S]*?<\/style>/, "").replace(/<[^>]+>/g, " ");
      expect(visible).not.toMatch(/[–—]| - /);
    }
  });

  it("lets everyone else (and an iPhone that chose the browser, or the app itself) through to the church", async () => {
    // Booth off in the tests: the church's own page is the app shell.
    for (const [ua, q] of [[ANDROID, ""], [MAC, ""], [IPHONE, "?web=1"], [IN_APP, ""]] as const) {
      const r = await join(ua, q);
      expect(r.status).toBe(200);
      expect(r.headers.get("x-prodeck-fallback")).toBe("cloud");
      expect(await r.text()).not.toContain("Get ProDeck Crew");
    }
  });

  it("only for the crew code itself", () => {
    const q = new URLSearchParams();
    expect(wantsAppStep("GET", "/join", q, IPHONE)).toBe(true);
    expect(wantsAppStep("GET", "/", q, IPHONE)).toBe(false);
    expect(wantsAppStep("POST", "/join", q, IPHONE)).toBe(false);
    expect(wantsAppStep("GET", "/join", new URLSearchParams("web=1"), IPHONE)).toBe(false);
    expect(wantsAppStep("GET", "/join", q, IN_APP)).toBe(false);
    expect(wantsAppStep("GET", "/join", q, ANDROID)).toBe(false);
  });

  it("never lets the address break out of the page", () => {
    const html = appStepPage('https://grace-crew.prodeck.live/join?x="><script>');
    expect(html).not.toContain('"><script>');
  });
});
