import { describe, expect, it } from "vitest";
import { resiEmbedId, resiPlayerUrl } from "../lib/resi";

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
  it("plays muted with no controls on the booth", () => {
    const u = new URL(resiPlayerUrl(ID, { booth: true }));
    expect(u.origin + u.pathname).toBe("https://control.resi.io/webplayer/video.html");
    expect(Object.fromEntries(u.searchParams)).toEqual({ id: ID, autoplay: "true", mute: "true", controls: "false", disableAnalytics: "true" });
  });

  it("starts muted on phones but lets them unmute", () => {
    expect(new URL(resiPlayerUrl(ID, { booth: false })).searchParams.get("controls")).toBe("true");
  });
});
