/**
 * prodeck-local: secure local addresses for ProDeck booths.
 *
 * A phone only lets a web page use its microphone (comms) or receive page
 * notifications on https. A booth that only lives on the church network has
 * plain http, so neither works there. This hands each booth a name,
 * <name>.local.prodeck.live, pointing at the booth's address on its own
 * network (172.20.4.20 and the like), and answers the booth's certificate
 * challenge so it can get a real Let's Encrypt certificate for that name.
 * Phones on the church Wi-Fi then reach the booth over https directly: no
 * traffic comes through here or through Cloudflare, only the name lookup.
 *
 *   booth  GET    /v1/available?name=      is a name free?
 *   booth  POST   /v1/claim     {name}                  → {name, host, secret}
 *   booth  POST   /v1/address   {name, secret, ip}      point the name at the booth
 *   booth  POST   /v1/challenge {name, secret, value}   certificate challenge TXT
 *   booth  DELETE /v1/challenge {name, secret}          ...and clean it up
 *   booth  DELETE /v1/address   {name, secret}          stop pointing the name anywhere (kept for the crew address)
 *   booth  POST   /v1/release   {name, secret}          give the name back
 *   Worker Names.fetch POST /verify {name, secret}   is this the name's secret? (service binding only)
 *   Zach   POST   /v1/admin/release {name}  (Authorization: Bearer ADMIN_TOKEN)
 *
 * Keeping prodeck.live safe (it also runs Cornerstone's crew app):
 *  - Every record this writes is under local.prodeck.live and DNS-only (never
 *    proxied), so nothing here can touch the zone's own names or the crew-edge
 *    Worker in front of them.
 *  - Address records only ever point at private network addresses
 *    (names.ts isPrivateIPv4), so this can't be used to point a prodeck.live
 *    name at a public site.
 *  - Each name's secret is shown once, to the booth that claimed it; only
 *    its SHA-256 is kept.
 *  - A ceiling (MAX_NAMES) keeps the zone well under Cloudflare's free-plan
 *    record limit, so the crew app's own records can always be edited.
 */
import { WorkerEntrypoint } from "cloudflare:workers";
import { isPrivateIPv4, nameProblem } from "./names";

interface Env {
  REGISTRY: DurableObjectNamespace;
  CLAIMS: RateLimit;
  CALLS: RateLimit;
  CF_API_TOKEN?: string;
  ADMIN_TOKEN?: string;
  ZONE_ID: string;
  BASE: string;
}

/** Each booth uses an address record and, for a minute every two months, a TXT. */
const MAX_NAMES = 150;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const fail = (status: number, error: string) => json({ ok: false, error }, status);

const hex = (b: ArrayBuffer | Uint8Array) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");
const sha256 = async (s: string) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
/** Constant-time compare of two hex digests. */
function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const who = req.headers.get("CF-Connecting-IP") ?? "unknown";
    if (!(await env.CALLS.limit({ key: who })).success) return fail(429, "Too many requests. Try again in a minute.");
    const registry = env.REGISTRY.get(env.REGISTRY.idFromName("registry"));

    if (req.method === "GET" && url.pathname === "/v1/available") {
      const name = (url.searchParams.get("name") ?? "").toLowerCase();
      const problem = nameProblem(name);
      if (problem) return json({ ok: true, available: false, problem });
      return registry.fetch(`https://do/available?name=${encodeURIComponent(name)}`);
    }

    if (url.pathname === "/v1/admin/release" && req.method === "POST") {
      const auth = req.headers.get("Authorization") ?? "";
      if (!env.ADMIN_TOKEN || !same(await sha256(auth), await sha256(`Bearer ${env.ADMIN_TOKEN}`)))
        return fail(401, "Not allowed.");
      return registry.fetch("https://do/release", { method: "POST", body: JSON.stringify({ ...(await body(req)), admin: true }) });
    }

    const routes: Record<string, string> = {
      "POST /v1/claim": "claim",
      "POST /v1/address": "address",
      "DELETE /v1/address": "unaddress",
      "POST /v1/challenge": "challenge",
      "DELETE /v1/challenge": "unchallenge",
      "POST /v1/release": "release",
    };
    const route = routes[`${req.method} ${url.pathname}`];
    if (!route) return fail(404, "Not found.");
    if (route === "claim" && !(await env.CLAIMS.limit({ key: who })).success)
      return fail(429, "Too many names claimed from here. Try again in a minute.");
    return registry.fetch(`https://do/${route}`, { method: "POST", body: JSON.stringify(await body(req)) });
  },
};

