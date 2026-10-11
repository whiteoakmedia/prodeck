/**
 * Church Online Platform webhook events, cut down to what ProDeck shows.
 *
 * ChOP sends CloudEvents carrying a full user record (email included). The
 * relay keeps only what the booth needs: who (first name and last initial),
 * which service, and the one or two numbers each event is about. Pure, so the
 * app's tests can run it too.
 */

export type ChopKind = "attended" | "chatted" | "served" | "prayer" | "moment" | "other";

export interface SlimEvent {
  /** CloudEvents id: ChOP retries for days, so this is how duplicates are dropped. */
  id: string;
  kind: ChopKind;
  /** When it happened (CloudEvents `time`, else when it arrived), epoch ms. */
  at: number;
  serviceId: string;
  /** "Jane D." or a nickname; "" for someone who wasn't signed in. */
  who: string;
  /** The ChOP user id, to count people once. */
  userId: string;
  /** chatted: messages across channels. attended/served: seconds attended, as sent. */
  count: number;
  /** moment: its type and follow-up option, e.g. "salvation". */
  detail: string;
}

const KIND: Record<string, ChopKind> = {
  "church.online.service.attended": "attended",
  "church.online.service.chatted": "chatted",
  "church.online.service.served": "served",
  "church.online.prayer.requested": "prayer",
  "church.online.moment.interacted": "moment",
};

function displayName(u: any): string {
  const first = typeof u?.firstName === "string" ? u.firstName.trim() : "";
  const last = typeof u?.lastName === "string" ? u.lastName.trim() : "";
  if (first) return last ? `${first} ${last[0].toUpperCase()}.` : first;
  const nick = typeof u?.nickname === "string" ? u.nickname.trim() : "";
  return nick.slice(0, 40);
}

export function slimEvent(e: any, receivedAt: number): SlimEvent | null {
  if (!e || typeof e !== "object" || typeof e.id !== "string" || !e.id) return null;
  const kind = KIND[e.type] ?? "other";
  const d = e.data ?? {};
  const t = Date.parse(e.time ?? d.timestamp ?? "");
  let count = 0;
  if (kind === "chatted" && Array.isArray(d.channels)) {
    count = d.channels.reduce((n: number, c: any) => n + (Number(c?.messageCount) || 0), 0);
  } else if (kind === "attended" || kind === "served") {
    count = Number(d.totalTimeAttended) || 0;
  }
  let detail = "";
  if (kind === "moment") {
    const m = d.moment ?? {};
    const opts = m.options && typeof m.options === "object" ? Object.values(m.options).join(" ") : "";
    detail = `${m.type ?? ""} ${opts}`.trim().slice(0, 120);
  } else if (kind === "prayer") {
    detail = String(d.channel?.type ?? "").slice(0, 40);
  }
  return {
    id: e.id.slice(0, 100),
    kind,
    at: Number.isFinite(t) ? t : receivedAt,
    serviceId: String(d.service?.id ?? "").slice(0, 100),
    who: displayName(d.user),
    userId: String(d.user?.id ?? "").slice(0, 100),
    count,
    detail,
  };
}

/** True when a moment response is a salvation response. */
export const isSalvation = (e: Pick<SlimEvent, "kind" | "detail">) =>
  e.kind === "moment" && /salvation/i.test(e.detail);

/** `sha1=<hex>` of the raw body with the webhook's secret, as ChOP signs it. */
export async function chopSignature(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  return "sha1=" + Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Compare without leaking where the strings differ. */
export function sameString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
