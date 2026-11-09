// Rules for secure local addresses (<name>.local.prodeck.live). Shared by the
// Worker that hands them out and the booth's Settings card, so a name the
// card accepts is a name the Worker accepts.

/** Names nobody gets: ours, confusing ones, and ones a phishing page would want. */
export const RESERVED = new Set([
  "www", "api", "app", "admin", "root", "mail", "smtp", "ftp", "ns1", "ns2", "dns",
  "local", "localhost", "edge", "claim", "status", "help", "support", "docs", "test", "demo",
  "prodeck", "pro-deck", "whiteoak", "white-oak", "whiteoakmedia", "booth", "crew", "login",
  "secure", "account", "billing", "update", "updates", "download", "downloads",
]);

export const NAME_MIN = 3;
export const NAME_MAX = 32;

/** Why a name can't be used, or "" if it can. Lower case only; the card lowercases as you type. */
export function nameProblem(name: string): string {
  if (name.length < NAME_MIN) return `At least ${NAME_MIN} letters or numbers.`;
  if (name.length > NAME_MAX) return `At most ${NAME_MAX} characters.`;
  if (!/^[a-z0-9-]+$/.test(name)) return "Only lowercase letters, numbers and hyphens.";
  if (name.startsWith("-") || name.endsWith("-")) return "Can't start or end with a hyphen.";
  if (name.includes("--")) return "No double hyphens.";
  if (RESERVED.has(name)) return "That name is reserved. Try your church's name.";
  return "";
}

/** "St. John's Church" → "st-johns-church": a starting suggestion for the card. */
export function suggestName(from: string): string {
  return from
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, NAME_MAX)
    .replace(/-+$/g, "");
}

/**
 * Only addresses inside a church network: 10/8, 172.16/12, 192.168/16. A
 * public address here would make prodeck.live a free DNS service for anyone,
 * pointing at anything.
 */
export function isPrivateIPv4(ip: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return false;
  const [a, b, c, d] = m.slice(1).map(Number);
  if ([a, b, c, d].some((n) => n > 255)) return false;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/**
 * A church's crew address host: <name>-crew.<zone> (crew-cloud/). One label,
 * so Cloudflare's free *.prodeck.live certificate covers it. With NAME_MAX at
 * 32 the label is at most 37 characters, well inside DNS's 63.
 */
export const CREW_SUFFIX = "-crew";
export function crewHost(name: string, zone = "prodeck.live"): string {
  if (nameProblem(name)) throw new Error("refusing a crew address for a name that isn't valid");
  const label = `${name}${CREW_SUFFIX}`;
  if (label.length > 63) throw new Error("refusing a DNS label over 63 characters");
  return `${label}.${zone}`;
}
