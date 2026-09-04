# Handoff: ProDeck Crew PWA (mobile)

**Client:** Cornerstone Church, Cheshire · contact Zach Green (zach@whiteoakmedia.io)
**Scope:** the 11 phone screens of the ProDeck crew PWA, bottom navigation, component sheet, and the ProDeck brand mark used inside them.

## Overview

ProDeck runs a church production booth. This PWA is its phone experience: an installable web app volunteers add to their Home Screen and use on Sunday morning — one-handed, often walking, often in a dim room, sometimes in full sun outdoors.

Two roles: **Member** (volunteer) and **Admin** (booth/leads). Admin adds stage/confidence sends, pages with read tracking, and the leader board.

Priority order for implementation (client's stated critical path): **chat → page/read tracking → everything else.**

## About the design files

The files in this bundle are **design references authored in HTML** — prototypes that show intended look, copy, and behaviour. They are **not production code to copy**. The task is to recreate them in the target codebase's existing environment (React/Vue/native/etc.) using its established components, tokens, and patterns. If no environment exists yet, pick the framework that best fits a PWA with web push and offline caching, and implement there.

Each `.dc.html` file is a self-contained page: open it in a browser to view the screens. `support.js` is only the viewer runtime for those files — do not port it.

## Fidelity

**High-fidelity.** Colours, type sizes, radii, spacing and copy are final and should be matched. Every screen is drawn at **375×812** (iOS reference) except S01b, drawn at **360×800** to prove the small-Android case. Nothing uses viewport units; all values below are px.

## Design tokens

### Colour

| Token | Hex | Use |
|---|---|---|
| bg | `#0e131b` | app background |
| panel | `#161d28` | cards, list rows, inputs |
| panel-sunk | `#131a24` | completed rows, segmented-control track, nav bar |
| panel-raised | `#1b2430` | incoming chat bubbles, toast |
| border | `#232f3e` | 1px panel outline |
| border-soft | `#1c2634` | dividers, frame outline |
| border-mid | `#2b3849` | secondary button outline, broadcast rows |
| control-outline | `#3a4a5e` | empty checkbox / PIN dot |
| text | `#eef3fa` | primary text |
| text-soft | `#c9d6e6` / `#dbe5f1` | secondary body on panels |
| muted | `#92a2b6` | supporting copy |
| dim | `#6d7f95` | mono labels, inactive nav |
| disabled-text | `#4d5a6b` | disabled button label |
| accent | `#5b8def` | primary action, own chat bubble, selected segment |
| accent-hi | `#79a4f6` | active nav, links, mono accent labels |
| accent-quiet | `#22405f` / `#1a2740` | avatar fill, selected recipient row |
| accent-line | `#2f4874` | outline on selected/accent cards |
| success | `#3fcf8e` | read/confirmed, on-track, "Got it" button |
| success-quiet | `#14291f` | success chip background |
| warn | `#f0b429` | pages, overdue, waiting |
| warn-bg | `#2a1f1a` / `#14100a` | overdue panel / page-takeover background |
| warn-line | `#4a3520` | outline on warn panels |
| warn-text | `#c2a878` / `#fdf6e6` | body / heading on warn surfaces |
| danger | `#e0645b` | no response, not arrived |
| danger-bg | `#241519` · line `#52242a` | danger panel |
| track | `#222d3b` | progress-bar track |

Dark-first. Every colour pair above meets 4.5:1 or better against its background; the accent-on-dark pairing (`#0e131b` text on `#5b8def`) is what carries full-sun legibility, so **do not invert it to white-on-accent**.

### Typography

IBM Plex Sans (400/500/600/700) and IBM Plex Mono (400/500) — both OFL, embeddable.

| Role | Size / weight / tracking |
|---|---|
| Screen title | 24 / 600 / −0.025em |
| Section title, sheet title | 17 / 600 / −0.015em |
| Card headline | 19–26 / 600 / −0.02em |
| Page takeover headline | 38 / 600 / −0.03em / line-height 1.12 |
| List row primary | 14.5–15 / 600 |
| Body | 13.5–14.5 / 400–500 / line-height 1.4–1.5 |
| Supporting | 12.5 / 400, `muted` |
| Button label | 16 / 600 (Page button 700) |
| Nav label | 10.5 / 500 |
| Mono label | 10–11 / 400–500 / +0.14–0.18em / uppercase |
| Mono data (times, counts) | 11–12.5 / 400 |
| Countdown numeral | 38 mono / 500 / −0.03em |

Rule: **times, counts, IDs and status words are always mono**; prose is always Sans. That split is the app's main texture.

### Spacing, radius, shape

- Screen gutter 20 (24 on onboarding/PIN, 22 on 360-wide).
- Vertical gap between cards 12; between list rows 8–9; inside cards 12–14.
- Radii: screen frame 44 · card 20 · list row 15–16 · input 18 · chip 6–11 · button 17–18 · pill/keypad 999.
- Borders are `box-shadow: inset 0 0 0 1px <color>` so they never affect layout; accent/warn cards use 1px, outline buttons 1.5px.
- Status bar block 50 high, content starts under it. Bottom nav 90 total (68 tappable + 22 safe-area inset). Home indicator 134×5, `rgba(238,243,250,.35)`.
- Minimum hit target 44; list rows are 52–62 tall; keypad keys 74; the page-confirm target is 335×268.

### Motion

Only one animation ships: `pdPulse` — `opacity 1→.35`, `scale 1→.82`, 1.5s ease-in-out infinite, on waiting/page dots (0.4s stagger between two). Page takeover uses 1.2s. Everything else is static by design.

Intended transitions (not built): thread push from right with header cross-fade; composer and page takeover fade+scale up from 96%; nav tab switches cross-fade with no slide; read receipts stream in from the top of the WAITING group and animate down into READ.

## Screens

### S01a / S01b — Install onboarding (first visit, iOS / Android)
**Purpose:** get the app onto the Home Screen; iOS delivers no web push otherwise, which would kill paging.
**Layout:** mark 52 → title 28/600 → 3 numbered step rows (panel, 16 radius, 30px numbered square `#22405f` on `#a8c4fa`) → amber-dot caution panel (`panel-sunk`, 1px `border`) → bottom: primary 56 button + text link.
**Copy (iOS):** "Add ProDeck to your Home Screen" / "Three taps, once. Safari can't send you pages until ProDeck lives on your Home Screen." / steps: Share → Add to Home Screen → open and allow Notifications / caution: "Notifications are how pages reach you when your phone is in your pocket. Without them ProDeck is silent." / buttons "I've added it — continue", "Show me again".
**Copy (Android):** "Install ProDeck on this phone" / steps: Install (or Chrome menu → Install app) → open from app drawer → allow Notifications / caution about battery optimisation / buttons "Install", "Continue in the browser".
**Behaviour:** detect platform, render one variant only, never both. Android's button triggers the `beforeinstallprompt` flow directly. Screen shows once per device; re-entry only via the text link.

### S02a / S02b — Join, PIN, waiting for approval
**Purpose:** set a device PIN (first run), unlock (returning), or wait for booth approval (new join).
**Layout:** title → 4 PIN dots (16px, filled `accent`, empty 1.5px `control-outline`, gap 14) → helper line → keypad: 74px circles on `panel`, 3 columns, gap 14, `⌫` unfilled, "Forgot" occupying the unused bottom-left cell on the unlock state → first-run only: disabled 56 "Confirm PIN" until 4 digits.
**Pending state:** amber card at top — mono "WAITING FOR BOOTH" + pulsing dot, "Zach needs to approve you", "Requested 8:52. You'll get a notification the moment you're in — you can close this."
**Behaviour:** keypad not a text input (no keyboard animation, bigger targets). Unlock submits on the 4th digit — no confirm button. Name/role are pre-filled from the Planning Center roster match.

### S03 — Home, the Sunday screen
**Purpose:** answer "what do I do next" in two seconds.
**Order (fixed by urgency):** countdown card → my next duty (the only accent-filled card) → checklist progress → unread + TapLink tiles → live status strip → pinned check-in bar → nav.
**Components:**
- Countdown: `T-24` in mono 38 `accent-hi`, mono caption "TO COUNT-IN", 1px vertical divider, "Service starts 10:05" 14.5/600 + "Plan locked · 6 items ahead of you".
- Next duty: `#1a2740` card, 1px `#2f4874`, mono "MY NEXT DUTY" + "IN 19 MIN", "Mic 4" 26/600, "Arrive 10:00 · stage left", 44 accent "Details".
- Checklist: title + amber "1 OVERDUE" chip + mono "4/7", 6px progress bar 57% accent on `track`.
- Tiles: UNREAD "6 messages" + channel list; TAPLINK green dot "4 discs live" + locations.
- Live strip: green dot "Booth online" · mono "SLIDE 12" · mono "84 dB", 1px dividers.
- Check-in bar (pinned above nav): "Not checked in" + mono "EXPECTED 10:00", 52 accent "I'm here". On tap it collapses to a green "Checked in 9:41" line and ticks the same item on S08 — one source of truth, cannot be checked twice.
**Behaviour:** everything except the check-in bar is read-only. No controls mid-screen.

### S04 — Chat, channel list
**Purpose:** find the right conversation fast.
**Layout:** title 28/600 + 44 compose button (`panel`, 1px border, `+` in `accent-hi`) → quiet-hours strip (amber dot, "Quiet hours until 6:00 — pages still ring") → grouped list under mono headers TEAM / MY ROLES / DIRECT.
**Row:** 62 tall, 16 radius `panel`, 42 avatar square (13 radius; `#22405f`/`#a8c4fa` for team+admin, `#1d2b3a`/`muted` otherwise, 2-letter initials), name 15/600, last message 13 `muted` single-line ellipsis, right column mono time 11 + unread badge.
**Badge:** min-width 20, height 20, radius 10, `accent` on `#0e131b`, mono 11.5, padding 0 6; caps at "9+".
**Behaviour:** quiet hours is informational only — it never suppresses a page. Admin rows carry a mono "BOOTH" chip.

### S05a — Chat thread (member)
**Layout:** back chevron 44 → title + "12 members · 4 on site" → message list bottom-aligned, 14 gap → compose bar → nav.
**Bubbles:** incoming `panel-raised`, radius 16 with 6 on the bottom-left corner, 14.5/1.4 text, 32 avatar, sender 12.5/600 `accent-hi` + mono time. Own messages right-aligned, `accent` background, `#0e131b` text 14.5/500, 6 on bottom-right, mono "9:02 · read" below.
**Broadcast rows:** centred, no bubble — 12 radius, 1px `border-mid`, mono "→ STAGE · 8:58" in `accent-hi` + 13 `muted` body. These are records, not conversation.
**Unread divider:** 1px rules either side of mono "NEW" in `accent-hi`.
**Compose:** 46 pill field `panel` + 1px border, placeholder "Message Sunday Team", 46 accent circular send with `↑`.

### S05b — Chat thread (admin)
Adds: mono "ADMIN" chip in the header; a **persistent destination segmented control** directly above the field (Team / Stage / Confidence — track `panel-sunk`, selected segment `accent` on `#0e131b`, 32 tall) with the field placeholder following the selection ("Send to Team"); and an **amber outlined 38 "Page" button** beside it — deliberately a different shape and colour from send so it is never hit by accident.
Broadcast rows in this state are full-width and show live status: mono "YOU → STAGE · 9:03" with "ON DISPLAY 41s" in `success`, or "CLEARED" in `dim`. A sent page appears as an amber panel with "PAGE → CAMERA (3) · 9:06" and a mono "2/3 read" counter that links to S06b.

### S06a — Page composer (admin)
**Purpose:** send a page in seconds, one-handed, mid-service.
**Layout:** modal sheet, **no bottom nav** — "Cancel" / "Send a page" / spacer header. Body: 88-min message field (18/500, accent caret) → preset chips (11 radius, 1px `border-mid`, `muted` 12.5: "Standby", "Go to black", "Mic check", "Cam 2 hot") → mono "RECIPIENTS" → Person/Role/Everyone segmented → recipient rows (48 tall; selected = `#1a2740` + 1px `#2f4874` + 22px accent check square; unselected = `panel` + 1.5px empty box, mono "3 on shift" right).
**Footer:** "Buzz until read" row with "Repeats every 20s for 2 min" and a 48×29 accent toggle → **60px amber primary "Send page to 5"** (700 weight, `#221803` text) that counts the actual recipients.
**Behaviour:** presets exist because most pages are one of five phrases; typing one-handed mid-service is the failure mode. The count on the button is the last chance to catch a mis-selected role.

### S06b — Read tracking (admin)
**Layout:** header "Page · 9:06" + "Camera, Audio · buzz on" → quoted message card with "3 of 5 read", mono "38s elapsed", 6px 60% green progress bar → **WAITING group first** (amber panels, pulsing dot, name, "Camera 2 · last seen 9:02", mono elapsed in `warn`) → **READ group** (`panel` rows, 22px green check circle, name 15/500, mono "9:06:04 · 4s" in `success`) → footer: amber outlined 56 "Re-buzz 2" + 116-wide `panel` "Done".
**Behaviour:** waiting sits above read because the unresolved half is why the operator opened the screen. Rows carry role and last-seen so a no-show is diagnosable here. Re-buzz re-fires only to the waiting set.

### S07a — Incoming page (member, full takeover)
**Purpose:** confirm a command in under a second, blind, phone at hip.
**Layout:** whole frame tinted `#14100a` with `#4a3520` outline, status-bar glyphs amber. Pulsing dot + mono "PAGE · 9:06" → message 38/600 `#fdf6e6` → sender row (40 avatar `#3a2a15`/`warn`, "Zach Green", "Booth · buzzing until you confirm") → **335×268 green confirm target** (radius 32, `success`, `✓` 96/700 and "Got it" 26/700 in `#08281b`) → "Tap anywhere in the green to confirm".
**Behaviour:** fades up over whatever screen was showing. No dismiss gesture, no snooze — confirming is the only exit. Green appears nowhere else in the app at this size.

### S07b — Lock-screen notification anatomy
Notification card: `rgba(238,243,250,.1)` fill, 22 radius, 38 app-icon tile with the mark at 24, title "ProDeck · Page" 14.5/600, mono "now", body "Zach: Need you in the booth now", then a 46 action row split by 1px rules: "✓ Got it" in `success`, "Open" in `accent-hi`.
**Spec:** title is always "ProDeck · Page", never the message. Body = sender first name + colon + text, 64 chars before truncation. "Got it" resolves without opening the app; "Open" launches S07a. Critical-alert channel, repeats every 20s while buzz is on. Android: same anatomy, high-importance channel "Pages", ongoing until read.

### S08 — My checklist
**Layout:** title + "Camera 1 · 4 of 7 done" + mono "T-24 · 9:41" → **check-in card pinned as item zero** (accent card, "I'm here" / "Expected 9:15 · tells the booth", 46 accent "Check in") → items.
**Item states:** done = `panel-sunk`, 24px green check circle, title `muted` strikethrough, mono "T-45 · 9:15 · done 9:12". Pending = `panel`, 1.5px empty 8-radius box, mono time in `dim`, "Note" affordance right. Overdue = whole panel `warn-bg` + 1px `warn-line`, amber 1.5px box, mono "T-20 · 9:40 · 1 min overdue", and an expanded note block (`#1d1610`, 12.5 `warn-text`).
**Behaviour:** overdue tints its panel rather than adding a badge, so a glance reads as one warm block. Completion times are kept — S09 reads them.

### S09 — Leader board (admin)
**Layout:** title + "12 on shift · 2 need attention" + mono "T-24" → three stat tiles (ON SITE 9/12, ON TRACK 7 green, ISSUES 2 amber) → **NEEDS ATTENTION** group → **ON TRACK** group collapsed to one 52px line each (status dot, name, "Camera 1 · on site 8:52", mono "6/6" green).
**Danger card:** `danger-bg` + `#52242a`, red dot, "Sam Okoye", "Audio A2 · expected 8:45, not arrived", mono "0/6", plus two 44 buttons: red outlined "Nudge" and `panel` "Reassign".
**Amber row:** "Marcus Hale · Camera 2 · on site 9:02 · 1 overdue", mono "3/6".
**Behaviour:** sorted by exception, never alphabetically. Arrival compares to the Planning Center roster time, so "not arrived" is a fact. **Nudge opens S06a pre-filled** with that person's role and the missing item — the one cross-screen link not spelled out in the brief; confirm before building.

### S10 — Dashboards (polish pass, existing feature)
**Layout:** title → Booth/Stage/Office segmented → widget stack, 12 gap, 20 radius, last widget clears the nav by 16.
**Widgets:** SPL (34/600 "84 dBA" + 10-bar level ramp in four accent tints, mono "WITHIN LIMIT" in `success`); ProPresenter (NOW/NEXT rows, mono row labels 42 wide, 1px divider, mono "SLIDE 12/31"); Giving today (£1,240, "18 taps · 4 discs") and MIDI/OSC (green dot "Rig armed") side by side; NDI cameras (four 16:10 tiles).
**Polish deltas vs today:** widget header becomes mono 10.5 +0.16em with its status value right-aligned on the same line; radius 20 and gap 12 throughout; bottom clearance above the nav.
**Assets:** camera tiles are diagonal-stripe placeholders (`repeating-linear-gradient(135deg,#1b2430 0 6px,#202b38 6px 12px)`) with a mono "CAM n" label — swap in real NDI stills.

### S11 — Booth offline
Centred mark at 88 white, 55% opacity → "Command Center offline" 25/600 → "Reconnecting — attempt 3. Your checklist below still works and syncs when the booth is back." → pulsing amber dot chip "LAST SYNC 9:04" → footer: 56 accent "Open cached checklist" + 56 outlined "Retry now". **Nav is hidden** — nothing else is reachable. Mirrors the desktop splash but always offers somewhere to go.

## Bottom navigation

Five tabs: Home / Chat / Checklist / Dashboards / More. Bar `panel-sunk` with a 1px top rule, 9 top padding, 22 bottom safe-area inset, items 70 wide, icon 22 in a 24 box, label 10.5/500. Active `#79a4f6`, inactive `#6d7f95`.
Icons are geometric, drawn in `currentColor`: Home = the ProDeck mark silhouette (three tiles); Chat = rounded rect + tail; Checklist = 18px rounded square outline with a 2px check; Dashboards = 2×2 tiles; More = three 2.1r dots.
**Badges appear on Chat only** (unread messages), positioned top-right of the icon with a 2px `panel-sunk` ring. Pages never badge — they take the screen. Checklist overdue shows an amber 10px dot, not a count. At 360 wide the labels still fit; below that, drop to icon-only.

## State

| State | Notes |
|---|---|
| `role` | `member` \| `admin` — gates S05b sends, S06, S09 |
| `session` | device PIN hash, `pendingApproval` flag → S02b banner |
| `serviceClock` | server-driven `T-n` and wall time; every mono time on screen derives from it |
| `checkedIn` | drives both the Home bar and item zero on S08 |
| `checklist[]` | `{ id, label, dueAt, tOffset, state: pending\|done\|overdue, note }` — overdue is computed from `serviceClock`, not stored |
| `channels[]` / `unread` | badge count, capped display at 9+ |
| `composeTarget` | `team` \| `stage` \| `confidence` — persists per thread |
| `page` | `{ id, body, recipients[], buzz, sentAt }` |
| `receipts[]` | `{ userId, readAt, elapsed }` — polled or pushed; drives S06b groups and the S05b counter |
| `connection` | `online` \| `reconnecting(attempt)` \| `offline` → S11, plus cached checklist reads |
| `installState` | platform + standalone detection → S01a/S01b/skip |

Offline: checklist and the current service plan must be readable from cache; check-ins and item ticks queue and sync on reconnect. Read receipts must **not** be optimistic — a confirm that didn't reach the booth must not show as read.

## Accessibility & reach

- Everything interactive ≥44; primary actions in the bottom third.
- The confirm target on S07a is the largest control in the app (335×268) and needs no aim.
- Support Dynamic Type / font scaling up to 120% without clipping: rows grow, they do not truncate labels.
- Status is never colour-only — every dot is paired with a word or a mono count.
- Respect `prefers-reduced-motion`: drop `pdPulse` to a static dot.

## Assets

Brand set in `brand/` — vector masters and PNG exports, all carrying the author credit:
`prodeck-mark-{color,white,dark}.svg` · `prodeck-mark-small-*.svg` (pixel-tuned, use below 24px) · `prodeck-wordmark-*.svg` · `prodeck-lockup-horizontal-*.svg` · `prodeck-lockup-stacked-*.svg` · `prodeck-icon-{1024,512,192}.png` · `prodeck-favicon-32.png`.
Icon PNGs are full-bleed squares on `#161d28` — let the OS apply the squircle mask; supply 512/192 in the web manifest. Wordmark SVGs carry live IBM Plex Sans SemiBold; outline before print. Credit line "BY ZACH GREEN" is part of the lockups and must not be detached or re-spaced. No other icon assets are needed — every glyph in the UI is geometry in `currentColor`.

## Files in this bundle

| File | What it is |
|---|---|
| `ProDeck Crew Mobile.dc.html` | all 11 screens, nav states, component sheet |
| `CrewNav.dc.html` | bottom-nav reference (props: `active`, `badge`) |
| `ProDeckMark.dc.html` | the mark; `variant="f"` is final, `variant="a5"` is the ≤24px pixel-tuned drawing |
| `ProDeck Logo Concepts.dc.html` | brand rationale, usage sheet, clearspace and minimum sizes |
| `support.js` | viewer runtime for the files above — **not** for porting |
| `brand/` | SVG masters + PNG exports |
| `screens/` | 2× PNG of every screen frame, named by screen ID |

Open any `.dc.html` directly in a browser. Screens carry `data-screen-label` (`S03`, `S05b`, …) — the same IDs used throughout this document.
