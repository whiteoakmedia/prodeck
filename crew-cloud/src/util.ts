// Small pure helpers shared by the router and the per-church object. Kept
// free of Worker globals beyond WebCrypto so the tests can call them directly.

/**
 * What follows a church's name in its crew address: <name>-crew.prodeck.live,
 * one level under the zone so Cloudflare's free *.prodeck.live certificate
 * covers it. The second is for `wrangler dev` on this computer (browsers send
 * *.localhost to 127.0.0.1).
 */
export const SUFFIXES = ["-crew.prodeck.live", "-crew.localhost"];

/** Same rules as the secure local address names (local-edge/src/names.ts). */
const NAME_RE = /^[a-z0-9](?:[a-z0-9]|-(?!-)){1,30}[a-z0-9]$/;

/**
 * Which church a request is for: the name in `<name>-crew.prodeck.live`. A
 * `x-prodeck-church` header stands in when the host has no name (the booth
 * calling a local test Worker, the tests). null = not a church address.
 */
export function churchFor(host: string, header: string | null, suffixes = SUFFIXES): string | null {
  const h = host.toLowerCase().replace(/:\d+$/, "");
  for (const suffix of suffixes) {
    if (h.endsWith(suffix)) {
      // One label only: "a.b-crew.prodeck.live" is nobody's.
      const name = h.slice(0, -suffix.length);
      return NAME_RE.test(name) ? name : null;
    }
  }
  const n = (header ?? "").trim().toLowerCase();
  return NAME_RE.test(n) ? n : null;
}

export const enc = new TextEncoder();

export function hex(b: ArrayBuffer | Uint8Array): string {
  return Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");
}

export async function sha256(s: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));
}

/** Constant-time compare of two hex strings of equal length. */
export function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/**
 * How a gateway password is kept in the cloud: PBKDF2-SHA256 with a salt the
 * booth picked, so a copy of the cloud's storage can't be turned back into a
 * church's crew password with a lookup table. The booth computes the same
 * thing (src-tauri/src/crewcloud.rs `verifier`); the test vectors there and
 * in test/util.test.ts must agree.
 */
export const PBKDF2_ITERATIONS = 20000;

export async function verifier(token: string, salt: string, iterations = PBKDF2_ITERATIONS): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(token), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: enc.encode(salt), iterations },
    key,
    256,
  );
  return hex(bits);
}

export function b64encode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Request headers worth passing to the booth. Everything else (cookies,
 * Cloudflare's own, anything claiming to say who the phone is) stays here:
 * the booth gets the phone's address from us, once, in its own field.
 */
const FORWARD = new Set([
  "accept",
  "accept-language",
  "content-type",
  "if-none-match",
  "if-modified-since",
  "range",
  "user-agent",
  "last-event-id",
]);

export function forwardHeaders(h: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  h.forEach((v, k) => {
    const key = k.toLowerCase();
    // The booth writes these into a raw HTTP request: no line breaks, ever.
    if (FORWARD.has(key) && !/[\r\n]/.test(v) && v.length <= 1024) out[key] = v;
  });
  return out;
}

/** Response headers from the booth that must not be copied onto ours. */
const HOP = new Set(["connection", "keep-alive", "transfer-encoding", "content-length", "upgrade", "proxy-connection"]);

export function responseHeaders(h: Record<string, string> | undefined): Headers {
  const out = new Headers();
  for (const [k, v] of Object.entries(h ?? {})) {
    if (!HOP.has(k.toLowerCase())) {
      try {
        out.set(k, v);
      } catch {
        /* a header the runtime won't take: drop it */
      }
    }
  }
  return out;
}

/**
 * Paths the relay won't carry from outside the church. The TV pairing calls
 * are for screens in the building, and the overflow audio is a continuous
 * stream that belongs on the church Wi-Fi, not on its internet uplink. Comms
 * and camera feeds aren't on this gateway's port at all.
 */
export function relayRefuses(path: string): boolean {
  return path.startsWith("/api/tv/") || path.startsWith("/api/listen") || path.startsWith("/_booth/");
}

/** A Response with JSON and the CORS headers the crew pages need. */
export function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...cors(), ...extra },
  });
}

export function cors(): Record<string, string> {
  // A crew page on the church network (http://192.168.1.20:8088) reads the
  // cloud copy from here when the booth stops answering. Auth is the crew
  // password in the request, never a cookie, so any origin may ask.
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
  };
}

export function randHex(bytes: number): string {
  return hex(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** Same construction as the booth's hash_pin (sha256 over salt + pin, hex). */
export async function hashPin(salt: string, pin: string): Promise<string> {
  return sha256(salt + pin);
}
