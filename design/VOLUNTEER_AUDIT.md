# Volunteer experience audit (2026-11-02)

Four code reviews (getting in, pages and notifications, daily use, today's new
features) plus a hands-on pass through the phone screens in the demo at 375 and
320 px. Every P0 below was checked against the code. Nothing here is fixed yet
unless it says **Fixed**.

**Native app** marks problems the ProDeck Crew app (design/CREW_APP.md) removes
by design: there's no Home Screen copy, no Safari storage split, and push and
the microphone are native.

## P0: a volunteer is stuck, or a page or message is lost

1. **Fixed (49f507a).** Header smuggling at the secure address's https front let
   anyone on the church network skip the password throttle.
2. **A phone can get stuck on "Command Center offline" after the booth comes
   back.** When phones reach the booth through the tunnel, a restart makes the
   edge answer `/api/events` with a 503. A non-200 answer closes an EventSource
   for good, and nothing reconnects it. The only way out is force-quitting the
   app. Also blocks a volunteer waiting for approval.
   - Where: `src/lib/tauri.ts:131-146`.
   - Fix: in `onerror`, when the state is CLOSED, call `reconnectSse()` with
     backoff, and again on visibilitychange. Add S11's "Retry now" button.
3. **Chat loses messages.**
   - Messages sent while a phone slept never appear, because history is fetched
     once at mount.
   - After a booth restart, message ids start again at 1. The phone drops every
     new message as a duplicate, but the badge and chime still go off.
   - Where: `src/chatStore.tsx:117-131`, `src-tauri/src/chat.rs:65`.
   - Fix: refetch on every SSE open, and use epoch-based ids.
4. **Pages missed while the app was backgrounded never show.**
   - `page_list` is fetched once at mount, and `page:new` isn't replayed. Same
     cause: a lock-screen confirm can leave the takeover ringing.
   - Where: `src/pagesStore.tsx:60`.
   - Fix: refetch on SSE open and on visibilitychange.
5. **Page ids restart at 1 when the booth restarts.** An old "Got it" then
   confirms a different, newer page.
   - Where: `src-tauri/src/pages.rs:82`.
   - Fix: seed ids from the clock.
6. **Push allows one subscription per person.**
   - A second device silently replaces the first, though both say "on".
     Turning push off on one kills it everywhere.
   - The phone never re-sends its subscription, so "on" can be false:
     - after a failed register;
     - after the VAPID key is re-minted;
     - after someone else signs in on the same phone. Lock and sign-out don't
       unsubscribe.
   - Where: `src-tauri/src/push.rs:202,216`; `src/lib/pushClient.ts`.
   - Fix: key subscriptions by endpoint, re-register at every start, and
     unsubscribe on sign-out. **Native app.**
7. **Someone with only the "page" permission can't send a page.** The composer
   builds recipients from `identity_list`, which needs "manage", so it shows
   "Send page to 0".
   - Where: `src/mobile/CrewPages.tsx:203`.
   - Fix: add a roster read gated on "page".
8. **Opening an old invite or crew link wipes a working sign-in.**
   - `?join=` and `?invite=` overwrite a valid token unchecked. The volunteer
     then sees a password box they were never given.
   - Where: `src/lib/tauri.ts:57`.
   - Fix: keep an existing token unless the new one proves valid.
9. **Rotating the crew link signs out every phone that joined by link.**
   iPhone Home Screen copies can't recover: the old `hs` token comes back on
   every cold launch. The Rotate button doesn't warn about this.
   - Where: `Settings.tsx:2647`; `tauri.ts`.
   - Fix: warn about this in the Rotate UI, or give each device its own credential.
     **Native app.**
10. **"Sign in with your PIN instead" has no PIN field.** An existing crew member
    without a token who scans the poster while joining is closed has no way in.
    - Where: `identity.rs:948`; `PosterJoin.tsx`.
    - Fix: verify the PIN, then let the booth approve a sign-in ticket.

## P1: wrong or confusing, gets through with friction

### Getting in

- A second device, the Home Screen copy or the secure address opens as a
  stranger: "Join the crew" and "Pick a PIN".
  - A new PIN there gives "Error: wrong PIN".
  - Tapping your Planning Center spelling creates a duplicate pending account.
    The duplicate check misses `pco_name` and `nickname`.
