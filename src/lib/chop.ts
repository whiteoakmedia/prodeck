// Church Online Platform (ChOP): the online service, as the booth sees it.
//
// Two sources:
//   1. ChOP's public API, per church: which service is live or next. No setup
//      beyond the church's ChOP address.
//   2. ChOP webhooks: who attended, chatted, asked for prayer or responded to
//      a moment. ChOP can only send these to a public address, so they land in
//      the church's inbox on White Oak's relay (feedback-edge/src/chop.ts) and
//      the booth collects them from there.
// Neither carries chat or prayer text: ChOP doesn't send it.

import { isSalvation, type SlimEvent } from "../../feedback-edge/src/chopEvents";

export { isSalvation };
export type { SlimEvent };

export const RELAY = "https://prodeck-feedback.taplink-edge.workers.dev";

/** "https://yourchurch.online.church/live" → "yourchurch.online.church". */
export function chopHost(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/[/?#].*$/, "")
    .replace(/\.$/, "");
}

export interface ChopService {
  id: string;
  title: string;
  /** Epoch ms. Start includes ChOP's pre-service chat time. */
  start: number;
  end: number;
}

/** The live service, else the next one; null when ChOP has none scheduled. */
export async function fetchCurrentService(domain: string, fetchImpl: typeof fetch = fetch): Promise<ChopService | null> {
  const host = chopHost(domain);
  if (!host) throw new Error("Add your Church Online address first.");
  let res: Response;
  try {
    res = await fetchImpl(`https://${host}/graphql`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        operationName: "CurrentService",
        query:
          "query CurrentService { currentService(onEmpty: LOAD_NEXT) { id startTime endTime content { title } } }",
      }),
    });
  } catch {
    throw new Error(`Couldn't reach ${host}. Check the address and the internet connection.`);
  }
  if (!res.ok) throw new Error(`${host} didn't answer as a Church Online site (error ${res.status}). Check the address.`);
  const j = (await res.json().catch(() => null)) as any;
  const s = j?.data?.currentService;
  if (!s?.id) return null;
  return {
    id: String(s.id),
    title: String(s.content?.title ?? "Online service"),
    start: Date.parse(s.startTime),
    end: Date.parse(s.endTime),
  };
}

export type Phase = "none" | "upcoming" | "live" | "ended";

export function phaseOf(svc: ChopService | null, now: number): Phase {
  if (!svc || !Number.isFinite(svc.start)) return "none";
  if (now < svc.start) return "upcoming";
  if (!Number.isFinite(svc.end) || now < svc.end) return "live";
  return "ended";
}

// ---------------------------------------------------------------- relay inbox

