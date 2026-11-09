// One Durable Object per church: its crew address <name>.crew.prodeck.live.
//
// Two jobs (design/CREW_ADDRESS.md):
//
//  1. The cloud copy. The booth pushes what it already has (this week's plan,
//     checklists, crew names, team chat) every few minutes. Phones read it
//     when the booth is off, and what they do meanwhile (a checklist tick, a
//     chat message, a booth-off signup) waits here until the booth's next
//     sync picks it up. No Planning Center credentials ever come here.
//
//  2. The relay. While the booth is on it keeps one WebSocket open to this
//     object, and every other request to the crew address (/api/cmd, the
//     /api/events stream, the app itself) is carried down that socket to the
//     booth's own gateway and the answer streamed back. The booth checks the
//     password exactly as it would on the church Wi-Fi; nothing here decides
//     who may control anything.
//
// Who the booth is: the secret it got when it claimed its name from the
// prodeck-local Worker (local-edge/). The first time a secret is seen it is
// checked there (NAMES binding) and remembered by hash for an hour.

import { DurableObject } from "cloudflare:workers";
import {
  b64decode,
  b64encode,
  cors,
  forwardHeaders,
  hashPin,
  json,
  randHex,
  relayRefuses,
  responseHeaders,
  same,
  sha256,
  verifier,
} from "./util";

export interface Env {
  CHURCH: DurableObjectNamespace<Church>;
  ASSETS: Fetcher;
  /** prodeck-local's `Names` entrypoint: POST /verify {name, secret}. */
  NAMES: Fetcher;
}

// ------------------------------------------------------------------ shapes

/** What the booth pushes (src-tauri/src/crewcloud.rs `snapshot`). */
export interface Copy {
  sentMs: number;
  church: { name: string };
  /** The same shape crew-edge's /edge/plan returns, built by the booth. */
  plan: Record<string, unknown> | null;
  checklists: Checklist[];
  crew: { id: string; name: string; role: string }[];
  auth: Auth;
  /** Every crew name, any approval state: booth-off signups can't take one. */
  names: string[];
}

export interface Auth {
  salt: string;
  /** PBKDF2 verifiers (util.ts `verifier`) of the gateway passwords. */
  admin: string[];
  member: string[];
  /** sha256(crew session) → crew user id. */
  sessions: Record<string, string>;
}

interface ChItem {
  id: string;
  text?: string;
  done?: boolean;
  header?: boolean;
  [k: string]: unknown;
}
interface Checklist {
  id: string;
  visibility?: string;
  role?: string;
  items: ChItem[];
  [k: string]: unknown;
}

export interface EdgeMsg {
  seq: number;
  origin: "edge" | "booth";
  from: string;
  text: string;
  channel: string;
  ts: number;
}

export interface Tick {
  id: number;
  listId: string;
  itemId: string;
  done: boolean;
  by: string;
  ts: number;
}

interface PendingJoin {
  id: string;
  name: string;
  role: string;
  salt: string;
  pinHash: string;
  session: string;
  ts: number;
}

type Tier = "admin" | "member";

// ------------------------------------------------------------------ limits

const MSG_CAP = 500;
const MAX_FROM = 32;
const MAX_TEXT = 500;
const REPLAY_WINDOW_MS = 24 * 3600 * 1000;
const JOIN_CAP = 50;
const JOIN_TTL_MS = 7 * 24 * 3600 * 1000;
const TICK_CAP = 500;
const TICK_TTL_MS = 24 * 3600 * 1000;
const MAX_SYNC_BYTES = 2 * 1024 * 1024;
const MAX_RELAY_BODY = 1024 * 1024;
/** Re-check the booth's secret with the name service this often. */
const OWNER_RECHECK_MS = 3600 * 1000;
/** A booth whose socket has said nothing for this long is treated as gone. */
export const LINK_STALE_MS = 90 * 1000;
/** How long the booth gets to start answering a relayed request. */
const HEAD_TIMEOUT_MS = 15 * 1000;
/** Wrong passwords: this many different ones from one address, then a wait. */
const WRONG_LIMIT = 10;
const WRONG_WINDOW_MS = 10 * 60 * 1000;
/** Bytes per relayed body frame from the booth. */
export const CHUNK = 64 * 1024;

