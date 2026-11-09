/**
 * prodeck-push: page notifications for the ProDeck Crew phone app.
 *
 * A web page on a phone gets push through the browser, signed by the booth's
 * own key (src-tauri/src/push.rs). The phone app can't: Apple only takes
 * notifications for it signed with White Oak's push key, and Google only from
 * White Oak's Firebase project, and neither key can ship inside every
 * church's booth. So a booth sends its app pages here and this signs and
 * hands them to Apple (iPhone, "apns") or Firebase (Android, "fcm").
 *
 *   booth  POST /v1/send  {to: [{p: "apns" | "fcm", t: token}], title, body, tag?, page?}
 *                         → {ok, sent, dead: [token]}   dead = drop it, the app is gone
 *   anyone GET  /         → {ok, apns, fcm}   is each set up?
 *
 * What keeps it from being anyone's free push service:
 *  - It can only reach phones with ProDeck Crew installed (the key and topic
 *    are this app's), and only ones whose push token you already hold, which
 *    the phone hands only to its own church's booth.
 *  - Rate limits per sender and per phone, small caps on size, and nothing
 *    is stored.
 *
 * Errors go to White Oak's Sentry (project "prodeck", tag side=push-relay):
 * Apple refusing the key or topic, and anything that throws. Reports never
 * carry a page's words, a push token or the sender's address.
 */

import { apnsPayload, cleanFcmToken, collapses, fcmMessage, fcmVerdict, type TargetExtras } from "./payload";
import * as Sentry from "@sentry/cloudflare";

/** Workers reach sentry.io directly; only booths need the feedback Worker's tunnel. */
const SENTRY_DSN = "https://79aebd1fda6a14652e119fabfa555f91@o4511745054998528.ingest.us.sentry.io/4512215209869312";

interface Env {
  SENDS: RateLimit;
  PHONES: RateLimit;
  APNS_KEY?: string;
  APNS_KEY_ID?: string;
  APNS_TEAM: string;
  APNS_TOPIC: string;
  /** The Firebase service account's whole JSON key file (a secret). */
  FCM_SERVICE_ACCOUNT?: string;
  /** Local tests only: a stand-in for fcm.googleapis.com. Never set in production. */
  FCM_API?: string;
}

interface Target {
  p: string;
  t: string;
  /** Extra fields for this phone only (a page's confirm link). */
  x?: TargetExtras;
}

const MAX_TO = 100;
/** A page nobody saw in ten minutes is old news; Apple drops it after this. */
const PAGE_TTL_S = 600;
/** Chat and reminders keep a day for a phone that's off (Firebase's default is four weeks). */
const CREW_TTL_S = 86_400;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const fail = (status: number, error: string) => json({ ok: false, error }, status);

const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlText = (s: string) => b64url(new TextEncoder().encode(s));

// ------------------------------------------------------------- APNs token
// An ES256 JWT, good for up to an hour; Apple asks that it be renewed no more
// than every 20 minutes, so one is kept per isolate for 40.

let cached: { jwt: string; at: number } | null = null;

async function apnsJwt(env: Env): Promise<string> {
  if (cached && Date.now() - cached.at < 40 * 60_000) return cached.jwt;
  const pem = (env.APNS_KEY ?? "").replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const head = b64urlText(JSON.stringify({ alg: "ES256", kid: env.APNS_KEY_ID }));
  const claims = b64urlText(JSON.stringify({ iss: env.APNS_TEAM, iat: Math.floor(Date.now() / 1000) }));
  // WebCrypto signs ECDSA as raw r||s, which is exactly what ES256 wants.
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(`${head}.${claims}`));
  cached = { jwt: `${head}.${claims}.${b64url(new Uint8Array(sig))}`, at: Date.now() };
  return cached.jwt;
}

/**
 * One notification to one phone. A build run from Xcode gets a token from
 * Apple's test service rather than the real one, and nothing in the token
 * says which, so a token the real service calls bad is tried there too.
 * Returns "sent", "dead" (the app was removed; stop sending) or "failed".
 */
