# TapLink — Dynamic NFC Link Driven by ProPresenter

Custom replacement for Overflow's ProPresenter→Tap integration. When a slide with a
keyword goes live in PP7, the destination behind our NFC tap URL switches within ~2s.
Congregant taps a disc → phone opens `go.cornerstonecheshire.com/now` → instant 302 to
whatever destination matches the current moment of the service (giving, connect, events…).

## Why the redirect model (not a live-updating page)

NFC taps resolve a URL *at tap time*, and phones are on cellular/guest Wi-Fi — they can't
see the booth LAN. So the dynamic part must live at a tiny internet-reachable edge service,
and the fastest UX is an instant 302 (no landing page to render). A live-updating SSE page
is a later optional add-on for kiosks/screens, not the tap path.

## Architecture

```
ProPresenter (172.16.0.68:51417)
        │  /v1/status/slide?chunked=true   (current slide text + NOTES)
        ▼
ProDeck watcher (new tap module, booth Mac)
        │  parses notes for "tap:<keyword>", debounces,
        │  POST /api/state {state} on change  + 60s heartbeat
        ▼
Edge service — Cloudflare Worker + Durable Object
  go.cornerstonecheshire.com
        │  GET /now  → 302 current destination (<50ms, no-store)
        ▲
Phone (cellular) ◄── NFC disc (Overflow Tap w/ custom link, or plain NTAG)
```

## Component 1: Edge service (Cloudflare Worker + Durable Object)

One Durable Object holds all state — strongly consistent, so a state flip is visible on the
very next tap. (KV is wrong here: its edge caches can serve stale reads for up to ~60s,
which would blow the "pastor says give → link is giving" moment.) DOs are on the free tier.

**Routes**

| Route | Auth | Behavior |
|---|---|---|
| `GET /now` (and `/`) | none | 302 → current destination. `Cache-Control: no-store`. Logs a tap event (timestamp, state — no PII). |
| `POST /api/state` | Bearer | `{"state": "giving"}` or `{"state": null}` (revert to default). Rejects unknown keywords. |
| `GET /api/state` | Bearer | Current state, destination, last-update time, source (auto/override). |
| `PUT /api/mappings` | Bearer | Full mapping doc (below). Pushed from ProDeck settings UI. |
| `GET /api/stats` | Bearer | Tap counts per state per day. |
| `GET /admin` | token in URL, long random path | Minimal phone-friendly page with buttons to flip state manually — emergency fallback if the booth loses internet (edge is still reachable from phones). |
| `GET /api/health` | none | ok + version. |

**Mapping doc** (single JSON blob in DO storage):

```json
{
  "default": "https://cornerstonecheshire.com/connect",
  "ttl_minutes": 180,
  "keywords": {
    "giving":  "https://cornerstonecheshire.com/give",
    "connect": "https://cornerstonecheshire.com/connect-card",
    "events":  "https://cornerstonecheshire.com/events"
  }
}
```

**Rules**

