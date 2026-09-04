// crew-edge — ProDeck's cloud half, phase 1 (read-only).
//
// Serves this week's plan straight from Planning Center 24/7, so phones show
// the setlist, keys, leaders, charts, call times, and position guides even
// when the booth Mac is off. The booth pushes the bits only it knows (valid
// member tokens, call times, guides, file filters) into a Durable Object;
// everything else is fetched from PCO on demand with a short edge cache.
//
// Routes (mounted at prodeck.live/edge/* and on workers.dev):
//   POST /edge/push        booth only (Bearer ADMIN_TOKEN): tokens + extras,
//                          plus a chat sync: booth mirrors its ring up and the
//                          response carries phone-sent messages back down
//   GET  /edge/plan?token= member: composed plan payload (cached ~2 min)
//   GET  /edge/chart/:id?token= member: 302 to the attachment's fresh URL
//   POST /edge/chat        member: send a team message (booth-off fallback)
//   GET  /edge/chat?since= member: chat history after a sequence number
//
// Phase 2 trust model, deliberately identical to the booth's: sender names
// are labels, not identities (chat.rs says the same). Auth is the member
// token; the DO's SQLite ring is the cloud mirror of the booth's in-memory
// ring, so a Saturday-night "running late" works with the booth Mac asleep
// and lands in the booth feed at its next sync.
//
// Secrets: PCO_APP_ID, PCO_SECRET, ADMIN_TOKEN.

export interface Env {
  CREW_STATE: DurableObjectNamespace;
  PCO_APP_ID: string;
  PCO_SECRET: string;
  ADMIN_TOKEN: string;
  /** Worker-hosted copy of the app's dist/ — the booth-off shell. */
  ASSETS: Fetcher;
}

const PCO = "https://api.planningcenteronline.com";
const PLAN_CACHE_SECS = 120;
// Same tolerance as the booth's autopilot: a plan counts as "current" from
// 36 h before its date onward, so Saturday setup and Sunday morning agree.
const PLAN_LOOKBACK_MS = 36 * 3600 * 1000;

// ---------------------------------------------------------------- state DO