async function sendApns(env: Env, token: string, body: string, tag: string, page: boolean): Promise<"sent" | "dead" | "failed"> {
  const headers: Record<string, string> = {
    authorization: `bearer ${await apnsJwt(env)}`,
    "apns-topic": env.APNS_TOPIC,
    "apns-push-type": "alert",
    "apns-priority": "10",
  };
  if (tag && collapses(page)) headers["apns-collapse-id"] = tag.slice(0, 64);
  if (page) headers["apns-expiration"] = String(Math.floor(Date.now() / 1000) + PAGE_TTL_S);

  let lastReason = "";
  for (const host of ["api.push.apple.com", "api.sandbox.push.apple.com"]) {
    const r = await fetch(`https://${host}/3/device/${token}`, { method: "POST", headers, body });
    if (r.status === 200) return "sent";
    const reason = ((await r.json().catch(() => ({}))) as { reason?: string }).reason ?? String(r.status);
    lastReason = reason;
    if (r.status === 410 || reason === "Unregistered") return "dead";
    if (reason === "ExpiredProviderToken") cached = null;
    if (reason !== "BadDeviceToken") break;
  }
  if (lastReason === "BadDeviceToken") return "dead";
  console.log(`apns refused: ${lastReason}`);
  // One issue per reason. The ones that matter most (InvalidProviderToken,
  // TopicDisallowed) mean every page from every church is failing.
  Sentry.captureMessage(`APNs refused: ${lastReason}`, { level: "error", fingerprint: ["apns-refused", lastReason] });
  return "failed";
}

// ------------------------------------------------------------- Firebase (Android)
// FCM HTTP v1 takes an OAuth access token, which the service account gets by
// signing a JWT (RS256) and trading it at Google's token endpoint. Tokens last
// an hour; one is kept per isolate for 50 minutes.

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri?: string;
}

function serviceAccount(env: Env): ServiceAccount | null {
  try {
    const sa = JSON.parse(env.FCM_SERVICE_ACCOUNT ?? "") as ServiceAccount;
    return sa?.project_id && sa.client_email && sa.private_key ? sa : null;
  } catch {
    return null;
  }
}

let fcmCached: { token: string; at: number } | null = null;
/** One trip to Google at a time: a page to ten phones asks once. */
let fcmPending: Promise<string> | null = null;

function fcmAccessToken(sa: ServiceAccount): Promise<string> {
  if (fcmCached && Date.now() - fcmCached.at < 50 * 60_000) return Promise.resolve(fcmCached.token);
  fcmPending ??= newFcmToken(sa).finally(() => (fcmPending = null));
  return fcmPending;
}

async function newFcmToken(sa: ServiceAccount): Promise<string> {
  const pem = sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const aud = sa.token_uri || "https://oauth2.googleapis.com/token";
  const now = Math.floor(Date.now() / 1000);
  const head = b64urlText(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64urlText(
    JSON.stringify({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging", aud, iat: now, exp: now + 3600 }),
  );
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${head}.${claims}`));
  const r = await fetch(aud, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${head}.${claims}.${b64url(new Uint8Array(sig))}`,
    }),
  });
  const out = (await r.json().catch(() => ({}))) as { access_token?: string; error?: string };
  if (!r.ok || !out.access_token) throw new Error(`Google refused the Firebase key: ${out.error ?? r.status}`);
  fcmCached = { token: out.access_token, at: Date.now() };
  return out.access_token;
}

