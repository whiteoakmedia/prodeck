/**
 * Church Online Platform inboxes.
 *
 * ChOP can only deliver webhooks to a public HTTPS address, and a booth
 * computer doesn't have one. So each church gets a private inbox here:
 *
 *   ProDeck   POST   /chop/inboxes              → { inbox, token }   (once, at setup)
 *   ProDeck   PUT    /chop/inboxes/:id/secret   { secret }           (the key ChOP shows)
 *   ChOP      POST   /chop/hook/:id             (each webhook, signed)
 *   ProDeck   GET    /chop/inboxes/:id/events?after=<seq>            (every few seconds)
 *   ProDeck   DELETE /chop/inboxes/:id                               (disconnect)
 *
 * One Durable Object per inbox. It checks each webhook's signature, keeps the
 * slim form (chopEvents.ts: no email addresses), drops duplicates from ChOP's
 * retries, and forgets everything after three days. Calls from ProDeck carry
 * the inbox token; only its SHA-256 is stored.
 */
import { chopSignature, sameString, slimEvent } from "./chopEvents";

const KEEP_MS = 3 * 86400_000;
const KEEP_ROWS = 3000;
const PAGE = 500;

const hex = (b: ArrayBuffer | Uint8Array) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");
const randomHex = (n: number) => hex(crypto.getRandomValues(new Uint8Array(n)));
const sha256 = async (s: string) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));

interface Meta {
  tokenHash: string;
  secret: string;
  created: number;
  lastEventAt: number;
  lastBadSignatureAt: number;
}

export class ChopInbox {
  private storage: DurableObjectStorage;
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState) {
    this.storage = ctx.storage;
    this.sql = ctx.storage.sql;
    this.sql.exec(
      "CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY AUTOINCREMENT, eid TEXT UNIQUE NOT NULL, at INTEGER NOT NULL, received INTEGER NOT NULL, verified INTEGER NOT NULL, ev TEXT NOT NULL)",
    );
  }

  private meta(): Promise<Meta | undefined> {
    return this.storage.get<Meta>("meta");
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const op = url.pathname;
    const meta = await this.meta();

    if (op === "/init") {
      if (meta) return Response.json({ ok: false, error: "exists" }, { status: 409 });
      const { tokenHash } = (await req.json()) as { tokenHash: string };
      await this.storage.put<Meta>("meta", { tokenHash, secret: "", created: Date.now(), lastEventAt: 0, lastBadSignatureAt: 0 });
      return Response.json({ ok: true });
    }
    if (!meta) return Response.json({ ok: false, error: "No such inbox." }, { status: 404 });

    if (op === "/hook") {
      const body = await req.text();
      const given = req.headers.get("x-chop-webhook-signature") ?? "";
      const verified = !!meta.secret && sameString(await chopSignature(meta.secret, body), given.trim());
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        return new Response("not json", { status: 400 });
      }
      const now = Date.now();
      const ev = slimEvent(parsed, now);
      if (!ev) return new Response("not a CloudEvent", { status: 400 });
      this.sql.exec(
        "INSERT OR IGNORE INTO events (eid, at, received, verified, ev) VALUES (?, ?, ?, ?, ?)",
        ev.id, ev.at, now, verified ? 1 : 0, JSON.stringify(ev),
      );
      if (verified) meta.lastEventAt = now;
      else meta.lastBadSignatureAt = now;
      await this.storage.put("meta", meta);
      this.sql.exec("DELETE FROM events WHERE received < ?", now - KEEP_MS);
      this.sql.exec("DELETE FROM events WHERE seq <= (SELECT MAX(seq) FROM events) - ?", KEEP_ROWS);
      // Accepted either way: an unverified event is kept (flagged) so Settings
      // can say the secret is wrong, and ChOP must not retry it for 21 days.
      return new Response(null, { status: 202 });
    }

    // Everything else is ProDeck, with the inbox token.
    const auth = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!auth || !sameString(await sha256(auth), meta.tokenHash)) {
      return Response.json({ ok: false, error: "Not allowed." }, { status: 401 });
    }

    if (op === "/secret" && req.method === "PUT") {
      const { secret } = (await req.json()) as { secret?: string };
      meta.secret = typeof secret === "string" ? secret.trim().slice(0, 200) : "";
      await this.storage.put("meta", meta);
      // Events that arrived before the secret can't be checked any more.
      return Response.json({ ok: true });
    }
    if (op === "/events" && req.method === "GET") {
      const after = Math.max(0, Number(url.searchParams.get("after")) || 0);
      const rows = this.sql
        .exec("SELECT seq, verified, ev FROM events WHERE seq > ? ORDER BY seq LIMIT ?", after, PAGE)
        .toArray() as { seq: number; verified: number; ev: string }[];
      const last = (this.sql.exec("SELECT MAX(seq) AS m FROM events").one() as { m: number | null }).m ?? 0;
      return Response.json({
        ok: true,
        seq: rows.length ? rows[rows.length - 1].seq : Math.max(after, 0),
        latest: last,
        events: rows.filter((r) => r.verified).map((r) => ({ seq: r.seq, ...JSON.parse(r.ev) })),
        unverified: rows.filter((r) => !r.verified).length,
        hasSecret: !!meta.secret,
        lastEventAt: meta.lastEventAt,
        lastBadSignatureAt: meta.lastBadSignatureAt,
      });
    }
    if (op === "/delete" && req.method === "DELETE") {
      await this.storage.deleteAll();
      return Response.json({ ok: true });
    }
    return Response.json({ ok: false, error: "Not found." }, { status: 404 });
  }
}