- Destinations only ever come from the stored mapping — never from query params (no open redirect).
- TTL: if no state update or heartbeat for `ttl_minutes`, auto-revert to `default` (prevents
  Sunday's last state leaking into Wednesday). Manual overrides get the same TTL.
- Auth: one long random bearer token, generated once, stored in ProDeck settings and as a
  Worker secret. Rate-limit `/api/*` writes.
- Deploy with `wrangler`; custom domain `go.cornerstonecheshire.com` routed to the Worker
  (requires the domain's DNS on Cloudflare — see Decisions).

## Component 2: ProDeck watcher (Rust, `src-tauri/src/tap.rs`)

- Add `("current_slide", "status/slide")` to the endpoint list in
  `propresenter.rs::spawn_status_streams` (the reconnect/backoff loop is already there).
- New `tap.rs` module consumes the emitted event:
  - Parse notes for `tap:<keyword>` (word-boundary, case-insensitive). Prefixed form, not a
    bare word, so ordinary notes text can't false-trigger. Notes are invisible on output.
  - Debounce ~750ms — an operator arrowing through slides shouldn't spam the edge; last
    state wins.
  - Push only on change; retry with backoff; heartbeat every 60s.
  - **Only auto-push when this instance is the source of truth**: skip when relay mode ==
    "client" (mirrors host state; would double-push). Slide-driven pushes are host-only;
    manual overrides are allowed from the web gateway (see Component 3).
  - Arm/disarm toggle in settings — disarmed during rehearsal if desired. Tap analytics
    reuse the existing rehearsal-vs-service bucketing.
- Settings (via existing atomic settings.rs): enabled, edge URL, bearer token, mappings
  (edited here, PUT to edge on save).

**Keyword convention** — same placement as Overflow's integration (slide notes), so
switching back or running both is trivial. v1 reads notes only; presentation-name fallback
deliberately out of scope.

**State semantics** — sticky-until-changed: a `tap:giving` slide sets giving and it *stays*
giving through subsequent unmarked slides, until another keyword slide fires or TTL/manual
revert. (Reverting on the next unmarked slide would kill the link seconds after the pastor
moves on, mid-giving-moment.) To end a moment explicitly, mark a slide `tap:default`.

## Component 3: ProDeck UI

- Status widget: current tap state + destination, edge reachability, last push time.
- Manual override buttons (one per mapping + "revert to default"). Override sets
  `source: override` on the edge; auto-pushes from slides still win afterward (simplest
  mental model: last writer wins; the operator can always re-override).
- Mapping editor in settings (keyword → URL rows, default URL, TTL) — shipped 0.1.64.
  Booth-only. Because the trigger lives in PP slide notes that ProDeck can't rewrite,
  it carries a standing warning and confirms before saving any change that drops a
  previously-known keyword, naming the old `tap:<kw>` strings to go re-tag.
- Web clients (phone on the gateway) get the same widget, overrides included — the host
  proxies `tap_edge_state`/`tap_override`, so the edge token and the mapping/enable
  switches stay booth-only. Same trust level as the pp_* controls the gateway already
  exposes; both sit behind the gateway password.

## NFC hardware

Two options, not mutually exclusive:

1. **Keep the Overflow Tap discs** — set the Tap group's custom link to
   `https://go.cornerstonecheshire.com/now` once in the Overflow dashboard and never touch
   it again. One extra redirect hop (Overflow short link → our edge → destination), keeps
   existing hardware. Note this likely still requires the Overflow subscription.
2. **Generic NTAG213/215 discs** (~$1–2 each) with our URL written directly. One fewer hop,
   zero vendor dependency. Any phone with an NFC-write app can program them.

Recommendation: start with (1) if discs are already deployed; buy a couple of blank tags
anyway for testing.

## Failure modes

| Failure | Behavior |
|---|---|
| PP quits / booth Mac reboots | Stream reconnect loop already handles PP; edge keeps last state, TTL reverts eventually. |
| ProDeck closed after service | Heartbeat stops → TTL revert to default. |
| Venue internet down mid-service | Phones (cellular) still reach the edge; state is frozen at last push. Operator can flip state from their phone via `/admin`. |
| Cloudflare outage | Taps fail entirely — same blast radius as Overflow's own cloud. Accept. |
| Two ProDeck instances running | Only relay-host (or standalone) pushes; clients never push. |
| Unknown keyword in notes | Edge rejects; ProDeck surfaces a warning toast. |

## Analytics

- Edge logs `{ts, state}` per tap in the DO (daily rollups, keep raw for ~90 days).
- ProDeck pulls `/api/stats` and adds a "taps by moment" section to service reports,
  bucketed rehearsal-vs-service like the SPL/analytics data already is.

## Build order

1. **Edge service** (worker + DO + `/now` + `/api/state` + `/admin`, custom domain, deploy).
   Test with curl + a blank NFC tag. Measure flip latency (target: next tap after POST is
   correct, i.e. effectively instant).
2. **Watcher**: `status/slide` stream + keyword parse + push + heartbeat. Verify notes come
   through the API on the booth machine (PP was unreachable when planning; endpoint is the
   documented one Overflow uses). Curl the stream, arrow through a marked presentation.
3. **UI**: status widget, overrides, mapping editor.
4. **Analytics + polish**: stats in service reports, `/live` SSE page if ever wanted.

1 and 2 make it functional end-to-end; 3 and 4 are quality of life.

## Decisions (settled 2026-07-30)

1. **Domain**: user will create the `go.cornerstonecheshire.com` subdomain on Cloudflare.
2. **Hardware**: keep the Overflow Tap discs; set their custom link to the edge URL once.
3. **Destinations** (see `taplink-edge/mappings.json`): `go` → PushPay giving,
   `connect` → Church Center connect card (also the default), `notes` → FaithNotes,
   `prayer` → prayer form, `groups` → small group signup.

## Status

- **Phase 1 (edge service): DEPLOYED 2026-07-30** at
  `https://taplink-edge.taplink-edge.workers.dev` — all production checks pass (tap 302s,
  mappings pushed, auth, admin remote, stats). Secrets in gitignored
  `taplink-edge/.secrets.local` and as Worker secrets. Remaining: custom domain
  (`go.cornerstonecheshire.com`, requires zone on Cloudflare), point Overflow Tap custom
  link at `<edge>/now`.
- **Phases 2+3 (watcher + UI): SHIPPED in ProDeck 0.1.61, installed 2026-07-30.**
  Watcher lives in Rust (`src-tauri/src/tap.rs`) off the `status/slide` stream — only the
  instance connected to PP pushes; web gateway redacts the token and rejects `tap_*`.
  Verified end-to-end against a scripted fake PP driving the production edge: go flip,
  sticky state, case-insensitive keywords, debounce, `tap:default` revert, heartbeat.
  UI: Settings → "TapLink (NFC giving link)" card + "TapLink (NFC)" dashboard widget.
- **Sunday checklist**: with real ProPresenter running, put `tap:go` in a test slide's
  notes, fire it, confirm the edge flips (`/api/state` or the widget) — this is the one
  remaining unverified link (PP was offline all week; the notes field shape is assumed
  from the documented API).
