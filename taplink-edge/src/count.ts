// Which requests to the tap link are real taps (pure; tested from the app's
// suite in src/__tests__/taplinkCount.test.ts).
//
// Every hit used to count. One NFC tap can arrive twice (Android Chrome
// prerenders, an iPhone retries), a link pasted into a text gets fetched by
// the preview bot, and HEAD requests from link checkers counted too. Now: GET
// only, never a prefetch or a known preview bot, and one tap per phone per
// minute.

/** One phone tapping again within this long is the same tap. */
export const SAME_TAP_MS = 60_000;

const BOTS =
  /bot|crawler|spider|preview|facebookexternalhit|slackbot|twitterbot|whatsapp|telegram|discord|skypeuripreview|linkedin|embedly|curl|wget|python-requests|httpclient|okhttp|go-http-client|headless/i;

export function isRealTap(method: string, headers: { get(name: string): string | null }): boolean {
  if (method !== "GET") return false;
  const purpose = `${headers.get("sec-purpose") ?? ""} ${headers.get("purpose") ?? ""} ${headers.get("x-moz") ?? ""} ${headers.get("x-purpose") ?? ""}`;
  if (/prefetch|prerender|preview/i.test(purpose)) return false;
  const ua = headers.get("user-agent") ?? "";
  if (!ua || BOTS.test(ua)) return false;
  return true;
}

/**
 * Who tapped, without keeping who: a hash of the address and browser with a
 * salt that changes every day, so it can only ever match within the minute
 * it's used for.
 */
export async function tapperKey(ip: string, ua: string, now: number): Promise<string> {
  const day = Math.floor(now / 86_400_000);
  const bytes = new TextEncoder().encode(`${day}|${ip}|${ua}`);
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(h.slice(0, 12), (b) => b.toString(16).padStart(2, "0")).join("");
}