// ------------------------------------------------------------------ relay

interface Pending {
  head: (h: { status: number; headers: Record<string, string> }) => void;
  fail: (why: string) => void;
  writer: WritableStreamDefaultWriter<Uint8Array> | null;
  headDone: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

/** Frames the booth sends up the link. */
type Up =
  | { t: "hello"; version?: string }
  | { t: "head"; id: number; status: number; headers?: Record<string, string> }
  | { t: "data"; id: number; b: string }
  | { t: "end"; id: number }
  | { t: "error"; id: number; message?: string };

export class Church extends DurableObject<Env> {
  private sql: SqlStorage;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  /** token sha256 → tier, for tokens already checked against the verifiers. */
  private tierCache = new Map<string, Tier | null>();
  /** ip → wrong token hashes with when each was first tried. */
  private wrong = new Map<string, Map<string, number>>();
  private lastPushMs = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS messages (
      seq INTEGER PRIMARY KEY AUTOINCREMENT, origin TEXT NOT NULL, bid INTEGER, bts INTEGER,
      from_name TEXT NOT NULL, text TEXT NOT NULL, channel TEXT NOT NULL, ts INTEGER NOT NULL,
      UNIQUE(origin, bid, bts))`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS ticks (
      id INTEGER PRIMARY KEY AUTOINCREMENT, list TEXT NOT NULL, item TEXT NOT NULL,
      done INTEGER NOT NULL, by_name TEXT NOT NULL, ts INTEGER NOT NULL)`);
    // The booth pings with the literal text "ping"; answered without waking us.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  // ---------------------------------------------------------------- storage

  private get<T>(k: string): T | null {
    const r = this.sql.exec("SELECT v FROM kv WHERE k = ?", k).toArray()[0];
    return r ? (JSON.parse(String(r.v)) as T) : null;
  }
  private put(k: string, v: unknown) {
    this.sql.exec("INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)", k, JSON.stringify(v));
  }

  /** Everything a church left here: used when the name changes hands. */
  private wipe() {
    this.sql.exec("DELETE FROM kv");
    this.sql.exec("DELETE FROM messages");
    this.sql.exec("DELETE FROM ticks");
    this.tierCache.clear();
  }

  // ---------------------------------------------------------------- the booth

  /** Is `secret` this name's? Checked with the name service, remembered for an hour. */
  private async ownerOk(name: string, secret: string): Promise<boolean> {
    if (!secret) return false;
    const h = await sha256(secret);
    const owner = this.get<{ hash: string; checked: number }>("owner");
    if (owner && same(owner.hash, h) && Date.now() - owner.checked < OWNER_RECHECK_MS) return true;
    let ok: boolean;
    try {
      const r = await this.env.NAMES.fetch("https://names/verify", {
        method: "POST",
        body: JSON.stringify({ name, secret }),
      });
      ok = r.ok && ((await r.json()) as { ok?: boolean }).ok === true;
    } catch {
      // The name service is down: a booth we already know keeps working.
      return !!owner && same(owner.hash, h);
    }
    if (!ok) return false;
    // A new owner (the name was released and claimed again): nothing the
    // last church left here may be shown to the new one's crew, or the other
    // way round.
    if (owner && !same(owner.hash, h)) this.wipe();
    this.put("owner", { hash: h, checked: Date.now() });
    return true;
  }

  private boothSockets(): WebSocket[] {
    return this.ctx.getWebSockets("booth");
  }

  /** The booth's link, if it's up and has spoken recently. */
  private link(): WebSocket | null {
    const now = Date.now();
    for (const ws of this.boothSockets()) {
      const att = (ws.deserializeAttachment() ?? {}) as { since?: number; seen?: number };
      const pinged = this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() ?? 0;
      const last = Math.max(att.since ?? 0, att.seen ?? 0, pinged);
      if (ws.readyState === WebSocket.OPEN && now - last < LINK_STALE_MS) return ws;
    }
    return null;
  }

