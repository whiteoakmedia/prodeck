// TapLink edge: NFC discs point at GET /now, which 302s to the destination for
// the current service moment. ProDeck pushes state via POST /api/state when a
// slide with a tap:<keyword> note goes live. See ../TAPLINK_PLAN.md.
//
// All state lives in a single Durable Object ("singleton") so a state flip is
// visible on the very next tap — no KV edge-cache staleness.

export interface Env {
  TAP_STATE: DurableObjectNamespace;
  TAPLINK_TOKEN: string; // bearer token for /api/* writes and reads
  ADMIN_KEY: string; // long random path segment for the phone admin page
}

const VERSION = "0.3.0";
const TAP_RETENTION_DAYS = 90;

// A keyword maps to either a bare URL (uses the global ttl_minutes) or
// { url, ttl_minutes } for a per-keyword revert timer.
type KeywordDef = string | { url: string; ttl_minutes?: number };

interface TapConfig {
  default: string;
  ttl_minutes: number;
  keywords: Record<string, KeywordDef>;
}

function kwUrl(cfg: TapConfig, k: string): string | null {
  const d = cfg.keywords[k];
  if (typeof d === "string") return d;
  return d?.url ?? null;
}

function kwTtl(cfg: TapConfig, k: string): number {
  const d = cfg.keywords[k];
  return (typeof d === "object" && d?.ttl_minutes) || cfg.ttl_minutes;
}

// Shipped defaults; runtime changes go through PUT /api/mappings (or ProDeck
// settings once the watcher lands). Keyword "go" is the giving moment; the
// default (no active keyword) is the connect card.
const DEFAULT_CONFIG: TapConfig = {
  // Where a disc lands when no destination has been set (or the TTL lapsed).
  // Point this at YOUR default page — connect card, church site, anything.
  default: "https://example.com/REPLACE-WITH-YOUR-DEFAULT-LINK",
  ttl_minutes: 180,
  keywords: {
    go: { url: "https://pushpay.com/g/cornerstonecheshire?src=hpp", ttl_minutes: 15 },
    connect: "https://cornerstonecheshire.churchcenter.com/people/forms/566700",
    notes: "https://faithnotes.cloud/cornerstonechurchcheshire",
    prayer: "https://cornerstonecheshire.churchcenter.com/people/forms/963472",
    groups: "https://cornerstonecheshire.churchcenter.com/groups/small-groups?enrollment=open_signup,request_to_join&filter=enrollment",
  },
};

interface CurrentState {
  state: string; // keyword, always present when set (revert-to-default = no row)
  source: "auto" | "override";
  setAt: number;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/api/health") {
      return json({ ok: true, version: VERSION });
    }
    const id = env.TAP_STATE.idFromName("singleton");
    return env.TAP_STATE.get(id).fetch(req);
  },
};

export class TapState {
  private storage: DurableObjectStorage;
  private sql: SqlStorage;
  private env: Env;

  constructor(ctx: DurableObjectState, env: Env) {
    this.storage = ctx.storage;
    this.sql = ctx.storage.sql;
    this.env = env;
    this.sql.exec(
      "CREATE TABLE IF NOT EXISTS taps (ts INTEGER NOT NULL, state TEXT NOT NULL)",
    );
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    // Public tap path — must stay fast and unauthenticated.
    if ((path === "/" || path === "/now") && (req.method === "GET" || req.method === "HEAD")) {
      return this.handleTap();
    }

    if (path.startsWith("/admin/")) {
      return this.handleAdmin(req, path);
    }

    if (path.startsWith("/api/")) {
      if (!(await this.bearerOk(req))) return json({ error: "unauthorized" }, 401);

      if (path === "/api/state" && req.method === "GET") return this.getState();
      if (path === "/api/state" && req.method === "POST") return this.setState(req);
      if (path === "/api/mappings" && req.method === "GET") {
        return json(await this.config());
      }
      if (path === "/api/mappings" && req.method === "PUT") return this.putMappings(req);
      if (path === "/api/heartbeat" && req.method === "POST") {
        await this.storage.put("heartbeat", Date.now());
        return json({ ok: true });
      }
      if (path === "/api/stats" && req.method === "GET") return this.getStats(url);
      return json({ error: "not found" }, 404);
    }

    return json({ error: "not found" }, 404);
  }

  // ------------------------------------------------------------------ tap