interface CrewStateData {
  tokens: string[];
  extras: {
    serviceTypeId?: string;
    checkinTimes?: Record<string, string>;
    positionGuides?: Record<string, string>;
    fileFilters?: Record<string, string[]>;
  };
  /** Booth-mirrored web-push material. Pushes from here are PAYLOAD-LESS
   *  (RFC 8030 empty POST) — the phone's service worker shows a generic
   *  "new team message" and the app fetches the real text when opened — so
   *  the p256dh/auth encryption keys never leave the booth. */
  push?: {
    vapidPub: string;
    vapidPriv: string;
    subs: { user: string; endpoint: string }[];
  };
  /** Approved crew names mirrored from the booth — lets booth-off signups be
   *  refused a taken name immediately instead of failing at ingest. */
  names?: string[];
  /** Booth-off signups waiting for the booth: the PIN is hashed HERE with the
   *  booth's own salt+sha256 scheme, so the plaintext never reaches storage
   *  and the booth ingests the row as-is. Consumed via the /push heartbeat. */
  joins?: PendingJoin[];
  updated_ms: number;
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

const JOIN_CAP = 50;
const JOIN_TTL_MS = 7 * 24 * 3600 * 1000;

function randHex(bytes: number): string {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/** Same construction as the booth's hash_pin (sha256 over salt+pin, hex). */
async function hashPin(salt: string, pin: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(salt + pin));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

// ------------------------------------------------------------- web push
// VAPID (RFC 8292) with WebCrypto: an ES256 JWT per push-service origin.
// No payload → no RFC 8291 encryption → tiny and hard to get wrong.

function b64u(buf: ArrayBuffer | Uint8Array): string {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromB64u(s: string): Uint8Array {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  return Uint8Array.from(atob(pad), (c) => c.charCodeAt(0));
}

async function vapidJwt(vapidPub: string, vapidPriv: string, aud: string, contact: string): Promise<string> {
  const pub = fromB64u(vapidPub); // 65-byte uncompressed point: 0x04 || x || y
  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: "EC", crv: "P-256", d: vapidPriv, x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33, 65)) },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const enc = new TextEncoder();
  const head = b64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64u(
    enc.encode(
      JSON.stringify({
        aud,
        exp: Math.floor(Date.now() / 1000) + 12 * 3600,
        sub: contact,
      }),
    ),
  );
  // WebCrypto ECDSA yields raw r||s — exactly the JWT ES256 signature shape.
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${head}.${claims}`));
  return `${head}.${claims}.${b64u(sig)}`;
}

/** Push to every endpoint except the sender's own subscriptions.
 *  Returns endpoints the push service says are dead (404/410) for pruning. */
async function sendPushes(
  push: NonNullable<CrewStateData["push"]>,
  skipUser: string,
  contact: string,
): Promise<string[]> {
  const jwts = new Map<string, string>();
  const dead: string[] = [];
  for (const s of push.subs) {
    if (skipUser && s.user === skipUser) continue;
    try {
      const origin = new URL(s.endpoint).origin;
      let jwt = jwts.get(origin);
      if (!jwt) {
        jwt = await vapidJwt(push.vapidPub, push.vapidPriv, origin, contact);
        jwts.set(origin, jwt);
      }
      const r = await fetch(s.endpoint, {
        method: "POST",
        headers: {
          Authorization: `vapid t=${jwt}, k=${push.vapidPub}`,
          TTL: "86400",
          Urgency: "high",
        },
      });
      if (r.status === 404 || r.status === 410) dead.push(s.endpoint);
    } catch {
      /* one bad endpoint must not stop the rest */
    }
  }
  return dead;
}

// One chat message in the cloud mirror. `seq` is the DO's own monotonic
// order; `origin` says which side authored it ("edge" = a phone while the
// booth was off, "booth" = mirrored up from the booth's ring).
export interface EdgeMsg {
  seq: number;
  origin: "edge" | "booth";
  from: string;
  text: string;
  channel: string;
  ts: number;
}

const MSG_CAP = 500;
const MAX_FROM = 32;
const MAX_TEXT = 500;
// A booth restart pulls with sinceSeq=0; only replay recent phone-sent
// messages, not the whole archive, into its fresh in-memory ring.
const REPLAY_WINDOW_MS = 24 * 3600 * 1000;

export class CrewState {
  private state: DurableObjectState;
  private sql: any;
  /** Push burst guard; instance-local is fine — a hibernation reset just
   *  allows one extra buzz. */
  private lastPushMs = 0;
  /** Web-push VAPID contact claim (push services require one). Set
   *  VAPID_CONTACT in your worker vars; defaults to the maintainer. */
  private contact: string;
  constructor(state: DurableObjectState, env: Env) {
    this.contact = (env as any)?.VAPID_CONTACT || "mailto:zach@whiteoakmedia.io";
    this.state = state;
    this.sql = (state.storage as any).sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS messages (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      origin TEXT NOT NULL,
      bid INTEGER,
      bts INTEGER,
      from_name TEXT NOT NULL,
      text TEXT NOT NULL,
      channel TEXT NOT NULL,
      ts INTEGER NOT NULL,
      UNIQUE(origin, bid, bts)
    )`);
  }

  private rows(where: string, ...binds: unknown[]): EdgeMsg[] {
    return this.sql
      .exec(
        `SELECT seq, origin, from_name, text, channel, ts FROM messages ${where}`,
        ...binds,
      )
      .toArray()
      .map((r: any) => ({
        seq: Number(r.seq),
        origin: r.origin,
        from: r.from_name,
        text: r.text,
        channel: r.channel,
        ts: Number(r.ts),
      }));
  }

  private trim(): void {
    this.sql.exec(
      `DELETE FROM messages WHERE seq <= (SELECT MAX(seq) FROM messages) - ?`,
      MSG_CAP,
    );
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    // Phone sends a message (booth-off fallback). Same label-not-identity
    // trust model as the booth ring; the worker already checked the token.
    if (req.method === "POST" && url.pathname === "/chat") {
      const b = (await req.json()) as any;
      const from = String(b.from ?? "").trim().slice(0, MAX_FROM);
      const text = String(b.text ?? "").trim().slice(0, MAX_TEXT);
      const channel = /^role:.{1,48}$/.test(String(b.channel ?? ""))
        ? String(b.channel)
        : "team";
      if (!from) return Response.json({ error: "sender name is required" }, { status: 400 });
      if (!text) return Response.json({ error: "empty message" }, { status: 400 });
      this.sql.exec(
        `INSERT INTO messages (origin, from_name, text, channel, ts) VALUES ('edge', ?, ?, ?, ?)`,
        from, text, channel, Date.now(),
      );
      this.trim();
      const msg = this.rows(`WHERE seq = (SELECT MAX(seq) FROM messages)`)[0];
      // Buzz the team — this message exists precisely because the booth is
      // off, so nothing else will notify anyone. Payload-less; the sender's
      // own devices are skipped; rapid follow-ups within 25 s stay silent
      // (the notification tag collapses them on the phone anyway).
      const data = (await this.state.storage.get("data")) as CrewStateData | undefined;
      if (data?.push?.subs?.length && Date.now() - this.lastPushMs > 25_000) {
        this.lastPushMs = Date.now();
        const p = data.push;
        this.state.waitUntil(
          sendPushes(p, String(b.sender ?? ""), this.contact).then(async (dead) => {
            if (dead.length === 0) return;
            const cur = (await this.state.storage.get("data")) as CrewStateData | undefined;
            if (!cur?.push) return;
            cur.push.subs = cur.push.subs.filter((s) => !dead.includes(s.endpoint));
            await this.state.storage.put("data", cur);
          }),
        );
      }
      return Response.json({ ok: true, msg });
    }

    // Booth-off signup: store a pending join the booth ingests at its next
    // heartbeat. Runs inside the DO so the duplicate check is atomic.
    if (req.method === "POST" && url.pathname === "/join") {
      const b = (await req.json()) as any;
      const name = String(b.name ?? "").trim().replace(/\s+/g, " ").slice(0, 32);
      const role = String(b.role ?? "").trim().slice(0, 48);
      const pin = String(b.pin ?? "");
      if (name.length < 2) return Response.json({ error: "enter your name" }, { status: 400 });
      if (!/^\d{4}$/.test(pin))
        return Response.json({ error: "PIN must be exactly 4 digits" }, { status: 400 });
      const data =
        ((await this.state.storage.get("data")) as CrewStateData | undefined) ?? {
          tokens: [],
          extras: {},
          updated_ms: 0,
        };
      // Prune expired joins HERE too — the booth-heartbeat PUT is the only
      // other pruner and it never runs while the booth is off, so stale
      // entries would otherwise hold the cap and 429 real signups (audit).
      data.joins = (data.joins ?? []).filter((j) => Date.now() - j.ts < JOIN_TTL_MS);
      const lower = name.toLowerCase();
      const taken =
        (data.names ?? []).some((n) => n.toLowerCase() === lower) ||
        data.joins.some((j) => j.name.toLowerCase() === lower);
      if (taken)
        return Response.json(
          { error: `"${name}" is taken — pick another name or wait for the booth to log in` },
          { status: 409 },
        );
      if (data.joins.length >= JOIN_CAP)
        return Response.json({ error: "too many pending signups — see the booth" }, { status: 429 });
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
      data.joins = [...data.joins, join];
      await this.state.storage.put("data", data);
      return Response.json({ status: "pending", session: join.session, name: join.name });
    }

    // Phone polls history.
    if (req.method === "GET" && url.pathname === "/chat") {
      const since = Number(url.searchParams.get("since") ?? 0) || 0;
      const msgs = this.rows(`WHERE seq > ? ORDER BY seq ASC LIMIT 200`, since);
      return Response.json({ msgs, seq: msgs.length ? msgs[msgs.length - 1].seq : since });
    }

    // Booth sync (the /push heartbeat): store tokens/extras, mirror the
    // booth's ring up (deduped on booth id + timestamp — booth ids restart
    // at 1 with the app), and hand back phone-sent messages it hasn't seen.
    if (req.method === "PUT") {
      const body = (await req.json()) as Partial<CrewStateData> & {
        msgs?: { id: number; from: string; text: string; channel: string; ts: number }[];
        sinceSeq?: number;
        /** Join ids the booth ingested last round — safe to delete here. */
        consumedJoins?: string[];
      };
      const cur =
        ((await this.state.storage.get("data")) as CrewStateData | undefined) ?? {
          tokens: [],
          extras: {},
          updated_ms: 0,
        };
      const consumed = new Set(
        Array.isArray(body.consumedJoins) ? body.consumedJoins.map(String) : [],
      );
      const next: CrewStateData = {
        tokens: Array.isArray(body.tokens) ? body.tokens.filter(Boolean) : cur.tokens,
        extras: body.extras && typeof body.extras === "object" ? body.extras : cur.extras,
        push:
          body.push && typeof body.push === "object" && Array.isArray((body.push as any).subs)
            ? body.push
            : cur.push,
        names: Array.isArray(body.names)
          ? body.names.filter(Boolean).map(String).slice(0, 500)
          : cur.names,
        joins: (cur.joins ?? []).filter(
          (j) => !consumed.has(j.id) && Date.now() - j.ts < JOIN_TTL_MS,
        ),
        updated_ms: Date.now(),
      };
      await this.state.storage.put("data", next);

      for (const m of Array.isArray(body.msgs) ? body.msgs : []) {
        const from = String(m.from ?? "").slice(0, MAX_FROM);
        const text = String(m.text ?? "").slice(0, MAX_TEXT);
        if (!from || !text) continue;
        this.sql.exec(
          `INSERT OR IGNORE INTO messages (origin, bid, bts, from_name, text, channel, ts)
           VALUES ('booth', ?, ?, ?, ?, ?, ?)`,
          Number(m.id) || 0, Number(m.ts) || 0, from, text,
          String(m.channel ?? "team"), Number(m.ts) || Date.now(),
        );
      }
      this.trim();

      const sinceSeq = Number(body.sinceSeq ?? 0) || 0;
      const edgeMsgs = this.rows(
        `WHERE origin = 'edge' AND seq > ? AND ts > ? ORDER BY seq ASC LIMIT 200`,
        sinceSeq, Date.now() - REPLAY_WINDOW_MS,
      );
      // Watermark = the LAST MESSAGE ACTUALLY DELIVERED, not the global max:
      // with >200 pending, MAX(seq) marked the overflow as consumed and the
      // booth permanently skipped messages 201+ (audit finding). When nothing
      // is pending the global max fast-forwards past booth-origin rows.
      const top = this.sql.exec(`SELECT COALESCE(MAX(seq), 0) AS s FROM messages`).one();
      const edgeSeq = edgeMsgs.length === 200
        ? Number(edgeMsgs[edgeMsgs.length - 1].seq)
        : Number(top.s);
      return Response.json({
        ok: true,
        edgeMsgs,
        edgeSeq,
        pendingJoins: next.joins ?? [],
      });
    }

    const data =
      ((await this.state.storage.get("data")) as CrewStateData | undefined) ?? {
        tokens: [],
        extras: {},
        updated_ms: 0,
      };
    return Response.json(data);
  }
}