  private acceptLink(): Response {
    // One booth per church: a new link replaces the old one (a restart, or
    // the Mac waking from sleep before the old socket noticed it was dead).
    for (const old of this.boothSockets()) {
      try {
        old.close(4000, "replaced");
      } catch {
        /* already gone */
      }
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server, ["booth"]);
    server.serializeAttachment({ since: Date.now(), seen: Date.now() });
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    if (typeof raw !== "string") return;
    let f: Up;
    try {
      f = JSON.parse(raw) as Up;
    } catch {
      return;
    }
    const att = (ws.deserializeAttachment() ?? {}) as Record<string, unknown>;
    ws.serializeAttachment({ ...att, seen: Date.now(), ...(f.t === "hello" ? { version: f.version ?? "" } : {}) });
    if (f.t === "hello") return;
    const p = this.pending.get(f.id);
    if (!p) {
      // The phone went away, or we never asked: tell the booth to stop.
      if (f.t === "head" || f.t === "data") ws.send(JSON.stringify({ t: "cancel", id: f.id }));
      return;
    }
    switch (f.t) {
      case "head":
        p.head({ status: f.status, headers: f.headers ?? {} });
        break;
      case "data":
        if (p.writer) {
          p.writer.write(b64decode(f.b)).catch(() => this.cancel(f.id));
        }
        break;
      case "end":
        this.finish(f.id);
        break;
      case "error":
        if (!p.headDone) p.fail(f.message || "The booth couldn't answer.");
        this.finish(f.id);
        break;
    }
  }

  async webSocketClose(ws: WebSocket) {
    this.dropAll(ws);
  }
  async webSocketError(ws: WebSocket) {
    this.dropAll(ws);
  }

  private dropAll(ws: WebSocket) {
    // Only when the socket that closed was the live one: a replaced link
    // closing late must not cut off requests already on the new one.
    if (this.boothSockets().some((s) => s !== ws && s.readyState === WebSocket.OPEN)) return;
    for (const id of [...this.pending.keys()]) {
      const p = this.pending.get(id)!;
      if (!p.headDone) p.fail("The booth went away.");
      this.finish(id);
    }
  }

  private finish(id: number) {
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    if (p.timer) clearTimeout(p.timer);
    p.writer?.close().catch(() => {});
  }

  private cancel(id: number) {
    if (!this.pending.has(id)) return;
    this.finish(id);
    const ws = this.link();
    try {
      ws?.send(JSON.stringify({ t: "cancel", id }));
    } catch {
      /* link already gone */
    }
  }

  /** Carry one phone request down to the booth and stream its answer back. */
  private async relay(ws: WebSocket, req: Request, ip: string): Promise<Response> {
    const url = new URL(req.url);
    let body: Uint8Array | null = null;
    if (req.method !== "GET" && req.method !== "HEAD") {
      const buf = new Uint8Array(await req.arrayBuffer());
      if (buf.length > MAX_RELAY_BODY) return json({ error: "That request is too big." }, 413);
      body = buf;
    }
    const id = this.nextId++;
    const noBody = req.method === "HEAD";
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();
    const head = new Promise<{ status: number; headers: Record<string, string> }>((resolve, reject) => {
      const p: Pending = {
        head: (h) => {
          p.headDone = true;
          if (p.timer) clearTimeout(p.timer);
          p.timer = null;
          resolve(h);
        },
        fail: (why) => {
          p.headDone = true;
          reject(new Error(why));
        },
        writer,
        headDone: false,
        timer: setTimeout(() => {
          if (!p.headDone) {
            p.fail("The booth didn't answer in time.");
            this.cancel(id);
          }
        }, HEAD_TIMEOUT_MS),
      };
      this.pending.set(id, p);
    });
    try {
      ws.send(
        JSON.stringify({
          t: "req",
          id,
          method: req.method,
          path: url.pathname + url.search,
          headers: forwardHeaders(req.headers),
          ip,
          ...(body && body.length ? { b: b64encode(body) } : {}),
        }),
      );
    } catch {
      this.finish(id);
      return offlineApi("The booth went away.");
    }
    // A phone that hangs up (or a stream it stopped reading) stops the booth's side too.
    req.signal?.addEventListener?.("abort", () => this.cancel(id));
    let h: { status: number; headers: Record<string, string> };
    try {
      h = await head;
    } catch (e) {
      this.finish(id);
      return url.pathname.startsWith("/api/") ? offlineApi(String((e as Error).message)) : shell();
    }
    const headers = responseHeaders(h.headers);
    headers.set("x-prodeck-via", "relay");
    const empty = noBody || [101, 204, 205, 304].includes(h.status);
    if (empty) {
      // Drain whatever the booth still sends; the phone gets no body.
      const p = this.pending.get(id);
      if (p) p.writer = null;
      writer.close().catch(() => {});
      return new Response(null, { status: h.status === 101 ? 502 : h.status, headers });
    }
    return new Response(readable, { status: h.status, headers });
  }

