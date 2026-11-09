// Smart crew codes: one QR per church, https://<name>-crew.prodeck.live/join.
//
//  - iPhone with ProDeck Crew: iOS opens the app straight into the church
//    (universal links). The app claims *.prodeck.live; for a wildcard iOS
//    reads the association file from the base domain, so crew-edge serves
//    this same file at prodeck.live too, and every crew host serves it as well.
//  - iPhone or iPad without the app: a short page with "Get ProDeck Crew"
//    (App Store) and "Continue in the browser". Never a forced redirect.
//  - Android and computers: the church's join page, as before.
//
// Only the links the app handles are claimed: /join, and the crew link and
// personal invite (?join= / ?invite=). Everything else stays in the browser.

export const TEAM_ID = "2B77WL3HZ6";
export const IOS_BUNDLE = "app.prodeck.crew";
export const APP_STORE_ID = "6829868156";
export const APP_STORE_URL = `https://apps.apple.com/app/id${APP_STORE_ID}`;

/**
 * Android App Links, once the Android app exists: its package and the SHA-256
 * fingerprints of its signing certificate. Empty = no assetlinks.json yet.
 */
export const ANDROID_PACKAGE = "";
export const ANDROID_CERT_SHA256: string[] = [];

/** /.well-known/apple-app-site-association */
export function appleAppSiteAssociation() {
  return {
    applinks: {
      details: [
        {
          appIDs: [`${TEAM_ID}.${IOS_BUNDLE}`],
          components: [
            // "Continue in the browser" must stay in the browser.
            { "/": "/join", "?": { web: "?*" }, exclude: true, comment: "Chose the browser" },
            { "/": "/join", comment: "The church's crew code" },
            { "/": "/", "?": { join: "?*" }, comment: "The crew link" },
            { "/": "/", "?": { invite: "?*" }, comment: "A personal invite" },
          ],
        },
      ],
    },
  };
}

/** /.well-known/assetlinks.json, or null until the Android app is signed. */
export function assetLinks(): unknown[] | null {
  if (!ANDROID_PACKAGE || ANDROID_CERT_SHA256.length === 0) return null;
  return [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: { namespace: "android_app", package_name: ANDROID_PACKAGE, sha256_cert_fingerprints: ANDROID_CERT_SHA256 },
    },
  ];
}

/** The two files, for any host this Worker answers. null = not one of them. */
export function wellKnown(path: string): Response | null {
  if (path === "/.well-known/apple-app-site-association" || path === "/apple-app-site-association") {
    return new Response(JSON.stringify(appleAppSiteAssociation()), {
      headers: { "content-type": "application/json", "cache-control": "public, max-age=3600" },
    });
  }
  if (path === "/.well-known/assetlinks.json") {
    const a = assetLinks();
    return a
      ? new Response(JSON.stringify(a), { headers: { "content-type": "application/json", "cache-control": "public, max-age=3600" } })
      : new Response("Not found.\n", { status: 404 });
  }
  return null;
}

/**
 * Show the "Get ProDeck Crew" step? Only a crew code (/join) opened in an
 * iPhone or iPad browser, not inside the app, and not once they chose the
 * browser (?web=1). An iPad that asks as a Mac gets the browser page, which
 * is still a working way in.
 */
export function wantsAppStep(method: string, path: string, search: URLSearchParams, userAgent: string): boolean {
  if (method !== "GET" || path !== "/join") return false;
  if (search.has("web")) return false;
  if (/\bProDeckCrew\//.test(userAgent)) return false;
  return /\b(iPhone|iPad|iPod)\b/.test(userAgent);
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The page an iPhone without the app sees. `self` is the code's own address. */
export function appStepPage(self: string): string {
  const browser = new URL(self);
  browser.searchParams.set("web", "1");
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="apple-itunes-app" content="app-id=${APP_STORE_ID}, app-argument=${esc(self)}">
<meta name="color-scheme" content="dark light">
<title>Join the crew</title>
<style>
:root{--bg:#0e131b;--card:#161d29;--ink:#eef2f8;--muted:#9aa6b8;--accent:#4f7cf0}
@media (prefers-color-scheme: light){:root{--bg:#f4f6fa;--card:#fff;--ink:#111826;--muted:#5b6678}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;background:var(--bg);color:var(--ink);font:17px/1.45 -apple-system,BlinkMacSystemFont,"Helvetica Neue",sans-serif;display:flex;align-items:center;justify-content:center;padding:24px 16px}
main{width:100%;max-width:420px;background:var(--card);border-radius:20px;padding:28px 22px;text-align:center}
h1{font-size:26px;margin:0 0 8px}
p{margin:8px 0;color:var(--muted)}
ol{text-align:left;margin:18px 0;padding-left:22px}
li{margin:8px 0}
a.btn{display:block;margin:12px 0;padding:15px;border-radius:14px;font-weight:600;text-decoration:none}
a.primary{background:var(--accent);color:#fff}
a.ghost{color:var(--accent)}
</style>
</head><body><main>
<h1>Join the crew</h1>
<p>Your church uses ProDeck Crew for the production team.</p>
<ol>
<li>Get the free ProDeck Crew app.</li>
<li>Scan this code again with the camera. The app opens straight into your church.</li>
</ol>
<a class="btn primary" href="${APP_STORE_URL}">Get ProDeck Crew</a>
<a class="btn ghost" href="${esc(browser.toString())}">Continue in the browser</a>
</main></body></html>
`;
}
