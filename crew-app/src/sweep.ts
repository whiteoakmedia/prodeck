// Finding the booth without Bonjour. Many church Wi-Fi systems quietly drop
// the discovery traffic Bonjour needs between devices, while ordinary
// connections still work. So the app also takes the phone's own Wi-Fi address
// and asks every address on that network whether it's a ProDeck booth (the
// asking itself is native: NetInfoPlugin probe).

/** A network address of this phone, as the app's NetInfo plugin reports it. */
export interface PhoneAddress {
  ip: string;
  /** iOS gives a netmask, Android a prefix length. */
  netmask?: string;
  prefix?: number;
}

/** The most addresses one search will try: a /22, about a thousand. */
const MAX_PREFIX_BITS = 22;

const toInt = (ip: string): number | null => {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];
};
const toIp = (n: number) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");

export function prefixOf(a: PhoneAddress): number | null {
  if (typeof a.prefix === "number") return a.prefix;
  const m = a.netmask ? toInt(a.netmask) : null;
  if (m === null) return null;
  let bits = 0;
  for (let i = 31; i >= 0 && (m >>> i) & 1; i--) bits++;
  return bits;
}

/** Only private networks: a phone on cellular or a hotspot has nothing to search. */
function isPrivate(n: number): boolean {
  const a = n >>> 24;
  const b = (n >>> 16) & 255;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/**
 * Every other address on the phone's network, nearest first (its own /24
 * before the rest), capped at a /22 on very large networks.
 */
export function hostsToTry(a: PhoneAddress): string[] {
  const ip = toInt(a.ip);
  const prefix = prefixOf(a);
  if (ip === null || prefix === null || prefix < 8 || prefix > 30 || !isPrivate(ip)) return [];
  const bits = Math.max(prefix, MAX_PREFIX_BITS);
  const size = 2 ** (32 - bits);
  const net = Math.floor(ip / size) * size;
  const mine: number[] = [];
  const rest: number[] = [];
  const myBlock = Math.floor(ip / 256);
  for (let n = net + 1; n < net + size - 1; n++) {
    if (n === ip) continue;
    (Math.floor(n / 256) === myBlock ? mine : rest).push(n);
  }
  return [...mine, ...rest].map(toIp);
}

/** Is `ip` on the same network as the phone address `a`? */
export function sameNetwork(ip: string, a: PhoneAddress): boolean {
  const x = toInt(ip);
  const y = toInt(a.ip);
  const bits = prefixOf(a);
  if (x === null || y === null || bits === null || bits < 1) return false;
  const size = 2 ** (32 - bits);
  return Math.floor(x / size) === Math.floor(y / size);
}
