# ProDeck Crew — Mobile PWA Plan (revised 2026-08-02)

Revision notes: **no native app** (PWA + Web Push instead — no Apple account, no
TestFlight), **no intercom** (church owns real comms). PINs approved by Zach.

## Architecture

- **PWA**: manifest + service worker on the existing web frontend. Volunteers
  "Add to Home Screen" once → real app icon, fullscreen, instant launch, and
  (iOS 16.4+/Android) **lock-screen Web Push**.
- **HTTPS prerequisite**: service workers/push refuse plain LAN HTTP. Solution:
  Cloudflare Tunnel from the booth Mac → `deck.cornerstonecheshire.com` (needs
  the zone on Cloudflare — open item). Bonus: off-campus access, no LAN-plaintext
  passwords. Office kiosk keeps using the LAN URL (its features need no SW).
- **Push**: booth sends VAPID Web Push directly to Apple/Google push services.
  Message content never transits our Cloudflare worker. Subscriptions stored by
  the booth (per device, tied to PIN identity).
- **Identity**: lightweight per-user PIN on top of the member/admin tiers —
  first join: pick name + 4-digit PIN, booth approves once. Unlocks channels,
  ACK pages, DMs, checklist ownership, real audit lines.

## Feature set (priority order)

1. **Pushed team chat** — existing chat + lock-screen delivery, quiet hours from
   PCO service times, role channels (Audio/Video/Stage/Hosts/Kids), DMs.
2. **Pages with ACK** — hard-buzz priority sends ("Mic 4 to stage NOW"); phone
   buzzes until ✓; sender sees who acknowledged and when. Cue presets one-tap.
3. **Checklists** — owners per item, due times relative to the service clock
   (T-45 pings owner at T-50), Sunday auto-reset, "I'm here" check-in item.
4. **Leader board** — all roles green/amber/red, arrival vs PCO roster,
   no-show nudges, one-tap "push a reminder."
5. **Assignment pushes** — Saturday night "You're on Mic 4 · arrive 8:00."
6. Production awareness (dashboards/Show Flow/TapLink/etc.) — already works;
   PWA packaging makes it instant-on.

Known web-platform tradeoffs (accepted): Listen audio may pause on locked
iPhones; no haptics API (system push vibration covers the need); iOS requires
Add-to-Home-Screen before push works (one-time, part of onboarding design).

## Phases

- **P1 — Foundation**: Cloudflare Tunnel + HTTPS; manifest + service worker +
  install onboarding; PIN identity (booth approval UI in desktop app).
  *Buildable now except the tunnel hostname (awaiting DNS decision).*
- **P2 — Push**: VAPID keys, subscription registry on the booth, push on chat/
  pages; quiet hours; ACK pages end-to-end.
- **P3 — Checklists v2 + leader board**: owners, service-clock deadlines,
  arrival tracking, reminder pushes.

Visual design: see DESIGN_HANDOFF_MOBILE.md — UI build follows the returned
designs; backend/PWA plumbing proceeds in parallel.

## Open items

1. `cornerstonecheshire.com` DNS zone → Cloudflare (blocks the tunnel hostname;
   everything else proceeds meanwhile).
2. Designer returns mobile UI (handoff doc sent).