async function relay<T>(path: string, init: RequestInit, token?: string, fetchImpl: typeof fetch = fetch): Promise<T> {
  let res: Response;
  try {
    res = await fetchImpl(RELAY + path, {
      ...init,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
  } catch {
    throw new Error("Couldn't reach White Oak's relay. Check the internet connection.");
  }
  const j = (await res.json().catch(() => ({}))) as any;
  if (!res.ok || j?.ok === false) {
    const err = new Error(j?.error || `The relay said ${res.status}.`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return j as T;
}

export const createInbox = (f?: typeof fetch) => relay<{ inbox: string; token: string }>("/chop/inboxes", { method: "POST", body: "{}" }, undefined, f);
export const setInboxSecret = (inbox: string, token: string, secret: string, f?: typeof fetch) =>
  relay(`/chop/inboxes/${inbox}/secret`, { method: "PUT", body: JSON.stringify({ secret }) }, token, f);
export const deleteInbox = (inbox: string, token: string, f?: typeof fetch) =>
  relay(`/chop/inboxes/${inbox}`, { method: "DELETE" }, token, f);
export const webhookUrl = (inbox: string) => `${RELAY}/chop/hook/${inbox}`;

export interface InboxPage {
  seq: number;
  latest: number;
  events: (SlimEvent & { seq: number })[];
  unverified: number;
  hasSecret: boolean;
  lastEventAt: number;
  lastBadSignatureAt: number;
}
export const fetchInbox = (inbox: string, token: string, after: number, f?: typeof fetch) =>
  relay<InboxPage>(`/chop/inboxes/${inbox}/events?after=${after}`, { method: "GET" }, token, f);

// ---------------------------------------------------------------- totals

export interface Moment {
  kind: "prayer" | "salvation";
  who: string;
  at: number;
}

/** One service's totals. Plain arrays so it survives JSON (storage, the gateway). */
export interface ServiceTally {
  serviceId: string;
  attendees: string[];
  chatters: string[];
  messages: number;
  prayers: number;
  salvations: number;
  recent: Moment[];
  seen: string[];
  updatedAt: number;
}

const RECENT = 12;
const SEEN = 2000;
const SERVICES = 4;

export const emptyTally = (serviceId: string): ServiceTally => ({
  serviceId,
  attendees: [],
  chatters: [],
  messages: 0,
  prayers: 0,
  salvations: 0,
  recent: [],
  seen: [],
  updatedAt: 0,
});

/**
 * Fold events into per-service totals. Idempotent: ChOP retries for weeks and
 * the booth may read the same events twice, so each event counts once.
 * Returns the totals and the events that are new (for paging).
 */
export function foldEvents(
  tallies: Record<string, ServiceTally>,
  events: SlimEvent[],
): { tallies: Record<string, ServiceTally>; fresh: SlimEvent[] } {
  const out: Record<string, ServiceTally> = { ...tallies };
  const fresh: SlimEvent[] = [];
  for (const e of events) {
    const key = e.serviceId || "unknown";
    const t: ServiceTally = out[key] ? { ...out[key] } : emptyTally(key);
    if (t.seen.includes(e.id)) continue;
    t.seen = [...t.seen, e.id].slice(-SEEN);
    const person = e.userId || e.id;
    if (e.kind === "attended" && !t.attendees.includes(person)) t.attendees = [...t.attendees, person];
    if (e.kind === "chatted") {
      if (!t.chatters.includes(person)) t.chatters = [...t.chatters, person];
      t.messages += e.count;
    }
    if (e.kind === "prayer") {
      t.prayers += 1;
      t.recent = [{ kind: "prayer" as const, who: e.who, at: e.at }, ...t.recent].slice(0, RECENT);
    }
    if (isSalvation(e)) {
      t.salvations += 1;
      t.recent = [{ kind: "salvation" as const, who: e.who, at: e.at }, ...t.recent].slice(0, RECENT);
    }
    t.updatedAt = Math.max(t.updatedAt, e.at);
    out[key] = t;
    fresh.push(e);
  }
  // Keep the most recent few services.
  const keep = Object.values(out)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, SERVICES)
    .map((t) => t.serviceId);
  for (const k of Object.keys(out)) if (!keep.includes(k)) delete out[k];
  return { tallies: out, fresh };
}

/** The page to send for a new event, or null. Only recent events page anyone. */
export function pageFor(
  e: SlimEvent,
  opts: { prayer: boolean; salvation: boolean },
  now: number,
): string | null {
  if (now - e.at > 15 * 60_000) return null;
  const who = e.who || "Someone who isn't signed in";
  if (e.kind === "prayer" && opts.prayer) return `Prayer request on Church Online from ${who}. Someone from the prayer team can pray with them there.`;
  if (isSalvation(e) && opts.salvation) return `${who} responded to the salvation moment on Church Online.`;
  return null;
}

/** What the booth shares with every screen (`chop:state`). */
export interface ChopSummary {
  domain: string;
  service: ChopService | null;
  serviceError: string;
  /** Totals for the service shown, when webhooks are connected. */
  tally: Omit<ServiceTally, "seen" | "attendees" | "chatters"> & { attendees: number; chatters: number } | null;
  webhooks: { connected: boolean; lastEventAt: number; lastBadSignatureAt: number; hasSecret: boolean; error: string };
  updatedAt: number;
}

export function summarize(
  domain: string,
  service: ChopService | null,
  serviceError: string,
  tallies: Record<string, ServiceTally>,
  webhooks: ChopSummary["webhooks"],
  now: number,
): ChopSummary {
  // The service on screen if it has events; otherwise the latest that does.
  const t =
    (service && tallies[service.id]) ||
    Object.values(tallies).sort((a, b) => b.updatedAt - a.updatedAt)[0] ||
    null;
  return {
    domain,
    service,
    serviceError,
    tally: t
      ? {
          serviceId: t.serviceId,
          attendees: t.attendees.length,
          chatters: t.chatters.length,
          messages: t.messages,
          prayers: t.prayers,
          salvations: t.salvations,
          recent: t.recent,
          updatedAt: t.updatedAt,
        }
      : null,
    webhooks,
    updatedAt: now,
  };
}
