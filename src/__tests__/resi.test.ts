import { describe, expect, it } from "vitest";
import { isBoothScreen, resiEmbedId, resiPlayerUrl } from "../lib/resi";

const ID = "d4797dd3-2766-4b6e-9866-4e21e4ac9382";
const EMBED = `<div style="position:relative;overflow:hidden;padding-top:56.25%;">
  <iframe allow="autoplay; fullscreen" allowfullscreen="true" class="resi-video-frame"
    src="https://control.resi.io/webplayer/video.html?id=${ID}" style="position:absolute;top:0;left:0;width:100%;height:100%;border:none;">
  </iframe>
</div>
<script defer type="text/javascript" src="https://control.resi.io/webplayer/page.min.js"></script>`;

describe("resiEmbedId", () => {
  it("reads the ID from Resi's embed code, a link, or the bare ID", () => {
    expect(resiEmbedId(EMBED)).toBe(ID);
    expect(resiEmbedId(`https://control.resi.io/webplayer/video.html?id=${ID}&autoplay=true`)).toBe(ID);
    expect(resiEmbedId(ID.toUpperCase())).toBe(ID);
  });

  it("refuses anything that isn't a Resi player", () => {
    expect(resiEmbedId(`<iframe src="https://evil.example/video.html?id=${ID}">`)).toBeNull();
    expect(resiEmbedId("https://youtube.com/watch?v=abc")).toBeNull();
    expect(resiEmbedId("")).toBeNull();
  });
});

describe("resiPlayerUrl", () => {
  it("is always a muted Resi player, kept out of the analytics", () => {
    const u = new URL(resiPlayerUrl(ID));
    expect(u.origin + u.pathname).toBe("https://control.resi.io/webplayer/video.html");
    expect(Object.fromEntries(u.searchParams)).toEqual({ id: ID, autoplay: "true", mute: "true", controls: "true", disableAnalytics: "true" });
  });
});

describe("isBoothScreen", () => {
  it("is the app itself, and any browser on the booth computer", () => {
    expect(isBoothScreen(false, "tauri.localhost")).toBe(true);
    expect(isBoothScreen(true, "localhost")).toBe(true);
    expect(isBoothScreen(true, "127.0.0.1")).toBe(true);
    expect(isBoothScreen(true, "[::1]")).toBe(true);
  });

  it("is not a phone or kiosk on the network", () => {
    expect(isBoothScreen(true, "192.168.1.40")).toBe(false);
    expect(isBoothScreen(true, "booth.local")).toBe(false);
  });
});
