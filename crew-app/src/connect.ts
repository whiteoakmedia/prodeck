// Working out which booth a volunteer means, from whatever they scanned or
// typed: the crew poster (https://church.org/join), an invite text
// (…/?invite=abc), the crew link (…/?join=abc), a booth address
// (booth.local, 192.168.1.20:8088), or a secure local address
// (stjohns.local.prodeck.live).

/** A church this phone has connected to. */
export interface Church {
  /** Where the booth's crew app lives, e.g. "http://192.168.1.20:8088". */
  base: string;
  /** What to call it in the list: the booth's name, else its host. */
  name: string;
  /** Last opened, epoch ms. */
  lastMs: number;
}

export interface Target {
  /** The booth's origin. */
  base: string;
  /**
   * Where to open first: the scanned link's path (keeps ?join=/?invite=). A
   * bare address opens the poster's /join, never the password screen: the
   * booth lets them in if joining is open, and otherwise asks to join with a
   * name and PIN.
   */
  open: string;
}

/** The gateway's port when an address comes without one. */
export const DEFAULT_PORT = 8088;

/**
 * Read a scanned or typed booth address. null = not something we can open.
 * Plain names and IPs get http and the gateway's port; https addresses (a
 * church's own domain, the secure local address) keep theirs.
 */
export function parseTarget(input: string): Target | null {
  let s = input.trim();
  if (!s) return null;
  // "mailto:", "tel:", "javascript:" and the like: a scheme, not a host:port.
  if (/^[a-z][a-z0-9+.-]*:(?!\/\/|\d)/i.test(s)) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    // No scheme: a host someone typed. A secure local address is https;
    // anything else on the church network is the plain gateway.
    const host = s.split(/[/?#]/)[0].toLowerCase();
    const secure = host.endsWith(".prodeck.live");
    s = `${secure ? "https" : "http"}://${s}`;
  }
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (!u.hostname || /\s/.test(u.hostname)) return null;
  // user@host would send a volunteer somewhere other than it looks.
  if (u.username || u.password) return null;
  if (u.protocol === "http:" && !u.port) u.port = String(DEFAULT_PORT);
  const keep = new URLSearchParams();
  for (const k of ["join", "invite", "kiosk", "tally", "token"]) {
    const v = u.searchParams.get(k);
    if (v) keep.set(k, v);
  }
  const q = keep.toString();
  // A link that carries its own way in (an invite, the crew link, a kiosk or
  // tally token) keeps it. Anything else goes through /join.
  if (q) return { base: u.origin, open: `/?${q}` };
  return { base: u.origin, open: "/join" };
}

/** "192.168.1.20:8088" or "stjohns.local.prodeck.live", for showing in a list. */
export function shortName(base: string): string {
  try {
    const u = new URL(base);
    return u.port && u.port !== "443" && u.port !== "80" ? `${u.hostname}:${u.port}` : u.hostname;
  } catch {
    return base;
  }
}

/** Saved churches, most recent first, one entry per booth. */
export function remember(list: Church[], c: Church): Church[] {
  return [c, ...list.filter((x) => x.base !== c.base)].slice(0, 8);
}

export function forget(list: Church[], base: string): Church[] {
  return list.filter((x) => x.base !== base);
}
