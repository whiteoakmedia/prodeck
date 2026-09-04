# ProDeck Crew — Mobile UI Design Handoff

**Client:** Cornerstone Church, Cheshire — contact Zach (zach@whiteoakmedia.io)
**Deliverable:** Mobile UI design for the ProDeck crew PWA — the phone-first
experience volunteers use on Sunday morning. Brand assets already exist (mark,
lockups "BY ZACH GREEN" — supplied; same family as the shipped desktop app).

## Product context

ProDeck runs a church production booth (slides, audio, Planning Center, NFC
giving). This project is its phone experience: an installable web app volunteers
add to their Home Screen. It must feel like a calm production tool, not a social
app — the users are stage managers, camera ops, hosts, and kids-ministry leads,
often walking, often in dim rooms, always one-handed.

Two roles everywhere: **Member** (volunteer — team chat, own checklists, own
dashboards) and **Admin** (Zach/leads — everything, plus stage/confidence sends,
pages, leader board). Design both states where they differ.

## Existing visual language (extend, don't reinvent)

- Dark-first: bg `#0e131b`, panel `#161d28`, text `#eef3fa`, muted `#92a2b6`,
  accent `#5b8def` (hi `#79a4f6`), success `#3fcf8e`. Amber/red used for
  warnings/overdue. Wordmark face: IBM Plex Sans.
- Existing desktop app has rounded panels, chips, quiet density (screenshots
  supplied). Mobile should read as the same product, thumb-sized.

## Screens to design (11)

1. **Install onboarding** — first visit in Safari/Chrome: explain Add to Home
   Screen (iOS steps differ from Android — design both), why notifications need
   it, then PIN setup. This is the only time we may hand-hold; volunteers see it
   once.
2. **Join / PIN** — pick name + 4-digit PIN (first run), then PIN unlock
   (returning). "Waiting for booth approval" state for new joins.
3. **Home** — the Sunday screen: my next duty ("Mic 4 · arrive 8:00"), service
   countdown, my checklist progress, unread chat, current TapLink/live status
   strip. Glanceable in 2 seconds.
4. **Chat: channel list** — Team + role channels + DMs, unread badges, quiet-
   hours indicator.
5. **Chat: thread** — messages with sender/time, target chips (stage/confidence
   sends visible as system-ish lines), compose bar. Admin variant adds the
   destination picker (Team/Stage/Confidence) and Page button.
6. **Page composer + ACK tracking (admin)** — compose a page, pick recipients
   (person/role/everyone), send; then the tracking view: who ACK'd (green,
   timestamped), who hasn't (pulsing), re-buzz button.
7. **Incoming page (member)** — full-takeover alert with one giant ✓ ACK
   button. Design the lock-screen notification anatomy too (title/body/actions).
8. **My checklist** — items with due-by-service-clock times ("T-45 · 9:15"),
   overdue state, "I'm here" check-in as the first item, per-item notes.
9. **Leader board (admin)** — every role: checklist green/amber/red, arrival
   status vs Planning Center roster, no-show nudge action.
10. **Dashboards (existing)** — the current widget dashboards on mobile mostly
    work; provide a light polish pass: spacing, widget headers, bottom-nav fit.
11. **Offline / booth-down state** — friendly full-screen "Command Center
    offline, reconnecting" (a desktop version exists; make the mobile sibling).

Plus: **bottom navigation** (Home / Chat / Checklist / Dashboards / More),
badge behavior, and a small component sheet (buttons, chips, list rows, unread
badges, ACK states, toasts).

## Hard requirements

- One-hand reach: primary actions in the bottom half; 44pt minimum targets.
- Dark-first; must also survive full sun (outdoor greeters) — check contrast.
- PWA standalone: no browser chrome; respect iOS safe areas (notch/home bar).
- Design at 375×812; must degrade gracefully to small Androids (360 wide).
- The ✓ ACK interaction must be doable blind, phone at hip, in ≤1 second.
- No feature invention beyond this doc — the backend scope is fixed.

## Deliverables

- Figma file: the 11 screens + bottom nav + component sheet, member and admin
  variants where they differ, light annotation of states (unread, overdue,
  ACK pending/confirmed, offline).
- Exportable icons used, if any beyond the supplied brand set.
- No hi-fi motion spec needed — note intended transitions in comments.

## Process

Wireframe pass → one review with Zach → hi-fi pass → final Figma. Engineering
builds backend + PWA plumbing in parallel and applies visuals as they land, so
screen-by-screen delivery is welcome (chat + page/ACK screens first, please —
they're the build's critical path).