// ---------------------------------------------------------------- helpers

function pcoGet(env: Env, path: string): Promise<Response> {
  return fetch(`${PCO}/${path.replace(/^\//, "")}`, {
    headers: {
      Authorization: "Basic " + btoa(`${env.PCO_APP_ID}:${env.PCO_SECRET}`),
      "User-Agent": "ProDeck-CrewEdge/1.0",
    },
  });
}

async function pcoJson(env: Env, path: string): Promise<any> {
  const r = await pcoGet(env, path);
  if (!r.ok) throw new Error(`PCO ${r.status} on ${path.split("?")[0]}`);
  return r.json();
}

function err(status: number, message: string): Response {
  return Response.json({ error: message }, { status, headers: cors() });
}

function cors(): Record<string, string> {
  // Same-origin on prodeck.live; open for workers.dev testing. Read-only data.
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type",
  };
}

async function stateOf(env: Env): Promise<CrewStateData> {
  const stub = env.CREW_STATE.get(env.CREW_STATE.idFromName("main"));
  const r = await stub.fetch("https://do/state");
  return r.json();
}

/** The booth mirrors its gateway credentials (admin + member + invite) as
 *  SHA-256 HASHES — the DO never stores a raw booth password at rest. The
 *  presented token is hashed and compared; the worker's own ADMIN_TOKEN
 *  secret stays a direct comparison. (Pre-hash plaintext entries are still
 *  honored so a not-yet-upgraded booth doesn't lock its crew out.) */
