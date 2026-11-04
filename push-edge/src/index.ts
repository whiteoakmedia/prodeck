/**
 * prodeck-push: page notifications for the ProDeck Crew phone app.
 *
 * A web page on a phone gets push through the browser, signed by the booth's
 * own key (src-tauri/src/push.rs). The phone app can't: Apple only takes
 * notifications for it signed with White Oak's push key, and that key can't
 * ship inside every church's booth. So a booth sends its app pages here and
 * this signs and hands them to Apple.
 *
 *   booth  POST /v1/send  {to: [{p: "apns", t: token}], title, body, tag?, page?}
 *                         → {ok, sent, dead: [token]}   dead = drop it, the app is gone
 *   anyone GET  /         → {ok, apns}   is it set up?
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
}

interface Target {
  p: string;
  t: string;
}

const MAX_TO = 100;
/** A page nobody saw in ten minutes is old news; Apple drops it after this. */
const PAGE_TTL_S = 600;

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
  if (tag) headers["apns-collapse-id"] = tag.slice(0, 64);
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

// ------------------------------------------------------------- routes

async function send(req: Request, env: Env): Promise<Response> {
  if (!env.APNS_KEY || !env.APNS_KEY_ID) return fail(503, "not set up yet");
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

  const body = JSON.stringify({
    aps: {
      alert: { title, body: text },
      sound: "default",
      "thread-id": page ? "pages" : "crew",
      // Pages break through Focus, the way a page on a radio would.
      "interruption-level": page ? "time-sensitive" : "active",
    },
  });

  const dead: string[] = [];
  let sent = 0;
  await Promise.all(
    to.map(async (x) => {
      const t = String(x?.t ?? "");
      if (x?.p !== "apns" || !/^[0-9a-f]{64,200}$/i.test(t)) return;
      if (!(await env.PHONES.limit({ key: t })).success) return;
      const r = await sendApns(env, t, body, tag, page).catch((e) => {
        console.log(`apns error: ${e}`);
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
      if (req.method === "GET" && url.pathname === "/") return json({ ok: true, apns: !!(env.APNS_KEY && env.APNS_KEY_ID) });
      if (req.method === "POST" && url.pathname === "/v1/send") return send(req, env);
      return fail(404, "not found");
    },
  } satisfies ExportedHandler<Env>,
);