- Picking a name someone else holds runs a login with your new PIN. That burns
  the other person's lockout and shows "Error: wrong PIN".
- An expired or used personal invite shows "Session expired".
- On iPhone, the Home Screen copy can carry a used invite (onboarding comes
  before the claim).
- **Unverified on a device:** whether Safari reads the manifest link that's
  swapped in at runtime, and honours a query in `start_url`. Test on iOS 17
  and 18.
- With the booth off, `/app.webmanifest` at the edge gets `index.html`. The
  asset regex allows extensions of 8 characters at most.
- **iPads are detected as Macs:**
  - they get Android install steps;
  - no push step is shown;
  - after a poster join they open in the full layout.
  - Fix: treat `Macintosh` plus `maxTouchPoints > 1` as iOS, in all three
    copies. **Native app.**
- The password gate:
  - calls a 429, a 503 or a network error "Wrong password.";
  - keeps an unvalidated token;
  - has no "Ask to join" path;
  - uses admin words ("member password").
- With the booth off, the poster lands on the password gate. An edge join looks
  signed in, then gets wiped on the next launch.
- Poster sign-ups behind the church's one public address share a single
  throttle bucket. Eight typos lock out the whole Wi-Fi.
- The pending screen never shows a rejection, and isn't remembered across a
  reopen.
- The PIN is entered once. "Confirm PIN" just submits it, so a typo becomes
  the PIN.
- "Sign out completely" has no warning. On the Home Screen copy it comes back
  signed in.
- "Ask the booth to reset you" promises a reset that doesn't exist.

### Pages and notifications

- Stale pages ring hours or days later. The 50-page ring keeps everything, and
  the header has no date.
- The sender is paged by their own broadcast.
- **A tally phone still vibrates:**
  - from push notifications (`public/sw.js`);
  - when its camera goes live (`Tally.tsx:107` calls `navigator.vibrate`
    directly).
- On iPhone, the lock-screen "Got it" doesn't exist: WebKit ignores
  notification actions. **Unverified:** whether a re-buzz with the same tag
  alerts again. **Native app.**
- Tapping a page notification reloads the open app, which drops a comms call.
  Fix: `c.focus()` when a client exists.
- The fatal-error regex looks for "not a recipient", but the booth says "wasn't
  sent to you". The siren rings forever with no Dismiss.
- A dismissed page comes back on the next re-buzz.
- **The sender's own page record can vanish from Chat, and their own messages
  can show as someone else's.** Both compare names (`from === chat.name`), and
  the phone's name changes to the Planning Center spelling after the weekly
  heal. Fix: compare by crew id.
- Focus and Do Not Disturb silence web push. Nothing says so, and "Pages will
  buzz this phone" overpromises.

### Daily use

- TV screen messages leave a chat badge that never clears.
- The badge total counts other roles' channels.
- **Offline checklist ticks are sent as flips:**
  - tick then untick collapses to one flip;
  - two people undo each other;
  - server rejections are queued forever.
  - Fix: send the desired state.
- The cached-checklist check-in doesn't queue when the booth is off (the regex
  misses "booth offline").
- The check-in bar isn't pinned, so it can be screens below "My set".
- Second-service crew see the first service's countdown and call time unless
  the booth's auto-advance is on.
- Song audio fails silently. `play()` runs after an await, so iOS may refuse it,
  and errors are never shown.
- Listen stops on a Wi-Fi stall, and the chip just vanishes.
- iPhone zooms in when you tap the chat box (`.crew-field` is under 16 px).
- **"Full view" is offered to member iPads.** It leads to admin pages that fail
  with "needs admin access".
- "Crew view" on an admin iPad with no crew account is a dead end: there's no
  way back.
- The leader board's Nudge isn't gated on "page".
- "Ask the booth to assign your position" can't work, because roles are
  rewritten from Planning Center every week.
- Stage and Confidence sends from a role channel vanish from that thread.
- **Permission errors show raw command names**, for example `'atem_cut' needs
  the "control" permission — ask whoever runs the booth`. Map them to plain
  sentences.

### Comms, tally, the secure address

- **Open mic, or a lost hold, comes back live after the phone sleeps.** Fix:
  `talk(false)` on hide or pagehide.
