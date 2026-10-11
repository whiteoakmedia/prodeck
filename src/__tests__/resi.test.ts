import { describe, expect, it } from "vitest";
import { isBoothScreen, resiEmbedId, resiPlayerUrl } from "../lib/resi";

const ID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
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

import { isResiMedia, pickVariant, playlistEnded, resiLatestEvent, videoVariants } from "../lib/resi";

const MASTER_URL = "https://resi.media/cc-test/evt/Manifest.m3u8";
const MASTER = `#EXTM3U
#EXT-X-VERSION:7
#EXT-X-STREAM-INF:AVERAGE-BANDWIDTH=323000,BANDWIDTH=646000,CODECS="avc1.64000d,mp4a.40.2",RESOLUTION=256x144,FRAME-RATE=29.97,AUDIO="aud1"
Manifest_0_3.m3u8
#EXT-X-STREAM-INF:AVERAGE-BANDWIDTH=1088000,BANDWIDTH=2176000,CODECS="avc1.64001f,mp4a.40.2",RESOLUTION=864x486,FRAME-RATE=29.97,AUDIO="aud1"
Manifest_0_2.m3u8
#EXT-X-STREAM-INF:AVERAGE-BANDWIDTH=6000000,BANDWIDTH=12000000,CODECS="avc1.640828,mp4a.40.2",RESOLUTION=1920x1080,FRAME-RATE=29.97,AUDIO="aud1"
Manifest_0_0.m3u8
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud1",LANGUAGE="en",NAME="English",AUTOSELECT=YES,DEFAULT=YES,CHANNELS="2",URI="Manifest_1_1.m3u8"`;

describe("booth video", () => {
  it("lists the video playlists and never the audio one", () => {
    const vs = videoVariants(MASTER, MASTER_URL);
    expect(vs.map((v) => v.url)).toEqual([
      "https://resi.media/cc-test/evt/Manifest_0_3.m3u8",
      "https://resi.media/cc-test/evt/Manifest_0_2.m3u8",
      "https://resi.media/cc-test/evt/Manifest_0_0.m3u8",
    ]);
    expect(vs.some((v) => v.url.includes("Manifest_1_1"))).toBe(false);
    expect(vs.map((v) => v.height)).toEqual([144, 486, 1080]);
    expect(vs[0].bandwidth).toBe(646000);
  });

  it("picks the biggest picture up to 540p", () => {
    expect(pickVariant(videoVariants(MASTER, MASTER_URL))?.height).toBe(486);
    expect(pickVariant([])).toBeNull();
  });

  it("tells a live event from a finished one", () => {
    expect(playlistEnded("#EXTM3U\n#EXT-X-PLAYLIST-TYPE:EVENT\nchunk-1.m4s")).toBe(false);
    expect(playlistEnded("#EXTM3U\nchunk-1.m4s\n#EXT-X-ENDLIST")).toBe(true);
  });

  it("only ever plays Resi's own media host", () => {
    expect(isResiMedia("https://resi.media/a/Manifest.m3u8")).toBe(true);
    expect(isResiMedia("https://cdn.resi.media/a/Manifest.m3u8")).toBe(true);
    expect(isResiMedia("https://evil.example/resi.media/Manifest.m3u8")).toBe(false);
    expect(isResiMedia("http://resi.media/a.m3u8")).toBe(false);
  });

  it("reads the channel's latest event", async () => {
    const f = async () => new Response(JSON.stringify({ name: "Sunday Service 11am", cloud: { hlsUrl: MASTER_URL } }));
    expect(await resiLatestEvent(ID, f as unknown as typeof fetch)).toEqual({ name: "Sunday Service 11am", hlsUrl: MASTER_URL });
    const none = async () => new Response("{}", { status: 404 });
    expect(await resiLatestEvent(ID, none as unknown as typeof fetch)).toBeNull();
  });
});

import { liveSeekTarget } from "../lib/resi";

describe("liveSeekTarget", () => {
  it("jumps from the beginning of a long event to near the live edge", () => {
    expect(liveSeekTarget(0, 2940, 0)).toBe(2934);
  });
  it("leaves a player that's already live alone", () => {
    expect(liveSeekTarget(0, 2940, 2932)).toBeNull();
  });
  it("catches up when it drifts behind", () => {
    expect(liveSeekTarget(0, 3000, 2950)).toBe(2994);
  });
  it("never jumps before what can be played, and waits for a range", () => {
    expect(liveSeekTarget(100, 104, 0)).toBe(100);
    expect(liveSeekTarget(0, 0, 0)).toBeNull();
    expect(liveSeekTarget(0, Infinity, 0)).toBeNull();
  });
});
