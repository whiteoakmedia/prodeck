# Changelog

What changed in each release of ProDeck, in plain language.

**Where to get it:** <https://whiteoakmedia.io/tools>. That page always points at
the current build. Download `ProDeck.dmg`, open it, drag ProDeck to Applications.

**First open only** (macOS Sequoia/Tahoe): double-click ProDeck → it won't open
yet → **System Settings → Privacy & Security** → scroll to the bottom → **Open
Anyway** → confirm. Once only. (The old right-click → Open trick was removed by
Apple in macOS Sequoia.)

**Updating:** ProDeck checks a few seconds after launch and shows a banner with
the release notes and an **Install & Restart** button.

> ### If updates aren't working, download it again
>
> Grab a fresh copy from **<https://whiteoakmedia.io/tools>** and drag it over
> your existing ProDeck. Your settings, dashboards, crew and reports all live
> outside the app and are untouched by replacing it.
>
> This matters because **a copy is only as good as the update settings it was
> built with.** Anything downloaded before **6 September 2026** was built
> pointing at a placeholder update feed, so it can never see a new version and
> can never fix itself — no matter how many times you press Check for updates.
> A fresh download is wired to the real update server and will keep itself
> current from then on.
>
> Copies from that date onward are already wired up correctly; re-downloading
> is still the fastest way to rule the app out if an update fails for any other
> reason.

ProDeck is free, open source, and has no account or licence check. Version
numbers below are the ones shown in **Settings → Software Update**.

---

## 0.9.73 — 9 September 2026

Everything here except the new widget came from someone else running ProDeck
and telling me what didn't work. Two of the bugs were mine, introduced in
0.9.72 while fixing other things.

### Fixed — adding widgets didn't work

Reported exactly that way, and it turned out to be two unrelated faults with
the same symptom. Both were silent, which is why it looked like the button
simply did nothing.

- **From a phone, a kiosk, or any browser, every dashboard edit was thrown
  away.** The page didn't save, and the gateway refused the save on top of
  that. You could add a widget, watch it appear, and find it gone on the next
  load with no error anywhere. Dashboards can now be edited from any browser
  signed in with the admin password, and a save that fails says so.
- **On the booth computer the widget was added — a thousand pixels below what
  you were looking at.** New widgets go to the bottom of the layout, the
  picker closed, and nothing appeared to change. ProDeck now scrolls to the
  new widget and outlines it for a couple of seconds.

### New — Stage Message widget

Asked for by name, for child alerts. Putting a line on the stage displays used
to mean standing at the booth computer with ProPresenter's own window open —
no use at all to the person in kids ministry who actually knows about the
alert. Now it's a widget, so it works from a phone.

It shows what's on the stage displays right now, sends either free text or one
of four quick buttons you can edit, and clears.

A stage message stays up until something takes it down, which is the wrong
default for an alert — one left up all service is worse than one never sent. So
there's an optional auto-clear (30, 60 or 120 seconds) with a countdown you can
see and a **Keep up** button. It counts down only while a dashboard showing the
widget is open, and the widget says so rather than letting you assume.

### Fixed — two things 0.9.72 broke

- **An X32 or M32 showed as disconnected all service.** The older Allen & Heath
  mirror was switching the connection light off every three seconds even when
  it wasn't the one driving the desk. The desk itself was fine the whole time.
- **"Take control" in Planning Center reported an error when nothing was
  wrong**, and once a live item was tracked it never let go. Rewriting the
  Planning Center error messages in 0.9.72 to be readable broke three places
  that were quietly reading those messages to recognise a normal, expected
  answer. They no longer depend on wording.

### Fixed — widgets that were connected but looked broken

- **On a fresh install every ProPresenter widget said "offline —
  reconnecting…" with no way to set anything up.** The check for "has this been
  configured?" tested a field that is never empty, so the helpful branch could
  never run.
- **The OBS tile froze on phones and kiosks**, showing whatever it read when
  the page opened and never updating. Same for the sound desk tile, which
  reported the console unreachable on every browser while the booth mirrored it
  perfectly. A TapLink failure was invisible on any screen but the booth's.
- **Two of the starter dashboards placed a widget that doesn't exist**, leaving
  a blank tile you couldn't delete. They now use the sound desk widget they
  were describing, and any unrecognised widget can be removed.

### Fixed — TapLink keyword with a space

`tap: give` — the form written in the README and the Adopter's Guide — parsed
to nothing, because the keyword ended at the space. The disc silently kept
pointing wherever it already pointed. Both `tap: give` and `tap:give` work now.

### Also

- The OBS WebSocket password was the one saved credential that browsers were
  given in the clear. It's now hidden like every other secret.
