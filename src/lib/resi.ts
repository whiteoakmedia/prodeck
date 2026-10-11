// Resi stream monitor: the church's Resi web player, as viewers see it.
//
// Only a Resi embed ID is ever accepted, and the player address is built here,
// so a dashboard can't be made to load some other page. Resi's player reads
// its options from the address (webplayer/loader.min.js): on the booth it
// plays muted with no controls, because the booth computer's sound can feed
// the house and a viewer-side player is 20 to 40 seconds behind the room.

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

export function resiPlayerUrl(id: string, opts: { booth: boolean }): string {
  const q = new URLSearchParams({
    id,
    autoplay: "true",
    mute: "true",
    // No controls on the booth: nothing to unmute into the house by accident.
    controls: opts.booth ? "false" : "true",
    // A monitor isn't a viewer; keep it out of the church's numbers.
    disableAnalytics: "true",
  });
  return `https://control.resi.io/webplayer/video.html?${q.toString()}`;
}