async function tokenOk(data: CrewStateData, env: Env, token: string): Promise<boolean> {
  if (!token) return false;
  if (token === env.ADMIN_TOKEN) return true;
  if (data.tokens.includes(token)) return true; // legacy plaintext mirror
  return data.tokens.includes(await sha256Hex(token));
}

// A note/description is "meaningful" (mirrors the booth's parser).
function meaningful(s: string): boolean {
  const t = (s ?? "").trim();
  return t !== "" && !/^[\s?\-–—.·*]+$/.test(t) && !/^(tbd|tba|n\/?a|none)$/i.test(t);
}

// ---------------------------------------------------------------- plan

async function pickPlan(env: Env, st: string): Promise<any | null> {
  const future = await pcoJson(
    env,
    `services/v2/service_types/${st}/plans?filter=future&order=sort_date&per_page=5`,
  );
  const plans: any[] = Array.isArray(future?.data) ? future.data : [];
  const now = Date.now();
  for (const p of plans) {
    const t = Date.parse(p.attributes?.sort_date ?? "");
    if (Number.isFinite(t) && t >= now - PLAN_LOOKBACK_MS) return p;
  }
  if (plans.length > 0) return plans[0];
  const past = await pcoJson(
    env,
    `services/v2/service_types/${st}/plans?filter=past&order=-sort_date&per_page=1`,
  );
  return Array.isArray(past?.data) && past.data.length > 0 ? past.data[0] : null;
}

