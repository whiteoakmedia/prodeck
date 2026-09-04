# Crew Cloud — Phase 2: people-features that survive the booth Mac being off

*Status: DESIGN — agreed direction ("do phase 2"), not yet built. Phase 1 is live.*

## Why

Everything room-shaped (ProPresenter, Dante, Avantis, NDI, SPL) rightly dies
with the booth Mac. But chat, pages, identity, and the plan are **people**
features — a volunteer texting "running late" on Saturday night shouldn't
need a Mac mini to be awake in an empty building. Phase 1 proved the model:
the plan and charts now come from a Cloudflare Worker 24/7. Phase 2 moves the
rest of the people layer there.

**Milestone 1 (the one that matters): chat that works with the booth off.**

## What exists today (Phase 1, live)

- Worker `crew-edge` (`~/Developer/prodeck-clone/crew-edge`), route
  `prodeck.live/edge/*`, Durable Object `CrewState` (SQLite-backed, name
  "main"). Secrets: `PCO_APP_ID`, `PCO_SECRET`, `ADMIN_TOKEN`.
- `POST /push` — booth (Rust, `src-tauri/src/edge.rs`) pushes `{tokens,
  extras}` 15 s after launch + every 10 min. Tokens let the edge validate
  member/admin/invite links; extras carry serviceTypeId, checkinTimes,
  positionGuides, fileFilters.
- `GET /plan`, `/chart/{id}`, `/chart-text/{song}/{arr}`, `/health` — PCO
  composed at the edge, cached.
- Phones already fall back to the edge: `CrewOffline` shows "This week", and
  `ChartSheet` fetches chart text via `/edge/chart-text` when the booth
  command fails.

## Architecture

```
phones ──HTTPS/WebSocket──► prodeck.live/edge/* ──► DO CrewState (SQLite)
                                                      ▲
booth Mac ── outbound WebSocket (admin token) ────────┘   (+ PCO fetch)
```

The inversion that makes it work: **the booth becomes just another client**
of the edge for people-features. It keeps sole authority over room features,
but chat/pages/identity state lives in the Durable Object. No inbound
connection to the booth is ever needed (the booth already only dials out —
Cloudflare Tunnel today, this adds one WebSocket).

### Durable Object: `CrewState` (extend the existing one)

SQLite tables (DO storage API):

- `users(id, name, pin_hash, role, approved, last_seen_ms)` — mirrored from
  booth `identity.json`; the edge becomes able to *authenticate* crew, booth
  stays the *admin* authority (approve/role/remove happen on the booth UI and
  sync up).
- `sessions(token_hash, user_id, created_ms)` — minted at either end, valid
  at both.
- `invites(token, name, role, expires_ms, used)` — claimable at the edge, so
  a personal invite works Saturday night with the booth asleep.
- `messages(id, ts, user_id, name, dest, text)` — ring capped at 500
  (superset of the booth's 200-ring; booth ring stays the in-room source for
  stage/confidence destinations).
- `pages(id, ts, sender, text, recipients_json, receipts_json)` — receipts
  stay never-optimistic: the DO is the single writer, same guarantee the
  booth gives today.
- `push_subs(user_id, endpoint, keys_json)` — see push section.

### WebSocket fan-out (replaces booth SSE for people-features)

- `GET /edge/ws?token=` upgrades; DO uses **WebSocket hibernation** so idle
  Sunday-morning phones cost nothing.
- Events mirror today's names (`chat:new`, `page:new`, `page:receipt`,
  `identity:changed`) so `store.tsx` handling stays almost untouched — the
  phone keeps its booth SSE for room events and adds the edge socket for
  people events. One new client module (`lib/edgeSocket.ts`) with the same
  reconnect/grace discipline as `onGatewayState` (6 s DOWN_GRACE).
- The booth connects to the same endpoint with the admin token. It forwards
  edge chat into the in-room ring (so the desktop ChatPanel and stage
  destinations still see everything) and forwards booth-originated
  chat/pages up to the DO. While the booth is connected, it also relays
  `page:new` to stage displays; with it off, pages still reach phones
  (that's the point).

### Identity sync

- Booth pushes the full identity table (pin hashes, not PINs) inside the
  existing 10-min heartbeat + immediately on any identity mutation.
- Edge-side changes (invite claimed, last_seen) flow down over the booth's
  WebSocket; booth writes them into `identity.json` (booth remains the file
  of record — a factory-reset edge repopulates from the next heartbeat).
- Conflict rule: booth wins on role/approval, edge wins on last_seen/claims.

### Push from the edge

Today's VAPID private key lives only on the booth (`push.json`) and pushing
requires the booth to be awake — which defeats booth-off chat notifications.
Plan: booth uploads the VAPID keypair to the DO once (over the authed
WebSocket; it's the same trust domain that already holds PCO secrets, and
Zach approved secrets-at-edge in Phase 1). The DO sends pushes for
`page:new` and (new) chat mentions when the booth socket is down or the
recipient has no live socket; the booth keeps sending its own pushes while
it's up, and the DO dedupes by message id so nobody gets buzzed twice.

### Staged cutover (each stage shippable, reversible)

1. **Mirror up**: booth pushes identity + tails chat/pages into the DO.
   Nothing reads from it yet. Verify parity in `/edge/health`.
2. **Read fallback**: phones read chat history + can send via
   `POST /edge/chat` *only when the booth is unreachable* (same pattern as
   ChartSheet's edge fallback). Booth replays edge-originated messages into
   the ring on reconnect. **← Milestone 1 lands here.**
3. **Socket cutover**: `chat:new`/`page:*` move to the edge WebSocket for
   phones; booth SSE keeps room events only. Remove the polling fallback.
4. **Push + invites at edge**: DO-driven push, invite claim at edge, booth
   becomes optional for the whole More/Chat/Pages surface.

### Non-goals

- Room features (PP, Dante, Avantis, SPL, Listen, NDI) never move.
- No new auth scheme — the existing token tiers and pin-hash model, mirrored.
- No multi-tenant anything: one church, one DO ("main"), same as Phase 1.

### Risks / open questions

- Ordering: booth ring and DO ring must converge — message ids become
  `{origin}-{counter}` and both sides dedupe on id, order by ts.
- iOS PWA WebSocket background behavior: sockets die when backgrounded;
  push is the real delivery path for closed apps (already true today).
- DO cold start after deploy loses hibernated sockets — clients must
  reconnect-with-resume (`?since=<last msg id>`); stage 2's HTTP history
  endpoint doubles as the resume path.
