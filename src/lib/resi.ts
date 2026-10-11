// Resi stream monitor: the church's Resi web player, as viewers see it.
//
// Only a Resi embed ID is ever accepted, and the player address is built here,
// so a dashboard can't be made to load some other page. Resi's player reads
// its options from the address (webplayer/loader.min.js); it starts muted.
//
// The booth computer never loads the player at all (isBoothScreen). Its sound
// can feed the house, and "muted" is only a setting inside Resi's player that
// ProDeck can't check, so the one guarantee is not playing it there.

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** The embed ID from Resi's embed code, a player link, or the bare ID; else null. */
export function resiEmbedId(input: string): string | null {
  const s = (input ?? "").trim();
  if (!s) return null;
  // Embed code or link: take the id= of a control.resi.io player.
  const fromUrl = s.match(/control\.resi\.io\/webplayer\/[a-z]+\.html\?[^"'\s<>]*\bid=([0-9a-f-]{36})/i);
  if (fromUrl && UUID.test(fromUrl[1])) return fromUrl[1].toLowerCase();
  // Just the ID.
  if (/^[0-9a-f-]{36}$/i.test(s) && UUID.test(s)) return s.toLowerCase();
  return null;
}

export function resiPlayerUrl(id: string): string {
  const q = new URLSearchParams({
    id,
    autoplay: "true",
    mute: "true",
    controls: "true",
    // A monitor isn't a viewer; keep it out of the church's numbers.
    disableAnalytics: "true",
  });
  return `https://control.resi.io/webplayer/video.html?${q.toString()}`;
}

/**
 * True on the booth computer: the app itself, or a browser on the same
 * computer pointed at its own gateway. The stream never plays there.
 */
export function isBoothScreen(isWeb: boolean, hostname: string): boolean {
  if (!isWeb) return true;
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return h === "localhost" || h === "127.0.0.1" || h === "::1" || h.endsWith(".localhost");
}

// ---------------------------------------------------------------- booth video
//
// On the booth the stream is played by ProDeck itself, picture only. Resi's
// channel API (webevents.resi.io, as its own player uses) gives the live
// event's HLS address; Resi carries sound as a separate rendition, so the
// video playlists hold no audio track at all. Playing one of those directly
// means no sound is ever downloaded to the booth, let alone played.

export interface ResiEvent {
  name: string;
  /** The master playlist (has the separate audio rendition; never played on the booth). */
  hlsUrl: string;
}

/** The web channel's current or latest event. */
export async function resiLatestEvent(id: string, fetchImpl: typeof fetch = fetch): Promise<ResiEvent | null> {
  const res = await fetchImpl(`https://webevents.resi.io/api/v1/eventprofiles/latest/${id}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Resi didn't answer (error ${res.status}).`);
  const j = (await res.json()) as any;
  const hls = String(j?.cloud?.hlsUrl ?? "");
  if (!isResiMedia(hls)) return null;
  return { name: String(j?.name ?? "Live stream"), hlsUrl: hls };
}

/** Only Resi's own media host is ever played. */
export function isResiMedia(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && (u.hostname === "resi.media" || u.hostname.endsWith(".resi.media"));
  } catch {
    return false;
  }
}

export interface Variant {
  url: string;
  height: number;
  bandwidth: number;
}

/** The video playlists in a master playlist, resolved against its address. */
export function videoVariants(master: string, masterUrl: string): Variant[] {
  const lines = master.split(/\r?\n/);
  const out: Variant[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!l.startsWith("#EXT-X-STREAM-INF:")) continue;
    const next = (lines[i + 1] ?? "").trim();
    if (!next || next.startsWith("#")) continue;
    const res = l.match(/RESOLUTION=\d+x(\d+)/);
    const bw = l.match(/[^-]BANDWIDTH=(\d+)/);
    out.push({ url: new URL(next, masterUrl).toString(), height: res ? Number(res[1]) : 0, bandwidth: bw ? Number(bw[1]) : 0 });
  }
  return out;
}

/** Big enough to read a lower third, light on the booth's network: up to 540p. */
export function pickVariant(vs: Variant[], maxHeight = 540): Variant | null {
  if (!vs.length) return null;
  const fit = vs.filter((v) => v.height > 0 && v.height <= maxHeight).sort((a, b) => b.height - a.height);
  return fit[0] ?? [...vs].sort((a, b) => a.bandwidth - b.bandwidth)[0];
}

/** A finished event's playlist ends with ENDLIST; a live one doesn't. */
export const playlistEnded = (media: string) => /#EXT-X-ENDLIST/.test(media);

/**
 * Where the booth player should be: near the live edge. Resi's live playlists
 * are EVENT playlists (every chunk since the start is kept), and the Mac's
 * player opens those at the beginning, so a monitor showed the service from
 * its first minute. Returns the time to jump to, or null when it's already
 * close enough. `seekStart`/`seekEnd` are the player's seekable range.
 */
export function liveSeekTarget(seekStart: number, seekEnd: number, current: number): number | null {
  if (!Number.isFinite(seekEnd) || seekEnd <= 0) return null;
  // A few seconds back from the very edge, so it doesn't stall waiting for
  // the next chunk; re-jump only when more than 15 s behind.
  const target = Math.max(seekStart, seekEnd - 6);
  return seekEnd - current > 15 ? target : null;
}