async function composePlan(env: Env, data: CrewStateData): Promise<any> {
  const st = data.extras.serviceTypeId;
  if (!st) throw new Error("the booth hasn't told the edge its service type yet");
  const plan = await pickPlan(env, st);
  if (!plan) throw new Error("no plans found");
  const planId = String(plan.id);

  const [itemsJ, timesJ, teamJ, attachJ] = await Promise.all([
    pcoJson(
      env,
      `services/v2/service_types/${st}/plans/${planId}/items?per_page=200&include=song,arrangement,key,item_notes`,
    ),
    pcoJson(env, `services/v2/service_types/${st}/plans/${planId}/plan_times?per_page=100`),
    pcoJson(
      env,
      `services/v2/service_types/${st}/plans/${planId}/team_members?per_page=200&include=team,times`,
    ),
    pcoJson(
      env,
      `services/v2/service_types/${st}/plans/${planId}/all_attachments?per_page=100`,
    ),
  ]);

  // Leader notes (ItemNote category "leader"), mirroring the booth parser.
  const leaderNotes: Record<string, string> = {};
  for (const inc of itemsJ?.included ?? []) {
    if (
      inc.type === "ItemNote" &&
      String(inc.attributes?.category_name ?? "").toLowerCase() === "leader"
    ) {
      leaderNotes[String(inc.id)] = String(inc.attributes?.content ?? "").trim();
    }
  }

  const items = (itemsJ?.data ?? [])
    .map((d: any) => {
      const a = d.attributes ?? {};
      let leader = "";
      for (const r of d.relationships?.item_notes?.data ?? []) {
        const c = leaderNotes[String(r.id)];
        if (c && meaningful(c)) {
          leader = c;
          break;
        }
      }
      if (!leader && meaningful(a.description ?? "")) leader = String(a.description).trim();
      return {
        id: String(d.id),
        title: a.title ?? "(untitled)",
        sequence: a.sequence ?? 0,
        length: a.length ?? 0,
        type: a.item_type ?? "item",
        key: a.key_name ?? "",
        leader,
        songId: d.relationships?.song?.data?.id
          ? String(d.relationships.song.data.id)
          : undefined,
        arrangementId: d.relationships?.arrangement?.data?.id
          ? String(d.relationships.arrangement.data.id)
          : undefined,
        keyId: d.relationships?.key?.data?.id
          ? String(d.relationships.key.data.id)
          : undefined,
      };
    })
    .sort((x: any, y: any) => x.sequence - y.sequence);

  const serviceTimes = (timesJ?.data ?? []).map((d: any) => ({
    id: String(d.id),
    name: d.attributes?.name ?? d.attributes?.time_type ?? "",
    type: d.attributes?.time_type ?? "",
    ts: Date.parse(d.attributes?.starts_at ?? "") || null,
  }));

  const team = (teamJ?.data ?? []).map((d: any) => {
    const a = d.attributes ?? {};
    return {
      name: a.name ?? "Unknown",
      position: a.team_position_name ?? "",
      status: a.status ?? "",
      timeIds: (d.relationships?.times?.data ?? []).map((t: any) => String(t.id)),
    };
  });

  const attachments = (attachJ?.data ?? []).map((d: any) => ({
    id: String(d.id),
    name: String(d.attributes?.filename ?? d.attributes?.display_name ?? "attachment"),
    attachableType: String(d.relationships?.attachable?.data?.type ?? ""),
    attachableId: String(d.relationships?.attachable?.data?.id ?? ""),
    // Generated charts (non-numeric ids) can't be fetched via the API — they
    // only exist as logged-in PCO web pages. Hand the URL to the client.
    webUrl: /^\d+$/.test(String(d.id)) ? undefined : d.attributes?.url ?? undefined,
  }));

  return {
    generatedMs: Date.now(),
    boothPushMs: data.updated_ms,
    plan: {
      id: planId,
      date: plan.attributes?.dates ?? "",
      title: plan.attributes?.title ?? "",
    },
    items,
    serviceTimes,
    team,
    attachments,
    extras: {
      checkinTimes: data.extras.checkinTimes ?? {},
      positionGuides: data.extras.positionGuides ?? {},
      fileFilters: data.extras.fileFilters ?? {},
    },
  };
}

