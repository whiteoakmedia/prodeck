# Crew address (`<name>-crew.prodeck.live`)

(Not to be confused with design/CREW_CLOUD.md, the older plan for Cornerstone's own crew-edge.)

Every church's crew can reach its ProDeck from outside the church network,
and still see the week while the booth Mac is off. Before this only
Cornerstone had that (prodeck.live, its own Cloudflare Tunnel and the
`crew-edge/` Worker). This is the same idea for every booth, with nothing for
the church to set up, on by default with a switch in Settings, Crew & screens.

## Pieces

| Where | What |
| --- | --- |
| `crew-cloud/` (Worker `prodeck-crew`) | Router plus one Durable Object per church (`Church`). Holds the cloud copy and the booth's relay socket. Tests: `cd crew-cloud && npx vitest run`. |
| `local-edge/` (Worker `prodeck-local`) | Hands out names (unchanged), plus a `Names` entrypoint that tells prodeck-crew whether a secret is a name's (service binding only), and `DELETE /v1/address` (keep a name but point it nowhere). Tests: `cd local-edge && npx vitest run`. |
| `src-tauri/src/crewcloud.rs` | Booth: claims a name if it has none, syncs the copy, keeps the relay link, proxies relayed requests to its own gateway. |
| `src/lib/crewCloud.ts` | Shared rules: the plan snapshot, where phones look for the copy, moving a page to the crew address, the "booth is off" line. |
| `src/components/CrewAddressCard.tsx` | The Settings card and switch. |
| `src/mobile/CrewOffline.tsx` | The booth-off screen, now reading either crew-edge or crew-cloud. |
| `crew-app/` | Remembers each church's crew address and opens it when the booth's own address doesn't answer. |

## Names and claiming

The crew address uses the secure local address's name (design/LOCAL_HTTPS.md):
`cornerstone.local.prodeck.live` means `cornerstone-crew.prodeck.live`, with
the same secret. A booth without one claims a name from the same service on
its first sync (`/v1/claim`, no DNS record is made), from the computer's name
(`grace-church`, then `grace-church-2`, and so on), kept as `crew_name` and
`crew_secret` (booth only, like `local_secret`). It can be changed in the card.
Claiming a secure local address with the crew name adopts it; giving the
secure local address back keeps the name for the crew address
(`DELETE /v1/address` instead of `/v1/release`).

prodeck-crew never hands out names or writes DNS. prodeck-local writes each
church's record when its booth turns the crew address on (`POST /v1/crew`,
`<name>-crew` AAAA `100::`, proxied, comment "prodeck crew") and removes it
when the booth turns it off or gives the name back. It checks a booth's secret
with prodeck-local through the `NAMES` service binding the first time it sees
it, remembers its hash for an hour, and wipes a church's store if a different
secret ever proves the name (released and claimed by someone else).

## Booth off: the cloud copy

Every two minutes (and five seconds after the plan changes) the booth POSTs
`/_booth/sync` with:

- `plan`: this week's plan in crew-edge's `/edge/plan` shape, built by the
  booth's window from what it shows (overrides included) and handed over with
  `crew_cloud_set_plan`. No Planning Center credentials, ids, files or notes
  beyond leaders.