  // ---------------------------------------------------------------- phones

  private overWrongLimit(ip: string): boolean {
    const m = this.wrong.get(ip);
    if (!m) return false;
    const now = Date.now();
    for (const [k, t] of m) if (now - t > WRONG_WINDOW_MS) m.delete(k);
    return m.size >= WRONG_LIMIT;
  }

  /**
   * Which gateway password this is, if any. Only different wrong passwords
   * count against an address (the booth's own rule since 0.9.118), so a
   * phone repeating one stale password doesn't lock its whole church out.
   */
  private async tier(token: string, ip: string): Promise<Tier | null | "throttled"> {
    if (!token || token.length > 512) return null;
    const auth = this.get<Auth>("auth");
    if (!auth) return null;
    const key = await sha256(token);
    let t = this.tierCache.get(key);
    if (t === undefined) {
      if (this.overWrongLimit(ip)) return "throttled";
      const v = await verifier(token, auth.salt);
      t = auth.admin.some((x) => same(x, v)) ? "admin" : auth.member.some((x) => same(x, v)) ? "member" : null;
      this.tierCache.set(key, t);
    }
    if (t === null) {
      const m = this.wrong.get(ip) ?? new Map<string, number>();
      if (!m.has(key)) m.set(key, Date.now());
      this.wrong.set(ip, m);
      if (this.wrong.size > 2000) this.wrong.clear();
    }
    return t;
  }

  /** The crew user behind a session (the booth mirrors sessions by hash). */
  private async sessionUser(session: string): Promise<{ id: string; name: string; role: string } | null> {
    if (!session) return null;
    const auth = this.get<Auth>("auth");
    const uid = auth?.sessions?.[await sha256(session)];
    if (!uid) return null;
    return this.get<Copy["crew"]>("crew")?.find((u) => u.id === uid) ?? null;
  }

  private overlayTicks(lists: Checklist[]): Checklist[] {
    const ticks = this.pendingTicks();
    if (!ticks.length) return lists;
    const want = new Map(ticks.map((t) => [`${t.listId}\u0000${t.itemId}`, t.done]));
    return lists.map((l) => ({
      ...l,
      items: l.items.map((i) => {
        const d = want.get(`${l.id}\u0000${i.id}`);
        return d === undefined ? i : { ...i, done: d };
      }),
    }));
  }

  private pendingTicks(): Tick[] {
    return this.sql
      .exec("SELECT id, list, item, done, by_name, ts FROM ticks WHERE ts > ? ORDER BY id ASC", Date.now() - TICK_TTL_MS)
      .toArray()
      .map((r) => ({
        id: Number(r.id),
        listId: String(r.list),
        itemId: String(r.item),
        done: Number(r.done) === 1,
        by: String(r.by_name),
        ts: Number(r.ts),
      }));
  }

  private rows(where: string, ...binds: unknown[]): EdgeMsg[] {
    return this.sql
      .exec(`SELECT seq, origin, from_name, text, channel, ts FROM messages ${where}`, ...binds)
      .toArray()
      .map((r) => ({
        seq: Number(r.seq),
        origin: r.origin as EdgeMsg["origin"],
        from: String(r.from_name),
        text: String(r.text),
        channel: String(r.channel),
        ts: Number(r.ts),
      }));
  }

  private trimMessages() {
    this.sql.exec(`DELETE FROM messages WHERE seq <= (SELECT MAX(seq) FROM messages) - ?`, MSG_CAP);
  }