  private async handleTap(): Promise<Response> {
    const cfg = await this.config();
    const st = await this.liveState(cfg);
    const dest = (st && kwUrl(cfg, st.state)) || cfg.default;
    const now = Date.now();
    this.sql.exec("INSERT INTO taps (ts, state) VALUES (?, ?)", now, st?.state ?? "default");
    // Cheap opportunistic pruning; table stays tiny at church-tap volumes.
    this.sql.exec("DELETE FROM taps WHERE ts < ?", now - TAP_RETENTION_DAYS * 86400_000);
    return new Response(null, {
      status: 302,
      headers: {
        Location: dest,
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    });
  }

  // Current state honoring TTL (per-keyword when set, else global). The TTL
  // clock runs from when the state was set, deliberately NOT extended by
  // heartbeats — an always-on booth Mac must not pin Sunday's giving state
  // through the week.
  private async liveState(cfg: TapConfig): Promise<CurrentState | null> {
    const st = await this.storage.get<CurrentState>("state");
    if (!st) return null;
    const unknown = kwUrl(cfg, st.state) === null;
    const expired = Date.now() - st.setAt > kwTtl(cfg, st.state) * 60_000;
    if (expired || unknown) {
      await this.storage.delete("state");
      return null;
    }
    return st;
  }

  private async config(): Promise<TapConfig> {
    return (await this.storage.get<TapConfig>("config")) ?? DEFAULT_CONFIG;
  }

  // ------------------------------------------------------------------ api

  private async getState(): Promise<Response> {
    const cfg = await this.config();
    const st = await this.liveState(cfg);
    return json({
      state: st?.state ?? null,
      source: st?.source ?? null,
      setAt: st?.setAt ?? null,
      destination: (st && kwUrl(cfg, st.state)) || cfg.default,
      expiresAt: st ? st.setAt + kwTtl(cfg, st.state) * 60_000 : null,
      lastHeartbeat: (await this.storage.get<number>("heartbeat")) ?? null,
      version: VERSION,
    });
  }

  private async applyState(
    state: string | null,
    source: "auto" | "override",
  ): Promise<Response> {
    const cfg = await this.config();
    if (state === null || state === "default") {
      await this.storage.delete("state");
      return json({ state: null, destination: cfg.default });
    }
    const dest = kwUrl(cfg, state);
    if (dest === null) {
      return json({ error: `unknown keyword "${state}"`, known: Object.keys(cfg.keywords) }, 422);
    }
    const st: CurrentState = { state, source, setAt: Date.now() };
    await this.storage.put("state", st);
    return json({ state, destination: dest, ttl_minutes: kwTtl(cfg, state) });
  }

  private async setState(req: Request): Promise<Response> {
    let body: { state?: unknown; source?: unknown };
    try {
      body = await req.json();
    } catch {
      return json({ error: "invalid JSON" }, 400);
    }
    if (body.state !== null && typeof body.state !== "string") {
      return json({ error: "state must be a string or null" }, 400);
    }
    const source = body.source === "override" ? "override" : "auto";
    return this.applyState(body.state as string | null, source);
  }

  private async putMappings(req: Request): Promise<Response> {
    let cfg: TapConfig;
    try {
      cfg = await req.json();
    } catch {
      return json({ error: "invalid JSON" }, 400);
    }
    const err = validateConfig(cfg);
    if (err) return json({ error: err }, 422);
    await this.storage.put("config", cfg);
    // A state whose keyword was removed dies on next read via liveState().
    return json({ ok: true, keywords: Object.keys(cfg.keywords) });
  }

  // `?from=<ms>&to=<ms>` narrows to one service window and answers a flat
  // per-keyword total instead of day buckets — a service crossing midnight UTC
  // (or two services inside one UTC day) can't be told apart by day rows.
  private async getStats(url: URL): Promise<Response> {
    const from = Number(url.searchParams.get("from"));
    const to = Number(url.searchParams.get("to"));
    if (url.searchParams.has("from") || url.searchParams.has("to")) {
      if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) {
        return json({ error: "from/to must be epoch-ms numbers with from < to" }, 400);
      }
      const rows = this.sql
        .exec(
          `SELECT state, COUNT(*) AS taps FROM taps
           WHERE ts >= ? AND ts < ? GROUP BY state ORDER BY taps DESC`,
          from,
          to,
        )
        .toArray();
      const total = rows.reduce((n, r) => n + Number(r.taps), 0);
      return json({ from, to, total, keywords: rows });
    }
    const rows = this.sql
      .exec(
        `SELECT date(ts / 1000, 'unixepoch') AS day, state, COUNT(*) AS taps
         FROM taps GROUP BY day, state ORDER BY day DESC, taps DESC`,
      )
      .toArray();
    return json({ days: rows });
  }

  // ---------------------------------------------------------------- admin