- `checklists` (the booth's file), `crew` (approved id, name, role), `names`.
- `auth`: a salt, PBKDF2-SHA256 (20000 rounds) verifiers of the admin
  password, the crew password and the invite token, and sha256 of each crew
  session mapped to its user id.
- chat sync as crew-edge does it (`msgs` up, `sinceSeq`, `edgeMsgs` down),
  `ackTicks`, `consumedJoins`.

The answer carries what phones did: chat (ingested like crew-edge's), queued
checklist ticks (applied as sets, not flips, with `checklist_set`, then
acknowledged next round; anything older than 12 hours is acknowledged
without applying) and booth-off signups (`identity::ingest_edge_joins`).

Phones use the same `/edge/*` API crew-edge has (`/plan`, `/chat`,
`/register`) plus `/checklist` and `/status`, so `CrewOffline` reads either.
`/edge/plan` adds `source: "booth"`, `sentMs`, `boothOnline`, `checklists`
(admin lists only for the admin password) and `crew`; the screen says
"The booth is off. Showing the last plan it sent at 9:14 PM." Different wrong
passwords from one address are throttled (10 in 10 minutes), the booth's own
rule since 0.9.118.

Switching it off deletes the copy (`/_booth/forget`).

## Booth on: the relay

The booth keeps one WebSocket to `/_booth/link` (pings every 30 seconds,
answered by the Durable Object without waking it; 90 seconds of silence is a
dead link). Any other request to the crew address goes down it as
`{t:"req", id, method, path, headers, ip, b}`; the booth opens its own gateway
on loopback, writes a plain HTTP request with only harmless headers plus
`CF-Connecting-IP: <phone>` and `X-ProDeck-Relay: 1`, and streams the answer
back (`head`, `data`, `end`, or `error`). `cancel` stops one. The gateway
treats it exactly like a request through a Cloudflare Tunnel: it checks the
password, throttles per phone and does on-site check-in by the phone's
address. Nothing in the cloud decides who may do what.

Not relayed: `/api/tv/*` (TV pairing is for screens in the building) and
`/api/listen*` (overflow audio). Comms (WebRTC) and camera feeds aren't on the
gateway port at all, and the crew screens hide comms on a crew address.
Hashed `/assets/*` files come from the Worker's own copy of the app when it
has them (saves the church's uplink, and a shell loaded while the booth was
off can't ask the booth for files it doesn't have).

Booth off: `/api/*` answers 503 with `x-prodeck-fallback: cloud` (the page's
gateway watcher flips to the booth-off screen), pages get the app shell from
the Worker's copy of `dist/`.

## Phones

- While the booth is up, every page remembers the crew address
  (`prodeck.crewUrl`) from settings.
- Booth unreachable: `CrewOffline` reads the copy from the crew address (from
  the booth's own address on the church network, cross origin; the Worker
  allows it, auth is the password in the request). If the copy says the booth
  is linked, the phone just can't reach it directly (it left the building), so
  the page moves to the crew address, carrying its sign in in the URL's
  `#pdhandoff=` fragment, which never reaches a server.
- Booth-off checklist ticks go to the crew address; only if that fails too do
  they wait in the phone's own outbox.
- A phone opening the crew address for the first time with the booth off has
  no password there yet: the booth-off screen asks for the crew password.
- Crew links, the poster and QR codes are unchanged: they still use the
  booth's own (or public, or secure local) address.
- ProDeck Crew learns the crew address from `/api/origin` (`crew`) and opens it
  when the booth's own address doesn't answer.

## Why one level, and what it can't touch

`<name>-crew.prodeck.live` is a single label under the zone, so Cloudflare's
free Universal SSL certificate (`prodeck.live` and `*.prodeck.live`) covers
it: no Advanced Certificate Manager. Names are at most 32 characters, so the
label is at most 37 (DNS allows 63); `local-edge/src/names.ts` `crewHost`
refuses anything else.

- **Route** `*-crew.prodeck.live/*`: only hosts ending in `-crew.prodeck.live`.
  Never the apex (crew-edge's `prodeck.live/*`), `www`, or anything under
  `local.prodeck.live` (those end in `.local.prodeck.live`).
- **DNS, per church (default, `CREW_DNS = "per-name"`):** nothing resolves
  that a booth didn't turn on. A record of that name somebody else made is
  never taken over (the booth gets "already used, pick another name"). Each
  counts against `MAX_RECORDS` (180, address and crew records together),
  under Cloudflare's 200 record free plan limit.
- **DNS, wildcard (`CREW_DNS = "wildcard"`):** for when churches outgrow that
  limit, Zach adds one proxied `*` AAAA `100::` record and prodeck-local stops
  writing per church records. Any unclaimed one level name then resolves to
  Cloudflare and gets an error page (the route still only answers `-crew`
  names); explicit records (`www`, `local`'s children) are unaffected.
- **Collisions between churches** can't happen: the crew label is the
  claimed name plus `-crew`, and names are unique in prodeck-local. A church
  named `team-crew` is `team-crew-crew.prodeck.live`; the Worker strips the
  suffix once.

## The booth never looks up its own crew address

A name looked up before its new DNS record reached the internet gets "no such
name" cached (macOS kept it for about half an hour on the first live enable,
2026-11-09, and the booth couldn't link until the cache was flushed). So:

- The booth reaches prodeck-crew at its own workers.dev address,
  `prodeck-crew.taplink-edge.workers.dev` (`workers_dev: true`), always
  sending its church in `x-prodeck-church`. A page there names no church and
  gets a 404, so phones can't use it.
- The crew address is a second way in for the booth only once public DNS has
  it (for a prodeck-crew deployed without workers.dev).
- Phones are told the crew address (settings `crew_url`, `/api/origin`'s
  `crew`) only once Cloudflare's public resolver answers for it, asked over
  https so no local resolver caches a "no". If that can't be asked (a filter
  blocks it), ten minutes after prodeck-local confirmed the record.

## The first name

A booth without a secure local address claims a name from the church's
Planning Center organization name (`GET services/v2`) when it's signed in
there, else from the computer's name with ".local", generic words (booth,
Mac, command center...), someone's name ("Zach's MacBook") and machine
numbers taken out, else `church`, `church-2`... Names already claimed stay
until the church renames in the card.

## Nothing happens until it's open

prodeck-local's `CREW_READY` var (`"0"` in the repo) gates everything. A booth
with the crew address on asks `GET /v1/crew/ready` at most once an hour; until
it says yes (or while prodeck-local is the older deploy without the route, a
404), the booth claims no name, writes no record, sends no copy and opens no
link, and the card says crew addresses aren't open yet. With the switch off a
booth makes no crew address request at all. The switch is **on** by default
(fresh installs and existing ones, via the settings default).

## Zach's prodeck.live

Untouched. crew-edge's route is `prodeck.live/*` (the apex only), this one is
`*-crew.prodeck.live/*`. Cornerstone's booth runs both: edge.rs still pushes to
crew-edge, and crewcloud.rs gives it `<name>-crew.prodeck.live` as well. On
prodeck.live the booth-off screen still asks crew-edge first (same origin).

## Deploying (Zach, once; nothing is deployed yet)

1. **prodeck-local:** `cd local-edge && npx wrangler deploy` (it adds the
   `Names` entrypoint, `/v1/crew` and `/v1/crew/ready`, still with
   `CREW_READY = "0"`). Its API token already has DNS edit on prodeck.live.
2. **prodeck-crew:** `npx vite build` at the repo root (the shell comes from
   `dist/`), then in `crew-cloud/` `npx wrangler deploy` (routes and
   `workers_dev` are in `wrangler.jsonc`). Redeploy after each release so the
   shell matches.
3. **Open it:** set `CREW_READY` to `"1"` in `local-edge/wrangler.jsonc` and
   deploy prodeck-local again. Booths pick it up within the hour.
4. **Release** a ProDeck with crewcloud.rs (any time; before step 3 it does
   nothing).

No certificate step: Universal SSL already covers the names.

## Limits and cost

- One Durable Object per church; it hibernates between syncs. A relayed event
  stream keeps it awake while a phone away from church has the app open:
  roughly 0.3 GB-s per minute per church, inside the Workers Paid plan's
  included 400,000 GB-s a month for many churches.
- Each relayed byte crosses the church's internet uplink once per phone.
- A first visit to the crew address from a phone that only ever used the
  booth's own address has no sign in there; the page moving over carries it,
  but ProDeck Crew opening the crew address directly can't (the sign in lives
  in the booth address's storage). The phone asks for the crew password once.
- Chord charts aren't in the copy (they'd need Planning Center); songs show
  without the chart link booth-off.

## Local test

Two terminals: `cd local-edge && npx wrangler dev --port 8798 --var CREW_READY:1`
and `cd crew-cloud && npm run dev` (port 8799; the `NAMES` binding finds the
local prodeck-local by itself). Claim a name on 8798, then open
`http://<name>-crew.localhost:8799`. Point a booth build at them with
`PRODECK_CREW_ORIGIN=http://127.0.0.1:8799` (the name goes in a header) and
`PRODECK_LOCAL_EDGE=http://127.0.0.1:8798`. Without a `CF_API_TOKEN` the local
prodeck-local can't write the crew record, so `/v1/crew` errors there; use
`--var CREW_DNS:wildcard` too.
