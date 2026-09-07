# Changelog

What changed in each release of ProDeck, in plain language.

**Installing:** download `ProDeck.dmg` from the
[latest release](https://github.com/whiteoakmedia/prodeck/releases/latest),
open it, drag ProDeck to Applications. On first open, macOS blocks it once:
double-click ProDeck, then go to **System Settings → Privacy & Security**,
scroll to the bottom, and click **Open Anyway**. You only do that once.

**Updating:** from 0.9.67 onward ProDeck updates itself. It checks a few
seconds after launch and shows a banner with the release notes and an
**Install & Restart** button.

> **If you downloaded ProDeck before 6 September 2026, please download it
> again.** Those early copies could not open on some Macs, and one build
> crashed on launch on any Mac without developer tools installed. They also
> predate the built-in updater, so they cannot fix themselves. Any copy from
> 0.9.67 onward keeps itself current.

ProDeck is free, open source, and has no account or licence check. Version
numbers below are the ones shown in **Settings → Software Update**.

---

## Unreleased

Built and committed, but **not published** — no installed copy has been offered
these yet.

- **OBS Studio** — scene, whether you're streaming and recording, how long for,
  and dropped frames, on a dashboard widget and in Settings. Answers "are we
  actually live?", which ProDeck couldn't before.
- **Behringer X32 / Midas M32** — mirrored the same way as the Allen & Heath
  desks: mutes, faders, scenes and channel names on every dashboard, and the
  desk watchdog works with it. *Not yet tried against real X32 hardware.*
- **Fixed — the update banner.** A failed install rendered nothing at all, so it
  looked like the button did nothing and then reappeared at the next launch. It
  now says what went wrong and offers a manual download. "Later" also means
  later, rather than until you relaunch.
- **Fixed — Planning Center 401.** "PCO 401 Unauthorized:" now explains the
  usual cause (an OAuth application's Client ID/Secret pasted where a Personal
  Access Token belongs). Credentials are also trimmed wherever they come from,
  and entering them from a phone or laptop no longer silently discards the
  secret.
- **Fixed — no settings for the NDI feed.** There is now a Stage feed (NDI) card
  that lists what NDI can see and points at where the source is chosen.
- **Fixed — Settings could silently discard a change** when one control set two
  values at once (choosing a console model saved the port and reverted the
  model).
- **Windows groundwork.** The macOS-only pieces are now behind platform gates
  and Windows implementations are written, but **nothing has been compiled or
  run on Windows** — see the note in `src-tauri/src/keepalive.rs`. Not usable
  yet.

---

## 0.9.71 — 6 September 2026

### Crew pages now buzz hard enough to feel

- The vibration on an incoming page is **much longer and heavier**, and it
  escalates the longer the page goes unconfirmed — from three solid hits, to a
  sharp stutter into heavy pulses, to near-continuous buzzing. Confirming stops
  it instantly.
- The same treatment for notifications on a **locked phone**, which is how most
  pages actually arrive.
- **Fixed:** the buzz pattern was being restarted before it finished, so the
  long closing pulse — the part you feel through a pocket — was cut short every
  time and had never played in full.
- **iPhone:** Safari has no vibration control at all, so the notification is the
  only buzz an iPhone can give. Repeat reminders are now front-loaded — three in
  the first 30 seconds instead of one — still stopping the moment someone
  confirms, and still capped at two minutes.
- Team chat still gets a single light tap, so a page and a message never feel
  the same.

---

## 0.9.70 — 6 September 2026

### Try it without connecting anything

- **Demo mode** fills every dashboard with a sample Sunday — a plan, the team
  with check-ins, a live slide, sound levels, a mirrored console — so you can
  see what ProDeck does before wiring up your booth. It saves nothing and exits
  with one click. Start it from the welcome screen or **Settings → Help**.

### ProDeck keeps itself running

- **Settings → Reliability** turns on a watchdog that relaunches ProDeck within
  seconds of a crash and starts it at login, plus a sleep guard so the booth Mac
  never dozes off mid-service. *If you installed from the DMG you did not have
  this before — turning it on is the single most valuable thing you can do for a
  booth machine.*

### Getting help without needing the author

- A **?** on every settings card opens the matching part of the guide, built
  into the app so it works offline.
- **Report a problem** opens a pre-filled GitHub issue and puts diagnostics on
  your clipboard, with every password and key removed first.
- **Backup & restore**: one file holds your settings, dashboards, crew,
  checklists and reports. Moving to a new Mac is a copy and a click.
- **Kiosk screens**: pick a dashboard and get the link, a QR code, and setup
  steps for a Mac, Windows PC, or iPad.

### Fewer dead ends

- Widgets with nothing connected now **say what to connect and take you there**,
  instead of showing dashes.
- New installs can add **five ready-made volunteer checklists** (booth startup,
  audio, ProPresenter, camera, shutdown).
- **Fixed:** a display error used to leave a black screen. It now shows what
  happened, with a Reload button and copyable details.

---

## 0.9.69 — 6 September 2026

### A first-run setup that does the work

Every step now connects something for real and shows you it worked, instead of
telling you where to click later:

- **ProPresenter** — found on your network, with a live "connected" indicator.
- **Planning Center** — credentials verified before you move on (a wrong secret
  is refused rather than waved through).
- **Phones & kiosks** — the browser gateway is actually started, not just saved.
- **Sound console** — pick Avantis, dLive or SQ and watch it connect.
- **Your team** — a permanent join QR code your crew can scan right there; print
  it for the booth wall.
- **Dashboards** — one click creates starter layouts, pre-selected based on what
  you connected.
- **Progress is saved.** Close ProDeck mid-setup and it picks up where you left
  off. Every step is skippable, and the last screen shows exactly what is
  connected and where to fix anything that isn't.

---

## 0.9.68 — 6 September 2026

### More sound consoles

- **Allen & Heath dLive** and **SQ-5 / SQ-6 / SQ-7** now work alongside Avantis.
  Choose yours in **Settings → Allen & Heath Console**.
- dLive gets its full channel map (128 inputs, 24 DCAs, 6 mains, UFX), and the
  mirror reads current mutes and fader levels the moment it connects.
- SQ mirrors mutes, levels and scenes. SQ's MIDI protocol carries no channel
  names, so channels appear as numbers — that is a limit of the desk, not
  ProDeck.
- **Fixed:** the desk watchdog's periodic name re-check could briefly stall the
  console mirror.

> Built from Allen & Heath's published protocol documents and covered by tests,
> but **not yet exercised against real dLive or SQ hardware** — the only console
> on hand is an Avantis. If you run one, a report either way is welcome.

---

## 0.9.67 — 6 September 2026

### ProDeck can now update itself

- Installed copies check for updates at launch and offer them in one click, with
  the release notes shown on the main screen. **This is the first version that
  can update itself** — earlier downloads have to be replaced by hand once.

### Crew names and Planning Center links

- **Settings → Crew Members → Edit**: fix a name typo without breaking someone's
  PIN, add a nickname (which also works as their sign-in name), and choose
  exactly which Planning Center person an account belongs to. A link you set by
  hand is pinned — the weekly automatic matching will never overwrite it.

---

## 0.9.66 — 4 September 2026 · first public release

The booth system Cornerstone Church runs every Sunday, opened up for other
churches: ProPresenter and Planning Center in one place, live dashboards on
phones and kiosks, crew paging and check-in, sound-console mirroring, SPL
metering, NFC giving links, service reports.

**Two fixes were applied to this release's download after it went out.** If your
copy is from 4–5 September, replace it:

- The download **would not open on other Macs** — it was signed with a
  certificate that only existed on the author's machine, which macOS rejects
  outright.
- The app **crashed immediately on launch** on any Mac without Homebrew's
  OpenSSL installed. It is now fully self-contained.
- It is also now a **universal build** — Intel Macs as well as Apple Silicon,
  macOS 10.15 or newer.

---

## Notes

- **Dates** are when each version was published. 0.9.67 through 0.9.71 all
  landed on 6 September 2026; that was one long day of work following the first
  round of real installs.
- **Reporting problems:** Settings → Help → *Report a problem*, or
  [open an issue](https://github.com/whiteoakmedia/prodeck/issues). Diagnostics
  are redacted before they leave your machine.
- **Reading further:** the
  [Adopter's Guide](https://whiteoakmedia.github.io/prodeck/ADOPTERS_GUIDE.html)
  covers what ProDeck assumes about your setup, what it can't do, and a phased
  path from "try it on a spare Mac" to a permanent booth install.