/**
 * For the crew address Worker (prodeck-crew, crew-cloud/) only, through a
 * service binding: it asks whether a booth's secret is its name's. Not
 * reachable from the internet: a named entrypoint only answers bindings.
 */
export class Names extends WorkerEntrypoint<Env> {
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (req.method !== "POST" || url.pathname !== "/verify") return fail(404, "Not found.");
    const registry = this.env.REGISTRY.get(this.env.REGISTRY.idFromName("registry"));
    return registry.fetch("https://do/verify", { method: "POST", body: JSON.stringify(await body(req)) });
  }
}

async function body(req: Request): Promise<Record<string, unknown>> {
  try {
    const b = await req.json();
    return b && typeof b === "object" ? (b as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

interface Row {
  name: string;
  hash: string;
  created: number;
  seen: number;
  ip: string;
  a_id: string;
  txt_ids: string;
}

/** One instance holds every name, so a name can never be handed out twice. */
export class Registry {
  private sql: SqlStorage;

  constructor(
    ctx: DurableObjectState,
    private env: Env,
  ) {
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS names (
      name TEXT PRIMARY KEY, hash TEXT NOT NULL, created INTEGER NOT NULL, seen INTEGER NOT NULL,
      ip TEXT NOT NULL DEFAULT '', a_id TEXT NOT NULL DEFAULT '', txt_ids TEXT NOT NULL DEFAULT '')`);
  }

  private row(name: string): Row | null {
    const r = this.sql.exec("SELECT * FROM names WHERE name = ?", name).toArray()[0];
    return (r as unknown as Row) ?? null;
  }

  private host(name: string) {
    return `${name}.${this.env.BASE}`;
  }

  private zoneId = "";

  /**
   * The zone's id: ZONE_ID if set, else looked up once by name with the API
   * token (the zone is the base minus its first label: prodeck.live), so
   * setting this up is just the token.
   */
  private async zone(): Promise<string> {
    if (this.env.ZONE_ID) return this.env.ZONE_ID;
    if (this.zoneId) return this.zoneId;
    const zoneName = this.env.BASE.split(".").slice(1).join(".");
    const r = await fetch(`https://api.cloudflare.com/client/v4/zones?name=${encodeURIComponent(zoneName)}`, {
      headers: { Authorization: `Bearer ${this.env.CF_API_TOKEN}` },
    });
    const out = (await r.json().catch(() => ({}))) as { result?: { id: string; name: string }[] };
    const id = out.result?.find((z) => z.name === zoneName)?.id ?? "";
    if (!id) throw new Error(`The API token can't see the ${zoneName} zone.`);
    this.zoneId = id;
    return id;
  }

  /** Cloudflare's DNS API, for this zone only. */
  private async dns(method: string, path: string, payload?: unknown): Promise<{ id?: string }> {
    if (!this.env.CF_API_TOKEN) throw new Error("This service isn't set up yet.");
    const r = await fetch(`https://api.cloudflare.com/client/v4/zones/${await this.zone()}/dns_records${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.env.CF_API_TOKEN}`, "Content-Type": "application/json" },
      body: payload ? JSON.stringify(payload) : undefined,
    });
    const out = (await r.json().catch(() => ({}))) as { success?: boolean; result?: { id?: string }; errors?: { message: string }[] };
    // Deleting a record that's already gone is fine.
    if (!out.success && !(method === "DELETE" && r.status === 404)) {
      throw new Error(`DNS update failed: ${out.errors?.map((e) => e.message).join("; ") || r.status}`);
    }
    return out.result ?? {};
  }

  /** The record name must end in the base: nothing outside local.prodeck.live, ever. */
  private inBase(fqdn: string) {
    if (!fqdn.endsWith(`.${this.env.BASE}`)) throw new Error("refusing a name outside the base");
    return fqdn;
  }

  private async authed(b: Record<string, unknown>): Promise<Row | Response> {
    const name = String(b.name ?? "").toLowerCase();
    const row = this.row(name);
    if (!row) return fail(404, "That name isn't claimed.");
    if (!same(row.hash, await sha256(String(b.secret ?? "")))) return fail(403, "That name belongs to another booth.");
    return row;
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const b = req.method === "POST" ? await body(req) : {};
    try {
      switch (url.pathname) {
        case "/available": {
          const name = url.searchParams.get("name") ?? "";
          return json({ ok: true, available: !this.row(name), problem: this.row(name) ? "Taken. Try another." : "" });
        }
        case "/claim": {
          const name = String(b.name ?? "").toLowerCase();
          const problem = nameProblem(name);
          if (problem) return fail(400, problem);
          if (this.row(name)) return fail(409, "Taken. Try another.");
          const count = Number(this.sql.exec("SELECT COUNT(*) AS n FROM names").one().n);
          if (count >= MAX_NAMES) return fail(503, "No more names can be handed out right now. Tell White Oak Media.");
          const secret = b64url(crypto.getRandomValues(new Uint8Array(32)));
          const now = Date.now();
          this.sql.exec("INSERT INTO names (name, hash, created, seen) VALUES (?, ?, ?, ?)", name, await sha256(secret), now, now);
          return json({ ok: true, name, host: this.host(name), secret }, 201);
        }
        case "/address": {
          const row = await this.authed(b);
          if (row instanceof Response) return row;
          const ip = String(b.ip ?? "");
          if (!isPrivateIPv4(ip)) return fail(400, "Only an address on the church network (like 192.168.1.20) can be used.");
          const record = { type: "A", name: this.inBase(this.host(row.name)), content: ip, ttl: 60, proxied: false, comment: "prodeck local" };
          let id = row.a_id;
          if (row.ip !== ip || !id) {
            if (id) {
              try {
                await this.dns("PATCH", `/${id}`, record);
              } catch {
                id = ""; // deleted by hand in the dashboard: make a new one
              }
            }
            if (!id) id = (await this.dns("POST", "", record)).id ?? "";
          }
          this.sql.exec("UPDATE names SET ip = ?, a_id = ?, seen = ? WHERE name = ?", ip, id, Date.now(), row.name);
          return json({ ok: true, host: this.host(row.name), ip });
        }
        case "/unaddress": {
          // The booth gave up its secure local address but keeps the name for
          // its crew address: the name stops pointing at the church network.
          const row = await this.authed(b);
          if (row instanceof Response) return row;
          if (row.a_id) await this.dns("DELETE", `/${row.a_id}`);
          this.sql.exec("UPDATE names SET ip = '', a_id = '', seen = ? WHERE name = ?", Date.now(), row.name);
          return json({ ok: true });
        }
        case "/verify": {
          // Only reachable through Names (above): the public router never
          // forwards here.
          const row = this.row(String(b.name ?? "").toLowerCase());
          const ok = !!row && same(row.hash, await sha256(String(b.secret ?? "")));
          if (ok) this.sql.exec("UPDATE names SET seen = ? WHERE name = ?", Date.now(), row!.name);
          return json({ ok });
        }
        case "/challenge": {
          const row = await this.authed(b);
          if (row instanceof Response) return row;
          const value = String(b.value ?? "");
          // An ACME dns-01 value: base64url of a SHA-256, 43 characters.
          if (!/^[A-Za-z0-9_-]{43}$/.test(value)) return fail(400, "That isn't a certificate challenge.");
          const r = await this.dns("POST", "", {
            type: "TXT",
            name: this.inBase(`_acme-challenge.${this.host(row.name)}`),
            content: `"${value}"`,
            ttl: 60,
            comment: "prodeck local challenge",
          });
          const ids = [row.txt_ids, r.id ?? ""].filter(Boolean).join(",");
          this.sql.exec("UPDATE names SET txt_ids = ?, seen = ? WHERE name = ?", ids, Date.now(), row.name);
          return json({ ok: true });
        }
        case "/unchallenge": {
          const row = await this.authed(b);
          if (row instanceof Response) return row;
          await this.clearChallenges(row);
          return json({ ok: true });
        }
        case "/release": {
          const name = String(b.name ?? "").toLowerCase();
          const row = b.admin ? this.row(name) : await this.authed(b);
          if (!row) return fail(404, "That name isn't claimed.");
          if (row instanceof Response) return row;
          await this.clearChallenges(row);
          if (row.a_id) await this.dns("DELETE", `/${row.a_id}`);
          this.sql.exec("DELETE FROM names WHERE name = ?", row.name);
          return json({ ok: true });
        }
      }
      return fail(404, "Not found.");
    } catch (e) {
      return fail(502, String((e as Error)?.message ?? e));
    }
  }

  private async clearChallenges(row: Row) {
    for (const id of row.txt_ids.split(",").filter(Boolean)) await this.dns("DELETE", `/${id}`);
    this.sql.exec("UPDATE names SET txt_ids = '' WHERE name = ?", row.name);
  }
}
