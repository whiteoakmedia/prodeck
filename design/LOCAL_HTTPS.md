# Secure local address (`<name>.local.prodeck.live`)

Phones only allow comms (the microphone) and page notifications on https. A
booth that only lives on the church network serves plain http, so a church
without its own domain and tunnel could use neither. This gives every booth a
real https address on its own network with one button.

## How it works

1. **Claim.** Settings → Crew & screens → Secure local address. The booth asks
   the `prodeck-local` Worker (`local-edge/`) for a name. The Worker keeps the
   name and the SHA-256 of a secret it hands back once; the secret lives in the
   booth's settings (`local_secret`, never sent to a browser).
2. **Address.** The booth tells the Worker its address on the church network
   (default route, or the one picked in the card). The Worker writes
   `<name>.local.prodeck.live A 192.168.x.x`, DNS-only.
3. **Certificate.** The booth runs ACME (Let's Encrypt, dns-01) itself
   (`src-tauri/src/localhttps.rs`): the Worker only writes and removes the
   `_acme-challenge` TXT record. The certificate's private key never leaves the
   booth.
4. **Serve.** The booth listens on 443 (8443 if taken), finishes TLS, and hands
   each request to the ordinary gateway on loopback with `X-ProDeck-Peer` set to
   the phone's address (web.rs trusts it only from loopback, and never over
   Cloudflare's own header). `local_url` is saved so links, the poster and tally
   codes use it whenever there's no `public_url`.
5. **Upkeep.** Every 15 minutes: follow address changes, renew the certificate
   once two thirds of its life has passed.

Phones talk to the booth directly. Only the name lookup leaves the building.

## Keeping prodeck.live safe

prodeck.live also runs Cornerstone's crew app (crew-edge fronts the zone).

- The Worker runs on **workers.dev**, not on prodeck.live, so it is never in
  front of the zone.
- It only writes records under `local.prodeck.live`, always DNS-only (never
  proxied), and refuses any name outside that base.
- Address records can only point at private addresses (10/8, 172.16/12,
  192.168/16), so prodeck.live can't be used to point at a public site.
- At most 150 names, keeping the zone under Cloudflare's free-plan record
  limit (200 for zones created after September 2024) with room for the crew
  app's own records.
- The API token is scoped to DNS edit on the prodeck.live zone only.

## Setting it up (Zach, once)

1. Cloudflare dashboard → My Profile → API Tokens → Create Token → **Edit zone
   DNS** template, Zone Resources: **prodeck.live** only. Copy it.
2. In `local-edge/` (the Worker finds prodeck.live's zone id with the token):
   ```
   npm install
   npx wrangler deploy
   npx wrangler secret put CF_API_TOKEN     (paste the token)
   npx wrangler secret put ADMIN_TOKEN      (any long random string; keep it)
   ```
   It deploys as `prodeck-local` on the account's workers.dev subdomain
   (`https://prodeck-local.taplink-edge.workers.dev`), which is what the app
   calls.
3. Free a name by hand (a church that left, a name that shouldn't exist):
   ```
   curl -X POST https://prodeck-local.taplink-edge.workers.dev/v1/admin/release \
     -H "Authorization: Bearer <ADMIN_TOKEN>" -d '{"name":"thename"}'
   ```

## Limits and what to watch

- **Let's Encrypt:** 50 new certificates a week per registered domain
  (prodeck.live), renewals exempt when done through ARI. Fine for now.
- **Web filters:** DNS-rebinding protection (Cisco Umbrella, OpenDNS, some
  routers) drops answers that point at private addresses. The church has to
  allow `local.prodeck.live`. The card and Help say so.
- **Names are public** (certificate transparency logs). The card says so.