interface ChopEnv {
  CHOP_INBOX: DurableObjectNamespace;
  PER_IP: RateLimit;
}

const ID = /^[0-9a-f]{32}$/;

/** Routes under /chop/. Returns null for anything else. */
export async function chopRoute(req: Request, env: ChopEnv, url: URL, cors: Record<string, string>): Promise<Response | null> {
  const p = url.pathname;
  if (!p.startsWith("/chop/")) return null;
  const withCors = (r: Response) => {
    const out = new Response(r.body, r);
    for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
    return out;
  };
  const stub = (id: string) => env.CHOP_INBOX.get(env.CHOP_INBOX.idFromName(id));

  if (p === "/chop/inboxes" && req.method === "POST") {
    const ip = req.headers.get("CF-Connecting-IP") ?? "unknown";
    if (!(await env.PER_IP.limit({ key: `chop:${ip}` })).success) {
      return withCors(Response.json({ ok: false, error: "Too many at once. Try again in a minute." }, { status: 429 }));
    }
    const inbox = randomHex(16);
    const token = randomHex(32);
    const r = await stub(inbox).fetch("https://inbox/init", { method: "POST", body: JSON.stringify({ tokenHash: await sha256(token) }) });
    if (!r.ok) return withCors(Response.json({ ok: false, error: "Couldn't create the inbox. Try again." }, { status: 500 }));
    return withCors(Response.json({ ok: true, inbox, token }));
  }

  const hook = p.match(/^\/chop\/hook\/([0-9a-f]+)$/);
  if (hook && req.method === "POST") {
    if (!ID.test(hook[1])) return new Response("no such inbox", { status: 404 });
    return stub(hook[1]).fetch("https://inbox/hook", { method: "POST", headers: req.headers, body: await req.text() });
  }

  const m = p.match(/^\/chop\/inboxes\/([0-9a-f]+)(\/secret|\/events)?$/);
  if (m && ID.test(m[1])) {
    const op = m[2] === "/secret" ? "/secret" : m[2] === "/events" ? "/events" : req.method === "DELETE" ? "/delete" : "";
    if (!op) return withCors(Response.json({ ok: false, error: "Not found." }, { status: 404 }));
    const r = await stub(m[1]).fetch(`https://inbox${op}${url.search}`, {
      method: req.method,
      headers: { authorization: req.headers.get("authorization") ?? "", "content-type": "application/json" },
      body: req.method === "PUT" ? await req.text() : undefined,
    });
    return withCors(r);
  }
  return withCors(Response.json({ ok: false, error: "Not found." }, { status: 404 }));
}