  // Emergency fallback reachable from a phone when the booth loses internet.
  // Auth is the long random ADMIN_KEY path segment: /admin/<key>
  private async handleAdmin(req: Request, path: string): Promise<Response> {
    const key = path.slice("/admin/".length).replace(/\/+$/, "");
    if (!this.env.ADMIN_KEY || !(await safeEqual(key, this.env.ADMIN_KEY))) {
      return json({ error: "not found" }, 404);
    }

    if (req.method === "POST") {
      const form = await req.formData();
      const state = String(form.get("state") ?? "");
      await this.applyState(state === "__default" ? null : state, "override");
      return new Response(null, { status: 303, headers: { Location: path } });
    }

    const cfg = await this.config();
    const st = await this.liveState(cfg);
    const hb = await this.storage.get<number>("heartbeat");
    return new Response(adminPage(cfg, st, hb ?? null), {
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  private async bearerOk(req: Request): Promise<boolean> {
    const auth = req.headers.get("Authorization") ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!this.env.TAPLINK_TOKEN || !token) return false;
    return safeEqual(token, this.env.TAPLINK_TOKEN);
  }
}

// ------------------------------------------------------------------ helpers

function validateConfig(cfg: unknown): string | null {
  if (typeof cfg !== "object" || cfg === null) return "config must be an object";
  const c = cfg as Record<string, unknown>;
  if (!isHttpUrl(c.default)) return "default must be an http(s) URL";
  if (typeof c.ttl_minutes !== "number" || c.ttl_minutes <= 0 || c.ttl_minutes > 10080) {
    return "ttl_minutes must be a number between 1 and 10080";
  }
  if (typeof c.keywords !== "object" || c.keywords === null) return "keywords must be an object";
  const kw = c.keywords as Record<string, unknown>;
  for (const [k, v] of Object.entries(kw)) {
    if (!/^[a-z0-9_-]{1,32}$/.test(k)) return `keyword "${k}" must be [a-z0-9_-], max 32 chars`;
    if (k === "default" || k === "__default") return `"${k}" is reserved`;
    const url = typeof v === "object" && v !== null ? (v as Record<string, unknown>).url : v;
    if (!isHttpUrl(url)) return `destination for "${k}" must be an http(s) URL`;
    if (typeof v === "object" && v !== null) {
      const ttl = (v as Record<string, unknown>).ttl_minutes;
      if (ttl !== undefined && (typeof ttl !== "number" || ttl <= 0 || ttl > 10080)) {
        return `ttl_minutes for "${k}" must be a number between 1 and 10080`;
      }
    }
  }
  return null;
}

function isHttpUrl(v: unknown): boolean {
  if (typeof v !== "string") return false;
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

async function safeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  // Hash both sides so length differences don't shortcut the comparison.
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const va = new Uint8Array(ha);
  const vb = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
  return diff === 0;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

function adminPage(cfg: TapConfig, st: CurrentState | null, heartbeat: number | null): string {
  const current = st?.state ?? "default";
  const buttons = [
    ...Object.keys(cfg.keywords).map((k) => ({ value: k, label: k })),
    { value: "__default", label: "default" },
  ]
    .map(
      (b) => `<form method="post"><button name="state" value="${esc(b.value)}"
        class="${current === b.label ? "active" : ""}">${esc(b.label)}</button></form>`,
    )
    .join("");
  const hb = heartbeat
    ? `${Math.round((Date.now() - heartbeat) / 1000)}s ago`
    : "never";
  const dest = (st && kwUrl(cfg, st.state)) || cfg.default;
  const revert = st
    ? `set ${Math.max(0, Math.round((Date.now() - st.setAt) / 60_000))}m ago · reverts in ${Math.max(
        0,
        Math.ceil((st.setAt + kwTtl(cfg, st.state) * 60_000 - Date.now()) / 60_000),
      )}m`
    : "";
  return `<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>TapLink</title>
<style>
  body{font:17px -apple-system,system-ui,sans-serif;background:#111;color:#eee;
       max-width:26rem;margin:0 auto;padding:1.5rem}
  h1{font-size:1.2rem} .meta{color:#999;font-size:.85rem;margin:.3rem 0}
  form{margin:.5rem 0}
  button{width:100%;padding:1rem;font-size:1.1rem;border-radius:.6rem;border:1px solid #444;
         background:#222;color:#eee}
  button.active{background:#2b6;border-color:#2b6;color:#031;font-weight:700}
</style>
<h1>TapLink</h1>
<p class="meta">state: <b>${esc(current)}</b> → ${esc(dest)}</p>
${revert ? `<p class="meta">${esc(revert)}</p>` : ""}
<p class="meta">ProDeck heartbeat: ${esc(hb)}</p>
${buttons}`;
}
