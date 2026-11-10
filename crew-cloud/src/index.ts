/**
 * prodeck-crew: every church's crew address, <name>-crew.prodeck.live.
 *
 * A church's crew reach their booth from anywhere through this, and still see
 * this week's plan, checklists and team chat while the booth Mac is off. One
 * Durable Object per church (church.ts) holds the copy the booth last sent
 * and the booth's own WebSocket for relaying live requests while it's on.
 * See design/CREW_ADDRESS.md.
 *
 *   booth   POST /_booth/sync   (Bearer <claim secret>)  push the copy, collect queued ticks/chat/joins
 *   booth   GET  /_booth/link   (Bearer <claim secret>)  WebSocket: the relay
 *   booth   POST /_booth/forget (Bearer <claim secret>)  switched off: delete the copy
 *   phone   GET  /edge/plan?token=        the copy (crew-edge's shape, plus checklists and crew)
 *   phone   GET  /edge/status             is the booth linked, when did it last send
 *   phone   GET  /edge/chat?token=&since= / POST /edge/chat
 *   phone   POST /edge/checklist          {token, session, listId, itemId, done}
 *   phone   POST /edge/register           booth-off signup
 *   any     GET  /.well-known/apple-app-site-association (and assetlinks.json once there's an Android app)
 *   iPhone  GET  /join without ProDeck Crew: "Get ProDeck Crew" or continue in the browser (applinks.ts)
 *   phone   anything else                 relayed to the booth while it's linked;
 *                                         booth off: /api/* → 503, pages → the app shell
 *
 * The names are the secure local address names (local-edge/): a church that
 * claimed stjohns.local.prodeck.live is stjohns-crew.prodeck.live here, with
 * the same secret. This Worker never hands names out and never writes DNS.
 */
import { Church, type Env } from "./church";
import { Leaderboard } from "./board";
import { appStepPage, wantsAppStep, wellKnown } from "./applinks";
import { churchFor, same, sha256 } from "./util";

export { Church, Leaderboard };

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    // The app link files (applinks.ts), on every host this Worker answers.
    const known = wellKnown(url.pathname);
    if (known) return known;

    // White Oak Media takes someone off the Next Slide leaderboard:
    //   POST /_admin/board/remove  {nick, church?}  Authorization: Bearer <BOARD_ADMIN_TOKEN>
    if (url.pathname === "/_admin/board/remove" && req.method === "POST") {
      const auth = req.headers.get("authorization") ?? "";
      if (!env.BOARD_ADMIN_TOKEN || !(await sameSecret(auth, `Bearer ${env.BOARD_ADMIN_TOKEN}`))) {
        return new Response("Not allowed.\n", { status: 401 });
      }
      return env.BOARD.get(env.BOARD.idFromName("global")).fetch("https://board/remove", { method: "POST", body: await req.text() });
    }
    const name = churchFor(url.host, req.headers.get("x-prodeck-church"));
    if (!name) {
      return new Response("This is a ProDeck crew address. Ask whoever runs your church's booth for yours.\n", {
        status: 404,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }

    // A crew code opened on an iPhone without ProDeck Crew: offer the app,
    // with the browser one tap away. Booth on or off, the same page.
    if (wantsAppStep(req.method, url.pathname, url.searchParams, req.headers.get("user-agent") ?? "")) {
      return new Response(appStepPage(url.toString()), {
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
      });
    }

    // Hashed app files are the same bytes wherever they come from, so they're
    // served from this Worker's own copy of the app when it has them: quicker
    // for the phone, and the church's internet isn't spent on them.
    if ((req.method === "GET" || req.method === "HEAD") && url.pathname.startsWith("/assets/")) {
      const a = await env.ASSETS.fetch(req);
      if (a.ok) return a;
    }

    // Our own headers, never the phone's copy of them.
    const headers = new Headers(req.headers);
    for (const k of [...headers.keys()]) if (k.startsWith("x-prodeck-")) headers.delete(k);
    headers.set("x-prodeck-church", name);
    headers.set("x-prodeck-ip", req.headers.get("cf-connecting-ip") ?? "unknown");
    const inner = new Request(req, { headers });

    const stub = env.CHURCH.get(env.CHURCH.idFromName(name));
    const res = await stub.fetch(inner);
    if (res.headers.get("x-prodeck-shell") === "1") return shellFor(req, env);
    return res;
  },
};

/**
 * The booth is off: the app from this Worker's copy, so the page still opens
 * and shows the cloud copy. As in crew-edge, only navigations fall back to
 * index.html; a missing script stays a 404 so a phone's service worker never
 * caches a page under a script's name.
 */
async function shellFor(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const asset = await env.ASSETS.fetch(new Request(url.toString(), { method: req.method, headers: req.headers }));
  const assetLike = url.pathname.startsWith("/assets/") || /\.[a-z0-9]{1,12}$/i.test(url.pathname);
  const res =
    asset.status !== 404 || assetLike
      ? asset
      : await env.ASSETS.fetch(new Request(new URL("/", url).toString(), { method: req.method, headers: req.headers }));
  const out = new Response(res.body, res);
  out.headers.set("x-prodeck-fallback", "cloud");
  // ProDeck Crew checks a church is there by fetching /manifest.json from its
  // own page (capacitor://localhost): a cross origin request, refused without
  // this. The booth sends it itself; with the booth off this answers instead,
  // and without it the app said "Couldn't reach" (2026-11-10). Public files only.
  out.headers.set("access-control-allow-origin", "*");
  // index.html must be asked for again next time: the booth may be back.
  if (!assetLike) out.headers.set("cache-control", "no-store");
  return out;
}

/** Constant time compare of two secrets (by their hashes, so length can't leak). */
async function sameSecret(a: string, b: string): Promise<boolean> {
  return same(await sha256(a), await sha256(b));
}