/** One message to one Android phone. Same answers as sendApns. */
async function sendFcm(env: Env, sa: ServiceAccount, body: string): Promise<"sent" | "dead" | "failed"> {
  const api = env.FCM_API || "https://fcm.googleapis.com";
  const r = await fetch(`${api}/v1/projects/${sa.project_id}/messages:send`, {
    method: "POST",
    headers: { authorization: `Bearer ${await fcmAccessToken(sa)}`, "content-type": "application/json" },
    body,
  });
  if (r.ok) return "sent";
  const reply = await r.json().catch(() => ({}));
  const verdict = fcmVerdict(r.status, reply);
  if (verdict === "dead") return "dead";
  if (r.status === 401) fcmCached = null;
  const reason = (reply as { error?: { status?: string } })?.error?.status ?? String(r.status);
  console.log(`fcm refused: ${reason}`);
  // PERMISSION_DENIED / UNAUTHENTICATED mean every Android page is failing.
  Sentry.captureMessage(`FCM refused: ${reason}`, { level: "error", fingerprint: ["fcm-refused", reason] });
  return "failed";
}

// ------------------------------------------------------------- routes

async function send(req: Request, env: Env): Promise<Response> {
  const apnsReady = !!(env.APNS_KEY && env.APNS_KEY_ID);
  const sa = serviceAccount(env);
  if (!apnsReady && !sa) return fail(503, "not set up yet");
  const who = req.headers.get("CF-Connecting-IP") ?? "?";
  if (!(await env.SENDS.limit({ key: who })).success) return fail(429, "too many sends, slow down");

  let input: { to?: Target[]; title?: string; body?: string; tag?: string; page?: boolean };
  try {
    input = await req.json();
  } catch {
    return fail(400, "expected JSON");
  }
  const to = Array.isArray(input.to) ? input.to.slice(0, MAX_TO) : [];
  const title = String(input.title ?? "").slice(0, 80);
  const text = String(input.body ?? "").slice(0, 400);
  const tag = String(input.tag ?? "").slice(0, 64);
  const page = input.page === true;
  if (!to.length || !text) return fail(400, "nothing to send");

  const words = { title, body: text, page };

  const dead: string[] = [];
  let sent = 0;
  await Promise.all(
    to.map(async (x) => {
      const t = String(x?.t ?? "");
      let go: () => Promise<"sent" | "dead" | "failed">;
      if (x?.p === "apns" && apnsReady && /^[0-9a-f]{64,200}$/i.test(t)) {
        go = async () => sendApns(env, t, JSON.stringify(apnsPayload(words, x?.x)), tag, page);
      } else if (x?.p === "fcm" && sa && cleanFcmToken(t)) {
        go = async () => sendFcm(env, sa, JSON.stringify(fcmMessage(words, t, tag, page ? PAGE_TTL_S : CREW_TTL_S, x?.x)));
      } else return;
      if (!(await env.PHONES.limit({ key: t })).success) return;
      const r = await go().catch((e) => {
        console.log(`${x.p} error: ${e}`);
        Sentry.captureException(e);
        return "failed" as const;
      });
      if (r === "sent") sent++;
      else if (r === "dead") dead.push(t);
    }),
  );
  return json({ ok: true, sent, dead });
}

export default Sentry.withSentry<Env>(
  () => ({
    dsn: SENTRY_DSN,
    release: "prodeck-push@1",
    environment: "production",
    sendDefaultPii: false,
    tracesSampleRate: 0,
    initialScope: { tags: { side: "push-relay" } },
    // The request holds the sender's address and the page itself; neither
    // belongs in a crash report.
    beforeSend: (e) => {
      delete e.request;
      delete e.user;
      return e;
    },
    beforeBreadcrumb: (b) => (b.category === "fetch" || b.category === "console" ? null : b),
  }),
  {
    async fetch(req: Request, env: Env): Promise<Response> {
      const url = new URL(req.url);
      if (req.method === "GET" && url.pathname === "/") return json({ ok: true, apns: !!(env.APNS_KEY && env.APNS_KEY_ID), fcm: !!serviceAccount(env) });
      if (req.method === "POST" && url.pathname === "/v1/send") return send(req, env);
      return fail(404, "not found");
    },
  } satisfies ExportedHandler<Env>,
);