  /** The week as the booth last sent it: crew-edge's /edge/plan shape plus the copy's extras. */
  private planView(tier: Tier) {
    const meta = this.get<{ sentMs: number; church: { name: string } }>("meta");
    const plan = this.get<Record<string, unknown>>("plan");
    const lists = this.overlayTicks(this.get<Checklist[]>("checklists") ?? []).filter(
      // Admin lists are for whoever has the admin password, same as on the booth.
      (l) => tier === "admin" || l.visibility !== "admin",
    );
    return {
      plan: { id: "", date: "", title: "" },
      items: [],
      serviceTimes: [],
      team: [],
      attachments: [],
      extras: {},
      ...(plan ?? {}),
      generatedMs: meta?.sentMs ?? 0,
      source: "booth",
      sentMs: meta?.sentMs ?? 0,
      boothOnline: !!this.link(),
      church: meta?.church?.name ?? "",
      checklists: lists,
      crew: (this.get<Copy["crew"]>("crew") ?? []).map((u) => ({ name: u.name, role: u.role })),
    };
  }

  // ---------------------------------------------------------------- entry

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const name = req.headers.get("x-prodeck-church") ?? "";
    const ip = req.headers.get("x-prodeck-ip") ?? "unknown";
    const path = url.pathname;

    // -------- booth
    if (path === "/_booth/link" || path === "/_booth/sync" || path === "/_booth/forget") {
      const auth = req.headers.get("authorization") ?? "";
      const secret = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
      if (!(await this.ownerOk(name, secret))) return json({ ok: false, error: "That name belongs to another booth." }, 403);
      if (path === "/_booth/link") {
        if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") return json({ error: "WebSocket only." }, 426);
        return this.acceptLink();
      }
      if (req.method !== "POST") return json({ error: "POST only." }, 405);
      if (path === "/_booth/forget") {
        // The church switched its crew address off: nothing of its stays here.
        for (const ws of this.boothSockets()) {
          try {
            ws.close(4001, "turned off");
          } catch {
            /* already gone */
          }
        }
        const owner = this.get("owner");
        this.wipe();
        if (owner) this.put("owner", owner);
        return json({ ok: true });
      }
      return this.sync(req);
    }

    // -------- the cloud copy, for phones
    if (path.startsWith("/edge/") || path === "/edge") {
      if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
      return this.edge(req, url, ip);
    }