// ---------------------------------------------------------------- worker

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    // The route is now prodeck.live/* — the worker is the FRONT DOOR. Only
    // /edge/* (and bare paths on workers.dev) are edge API; everything else
    // goes booth-first with an edge-served shell when the booth is dark.
    const isEdgeApi =
      url.pathname === "/edge" ||
      url.pathname.startsWith("/edge/") ||
      url.hostname.endsWith(".workers.dev");
    if (!isEdgeApi) return frontDoor(req, env);
    const path = url.pathname.replace(/^\/edge/, "") || "/";
    const token = url.searchParams.get("token") ?? "";

    if (req.method === "OPTIONS") return new Response(null, { headers: cors() });

    if (req.method === "POST" && path === "/push") {
      const auth = req.headers.get("authorization") ?? "";
      if (auth !== `Bearer ${env.ADMIN_TOKEN}`) return err(401, "bad admin token");
      const stub = env.CREW_STATE.get(env.CREW_STATE.idFromName("main"));
      const r = await stub.fetch("https://do/state", {
        method: "PUT",
        body: JSON.stringify(await req.json()),
      });
      return new Response(await r.text(), {
        status: r.status,
        headers: { "content-type": "application/json", ...cors() },
      });
    }

    if (req.method === "GET" && path === "/plan") {
      const data = await stateOf(env);
      if (!(await tokenOk(data, env, token))) return err(401, "sign in to ProDeck first");
      // Short edge cache so a whole band opening at once costs one PCO trip.
      const cacheKey = new Request("https://crew-edge.cache/plan");
      const cache = (caches as any).default as Cache;
      const hit = await cache.match(cacheKey);
      if (hit) return new Response(hit.body, hit);
      try {
        const composed = await composePlan(env, data);
        const res = Response.json(composed, {
          headers: { "cache-control": `public, max-age=${PLAN_CACHE_SECS}`, ...cors() },
        });
        ctx.waitUntil(cache.put(cacheKey, res.clone()));
        return res;
      } catch (e: any) {
        return err(502, String(e?.message ?? e));
      }
    }

    const chartText = path.match(/^\/chart-text\/(\d+)\/(\d+)$/);
    if (req.method === "GET" && chartText) {
      const data = await stateOf(env);
      if (!(await tokenOk(data, env, token))) return err(401, "sign in to ProDeck first");
      try {
        const j = await pcoJson(
          env,
          `services/v2/songs/${chartText[1]}/arrangements/${chartText[2]}`,
        );
        const a = j?.data?.attributes ?? {};
        return Response.json(
          {
            chordChart: a.chord_chart ?? null,
            chartKey: a.chord_chart_key ?? null,
            lyrics: a.lyrics ?? null,
            name: a.name ?? null,
          },
          { headers: { "cache-control": "public, max-age=300", ...cors() } },
        );
      } catch (e: any) {
        return err(502, String(e?.message ?? e));
      }
    }

    const chart = path.match(/^\/chart\/(\d+)$/);
    if (req.method === "GET" && chart) {
      const data = await stateOf(env);
      if (!(await tokenOk(data, env, token))) return err(401, "sign in to ProDeck first");
      const r = await fetch(`${PCO}/services/v2/attachments/${chart[1]}/open`, {
        method: "POST",
        headers: {
          Authorization: "Basic " + btoa(`${env.PCO_APP_ID}:${env.PCO_SECRET}`),
          "Content-Length": "0",
          "User-Agent": "ProDeck-CrewEdge/1.0",
        },
      });
      if (!r.ok) return err(502, `PCO ${r.status}`);
      const j: any = await r.json();
      const dest = j?.data?.attributes?.attachment_url;
      if (!dest) return err(502, "no attachment url");
      return new Response(null, { status: 302, headers: { location: dest, ...cors() } });
    }

    // Booth-off signup: name + PIN while the booth Mac is dark. The invite/
    // member token gates it exactly like the booth's own register; the booth
    // creates the real (pending-approval) account at its next heartbeat and
    // adopts the session minted here, so the phone never signs in twice.
    if (req.method === "POST" && path === "/register") {
      const body = (await req.json()) as any;
      const data = await stateOf(env);
      if (!(await tokenOk(data, env, String(body?.token ?? "")))) {
        return err(401, "scan the crew invite first");
      }
      const stub = env.CREW_STATE.get(env.CREW_STATE.idFromName("main"));
      const r = await stub.fetch("https://do/join", {
        method: "POST",
        body: JSON.stringify({ name: body?.name, pin: body?.pin, role: body?.role }),
      });
      return new Response(await r.text(), {
        status: r.status,
        headers: { "content-type": "application/json", ...cors() },
      });
    }

    // Phone chat, the booth-off fallback. Send + poll; the DO owns the ring.
    if (path === "/chat" && (req.method === "POST" || req.method === "GET")) {
      const stub = env.CREW_STATE.get(env.CREW_STATE.idFromName("main"));
      if (req.method === "POST") {
        const body = (await req.json()) as any;
        const data = await stateOf(env);
        if (!(await tokenOk(data, env, String(body?.token ?? "")))) {
          return err(401, "sign in to ProDeck first");
        }
        const r = await stub.fetch("https://do/chat", {
          method: "POST",
          body: JSON.stringify(body),
        });
        return new Response(await r.text(), {
          status: r.status,
          headers: { "content-type": "application/json", ...cors() },
        });
      }
      const data = await stateOf(env);
      if (!(await tokenOk(data, env, token))) return err(401, "sign in to ProDeck first");
      const since = url.searchParams.get("since") ?? "0";
      const r = await stub.fetch(`https://do/chat?since=${encodeURIComponent(since)}`);
      return new Response(await r.text(), {
        status: r.status,
        headers: { "content-type": "application/json", ...cors() },
      });
    }

    if (req.method === "GET" && path === "/health") {
      const data = await stateOf(env);
      return Response.json(
        {
          ok: true,
          boothPushMs: data.updated_ms,
          tokens: data.tokens.length,
          pushSubs: data.push?.subs?.length ?? 0,
        },
        { headers: cors() },
      );
    }

    return err(404, "not found");
  },
};