- Choosing an X32 let you set a port that was saved and then ignored.
- The Adopter's Guide still described the console mirror as Avantis-only and
  never mentioned OBS, X32/M32, dLive or SQ. It also sent people to a Planning
  Center settings card that doesn't exist — the credentials are on the Planning
  Center page.

### Under the hood

- **Windows.** The Windows-only code has now been read against the actual
  Windows APIs and a dozen things that would have compiled and then misbehaved
  are fixed — the sleep guard was decorative, help links did nothing, printing
  a report was impossible, and every background command flashed a black console
  window. An installer is now built automatically on a Windows machine. **This
  still does not mean ProDeck runs on Windows** — no one has yet launched it
  there. It is closer, not done.

---

## 0.9.72 — 8 September 2026

The first release driven by reports from someone other than me running it. Three
bugs from that install are fixed here, plus two new consoles' worth of hardware
support.

### Fixed — updates that looked like they did nothing

Reported as *"the update feature doesn't work and/or doesn't disappear."* Both
halves turned out to be one cause: the banner drew the "available" and
"downloading" states but had **no error state at all**. So when an install
failed, the banner simply vanished — indistinguishable from the button doing
nothing — and the automatic check at the next launch put it straight back, which
looked like it wouldn't go away.

- A failed update now says **what went wrong**, with **Try again** and
  **Download it manually** (which can't fail).
- **Later** now means later: dismissing remembers that version instead of
  re-announcing it at every launch. A newer version still gets to interrupt, and
  pressing *Check for updates* yourself always reports.
- If updates keep failing, re-download from
  <https://whiteoakmedia.io/tools> — see the note at the top.

### Fixed — Planning Center connected but nothing loaded

Reported as credentials being accepted while the plan list stayed empty, with
`PCO 401 Unauthorized:` on screen — true, and useless.

- That message now **names the actual cause**. Planning Center's developer site
  offers OAuth *applications* (Client ID + Secret) right next to *Personal
  Access Tokens*, and they look nearly identical — but only a Personal Access
  Token works here. It also covers swapped fields and pasted whitespace, and
  gives distinct wording for 403 / 404 / rate limits / Planning Center outages.
- **Credentials are now trimmed wherever they come from.** They can arrive from
  a restored backup, a hand-edited file, or the browser — paths that never saw
  the entry form's trim — and an invisible trailing space is sent verbatim and
  rejected.
- **Entering them from a phone or laptop used to silently fail.** The gateway
  protects stored secrets by refusing to overwrite them from a browser, but it
  did that even when you had deliberately typed a new one: the Application ID
  saved and the Secret was thrown away, leaving a permanent 401 with no clue.
  Typed secrets now go through.

### Fixed — no settings for the NDI feed

Reported as *"I don't see the settings to add the NDI feed"* — correct, there
were none. The source is chosen inside the Stage Feed widget, which you can only
find if you already knew. **Settings → Stage feed (NDI)** now lists every NDI
source on your network (which also proves NDI is working), explains why the list
is empty when it is, and points at exactly where the choice is made.

### New — OBS Studio

Answers the question a booth asks all morning and ProDeck previously couldn't:
**are we actually live?**

- Current scene, whether you're **streaming** and **recording**, how long each
  has been running, and **dropped frames** — as a dashboard widget and in
  Settings.
- Turn on **Tools → WebSocket Server Settings** in OBS, then put the port and
  password into **Settings → OBS Studio**.
- When OBS can't reach your streaming service at all, that's shown as its own
  state rather than a healthy-looking zero.

### New — Behringer X32 and Midas M32

Probably more churches run an X32 than any other digital desk. It now mirrors
alongside the Allen & Heath consoles: mutes, faders, scenes and channel names on
every dashboard, and the desk watchdog works with it. Choose it under
**Settings → Sound Console**; there's nothing to configure on the console
itself.

> Built from the published OSC protocol and covered by tests — including the
> fader curve checked against the console's own level table — but **not yet
> tried against real X32 hardware.** Same caveat as dLive and SQ. If you run
> one, a report either way is genuinely useful.

### Also fixed

- **Settings could silently discard a change** when one control set two values
  at once. Choosing a console model saves the model *and* the port, so picking
  X32 — or dLive, which shipped this way — saved the port and quietly reverted
  the model.
- Sticky banners were see-through, so page content scrolled underneath and
  collided with their text.

### Under the hood

- **Windows groundwork.** The macOS-only pieces are now behind platform gates,
  with Windows implementations written. **This does not make ProDeck run on
  Windows** — none of it has been compiled or run there yet. It's a starting
  point, not a feature.

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
