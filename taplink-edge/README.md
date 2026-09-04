# taplink-edge

Cloudflare Worker + Durable Object behind `go.cornerstonecheshire.com`. NFC discs
(Overflow Tap, custom link) point at `GET /now`, which 302s to the destination for the
current service moment. ProDeck pushes state when a slide with a `tap:<keyword>` note
goes live in ProPresenter. Full design: [../TAPLINK_PLAN.md](../TAPLINK_PLAN.md).

## Keywords (slide notes)

| Note text | Destination |
|---|---|
| `tap:go` | PushPay giving |
| `tap:connect` | Connect card (Church Center form) |
| `tap:notes` | Sermon notes (FaithNotes) |
| `tap:prayer` | Prayer request form |
| `tap:groups` | Small group signup |
| `tap:default` | Back to default (connect card) |

State is sticky until another keyword fires, a manual override, or its timer
expires (then taps land on the default again). Timers: **`go` reverts after
15 min**; everything else uses the global `ttl_minutes` (180). A keyword maps
to a bare URL or `{ "url": ..., "ttl_minutes": N }` for a per-keyword timer.
**The live mapping is whatever the edge has stored** — since ProDeck 0.1.64 it is
normally edited in the app (Settings → TapLink → *Keywords & links*, which PUTs
here). [mappings.json](mappings.json) is the seed/bootstrap copy and will drift
once anyone edits in-app; `GET /api/mappings` is the source of truth, so re-dump
it there before treating the file as current.

Renaming or removing a keyword does **not** touch ProPresenter: the trigger lives
in the slide's notes, so any slide still tagged with the old `tap:<keyword>`
silently stops switching the discs until it is re-tagged by hand. (The in-app
editor warns and asks for confirmation before saving such a change.) A state
whose keyword disappears falls back to the default on the edge's next read.

## Endpoints

- `GET /now` (or `/`) — public tap path, 302 to current destination, logs an anonymous tap.
- `POST /api/state` — `{"state":"go"}` / `{"state":null}`. Bearer `TAPLINK_TOKEN`.
- `GET /api/state`, `GET|PUT /api/mappings`, `POST /api/heartbeat`, `GET /api/stats` — Bearer.
- `GET /admin/<ADMIN_KEY>` — operator-only phone remote (emergency override buttons).
- `GET /api/health` — public.

## Local dev

```bash
npm install
npx wrangler dev   # uses .dev.vars (TAPLINK_TOKEN=dev-token, ADMIN_KEY=dev-admin-key)
```

## Deploy

```bash
npx wrangler login
npx wrangler deploy
openssl rand -hex 32 | npx wrangler secret put TAPLINK_TOKEN
openssl rand -hex 16 | npx wrangler secret put ADMIN_KEY
```

Then:

1. Push the mapping: `curl -X PUT https://<worker-url>/api/mappings -H "Authorization: Bearer <token>" --data @mappings.json`
2. Custom domain: uncomment `routes` in [wrangler.jsonc](wrangler.jsonc) once
   `cornerstonecheshire.com` DNS is on Cloudflare, redeploy — the DNS record is created
   automatically.
3. Overflow dashboard → Tap group → custom link → `https://go.cornerstonecheshire.com/now`.
4. Save the admin URL (`https://go.cornerstonecheshire.com/admin/<ADMIN_KEY>`) to the
   booth phone's home screen.

Keep `TAPLINK_TOKEN` in ProDeck settings (watcher, phase 2) and nowhere public.