// ---------------------------------------------------------------- front door
// Booth-first, edge shell as the fallback. The tunnel answers 5xx in two
// distinct ways when the booth is dark: Cloudflare 530 (whole Mac off — the
// tunnel itself is gone) and cloudflared 502 (Mac up, ProDeck/gateway down).
// Genuine gateway responses are never in this set (web.rs emits no 5xx), so a
// passthrough 401/404/422 stays exactly what the booth said.
const BOOTH_DOWN = new Set([502, 503, 521, 522, 523, 524, 525, 526, 530]);

async function frontDoor(req: Request, env: Env): Promise<Response> {
  let origin: Response | null = null;
  try {
    origin = await fetch(req);
  } catch {
    origin = null;
  }
  if (origin && !BOOTH_DOWN.has(origin.status)) return origin;

  const url = new URL(req.url);
  // API calls must FAIL clean, not receive index.html: the app's gateway
  // watcher reads the failure and flips to its offline surfaces, which then
  // talk to /edge/* directly.
  if (url.pathname.startsWith("/api/")) {
    return Response.json(
      { error: "booth offline" },
      { status: 503, headers: { "x-prodeck-fallback": "edge", ...cors() } },
    );
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    return origin ?? err(503, "booth offline");
  }
  // Shell + hashed assets from the worker's static copy of dist/. The SPA
  // index.html fallback applies to NAVIGATIONS only — never to /assets/* or
  // anything with a file extension: serving index.html as a 200 for a missing
  // hashed .js would be cached by the phone's service worker as that script
  // FOREVER, bricking the app past the outage (audit finding). A missing
  // asset must stay a 404.
  const asset = await env.ASSETS.fetch(req);
  const assetLike =
    url.pathname.startsWith("/assets/") || /\.[a-z0-9]{1,8}$/i.test(url.pathname);
  const res =
    asset.status !== 404 || assetLike
      ? asset
      : await env.ASSETS.fetch(new Request(new URL("/", req.url).toString(), { headers: req.headers }));
  const out = new Response(res.body, res);
  out.headers.set("x-prodeck-fallback", "edge");
  return out;
}
