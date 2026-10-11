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