- **"Lock (PIN again)" leaves comms running behind the PIN screen.** Fix: leave
  comms when the session goes.
- Two tabs on one phone share one comms entry.
- Listeners miss the first word, because talk state goes through the booth.
  Fix: a data channel.
- A Wi-Fi blip on a call older than 12 s tears it down and blames cellular. Fix:
  time out only calls that never connected.
- Comms on the plain http address explains the problem but gives no address
  and no button.
- **Kiosk and tally codes lose the plain-IP fallback once a secure name
  exists.** A tally behind a rebinding filter goes blank. Tally doesn't need
  https.
- **Fixed (49f507a).** Saving Settings undid the secure address's network
  choice.
- Camera previews (MJPEG over http) break as mixed content on the secure
  address.
- Phones don't see the Comms switch change until they reload.
- Phones installed on the old http address get no guidance after a secure name
  is claimed (new origin, new sign-in, new icon).

## P2: polish

- **Copy.** About 40 volunteer-facing strings use em or en dashes:
  - the phone screens (Home, Chat, Checklist, Dashboards, More, Offline,
    Leader, Join, Chart sheet);
  - `listen.ts`;
  - `sw.js`;
  - booth errors that reach phones (`identity.rs`, `web.rs`, `pages.rs`).

  Also:
  - `String(e)` shows "Error: …" prefixes;
  - "1 songs";
  - the tab is called "Dashboards" but the screen says "Dashboard".
- **Small phones (320 px):**
  - the "My next duty" text is so large that **Done** is off-screen;
  - one Unread tile sits at half width;
  - the live strip and the countdown are tight.
- iPad crew layout: sheets, the composer, the takeover and the track bar still
  stretch edge to edge.
- More puts Page notifications below three optional cards. The member hint
  ignores per-person grants. "Signed in as —".
- **Pages:**
  - "Booth" is shown even when a volunteer sent the page;
  - "buzzing until you confirm" stays up after push has stopped;
  - with two pages queued, only the oldest shows, with no "1 more";
  - read tracking doesn't flag who has notifications off;
  - unticked "not here" people are still paged;
  - the confirm dialog backdrop covers the takeover.
- **Pending screen:**
  - the "Requested 9:41" time is never fresh;
  - the help line gives the volunteer the admin's steps.
- **Onboarding:** Android onboarding after Install looks like it failed. The
  Safari tab after "I've added it" resets on reload.
- **Charts and setlist:**
  - chart sheet titles aren't sticky;
  - the chart error tells volunteers to edit Planning Center;
  - the channel badge is white-on-accent, against the spec.
- **Location and offline:**
  - the location prompt appears with no explanation;
  - the offline screen has dead ends (Open checklist when signed out; no
    retry for the plan).
- **Comms:**
  - stuck "talking" banners;
  - signals relayed to every screen;
  - leaving while joining leaves a fake "on";
  - the tally tap menu hides Talk and Mute;
  - a station can name itself anything;
  - no headset hint on the tally;
  - after giving the address back, the booth keeps the old https name in links
    until restart.
- **Unverified on device:** iOS audio session with a held mic (orange
  indicator, AirPods in call mode).

## Old M items (design/UX_AUDIT.md Part 3)

| Item | Status |
|---|---|
| M1 | Fixed. Role channels use `identity_roles`. Off-week volunteers have no role channel. |
| M2 | Mostly fixed. Pending polls every 8 s. Rejection and reopen are still open. |
| M3 | Partly fixed. The title still has a dash, and the help line gives the admin's steps. |
| M4 | Fixed. The iPad regression is separate. |
| M5 | Fixed. There's a first-render "off" flash. |
| M6 | Partly fixed. The Checklist tab still says "0 of 0". |
| M7 | Fixed on Home. Dashboards still shows "— dB". |
| M8 | Fixed. The password copy is still jargon. |
| M9 | Fixed. |
| M10 | Mitigated. There's still no real confirm-PIN step. |
| M11 | Fixed. |
| M12 | Fixed. |
| M13 | Fixed. |
| M14 | Fixed in length. It uses a dash, and the first hint is inaccurate. |
| M15 | Decided: everyone on the plan, production first. |
