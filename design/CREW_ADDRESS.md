# Crew address (`<name>.crew.prodeck.live`)

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
`cornerstone.local.prodeck.live` means `cornerstone.crew.prodeck.live`, with
the same secret. A booth without one claims a name from the same service on
its first sync (`/v1/claim`, no DNS record is made), from the computer's name
(`grace-church`, then `grace-church-2`, and so on), kept as `crew_name` and
`crew_secret` (booth only, like `local_secret`). It can be changed in the card.
Claiming a secure local address with the crew name adopts it; giving the
secure local address back keeps the name for the crew address
(`DELETE /v1/address` instead of `/v1/release`).

prodeck-crew never hands out names or writes DNS. It checks a booth's secret
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

## Zach's prodeck.live

Untouched. crew-edge's route is `prodeck.live/*` (the apex only), this one is
`*.crew.prodeck.live/*`. Cornerstone's booth runs both: edge.rs still pushes to
crew-edge, and crewcloud.rs gives it `<name>.crew.prodeck.live` as well. On
prodeck.live the booth-off screen still asks crew-edge first (same origin).

## Deploying (Zach, once; nothing is deployed yet)

1. **prodeck-local first** (it exports `Names`): `cd local-edge && npx wrangler deploy`.
2. **DNS:** on prodeck.live, a proxied record `*.crew` AAAA `100::`.
3. **Certificate.** Cloudflare's free Universal SSL covers `*.prodeck.live`
   only, one level, so `grace.crew.prodeck.live` would fail TLS. Either:
   - **Advanced Certificate Manager** ($10 a month on the zone), then order an
     advanced certificate for `*.crew.prodeck.live`. Recommended.
   - Or a Worker custom domain per church (free, one certificate each, added
     by API at claim time). Not built; it would need a token with Workers
     edit rights in prodeck-local.
4. **Deploy prodeck-crew:** `npx vite build` at the repo root (the shell comes
   from `dist/`), then in `crew-cloud/` uncomment `routes` in `wrangler.jsonc`
   and `npx wrangler deploy`. Redeploy after each release so the shell matches.
5. **Release** a ProDeck with crewcloud.rs. Booths start syncing 20 seconds
   after launch.

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

`cd crew-cloud && npx wrangler dev -c wrangler.jsonc -c ../local-edge/wrangler.jsonc`
(local-edge first in the list only matters for its own port), then open
`http://<name>.crew.localhost:8787`. Point a booth build at it with
`PRODECK_CREW_ORIGIN=http://127.0.0.1:8787` (the name goes in a header) and
`PRODECK_LOCAL_EDGE` at the local prodeck-local.