    // -------- everything else: the booth if it's on, else the app shell
    const ws = this.link();
    if (ws && !relayRefuses(path)) return this.relay(ws, req, ip);
    if (path.startsWith("/api/")) {
      return offlineApi(ws ? "This only works on the church Wi-Fi." : "The booth is off.");
    }
    if (req.method === "GET" || req.method === "HEAD") return shell();
    return offlineApi("The booth is off.");
  }

  private async edge(req: Request, url: URL, ip: string): Promise<Response> {
    const path = url.pathname.replace(/^\/edge/, "") || "/";
    let body: Record<string, unknown> = {};
    if (req.method === "POST") {
      try {
        body = ((await req.json()) ?? {}) as Record<string, unknown>;
      } catch {
        return json({ error: "That wasn't readable." }, 400);
      }
    }
    const token = String(req.method === "POST" ? body.token ?? "" : url.searchParams.get("token") ?? "");
    const tier = await this.tier(token, ip);
    if (tier === "throttled") return json({ error: "Too many wrong passwords from here. Try again in a few minutes." }, 429);

    if (path === "/status" && req.method === "GET") {
      // Nothing secret: whether the booth is linked and when it last sent a copy.
      const meta = this.get<{ sentMs: number }>("meta");
      return json({ ok: true, boothOnline: !!this.link(), sentMs: meta?.sentMs ?? 0 });
    }
    if (!tier) return json({ error: "sign in to ProDeck first" }, 401);

    if (path === "/plan" && req.method === "GET") {
      if (!this.get("meta")) return json({ error: "The booth hasn't sent anything yet." }, 404);
      return json(this.planView(tier), 200, { "cache-control": "no-store" });
    }

    if (path === "/chat" && req.method === "GET") {
      const since = Number(url.searchParams.get("since") ?? 0) || 0;
      const msgs = this.rows(`WHERE seq > ? ORDER BY seq ASC LIMIT 200`, since);
      return json({ msgs, seq: msgs.length ? msgs[msgs.length - 1].seq : since });
    }

    if (path === "/chat" && req.method === "POST") {
      // A signed in phone's name comes from its crew session; otherwise the
      // label it sends, the same trust the booth's own chat gives it.
      const user = await this.sessionUser(String(body.session ?? ""));
      const from = (user?.name ?? String(body.from ?? "")).trim().slice(0, MAX_FROM);
      const text = String(body.text ?? "").trim().slice(0, MAX_TEXT);
      const channel = /^role:.{1,48}$/.test(String(body.channel ?? "")) ? String(body.channel) : "team";
      if (!from) return json({ error: "Set your name first." }, 400);
      if (!text) return json({ error: "That message is empty." }, 400);
      this.sql.exec(
        `INSERT INTO messages (origin, from_name, text, channel, ts) VALUES ('edge', ?, ?, ?, ?)`,
        from,
        text,
        channel,
        Date.now(),
      );
      this.trimMessages();
      const msg = this.rows(`WHERE seq = (SELECT MAX(seq) FROM messages)`)[0];
      return json({ ok: true, msg });
    }

    if (path === "/checklist" && req.method === "POST") {
      const listId = String(body.listId ?? "");
      const itemId = String(body.itemId ?? "");
      const done = body.done === true;
      const list = (this.get<Checklist[]>("checklists") ?? []).find((l) => l.id === listId);
      const item = list?.items.find((i) => i.id === itemId);
      if (!list || !item) return json({ error: "That checklist item isn't in the booth's last copy." }, 404);
      if (item.header) return json({ error: "That line is a section header, not a step." }, 400);
      if (list.visibility === "admin" && tier !== "admin") return json({ error: "Not allowed." }, 403);
      const user = await this.sessionUser(String(body.session ?? ""));
      // Latest intent per item wins: drop an older tick for the same item.
      this.sql.exec("DELETE FROM ticks WHERE list = ? AND item = ?", listId, itemId);
      const count = Number(this.sql.exec("SELECT COUNT(*) AS n FROM ticks").one().n);
      if (count >= TICK_CAP) return json({ error: "Too many ticks are waiting for the booth." }, 429);
      this.sql.exec(
        "INSERT INTO ticks (list, item, done, by_name, ts) VALUES (?, ?, ?, ?, ?)",
        listId,
        itemId,
        done ? 1 : 0,
        (user?.name ?? "").slice(0, MAX_FROM),
        Date.now(),
      );
      return json({ ok: true, done });
    }

    if (path === "/register" && req.method === "POST") return this.register(body);

    return json({ error: "not found" }, 404);
  }

  /** Booth-off signup, as crew-edge does it: the booth adopts the session at its next sync. */
  private async register(b: Record<string, unknown>): Promise<Response> {
    const name = String(b.name ?? "").trim().replace(/\s+/g, " ").slice(0, 32);
    const role = String(b.role ?? "").trim().slice(0, 48);
    const pin = String(b.pin ?? "");
    if (name.length < 2) return json({ error: "Enter your name." }, 400);
    if (!/^\d{4}$/.test(pin)) return json({ error: "The PIN must be exactly 4 digits." }, 400);
    const joins = (this.get<PendingJoin[]>("joins") ?? []).filter((j) => Date.now() - j.ts < JOIN_TTL_MS);
    const lower = name.toLowerCase();
    const taken =
      (this.get<string[]>("names") ?? []).some((n) => n.toLowerCase() === lower) ||
      joins.some((j) => j.name.toLowerCase() === lower);
    if (taken) return json({ error: `"${name}" is taken. Pick another name, or sign in when the booth is on.` }, 409);
    if (joins.length >= JOIN_CAP) return json({ error: "Too many signups are waiting for the booth." }, 429);
    const salt = randHex(16);
    const join: PendingJoin = {
      id: randHex(8),
      name,
      role,
      salt,
      pinHash: await hashPin(salt, pin),
      session: randHex(24),
      ts: Date.now(),
    };
    this.put("joins", [...joins, join]);
    return json({ status: "pending", session: join.session, name: join.name });
  }

  /** The booth's sync: store its copy, take its chat, hand back what phones did. */
  private async sync(req: Request): Promise<Response> {
    const text = await req.text();
    if (text.length > MAX_SYNC_BYTES) return json({ ok: false, error: "That copy is too big." }, 413);
    let b: Partial<Copy> & {
      msgs?: { id: number; from: string; text: string; channel: string; ts: number }[];
      sinceSeq?: number;
      ackTicks?: number[];
      consumedJoins?: string[];
    };
    try {
      b = JSON.parse(text);
    } catch {
      return json({ ok: false, error: "That copy wasn't readable." }, 400);
    }
    this.put("meta", {
      sentMs: Number(b.sentMs) || Date.now(),
      church: { name: String(b.church?.name ?? "").slice(0, 80) },
    });
    if (b.plan !== undefined) this.put("plan", b.plan && typeof b.plan === "object" ? b.plan : null);
    if (Array.isArray(b.checklists)) this.put("checklists", b.checklists.filter((l) => l && Array.isArray(l.items)));
    if (Array.isArray(b.crew)) {
      this.put(
        "crew",
        b.crew.slice(0, 1000).map((u) => ({ id: String(u.id), name: String(u.name).slice(0, 64), role: String(u.role ?? "").slice(0, 48) })),
      );
    }
    if (Array.isArray(b.names)) this.put("names", b.names.filter(Boolean).map(String).slice(0, 1000));
    if (b.auth && typeof b.auth === "object" && typeof b.auth.salt === "string") {
      const a = b.auth;
      const list = (x: unknown) => (Array.isArray(x) ? x.map(String).filter((s) => /^[0-9a-f]{64}$/.test(s)).slice(0, 20) : []);
      const sessions: Record<string, string> = {};
      for (const [k, v] of Object.entries(a.sessions ?? {}).slice(0, 5000)) {
        if (/^[0-9a-f]{64}$/.test(k)) sessions[k] = String(v);
      }
      this.put("auth", { salt: a.salt, admin: list(a.admin), member: list(a.member), sessions });
      // Passwords may have changed: everything checked so far is re-checked.
      this.tierCache.clear();
    }

    // Chat: mirror the booth's ring up (deduped on booth id + time).
    for (const m of Array.isArray(b.msgs) ? b.msgs.slice(0, 200) : []) {
      const from = String(m.from ?? "").slice(0, MAX_FROM);
      const t = String(m.text ?? "").slice(0, MAX_TEXT);
      if (!from || !t) continue;
      this.sql.exec(
        `INSERT OR IGNORE INTO messages (origin, bid, bts, from_name, text, channel, ts) VALUES ('booth', ?, ?, ?, ?, ?, ?)`,
        Number(m.id) || 0,
        Number(m.ts) || 0,
        from,
        t,
        String(m.channel ?? "team"),
        Number(m.ts) || Date.now(),
      );
    }
    this.trimMessages();

    // Ticks and joins the booth has applied since last time.
    const acked = Array.isArray(b.ackTicks) ? b.ackTicks.map(Number).filter(Number.isFinite) : [];
    for (const id of acked) this.sql.exec("DELETE FROM ticks WHERE id = ?", id);
    this.sql.exec("DELETE FROM ticks WHERE ts <= ?", Date.now() - TICK_TTL_MS);
    const consumed = new Set(Array.isArray(b.consumedJoins) ? b.consumedJoins.map(String) : []);
    const joins = (this.get<PendingJoin[]>("joins") ?? []).filter((j) => !consumed.has(j.id) && Date.now() - j.ts < JOIN_TTL_MS);
    this.put("joins", joins);

    const sinceSeq = Number(b.sinceSeq ?? 0) || 0;
    const edgeMsgs = this.rows(
      `WHERE origin = 'edge' AND seq > ? AND ts > ? ORDER BY seq ASC LIMIT 200`,
      sinceSeq,
      Date.now() - REPLAY_WINDOW_MS,
    );
    // Watermark = the last message actually handed over (crew-edge's audit fix).
    const top = Number(this.sql.exec(`SELECT COALESCE(MAX(seq), 0) AS s FROM messages`).one().s);
    const edgeSeq = edgeMsgs.length === 200 ? edgeMsgs[edgeMsgs.length - 1].seq : top;
    return json({ ok: true, edgeMsgs, edgeSeq, ticks: this.pendingTicks(), pendingJoins: joins });
  }
}

/** An /api call while the booth can't be reached: the app's gateway watcher reads this. */
export function offlineApi(why: string): Response {
  return json({ error: why }, 503, { "x-prodeck-fallback": "cloud", "cache-control": "no-store" });
}

/** Tells the router to answer with the app shell from its own copy of the app. */
export function shell(): Response {
  return new Response(null, { status: 503, headers: { "x-prodeck-shell": "1" } });
}
