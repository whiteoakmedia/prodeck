# ProDeck UX Audit — Booth Desktop + Mobile Fix Backlog

**Date:** Aug 7, 2026 · **App version audited:** 0.3.1

**Status update (0.3.2, Aug 7 2026): implemented.** Everything below shipped in
0.3.2 except: D5 (dashboard tab naming/pruning — user content, rename via Edit →
Rename), D8 partial (URL now shortened + click-to-copy; tile hidden from member
phones), and M15 (roster-scope decision, still production-only). Notable
implementation choices: booth desktop is hard-silenced in `lib/sound.ts` (no
toggle can re-enable it); the silence alert only fires after signal was seen
this run; pending-approval screen self-polls with the in-memory PIN; role
channels come from a new member-safe `identity_roles` command; the health strip
(D17) replaced the PP-only pill in the sidebar footer; push notifications carry
a vibrate pattern on Android (iPhones buzz via the notification itself).

Lens for everything below: *a volunteer is running the booth alone on a Sunday.
They did not install the app, they don't know what dBFS means, and when
something goes wrong they need the screen itself to tell them what to do.*

Severity: **P0** = volunteer will get stuck or something audible/visible goes
wrong in service · **P1** = confusing enough to generate a text to Zach ·
**P2** = polish.

---

## Part 1 — Booth desktop findings

### Sounds on the booth Mac (user-reported, P0)

- **D1 · P0 — The booth Mac plays app audio through the house.** The booth Mac
  drives music; `chime()` + `buzz()` fire in `chatStore.tsx:125` on every
  incoming chat message, and `lib/sound.ts` has no desktop exclusion. **Policy
  fix, not a toggle:** the desktop build must never emit app audio. Gate every
  function in `lib/sound.ts` on `IS_WEB` (or a "this Mac feeds house audio"
  settings flag that defaults to silent). Phones keep their sounds.
