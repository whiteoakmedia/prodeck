// Crew address (<name>.crew.prodeck.live, design/CREW_ADDRESS.md): the rules
// the booth and the phones share, kept free of React so they can be tested.
//
//  - The booth's window builds the week as it shows it (overrides and all)
//    and hands it to the booth, which sends it up with the checklists and
//    chat (src-tauri/src/crewcloud.rs).
//  - A phone remembers its church's crew address while the booth is up, so
//    when the booth stops answering it can still read the last copy there,
//    and when the booth is on but out of reach (the phone left the building)
//    it moves over to the crew address, which relays to the booth.

/** Where a phone keeps its church's crew address. */
export const CREW_URL_KEY = "prodeck.crewUrl";

const BASES = [".crew.prodeck.live", ".crew.localhost"];

/** Is this page on a crew address (as opposed to the booth itself)? */
export function isCrewHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return BASES.some((b) => h.endsWith(b));
}

/** Only an https crew address (or one on this computer, for testing) is kept. */
export function cleanCrewUrl(v: string | null | undefined): string {
  const t = (v ?? "").trim().replace(/\/+$/, "");
  const m = /^(https:\/\/[a-z0-9-]+\.crew\.prodeck\.live|http:\/\/[a-z0-9-]+\.crew\.localhost(:\d+)?)$/i.exec(t);
  return m ? m[1].toLowerCase() : "";
}

/** The booth's own address on the church network: plain http, a private
 *  address, a .local name, or the secure local address. */
function onChurchNetwork(origin: string, host: string): boolean {
  return (
    origin.startsWith("http://") ||
    host.endsWith(".local") ||
    host.endsWith(".local.prodeck.live") ||
    /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.)/.test(host)
  );
}

/**
 * Where to ask for the cloud copy (/edge/*), in order. On the crew address,
 * or a church's own domain (where crew-edge answers /edge/* even with the
 * booth off), that's the page's own origin. On the booth's address on the
 * church network, the crew address first: the booth's own origin is the very
 * thing that stopped answering.
 */
export function edgeBases(origin: string, crewUrl: string, publicUrl: string): string[] {
  const out: string[] = [];
  const add = (b: string) => {
    if (b && !out.includes(b)) out.push(b);
  };
  let host = "";
  try {
    host = new URL(origin).hostname;
  } catch {
    /* no origin: the desktop */
  }
  if (isCrewHost(host) || (host && !onChurchNetwork(origin, host))) add(origin);
  add(crewUrl);
  add(origin);
  add(publicUrl);
  return out;
}

// ---------------------------------------------------------------- the plan

interface SnapItem {
  id: string;
  title: string;
  sequence: number;
  length: number;
  type: string;
  key: string;
  leader: string;
}

export interface CloudPlan {
  plan: { id: string; date: string; title: string };
  items: SnapItem[];
  serviceTimes: { id: string; name: string; type: string; ts: number | null }[];
  team: { name: string; position: string; status: string; timeIds: string[] }[];
  extras: { checkinTimes: Record<string, string>; positionGuides: Record<string, string> };
}

/**
 * This week's plan in the shape phones read on the crew address (the same as
 * crew-edge's /edge/plan, so the booth-off screen reads either). Only what the
 * crew page shows: no notes beyond the leader, no files, no Planning Center
 * ids (charts aren't in the copy).
 */
export function cloudPlanSnapshot(input: {
  plan: { id: string; date: string; title: string } | null | undefined;
  items: { id: string; title: string; sequence: number; length: number; type: string; key: string; leader: string }[];
  serviceTimes: { id: string; name: string; ts: number }[];
  team: { name: string; position: string; status: string; timeIds: string[] }[];
  checkinTimes: Record<string, string>;
  positionGuides: Record<string, string>;
}): CloudPlan | null {
  if (!input.plan) return null;
  return {
    plan: { id: input.plan.id, date: input.plan.date, title: input.plan.title },
    items: input.items.map((i) => ({
      id: i.id,
      title: i.title,
      sequence: i.sequence,
      length: i.length,
      type: i.type,
      key: i.key ?? "",
      leader: i.leader ?? "",
    })),
    serviceTimes: input.serviceTimes.map((t) => ({ id: t.id, name: t.name, type: "service", ts: t.ts || null })),
    team: input.team.map((m) => ({ name: m.name, position: m.position, status: m.status, timeIds: m.timeIds ?? [] })),
    extras: { checkinTimes: { ...input.checkinTimes }, positionGuides: { ...input.positionGuides } },
  };
}

// ---------------------------------------------------------------- what phones see

/**
 * The line a phone shows over the cloud copy:
 * "The booth is off. Showing the last plan it sent at 9:14 PM".
 */
export function cloudCopyLine(sentMs: number, now: number = Date.now()): string {
  if (!sentMs) return "The booth is off, and it hasn't sent a plan yet.";
  const sent = new Date(sentMs);
  const time = sent.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const today = new Date(now);
  const sameDay = sent.toDateString() === today.toDateString();
  const yesterday = new Date(now - 86_400_000).toDateString() === sent.toDateString();
  const when = sameDay
    ? `at ${time}`
    : yesterday
      ? `yesterday at ${time}`
      : `on ${sent.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })} at ${time}`;
  return `The booth is off. Showing the last plan it sent ${when}.`;
}

// ---------------------------------------------------------------- moving over

export interface Handoff {
  token: string;
  session?: string;
  name?: string;
  role?: string;
  id?: string;
}

/**
 * The sign in a page carries to the crew address when it moves there (the
 * crew address is a different site, so it has none of its own yet). In the
 * address's #fragment, which never reaches any server.
 */
export function handoffHash(h: Handoff): string {
  const clean: Handoff = { token: h.token };
  if (h.session) clean.session = h.session;
  if (h.name) clean.name = h.name;
  if (h.role) clean.role = h.role;
  if (h.id) clean.id = h.id;
  return `#pdhandoff=${encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(clean)))))}`;
}

/** Read (and strip) a hand over from a page's #fragment. */
export function readHandoff(hash: string): { handoff: Handoff | null; rest: string } {
  const m = /(^#|&)pdhandoff=([^&]*)/.exec(hash);
  if (!m) return { handoff: null, rest: hash };
  let rest = hash.slice(0, m.index) + hash.slice(m.index + m[0].length);
  if (m[1] === "#") rest = rest ? `#${rest.replace(/^&/, "")}` : "";
  try {
    const v = JSON.parse(decodeURIComponent(escape(atob(decodeURIComponent(m[2]))))) as Handoff;
    if (!v || typeof v.token !== "string" || !v.token || v.token.length > 512) return { handoff: null, rest };
    const str = (x: unknown) => (typeof x === "string" && x.length <= 200 ? x : undefined);
    return {
      handoff: { token: v.token, session: str(v.session), name: str(v.name), role: str(v.role), id: str(v.id) },
      rest,
    };
  } catch {
    return { handoff: null, rest };
  }
}

/**
 * Should a page whose booth stopped answering move to the crew address? Only
 * when it isn't there already and the crew address says the booth is linked:
 * then the booth is on and this phone just can't reach it directly (it left
 * the building). With the booth off there's nothing to gain by moving, and
 * when the booth comes back on the church Wi-Fi the page reconnects where it is.
 */
export function shouldMoveToCrew(hostname: string, crewUrl: string, boothLinked: boolean): boolean {
  return !!crewUrl && boothLinked && !isCrewHost(hostname);
}
