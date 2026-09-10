# taplink-edge

The tiny web service behind TapLink. NFC discs in your lobby all point at one
fixed URL on it (`/now`); it redirects each tap to wherever the service is
right now, and counts the taps. ProDeck tells it what's live when a slide with
`tap:<keyword>` in its notes goes up in ProPresenter.

It runs on Cloudflare Workers (free tier is plenty) with a Durable Object for
state. You deploy one per church. **ProDeck's own Settings → TapLink card walks
you through this with copyable commands** — this file is the reference.

## What you need

- A **Cloudflare account** (free). Nothing else on Cloudflare — no domain
  required, though a short one like `go.yourchurch.org` is nicer on a disc.
- **Node.js 18+** on any computer, once, to deploy from.
- **NFC discs or stickers**, NTAG213 or better.

## Deploy

From the ProDeck source (`git clone https://github.com/whiteoakmedia/prodeck`):

```bash
cd taplink-edge
npm install
npx wrangler login          # opens Cloudflare in your browser
npx wrangler deploy         # prints your worker URL — that is your Edge URL
```

Create the token ProDeck will use and store it as a secret. **Copy the value
this prints** — it's the API token you paste into ProDeck, and Cloudflare will
not show it again:

```bash
openssl rand -hex 32 | tee /dev/stderr | npx wrangler secret put TAPLINK_TOKEN
```

And a separate key for the emergency phone page:

```bash
openssl rand -hex 16 | tee /dev/stderr | npx wrangler secret put ADMIN_KEY
```

Then in ProDeck: **Settings → TapLink**, paste the Edge URL and token, **Save &
test connection**. Green means reachable and authenticated.

### Optional: a short domain

If your domain's DNS is on Cloudflare, uncomment `routes` in
[wrangler.jsonc](wrangler.jsonc), set your hostname, and `npx wrangler deploy`
again. Cloudflare creates the DNS record. Your Edge URL becomes
`https://go.yourchurch.org`.

## Links and keywords

The edge stores a mapping of keyword → URL, plus a default. **Edit it in ProDeck**
(Settings → TapLink → Keywords & links); [mappings.json](mappings.json) is only
a starter for a brand-new deploy, and ProDeck's copy wins the moment anyone
saves there.

| Slide note | What every disc opens |
|---|---|
| `tap:give` | your giving page (reverts after 15 min by default) |
| `tap:connect` | connect card |
| `tap:notes` | sermon notes |
| `tap:prayer` | prayer request form |
| `tap:groups` | small-group signup |
| `tap:default` | back to the default |

Both `tap:give` and `tap: give` are accepted. State is sticky until another
keyword fires, a manual override, or its timer runs out (then taps land on the
default). A keyword is a bare URL or `{ "url": ..., "ttl_minutes": N }`.

Renaming or removing a keyword does **not** touch ProPresenter — a slide still
tagged with the old word silently stops switching until it's re-tagged. The
in-app editor warns before saving such a change.

## Writing the discs

Every disc gets the same URL: your Edge URL plus `/now`, e.g.
`https://go.yourchurch.org/now`. Any NFC-writer phone app (NFC Tools is free):
choose *URL*, paste, hold the disc to the phone. Because the URL never changes,
you can add discs forever without rewriting one.

## Endpoints

- `GET /now` (or `/`) — public tap path: 302 to the current destination, logs an anonymous tap.
- `GET /api/health` — public.
- `POST /api/state` — `{"state":"give"}` / `{"state":null}`. Bearer `TAPLINK_TOKEN`.
- `GET /api/state`, `GET|PUT /api/mappings`, `POST /api/heartbeat`, `GET /api/stats` — Bearer.
- `GET /admin/<ADMIN_KEY>` — operator-only phone remote with override buttons. Works even when the booth computer is off.

## Local dev

```bash
npm install
npx wrangler dev   # uses .dev.vars (TAPLINK_TOKEN=dev-token, ADMIN_KEY=dev-admin-key)
```