- **D2 · P0 — The bell/mute toggle in the Messages drawer doesn't silence.**
  Reported by Zach. The toggle (`ChatDrawer.tsx:52`) writes
  `prodeck.chatSound` and the listener does check `soundRef` — so verify at
  fix time: most likely the bell **icon reads as state when it acts as a
  button** (🔔 shown = "sound is on, click to mute", but it looks like "this
  mutes are off"), or a second surface (dashboard widget/other window) plays
  independently. D1's hard-silence makes the booth immune regardless; also
  relabel the toggle with words ("Sound: on / off"), not just an icon.

### Dashboard

- **D3 · P0 — Red banner "No audio signal (below -80 dBFS)" with no action.**
  It's the first thing on screen, it's red, and it's *normal* whenever the
  band isn't playing. Volunteers will read it as "broken." Fix: demote to a
  quiet chip when idle; make the full-red state appear only during a service
  window or after audio *was* flowing and stopped; and always include the next
  step: "If you expect sound, check the interface cable, then Settings →
  Audio."
- **D4 · P0 — "Not connected to ProPresenter — [Connect]" button doesn't
  connect.** It navigates to the ProPresenter page. A volunteer expects the
  button to do the thing. Fix: attempt reconnect with the saved host first;
  navigate only if that fails, and say why ("Couldn't reach 172.16.0.68 —
  opening connection settings").
- **D5 · P1 — Seven dashboard tabs, some unnamed ("Dashboard 2/5").** Empty
  or duplicate dashboards read as broken pages. Prune, name them by job
  ("Sunday", "Stage", "Office kiosk"), and hide empty ones from the tab strip.
- **D6 · P1 — SPL widget "Cal" button is a loaded gun.** One tap re-baselines
  the meter mid-service and every phone shows skewed numbers. Needs a confirm
  dialog with a plain sentence, or move calibration to Settings.
- **D7 · P1 — Mixed units: "50 dB SPL … −100 dBFS · pk 64".** Volunteers know
  one number: "how loud is the room." Show the calibrated SPL big, a status
  word ("quiet / good / loud"), and bury dBFS behind a details view.
- **D8 · P2 — TapLink widget shows raw URLs on the home dashboard.** Show the
  keyword + friendly name; the URL belongs in a copy button.

### ProPresenter page

- **D9 · P1 — Web admin sees raw `Error: 'pp_connect' is not available from a
  browser client`.** Internal error string leaking. Replace with: "ProPresenter
  can only be connected from the booth Mac itself. This browser view is
  read-only."
- **D10 · P1 — Connect flow leads with host/port fields.** Make **Scan** the
  hero button ("Find ProPresenter on this network"), auto-fill on find, and
  tuck manual host/port under "Advanced". Keep the Preferences → Network hint
  next to Scan, not below the fold.

### Captions page

- **D11 · P1 — One dense jargon paragraph gates the whole feature.** "whisper
  engine", "Gemini API key", "sensitivity 30% — lower = jumps more eagerly."
  This is genuinely an advanced feature: badge the page "Advanced — set up
  once by an admin", split setup (engine/key, admin-only) from run controls
  (Start/Stop, sensitivity slider with live preview of what it does), and
  rewrite the slider label: "How eagerly captions jump to the next line."

### Checklists page

- **D12 · P2 — "↻ Sun, Aug 9, 6:00 AM" is unexplained.** It's the auto-reset
  schedule. Label it: "Resets automatically Sun 6:00 AM."

### Analytics page

- **D13 · P1 — Service picker is a long flat list with five "Unlabelled
  service" rows.** Group by month, collapse or auto-hide unlabelled runs
  (they're mostly rehearsal noise), and allow rename/delete inline. The report
  itself (variance, peak SPL, tap counts, Copy summary/Print) is strong — the
  problem is only finding the right service.

### Multiview page

- **D14 · P2 — "NDI" unexplained.** One sentence fixes it: "Camera and
  ProPresenter feeds shared over the network appear here."

### Settings page

- **D15 · P1 — Eleven sections in one flat scroll.** Software Update,
  ProPresenter, Audio & Captions, Gemini, Control Inputs, Song Key, TapLink,
  Crew Members, LAN Relay, Alerts, Appearance — no nav, no grouping, admin
  and volunteer content interleaved. Add a section sidebar (anchors are
  enough), and group: **Connections** (PP, LAN Relay) / **Audio** / **Crew**
  / **Advanced** (Gemini, Control Inputs, Song Key, TapLink).
- **D16 · P0 — Crew approvals are buried.** A new volunteer registers on their
  phone and waits on the pending screen; the booth shows nothing unless
  someone opens Settings → Crew Members. Fix: a nav badge + dashboard toast —
  "1 person waiting to join — Approve" — that deep-links to the approval row.
  (Pairs with the mobile pending-screen findings, M2/M3.)

### Cross-cutting: the troubleshooting story

- **D17 · P1 — Headline recommendation: a system-status strip.** One row,
  always visible (dashboard header or nav footer), traffic lights for
  **ProPresenter · Audio · Planning Center · Internet**. Each light expands to
  a plain-language card: what this is, what "red" means, the one thing to try,
  and "call Zach if this doesn't fix it." This one feature covers 90% of
  "volunteer needs to troubleshoot" — every existing red banner then demotes
  to a light on this strip instead of shouting from the top of the page.

---

## Part 2 — Planning Center redesign proposal

### What's wrong today

The page is five cards in a strict 3-column grid — Show Flow, Team, Mic
Assignments, Mic Positions, Check-in times — and it mixes three different
jobs:

1. **Running the service live** (Show Flow, transport, slide links)
2. **Knowing who's here** (Team confirm status, check-in times — "who's on
   first" lives half here, half on phones)
3. **Set-and-forget configuration** (Mic Positions/template, mic count,
   check-in call times, plan picker, sync)

The live transport (Take Control / Auto / Follow Pro / ◀ ▶) is crammed into
the Show Flow card header in jargon; the mic system's semantics (dimmed = from
template, red = conflict) live in a hint line under the grid; and the Team
card shows PCO confirm status but *not* actual arrival — so "who's actually
here" isn't answered anywhere on this page.

### Proposed layout: Show Flow main + dedicated sidebar

```
┌────────────────────────────────────┬──────────────────┐
│  SHOW FLOW  (2/3 width, full       │  SIDEBAR (1/3)   │
│  height, big rows, LIVE highlight) │  [People] [Mics] │
│                                    │  [Setup]         │
│  ── transport bar (fixed) ──       │                  │
│  ◀ Prev   NEXT ▶ (big)             │  panel content   │
│  ⚡ Auto-fire slides   ⟳ Follow PP  │                  │
└────────────────────────────────────┴──────────────────┘
```

**Main column — Show Flow** is the only live thing, so it gets the space.
Transport moves out of the card head into a fixed bar: a big **NEXT**, a small
Prev, and two labeled toggles. "Take Control" appears *in* the bar only when
control is not held, phrased as the gate it is: **"Take control of PCO Live —
needed before Next/Prev works."** (PCO ignores next/prev when nobody holds the
controller; today a volunteer clicks ▶, nothing happens, and there's no clue.)

**Sidebar — three tabs:**

- **People** — the "who's on first" board, merged from today's Team card +
  check-in data the page never shows: avatar, position, PCO confirm status,
  expected arrival (manual call time or PCO), and live checked-in state
  ("Expected 8:45 · here 8:41 ✓" / "Expected 8:45 · not here" in red as the
  time passes). This is the single place the booth answers "where's my camera
  op?"
- **Mics** — today's Mic Assignments grid, kept. The **Mic Positions**
  card (eligibility checkboxes + default-mic template) is set-and-forget
  config: move it behind a gear ("Set up mic positions…") inside this tab.
  Promote the hint-line semantics into the UI: template picks get a "default"
  tag, conflicts get a visible "Mic 6 is on two people" warning row.
- **Setup** — plan/service-type pickers, Sync/Refresh, and the **Call times**
  editor (today's Check-in times card). All the things you touch on Tuesday,
  not during the service.

**Jargon renames:** "Follow Pro" → "Follow ProPresenter"; "Auto" →
"Auto-fire slides"; "link" → "Link slide…"; the ⋯ / × icon pair on linked
items → an explicit small menu ("Change slide / Unlink / Stop auto-linking").
The "auto" chip keeps its tooltip but gains a legend entry in the picker.

**What stays:** the link-picker search, auto-detect by name, SongKeyLeader
chips, per-item lengths, header rows. This is a re-arrangement, not a rebuild —
the stores (`pcoStore`) already expose everything the sidebar needs
(`arrivalFor`, `checkinTimes`, `micFor`, `micTemplate`).

---

## Part 3 — Mobile fix backlog (carried over from the phone audit, deferred)

- **M1 · P0 — Role channels invisible to members.** `CrewChannels.tsx` derives
  channels from `identityList` (admin-only) — members never see their role
  channel. Needs a member-safe roles endpoint.
- **M2 · P0 — Pending-approval screen promises a notification that never
  comes**, and doesn't auto-poll; volunteer stays stuck after approval until a
  manual refresh.
- **M3 · P1 — Pending screen tells the *volunteer* what the *admin* must do.**
  Reword to "You're all set — waiting for the booth to approve you."
- **M4 · P1 — Onboarding says "Tap Install below" but the button isn't below**;
  duplicate skip actions on the same screen.
- **M5 · P1 — Push card says "blocked" when permission was never asked.**
- **M6 · P1 — "Team checklist 0 of 0" and a 0/0 Home card** — hide empty
  checklist surfaces instead of showing contradictions.
- **M7 · P1 — Live strip shows "— dB" when idle** — show "quiet" state word.
- **M8 · P1 — WebGate copy "view & control the booth"** overstates what a
  member can do; members are mostly read-only.
- **M9 · P1 — Member More-tab shows admin-password text.**
- **M10 · P2 — Confirm-PIN field sits below the fold** on small phones.
- **M11 · P2 — No identity confirmation after join** — add "Hi Zachary ·
  Camera Team" to Home.
- **M12 · P2 — TapLink tile jargon on volunteer Home** — hide for members.
- **M13 · P2 — Battery-saver copy is a double negative.**
- **M14 · P2 — Channel explainer paragraph too long** — one sentence.
- **M15 · Decision needed — roster scope:** production teams only vs all PCO
  teams (currently production-only via `productionRoster()`).

---

## Part 4 — Suggested build order

1. **P0 batch (small, ship first):** D1+D2 booth hard-silence + bell fix ·
   D3 idle-audio banner · D4 Connect-button behavior · D16 approval badge ·
   M1 role channels · M2 pending-screen poll.
2. **Planning Center redesign (Part 2)** — the big one; pure frontend
   re-layout over existing stores.
3. **P1 batch:** Settings sidebar/grouping · Analytics picker cleanup ·
   PP scan-first connect · captions split · status strip (D17 — could also
   lead the P1 batch if Sundays keep generating "is it broken?" texts).
4. **P2 polish sweep:** remaining D's and M's in one pass.
