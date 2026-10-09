# Changelog

What changed in each release of ProDeck, in plain language.

**Where to get it:** <https://whiteoakmedia.io/tools>. That page always points at
the current build. Download `ProDeck.dmg`, open it, drag ProDeck to Applications.

**First open only** (macOS 15 and later): double-click ProDeck → it won't open
yet → **System Settings → Privacy & Security** → scroll to the bottom → **Open
Anyway** → confirm. Once only. (The old right-click → Open trick was removed by
Apple in macOS Sequoia.)

**Updating:** ProDeck checks a few seconds after launch and shows a banner with
the release notes and an **Install & Restart** button.

> ### Mac: updating never worked before 0.9.94 — and now it does, without redownloading
>
> Every Mac update from 0.9.67 through 0.9.93 failed with *"failed to unpack
> `._ProDeck.app`"* the moment you pressed Install & Restart. The app was
> fine; the update file we published carried macOS metadata entries the
> updater can't read. 0.9.94's file is clean, and the updater inside every
> existing copy can unpack it — so this is the first update that installs,
> from whatever version you are on. Nothing to redownload.
>
> ### If updates still aren't working, download it again
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

## 0.9.100 — 8 October 2026

### New: the slides follow the song

The **Slide Grid** and the playlist on the **ProPresenter** page now keep the
live slide in view as ProPresenter moves through a song, about a third of the
way down so the next few slides show below it. They move only when the live
slide drifts out of view, and if you scroll, click or type in them they wait a
few seconds before following again, so nobody loses their place.

### Fixed: a song in the playlist twice

A song that appears twice in a playlist, like a reprise at the end, showed both
copies as live. Now only the copy that is playing is marked.

## 0.9.99 — 8 October 2026

### Thank you

Thank you to everyone who has sent a report with the new **Report a bug**
button. Every fix below came from one.

### Fixed: Slide Preview showed the wrong slide's picture

The slide number was right, but on a song whose arrangement reorders or repeats
sections, the picture belonged to a different slide. When the song was started
from a playlist, Slide Preview and Slide Grid now follow that playlist item,
which says exactly which arrangement is playing.

### Fixed: saving Settings disconnected phones and kiosks

Every press of Save in Settings restarted the phone gateway in a way that
stopped it altogether, so phones and kiosks lost the booth until ProDeck was
restarted. Saving now leaves it running unless you change its port. If phones
and kiosks really can't connect, **Settings → Browser Access** says why, and on
a Mac names the app that is already using the port.

### Fixed: setup's print button and the SPL meter's start button

- **Print a poster** on the crew step of setup now prints the join poster. Before,
  the button did nothing.
- When the computer won't open the audio input, the SPL meter says what to
  check (microphone permission for ProDeck, the input plugged in) instead of
  doing nothing.

## 0.9.98 — 7 October 2026

### New: report a bug or request a feature inside ProDeck

**Report a bug** and **Request a feature** are at the bottom of the sidebar, on
the Help page and in **Settings → Help & support**. Say what happened and how
much it matters, add a screenshot if it helps, and leave an email if you'd like
a reply. It goes privately to White Oak Media, not to a public page. Tick
**Include diagnostics** to send ProDeck's version, the system, which connections
are up and the recent log, with every password and key removed; **See exactly
what's sent** shows it first. If ProDeck ever stops drawing, the error screen
has a button to send it too.

### New: crash reports

When something breaks, ProDeck now sends White Oak Media a report of what
failed and where in the code, so it gets fixed sooner. Reports never include
names, plans, passwords, the computer's name or its address. They travel
through White Oak's own service, so church content filters don't block them.
Turn them off any time in **Settings → Help & support → Send crash reports**.
The privacy notice (Settings → About) explains both.

### New: Yamaha CL, QL and TF consoles

Pick **Yamaha** in setup or Settings and enter the desk's IP address; there's
nothing to set on the desk. ProDeck shows channel names, mutes, fader levels,
DCAs, mute groups and the current scene, sized to the model it finds. It is
view only for now, and brand new: it was built from Yamaha's published
protocol and hasn't met every desk yet, so if anything looks wrong on yours,
please report it.

### New: clearer console setup

Setup no longer starts with Avantis picked. Choose your desk and ProDeck asks
only for what that desk needs: no MIDI channel for an X32 or a Yamaha, and the
port tucked away. Desk not listed? **Something else** says so plainly and moves
on; everything else in ProDeck works without a console.

### New: soundcheck playback

Play a recorded service back out through Dante Virtual Soundcard so the band's
tracks feed the console for a virtual soundcheck (Recording → Soundcheck). On an
Avantis, the patch sheet shows which channel listens to which track, worked out
from the show file and the Dante network. A reminder stays on screen while it
plays, so Sunday's inputs aren't forgotten.

### New: privacy and licences

**Settings → About** now has the privacy notice and the licences for everything
ProDeck is built with. Automix asks you to confirm the first time you arm it.

### Fixed: plans that cover two days

A plan holding Wednesday night and Sunday morning ("September 30 & October 4")
counted as over once Wednesday passed, so on Sunday ProDeck kept jumping to next
week's plan. A plan now stays current until its last service.

### Fixed: Follow ProPresenter

- When the same presentation is in the plan twice, like pre service slides at
  the start and the end, Follow picks the one nearest where Live is, instead of
  dragging Live back to the top.
- Follow no longer takes Planning Center Live control from anyone. If someone
  else is driving Live, it says who and stops.

## 0.9.97 — 30 September 2026

### Thank you

Thank you to every church running ProDeck, and to everyone who sent in a bug,
an idea or a kind word. Your support is what keeps this going.

### New — step by step setup for recording and Automix

Open either from **Setup**, the **Set up** button on the Recording page or the
Automix tile, or **Run setup** in Settings.

- **Recording:** pick where the audio comes from (Dante Virtual Soundcard, or
  a console plugged in over USB), check which channels have signal (ProDeck
  can listen to a USB console without recording), name the tracks (filled in
  from Dante and what ProDeck already knows), and choose the drive.
- **Automix:** connect the console, say which of your faders plays each part,
  click the channels your guitars and keys come in on, set up backing vocals,
  pick where the song timing comes from (guide track, click or MIDI clock) and
  the speech mics. Nothing is saved until the last step, and Automix still
  only moves faders after someone presses Arm.

### New — Automix works with your own fader names

Its moves used to name one church's faders ("EGs", "KEYs"). Now the setup
remembers which of your faders plays each part and rewrites the moves for
them, so a desk that says "Elec Gtr" or "Piano" works the same.

### A gift from White Oak Media

The bottom of the sidebar now says who gives ProDeck away. The logo opens
whiteoakmedia.io.

### Fixed — Settings no longer undoes changes made elsewhere

Settings kept the copy it loaded when it opened, so pressing Save there could
put back old values for things changed on another page, like track names on
the Recording page. It now follows those changes and keeps your own edits.

## 0.9.96 — 29 September 2026

### New — Automix: ProDeck can mix the band while you step away

Arm it with your mix where you want it, and it moves your DCAs and groups at
the right moments: the guide calls the section (Verse, Chorus, Bridge,
Breakdown, Build, All in) and the playback clock finds the downbeat, so the
fade lands **on** the beat. It never touches your main faders.

- **Your mix is home.** Moves are offsets from your own positions; each song
  remembers your chorus levels. Touch any fader and Automix lets go of it for
  the rest of the song. **Hold** freezes everything.
- **It learns from you.** Where you keep correcting a move in the same part of
  the same song, Settings → Automix offers your number — Keep or Dismiss.
- **Repeats climb.** A second and third Bridge or Chorus lift a little each time.
- **BGVs follow the singers**, tucking when no backing singer is singing.
- **It listens to the instruments** (map their direct outs): lifts whoever
  carries an instrumental, trims one that digs in, skips silent ones. Drums and
  bass are never nudged.
- **The FX mute** between songs, and back on for the next.
- **Stream Deck:** Arm / Hold / Home / Off keys and readouts (Companion).
- **Nothing moves the desk unless Automix is armed** — the speech-mic
  Autopilot (lapel, MC) included. Desk scenes by song leader and the song key
  to Waves work on their own, armed or not.
- Works on **Allen & Heath Avantis, dLive and SQ**, and **Behringer X32 /
  Midas M32** (DCAs, groups or mix buses, input channels).

### New — multitrack recording

The **Recording** page records every input to its own 24-bit WAV — a Dante
card, or **a console's USB audio plugged into this Mac** (X32/M32 X-USB, SQ,
Yamaha TF, any interface): pick it under **Record from**. Record to this Mac or
any external drive; if the drive is missing or drops out mid-service, it keeps
recording on this Mac. Each service gets a folder named for the day's
Planning Center service, with markers for every song, item and guide call, a
Reaper project and a marker file for Logic. Silent inputs are removed at the
end. You start it — it never records on its own.

### New — routing that keeps itself current

- **Dante, live.** Routing → **Live** reads every Dante device's subscriptions
  straight off the network every 30 seconds — read-only, it never changes a
  thing — and logs every change. The Recording page shows what each input is
  really subscribed to.
- **The desk's patch.** An **X32/M32** reports its input patch live. On an
  **Avantis**, save the show to a USB stick (or from Avantis Director) and
  ProDeck reads the input patch and every Dante output from it, and notes what
  changed since the last one.

### New — the weekly stream report

Analytics → **Stream mix**: every service's stream mix measured — loudness
against YouTube's −14 LUFS, worship vs message, tone against a professional
worship mix — with plain fixes ("the message sits 5 LU under the worship").

### New — checklists: Edit order

Drag (or ↑/↓) to reorder checklists and their steps, on the Checklists page and
the dashboard Checklist tile. Ticking is locked while you rearrange.

### Fixed — Slide Preview showed the same thing for every screen

Pick a screen and, when ProPresenter sends that screen out over **NDI**, the
tile now plays it live. A screen without NDI says so — and how to turn it on.

### Fixed — X32 / M32: faders were never trusted after connecting

The mirror never recorded when the desk connected, so every fader read as
"remembered, not confirmed". Fixed — which is also what lets Automix run on an X32.

### Faster, steadier

- **Slide presses reach ProPresenter faster** (no name lookup per press).
- **The Waves key change survives a network-MIDI restart** — the port is
  reopened for every send instead of silently sending nowhere.
- **Desk scenes follow the song on screen** (ProPresenter first), like the key.

### macOS

Tested on **macOS 27**; runs on 10.15 and newer. ProDeck now explains each
permission macOS asks for (Local network, Microphone, Desktop/Documents/
Downloads, removable drives) — **allow each one**; Help → *macOS asked for
permission* covers it. Dante discovery inside the app needed a network
permission entry it didn't have; it's there now.

### Also

- The crew sign-up poster no longer names our church on yours.
- Settings → Audio: new churches start with Autopilot mics, the FX mute and the
  instrument feeds blank, instead of our channel numbers.
- Browser demo: `?shots=1` draws the sample church exactly as the booth app.

## Also in 0.9.96

### Fixed — Planning Center no longer skips a week

The booth only knew the plans that existed when it last opened, so a week whose
plan was made late, moved, or given its service time afterwards was missing, and
when last week ended the booth jumped past it. The plan list now refreshes every
half hour and again right before any automatic switch, and the booth won't
move itself more than a week ahead. Planning Center's plan dates are also now
read as your local time (it sends them that way), so evening services outside
the Americas file under the right day.

### New — Release notes by email, if you want them

One optional line at the end of first-run setup and in Settings → Software
Update: leave an email and you get a short note when a new version comes out.
Nothing is sent unless you type an address and press the button.

### Windows — recording, the Dante reader and show files work there too

The multitrack recorder reads free space and lists drive letters, the live
Dante reader finds this computer's own addresses, and console show files unpack
with the tar that ships in Windows 10 and later.

### New — Auto-Follow, rebuilt: the slide changes as the line ends

Follow now hears the singing on four-second slices every two seconds, with
Whisper large-v3-turbo kept loaded in the background (about one second a
slice on an M1). It finds the song in the armed playlist by itself, and
moves ProPresenter when the slide on screen has sung its **last line** — a
beat early rather than late. Replayed against a real recording, every slide
change landed between 0.6 s early and 0.2 s late, with no wrong moves through
an instrumental.

- **It knows the song's tempo.** Each song's BPM comes from its Planning
  Center arrangement, so it knows how long a line lasts and won't leave a
  "Gloria… Gloria…" slide after the first Gloria.
- **It learns every slide's length** from rehearsal and Sunday, per song,
  and stretches them when the BPM changes. A slide nobody can hear still
  moves on time.
- **It ignores what isn't singing.** In a guitar solo Whisper "remembers"
  the song's lyrics; those windows are low-confidence and can't move a slide.
- **It asks Claude, rarely**, when two slides are equally likely, on its
  own monthly budget with the troubleshooter's key. Gemini is retired.
- **You stay in charge.** Click a slide in ProPresenter and Follow picks up
  from there; Back one / Forward one on the Captions page teach it too.
- Settings → Audio → **Auto-Follow listens to** picks its channels (default:
  the Listen board mix). ProDeck finds the best Whisper model by itself.

### New — song keys on the Stream Deck

`GET /api/deck/key?text=G` (C, C#/Db … B, or `off` for Tune off) sends a key
through the booth, and `deck-state` now carries the sent and live key so a
Companion key can glow. At Cornerstone: Production's WAVES readout opens a
new Keys page.

### New — the Waves key link reconnects itself after a restart

Song Key → Waves rides a Network MIDI session to the Waves PC, and macOS
forgot that connection every time either computer restarted. ProDeck now
watches the session behind the key-send port, remembers the peer it saw
connected, and asks it to connect again every 20 seconds until it answers.
The Song Key strip shows a second chip: **→ Axis_One** or **waiting for …**.

### New — Routing is now a real map, and it answers "no sound?" on a phone

The Routing page has been rebuilt around the one fact that survives every
Sunday: channel names change, numbers don't. It is now the patch list every
sound tech already has — **channel · door · socket · upstream** — pasted in
from a spreadsheet in one go, with names filling in live from the desk.

Click a row for what to walk to when that channel is the suspect. Every kind
of source (wireless pack, stage socket, playback computer, rack XLR, Dante
device) starts with a sensible checklist you edit to name your own receivers
and panels. Mark a socket **dead** and the walk routes around it. Two channels
on one socket are flagged: they share one gain.

**No sound?** — on a phone from Home, on the booth from Routing — takes a
person (this week's team, via their mic), a channel or a place, and does two
things in order: shows what ProDeck already checked from the booth (muted or
fader down on the desk, desk connected, signal at ProDeck's own input), then
lists what is left to walk to, most likely first, with the rule that explains
each surprise right under the step. Every tick is a place nobody had to walk
to. Nothing here guesses; if ProDeck can't see a hop it says so.

Maps saved by the old Routing page are converted on first open with every
step kept, and nothing is written until you press Save. Until you paste your
own list, the page shows a clearly-labelled sixteen-channel example.

### New — the Waves key, back on screen

The key ProDeck sends to the Waves rig when a song goes live is visible
again: under the transport on the **ProPresenter** page, and as a **Song Key →
Waves** dashboard tile. Both show the key last sent (green when it matches
the live song, amber when the rig is on something else), the live song's key,
whether the MIDI link is up, and thirteen buttons — the twelve keys and
**Tune off** — to send one by hand. Phones with Control can press them too;
the booth does the sending and everyone sees the result.

### Fixed — a mute ProDeck only remembered could show as fact

The Avantis can't be asked whether a channel is muted; ProDeck learns a mute
when the desk changes it and remembers it across restarts. So after a restart
a channel could read **MUTED** on ProDeck while the desk was open, until
someone pressed the mute twice. Now a mute the desk hasn't confirmed since it
connected shows as **MUTED?** with a dashed outline, the muted-mic alerts only
fire on confirmed mutes, and the troubleshooter says "ProDeck's last record
says…" instead of stating it. Tapping the mute once on the desk confirms it.

### New — the Sound Desk tile knows whether Waves is on

Tell ProDeck which console scenes switch your outboard rig on and off
(**Settings → Sound Console**) and the desk tile shows **Waves ON / OFF** from
the last scene recall the desk announced, the troubleshooter knows it, and an
alert appears if it is off within 90 minutes of a service — sound quality
changes a lot with it off.

### Ask ProDeck keeps the conversation while you look around

Tapping a link in an answer, switching to the Map, or reloading the phone
used to clear the chat. It now stays until you press **Start over** or close
the app.

### New — Ask ProDeck: describe the problem, get walked to the fix

A volunteer alone at 9am can now type what is wrong in their own words —
"Ruth's mic is crackling", "nothing from the keys", "the stream is quiet" —
under **No sound?** on a phone or the booth, and get an answer the way an
experienced sound tech would give it: one clarifying question if it really
needs one, what ProDeck already checked live, then the next physical thing to
walk to and look at, most likely first, naming the actual receiver, socket and
channel.

It is built to be trustworthy rather than clever. It can only speak from this
building's routing map, a folder of plain-text notes you write (the
**knowledge files**), and the live state of the desk; every fact it uses is
tied to something on the map and shown as a link under the answer; it never
touches the desk. Its general sound knowledge is a written method that ships
with ProDeck — signal-flow reasoning, symptom → cause, wireless, Dante,
scenes, rules during a service — so what it knows is reviewable. Every
question and answer is logged on the booth. Set it up in **Settings →
Troubleshooter** with an Anthropic API key, which stays on the booth; phones
ask through it. A monthly call cap keeps the bill bounded.

### New — Routing → Stage: the wall, pocket by pocket

Every stage pocket drawn as its sockets. Each tile shows the socket number,
the stage-box input it reaches, the console channel that becomes, the desk's
live mute, and whether that channel runs through an outboard rig. Free
sockets are dashed; mark one dead when it looks normal and goes nowhere.
Pockets are yours to name and range in Edit. Phones get the same tiles under
**No sound? → Stage**, so "which hole do I plug into" is answered standing at
the wall.

### Walking to a place reads from the far end

Picking a destination or an output in **No sound?** — the stream, the lobby
speakers, an outboard rig — now starts at the box itself, then the output,
then one desk check covering every channel that feeds it. It used to trace
each feeding channel all the way back to its pack and list every battery.

### Fixed — the sound meter could stay off for a whole service

If the audio interface was restarting at the moment ProDeck launched (Dante
Virtual Soundcard does this), the meter's one start attempt hung inside
macOS's audio system and nothing ever tried again — and every later audio
question waited politely behind the hung one. Now a query that overruns is
abandoned rather than waited on, the meter retries every 30 seconds until it
is running, and the Audio light says **not answering — retrying** instead of
**off** while that is happening. If the audio system stays wedged, the fix is
outside ProDeck: restart the audio interface's software (Dante Virtual
Soundcard) or the Mac's audio service.

### New — Routing → Map draws it

The same map as boxes and lines, laid out by kind: sources, doors, channels,
buses, outputs, destinations, one column each, so it stays readable however
big the building. Colour is the door — amber SLink, blue Dante, green Local —
and every line carries its socket number. **Only SLink / Only Dante / Only
Local** show one door's world at a time, the way the sheet on the wall does.

It is live: a muted channel turns amber, an open one shows its fader, dead
sockets are dashed, hops nobody has verified are dotted, and a line glows
when ProDeck hears signal on its own input. Double-click a box to walk it.

The view fits the columns to the window and reads top to bottom like the
sheet on the wall: scroll to move down it, ⌘-scroll or pinch to zoom, **Fit**
to come back. Live changes repaint only the box that changed.

In Edit, drag port to port to connect (only sensible links are allowed, and
a link into a door or channel asks for the socket), Delete removes, **Add**
drops a new box into its column, and a dragged box remembers its nudge. One
map, three views: the table, the picture and the phone walk all read and
write the same file. The picture is a separate download phones never fetch.

Help: *Building your routing map*, *Drawing the map* and *When something has
no sound*.

## 0.9.95 — 23 September 2026

### Fixed — after an update installed, ProDeck didn't come back

The first in-app update that actually installed (0.9.92 → 0.9.94) ended with
nothing running. The new version was in place and correct; opening ProDeck by
hand brought it straight up. It just shouldn't have needed you to.

What happened: the old copy started the new one as its own child process and
then quit. If ProDeck is being kept alive by a supervisor (the way a booth Mac
runs it, so it comes back after a crash), the supervisor treats the parent
quitting as the end of the job and stops the child with it — and because the
parent quit cleanly, it didn't restart anything either.

Relaunching now takes the right path for how ProDeck was started. Under a
supervisor it asks to be restarted, and comes back still supervised. Started
normally, it hands the launch to macOS the same way a double-click does, so the
new copy stands on its own before the old one leaves. Because this fix lives in
the copy doing the updating, the first update *from* 0.9.94 will still need one
manual open; every update after that comes back on its own.

### Fixed — ProDeck could freeze completely while opening Settings

Rarely, ProDeck came up with its window drawn but nothing working: no
ProPresenter, no Planning Center, phones unable to connect. It was waiting
forever on macOS's audio system. Opening Settings both lists your audio inputs
and starts the sound meter, and when those two asked CoreAudio the same
question at the same moment — one of them from the app's main thread — the
answers deadlocked and took the whole app with them.

Audio device questions now go one at a time, never on the main thread, and give
up after eight seconds with a clear error instead of hanging. A stalled audio
system can still leave the meter empty; it can no longer take the rest of
ProDeck down.

## 0.9.94 — 23 September 2026

### Fixed — the Mac update that never installed

Pressing **Install & Restart** on a Mac has failed on every release since
auto-update was introduced, with *"failed to unpack `._ProDeck.app`"*. The
update file we published contained macOS metadata sidecar entries that the
updater's extractor cannot read; the built-in `tar` command on a Mac silently
hides those same entries when you list an archive, which is why checking the
file by hand always looked fine.

The fault was in the file, not in ProDeck. Every existing Mac copy already has a
working updater — it was simply never given anything it could unpack. This
release is the first it can. Publishing now refuses to ship an archive with
those entries, checked with a reader that can actually see them.

## 0.9.93 — 23 September 2026

### Every connection now has a Reconnect / Disconnect

**Settings → Connections** lists ProPresenter, Planning Center, the sound console,
OBS, the stage feed and browser access on one card, each with a button to drop
and redial just that link. Everything reconnects on its own when a link falls
over; this is for the case it can't see — a connection that says it's fine and
isn't, a desk or OBS rebooted behind it, ProPresenter moved to a new address.
Until now the only fix was quitting ProDeck, mid-service, with everything else
on it.

### Planning Center sign-in: the token route is visible again

If you were looking for where to type an Application ID and Secret and found only
a Connect button, that was our doing: the token fields were folded behind a
one-line link that was easy to miss. They're now a plain second choice under the
Connect button. And after you press Connect, the page now says what to do next:
finish signing in **in the browser tab that opened** — including any login code
Planning Center emails or texts you. Nothing is typed into ProDeck.

A church already connected with a token also gets a **Disconnect** on the
Planning Center page, which is how you get back to the sign-in.

### Fixed — ProPresenter still appeared to drop out, this time for a different reason

The previous fix replaced "listen for silence" with "ask ProPresenter every few
seconds whether it's there". That check reused its network connection between
asks — and ProPresenter closes an idle connection after a few seconds, so the
connection was usually dead by the time the next check used it. The check
failed on a stale socket rather than on anything to do with ProPresenter, and
two of those in a row was enough to report a disconnection again.

Every check now opens a fresh connection, as do ProDeck's other commands, for
the same reason.

### ProDeck now tells you when macOS has cut it off from your network

If ProPresenter, the sound desk and the kiosks all stop working at once while
Planning Center carries on as normal, this is almost always the cause — and
until now ProDeck reported it as "no response (unreachable / firewalled)",
which sends you hunting through the router for a problem that is one switch in
System Settings.

macOS requires an app's permission to reach your local network, and it ties
that permission to the app itself — so **installing a ProDeck update can
switch it back off**. Nothing on screen says so. The internet still works, the
crew gateway still works, and only the things in the building go dark.

ProDeck now recognises that exact pattern — internet reachable, every address
in the building unreachable — and says so plainly, with a button that opens the
right settings pane. Turn ProDeck on in that list and everything reconnects
within seconds; no restart.

Installing on the booth also checks for it now, while you're still at the
keyboard, rather than letting a Saturday update surface at 7am on Sunday.

### Fixed — ProPresenter appeared to disconnect every 20–30 seconds

If ProDeck kept announcing that it had lost ProPresenter and then found it
again, while ProPresenter was sitting right there working, this was why.

ProDeck listened to ProPresenter's live status feeds and treated silence on
them as proof ProPresenter had gone away. But ProPresenter only sends on those
feeds when something *changes*, and a timer only sends while it is actually
running. A booth parked on a slide with its timers stopped — a soundcheck, a
pre-service hold, most of a week — sends nothing at all, so after fifteen quiet
seconds ProDeck declared it dead and un-declared it the moment anyone touched
anything.

ProDeck now asks ProPresenter directly, every five seconds, instead of
inferring it from silence, and requires two consecutive failures before
reporting a problem. A booth left untouched for an hour stays connected for the
hour.

Reported by Life Pacific University, whose troubleshooting is what found it:
they saw it over the loopback address as well as across the network, which
ruled out anything network-related, and noted that Bitfocus Companion on the
same machines never dropped — because Companion asks rather than listens.

### SPL now reads in dB(A), and the calibration will finally hold

Three fixes to the sound level meter, which together are why calibrating it
against a handheld never landed in the same place twice.

**It now averages like a sound level meter.** The reading was smoothed with
peak-meter ballistics — quick to rise, slow to fall, and applied to decibels.
A sound level meter integrates the energy with one even time constant. On pink
noise the difference is exactly the symptom: the number sat high and visibly
swayed while the handheld beside it sat still. **Settings → Audio → SPL time
weighting** picks Slow (1 s, what most handhelds are on) or Fast.

**It can read A-weighted, and does by default.** A-weighting is what
hearing-exposure limits, noise rules and handheld meters all speak, so it's the
only reading that can be compared to anything. The filters match the published
IEC 61672 table to better than 0.2 dB across everything below 2 kHz.

**C−A is shown next to the level.** A-weighting deliberately ignores most of
the bottom end, so a mix can read a respectable 92 dB(A) while the room takes
105 dB(C) — and the low end is what the complaints are usually about. The gap
between the two curves is the size of your bottom end: roughly 10–15 dB is a
balanced full-range mix, consistently above that means the bass is running
away. It turns red past 15.

Service reports also now record **LAeq** — the energy average — beside the
existing average and peak. A song that sits at 88 and peaks at 98 for one
chorus is a very different exposure from one held at 90, and a plain average of
decibels calls them the same.

> **You need to recalibrate once.** Any existing calibration figure was set
> against the old swaying, unweighted number and will be wrong. Put pink noise
> up, set your handheld to A and Slow, match those in Settings → Audio, then
> open Calibrate and let it sit a few seconds before typing the reading — it
> now averages the whole time the box is open instead of snapshotting one
> instant.

### Planning Center: press Connect instead of hunting for a token

Connecting Planning Center was eight steps through a developer site most
worship pastors have never seen, ending in an Application ID and a Secret
pasted into ProDeck. That is now a button.

Open **Planning Center → Connect**. Your browser opens Planning Center's own
sign-in page, you approve ProDeck there, and the page fills in behind you. No
password and no token is ever typed into ProDeck or stored by it.

What you're approving is deliberately small: **Services** (the plan, its
running order, the team and LIVE) and **People** (only so ProDeck can show
whose account it's connected as). Nothing else — not Giving, not Check-Ins. You
can see the connection in your Planning Center account and revoke it there, or
press **Disconnect** in ProDeck.

**Your existing setup keeps working, untouched.** A Personal Access Token is
still a supported way in — it's under *Use a Personal Access Token instead* on
the same panel, and nothing needs to change on a booth that already has one.
Worth knowing, though: that token is a password that never expires and carries
its creator's entire Planning Center account, which is the reason signing in is
now the recommended route.

One thing to expect on a copy that hasn't been told which Planning Center
application to sign in through: instead of a Connect button you'll see a short
numbered list and a **Client ID** box. An Organization Administrator creates the
application once, in about five minutes; ProDeck shows the exact three redirect
addresses to paste. Help → *Registering a Planning Center application* walks
through it.

### Fixed — picking a plan jumped months into the future

Selecting a Christmas service, a conference, or any other plan that spans two
days would immediately throw the booth onto a different plan, often months
ahead.

Planning Center gives each plan a human-readable date like
`December 23 & 24, 2026`. ProDeck was reading that text to work out when the
plan happened — and a computer reading it takes the second day as a *year*:
`December 23 & 24, 2026` becomes 2024, and `October 16 & 17, 2026` becomes
2017. No error, just a plan silently dated years in the past. ProDeck then
decided it was a finished service and moved you to the next "current" one. Any
service on a single date was unaffected, which is why this only ever bit the
Christmas and conference plans.

ProDeck now reads the machine-readable date Planning Center supplies alongside
it, and the same shared rule is used by the Service Readiness tile, which had
its own copy of the mistake.

Two related fixes came with it:

- **Today's plan stays selected all Sunday.** Planning Center removes a plan
  from its "future" list once the service time passes, and the query meant to
  cover that gap was fetching the wrong end of the calendar — the furthest
  *future* plans rather than recent ones. Today's plan was staying on screen by
  coincidence. The 11:00 could have been filed against the wrong plan.
- **A plan you chose is never overridden because it hasn't loaded yet.**
  Switching service type replaces the plan list, and a selection that wasn't in
  the new list was being treated as expired rather than simply absent.

### ProDeck refuses to run twice

Starting ProDeck when it's already running now brings the running window
forward instead of opening a second copy.

This was not cosmetic. A booth spent half an hour running two copies at once —
one started by the watchdog at login, one started by hand from the Dock. Both
polled Planning Center, both held the audio device, and both wrote the same
files in the data folder, which is the one case the app's write protection
can't cover. Only one of them owned the web gateway's port, so phones, the
kiosk and the green-room audio all showed as offline while ProDeck sat there
plainly running on screen.

One consequence worth knowing on a booth Mac: if someone has started ProDeck by
hand, the watchdog's own launch now steps aside, so the app is running but no
longer being watched for crashes. Quit ProDeck and start it again from the
watchdog to put it back. One unguarded copy is the deliberate trade against two
copies racing each other over the same data.

### Windows copies now update themselves

Windows installs check the same update feed the Mac does and offer new versions
in the same banner. Installing runs silently — current-user, no admin prompt.

The installer in each release is signed with ProDeck's update key and the app
refuses anything that key doesn't vouch for, so a Windows build downloaded from
the Actions tab (or from a release published before this) has no matching entry
and will simply report "up to date". Download once more from the
[Releases page](https://github.com/whiteoakmedia/prodeck/releases/latest) and it
stays current from then on.

Windows build and packaging by
[@jpeters0](https://github.com/jpeters0).

### Fixed — a long Sunday could quietly stop refreshing Planning Center

The plan sync resolved its Planning Center credentials once, when you pressed
Start, and reused them for as long as it ran. That was fine for a pasted token,
which never expires — but not for a signed-in connection, whose access is
renewed every couple of hours. It now re-resolves every tick, so a sync started
at 7am is still live at 1pm.

---

## 0.9.85 — 15 September 2026

### Fixed — first-run setup crashed the app on a brand-new install

**If you have been running ProDeck already, this never affected you.** On a
*fresh* install — a new computer, or a first Windows machine — the welcome
screen took the whole app down to "ProDeck hit an error" the moment it tried to
open.

The cause was a React rule: the onboarding screen ran two extra pieces of state
only after a guard that returns early, so the number of them changed the instant
the screen opened, and React refused to draw anything. It was introduced in
0.9.76 alongside the joining window, and it has been broken for every new
install since — invisible to every existing booth, because an existing booth
never opens that screen.

Found on the first Windows install, by @jpeters0.

There is now a test that reads every component in the app and fails the build if
any of them does this again. The same mistake had reached a release twice.

---

## 0.9.84 — 15 September 2026

### Windows build — thank you, Peterson

The Windows side of ProDeck now has someone with Windows booth hardware behind
it. **[Peterson (@jpeters0)](https://github.com/jpeters0)** contributed the
whole Windows build track: the PowerShell build script, a Windows CI workflow,
the installer configuration, and [WINDOWS.md](WINDOWS.md) — a genuinely careful
checklist for bringing up a Windows booth, ending with the advice not to use
console control in a live service until the read-only mirror has run a clean
rehearsal.

He also went through the app removing the assumption that a booth computer is a
Mac: the onboarding, Settings and the problem reporter no longer say "Mac", and
first-run no longer promises crash-relaunch on Windows, which a Run key can't
deliver.

**This still does not mean ProDeck is supported on Windows** — the Windows
paths need validating on real hardware first, which is exactly what his
checklist is for. macOS remains the supported build.

### Fixed — the plan switching itself mid-service

Also found by Peterson, and this one bites on a Sunday. ProDeck asked Planning
Center only for *future* plans, and Planning Center drops today's plan the
moment its service time passes. Part-way through the morning the plan you had
selected was no longer in the list, so ProDeck replaced it with next week's.
It now asks for recent plans as well, so the current weekend stays selectable
all day.

### Fixed — slide preview blank on a kiosk

The Slide Preview and Slide Grid tiles on a screen signed in with the crew
password could read the slide but not fetch its picture, so they sat empty.

> 0.9.83's notes claimed this fix and the release did not contain it — a
> mistake in how it was published, not in the code. This is the real one.

---

## 0.9.83 — 13 September 2026

### Fixed — slide preview blank on a kiosk

The Slide Preview widget on a screen signed in with the crew password could
read the slide but not fetch its picture, so the tile stayed empty. Slide
pictures are a viewer's read; they are now allowed.

---

## 0.9.82 — 13 September 2026

### Fixed — plan times now match Planning Center exactly

Planning Center anchors a plan on the **service start**: items marked
pre-service — rehearsal, pre-service slides, the countdown video — count
*backwards* from it, so the first song is at 8:00. ProDeck was stacking
everything forward from 8:00, putting a 45-minute rehearsal at 8:00 and the
first song at 8:56. Show Flow now lays the plan out the way PCO does, verified
against a real plan to the second.

### Changed — Keys to the Stage cues off the *service* ending

The call now comes **five minutes before the service is planned to end** —
the service start plus the items that run during it — rather than before the
sermon item ends. With services back to back, the end is the hard constraint
and the sermon is what flexes, so this is when the team needs to be walking
however long the message ran. It works whether or not anyone is driving PCO
LIVE. If you'd rather cue off the live item's own countdown, switch it in the
widget's edit mode.

---

## 0.9.81 — 13 September 2026

### Fixed — times that didn't follow Planning Center

Reported on a Sunday morning as "times from Planning Center are not accurate".
The Keys to the Stage countdown was right to the second; two other times
weren't, for two different reasons:

- **Service Countdown** never read Planning Center at all — it counted to a
  time typed by hand, fixed all morning and blank on a new kiosk. It now follows
  the plan's service times automatically: *ON AIR IN* until the next service
  starts, *ON AIR +* while it runs, then the next one. A typed time still
  overrides if you want it.
- **Show Flow's start times** were calculated from whichever service time was
  *selected*. With several services and auto-advance off, the 9:30 and 11:00
  showed the 8:00's times all morning. It now prints the service that's
  happening now, or the next one.

Call times and rehearsals are never counted to — only services.

---

## 0.9.80 — 10 September 2026

### Fixed — "my dashboard reverted when I left it"

It hadn't. Every change was saved; two things made it look lost:

- **Coming back to Dashboards always showed the first one.** Arrange "Green
  Room", leave, return — and you were looking at "Front of House". ProDeck now
  remembers which dashboard you were on.
- **A screen signed in with the crew password could open the editor**, drag
  freely, and have every save refused, since only the admin password may write
  dashboards. That screen now says *view only* instead of showing a pencil, and
  if a save is ever refused anyway, the message says why and where to edit.

---

## 0.9.79 — 10 September 2026

### Fixed — Keys to the Stage now counts down Planning Center's own clock

The widget used to time the live item from when *this* copy of ProDeck saw it
go live. Now it reads the countdown Planning Center itself publishes for the
current LIVE item — the same number the person driving PCO sees — so the booth
and a kiosk that switches on mid-sermon agree to the second, and the cue no
longer depends on anyone having been watching when the sermon started.

One detail worth knowing, learned from a real plan rather than the docs: while
an item is live, Planning Center gives its **start** time and length but not an
end time (the end is filled in only once you advance past). ProDeck computes
the end the way LIVE does. If Planning Center hasn't published a start — nobody
holds LIVE control, or the item is excluded from this service time — the widget
shows the songs and keys **without** a countdown rather than guess.

---

## 0.9.78 — 10 September 2026

For a TV in the room where the team waits — a green room, the office, wherever
breakfast happens during the service.

### New — Keys to the Stage

A widget that counts down the live item and, **five minutes before the sermon
is due to end**, turns into a call: *TO THE STAGE*, the countdown, and the
closing songs with their **keys** in the biggest type on the wall. It works for
any run of songs after any timed item, so it also covers the opening set. If
the sermon runs long the call stays up and says by how much. Change the lead
time (3, 5, 7 or 10 minutes) in the widget's edit mode.

### New — room audio without a tile

Edit a dashboard and press **Room audio: on**. Any kiosk showing it plays the
room's audio in the background — no Overflow Listen tile using up the screen.
(On a Mac mini the Chrome autoplay flag in the kiosk guide is what lets it start
with nobody clicking.)

### Fixed — kiosks now fill the TV

A fixed row height left the bottom third of a TV empty and every widget small.
Kiosks now scale the layout so it exactly fills the screen, whatever size it is.

### Also

- A **Green Room** starter template with this layout and room audio on: Keys
  to the Stage, Service Countdown, Live Viewers, Clock, Show Flow, Song
  Leaders, Now/Next.
- Help topics for the widget and for room audio.

---

## 0.9.77 — 10 September 2026

### New — permissions per person

Until now a phone's power came entirely from which password it typed: the
**admin** password meant everything, the **crew** password meant looking. So
letting one volunteer do one thing — the kids worker putting a child alert on
stage, the worship leader driving ProPresenter — meant giving them the admin
password, which can't be taken back from one person without changing it for
everyone.

Now each crew account can be granted exactly what its job needs. **Settings →
Crew Members → Edit** on a person, then tick:

- **Page** — send pages and re-buzz them
- **Stage** — put text on the stage displays and confidence screens
- **Control** — ProPresenter, the sound console, OBS scenes, Planning Center LIVE
- **Tap discs** — override where the lobby NFC discs point
- **Manage crew** — approve, edit and remove crew; invites; open joining

A phone signed in with the crew password gets that person's grants on top of
everything a viewer could already do. Nobody loses anything: a crew member with
no grants sees exactly what they saw yesterday. The admin password still does
everything, and is the **only** thing that can grant — *Manage crew* on purpose
does not include granting, because someone who could grant themselves Control
would just be an admin with extra steps. Revoking a person's approval removes
every grant at once.

Grants reach the phone within a few seconds; no sign-out. If a phone says
*"needs the page permission"*, that's exactly the box to tick.

### Also

- **Help** has a *Permissions* topic, and the crew topics no longer describe
  this as "coming next".
- **Demo mode** shows a small crew with a couple of grants, so the card
  demonstrates itself.

---

## 0.9.76 — 10 September 2026

For the churches now downloading this: help that lives in the app, and the two
systems that were still hardest to set up without me — crew and the lobby tap
discs — walked through step by step.

### New — Help, in the sidebar

Type a question the way you'd actually ask it — *"why does the join link say
closed"*, *"what url goes on the disc"*, *"page not arriving"* — and the
matching topics appear as you type. Each one names the exact page, card and
button, and **Open the setting** takes you there. The **?** on every Settings
card now opens the topic for that card instead of a web page.

It all works offline: the help is built into the app, so it's there on a booth
with no internet and on a phone in a basement.

If you've added a Gemini key (Settings → Gemini Smart Matching), the same box
can **Ask the assistant**, which answers in its own words using only this help
— and is told to say "I don't know" rather than guess. Without a key it still
searches, and offers the full guide and GitHub.

### New — TapLink for any church

TapLink (the lobby NFC discs that follow the service) needed a small Cloudflare
service that each church deploys once — and nothing in the app said so. You
reached *Edge URL* and *API token* with no idea where they came from.

- **Settings → TapLink** now leads with a five-step guide that knows what's
  done: deploy your edge (exact commands, copyable), connect and test, set your
  links, write the discs (the URL is ready to copy), tag your slides. Each step
  turns green from real state, not a checkbox.
- The first-run setup has an optional **Lobby tap discs** step: what it is,
  what you'll need, how long it takes, and a *Skip for now*.
- The starter link file and the edge's README are written for any church now,
  not this one. **docs/TAPLINK.md** is the end-to-end reference.

### New — Crew, explained and configurable

- **Settings → Crew Members** opens with how the system actually works — the
  password decides what a phone may *do*; the account decides *who* it is — and
  a three-step path (crew password → open joining or send invites → approve)
  that shows what's done.
- **Roles you use** is a per-church list offered wherever a role is typed by
  hand, so the leader board and role channels don't fragment into "Camera 1",
  "Cam 1" and "camera1". Roles on people still come from this week's Planning
  Center plan — the app now says so plainly instead of leaving you wondering
  why you can't edit one.
- A personal invite for someone who isn't on this week's plan can carry a
  role.
- **docs/CREW.md** is the reference.

### Fixed — the first-run "Your team" step

It shows the join QR code — and since 0.9.74, the join link only works while
joining is open, so a volunteer scanning it during setup was told *"joining is
closed"*. The step now opens joining for an hour when you reach it and shows
the countdown.

### What's next for crew

Permissions still come from which password a phone typed, not from the person.
Per-person permissions — this volunteer may page, that one may control
ProPresenter — is the next major change, and the reason the crew system got
explained properly first.

---

## 0.9.75 — 9 September 2026

### Fixed — the camera never appeared on a kiosk or a phone

Found while setting up an office kiosk. The **Stage Feed (NDI)** widget could
never work on any screen signed in with the crew (member) password — the office
mini, the switcher PC, every phone — for two separate reasons, both silent:

- Finding cameras and starting a feed were treated as admin-only actions, so a
  viewer screen was refused before it began.
- Even once started, the video stream itself only accepted the **admin**
  password, so a kiosk carrying the crew password was turned away.

The tile simply sat empty with nothing to explain it, while every other widget
on the same screen worked — which is exactly what makes this kind of fault so
hard to place. Viewing a camera is a viewer's job; it works now.

The permission list behind this is now covered by tests, because this is the
second time it has quietly left something out — the sound desk and OBS tiles
were blank on kiosks for the same reason, fixed in 0.9.74.

### Also

- A dashboard that references a widget your build doesn't have now says so on a
  kiosk instead of leaving a blank space. Nobody can edit a kiosk, so reading it
  off the screen is the only way anyone would ever find out.
- **Restoring a backup now restarts ProDeck by itself.** It always said it
  would, but left it as an optional button — and without the restart the
  running app writes its old data straight back over what you just restored.

---

## 0.9.74 — 9 September 2026

A deliberate hunt for bugs rather than a feature release: six parallel audits
across the phone app, the crew tools, the web gateway, data handling, and every
piece of hardware ProDeck talks to. Everything below was found by reading the
code and confirmed against it. Several are things that would have gone wrong on
a Sunday morning with nobody able to explain why.

### One thing changes for your volunteers — read this bit

**The crew join link and the printed poster now only work while you open
joining.** Settings → Crew invite link has a new switch: *Open for 15 minutes*
or *1 hour*, with a countdown and a Close now button.

**Crew who have already joined are not affected** — their phones keep working
exactly as before. This only gates people signing up for the first time.

The reason is blunt: that link handed out a working crew credential to anyone
who asked for it, from anywhere on the internet — not just someone standing in
your building with the poster in front of them. It could not ask for a password,
because a printed QR code has nobody to ask. The only honest gate is *when* it
answers. Open it at the volunteer meeting, let it close itself.

Someone scanning the poster while it is closed now gets *"Joining is closed
right now — ask whoever is at the production computer to open joining"* instead
of a password prompt.

### Fixed — a phone could alarm forever with no way to stop it

Two separate faults, either of which could leave a volunteer's phone sirening
and buzzing every two seconds, mid-service, with nothing on screen to stop it.
Force-quitting the app was the only escape.

- Locking the phone with **PIN again** kept it receiving pages while removing
  the only way to confirm one.
- A phone reconnects its live link every time it wakes from sleep, and each
  reconnect **re-delivered the last page as if it were new** — including one
  that had already been confirmed hours earlier.

A page the booth can no longer accept a confirmation for (because it restarted,
or the page is old) can now be dismissed.

### Fixed — ProDeck said "Connected" when ProPresenter wasn't

If ProPresenter quit, slept, or changed IP address, ProDeck never noticed. The
header kept saying Connected and every panel sat frozen on whatever was true
before it vanished. Worse, the automatic "find ProPresenter again" feature only
runs when ProDeck believes it is disconnected — so the thing built for a
ProPresenter Mac that changes IP could never actually fire. ProDeck now notices
silence and reconnects on its own.

### Fixed — things that could quietly destroy your setup

Seven files ProDeck keeps — your settings, dashboards, crew accounts, Planning
Center assignments, check-ins, routing map, position files — were read in a way
that could not tell *"this file doesn't exist yet"* from *"this file is
damaged"*. Both looked like a brand-new install, and the next save wrote that
emptiness back permanently.

- **Settings** was the most exposed: one damaged character and ProDeck started
  up looking factory-fresh. You would re-enter the two things you noticed, press
  Save, and everything else — Planning Center credentials, console address,
  passwords, tokens — was gone for good.
- **Planning Center assignments** needed no action from you at all. A bookkeeping
  mistake meant ProDeck saved that file on *every* launch whether anything had
  changed or not, so one bad read emptied every mic assignment, key override,
  plan link and position guide by itself.
- **Page notifications** could silently stop working for everyone: a damaged
  file caused ProDeck to mint a new notification key, invalidating every phone
  that had ever signed up. It presented as "pages stopped arriving on Sunday"
  with nothing to point at.

All of these now keep the damaged file, recover from an automatic backup, and
say what happened instead of pretending to be new.

### Fixed — Planning Center

- **Long plans were being cut off.** ProDeck only ever asked for the first page
  of any list and asked for more than Planning Center will give, so anything
  past the first hundred rows was silently missing. Chord charts were the first
  casualty on a plan with several songs.
- **Press Next, nothing happens.** If the check for "who is controlling Live"
  failed for any reason — a slow connection, a busy moment — ProDeck read that
  as "nobody is", and took the action that *releases* control. Pressing it again
  worked, which is what made it so confusing.

### Fixed — crew

- **Checklist items volunteers ticked on their phones were being undone.** The
  booth read the list once at startup and never again, so the next thing the
  operator ticked wrote its stale copy back over everyone's.
- **A volunteer could be locked out of their own account.** Signing out left the
  phone with no way to sign back in — typing your own name said *"that name is
  taken — pick another or log in"*, with no log-in to be found.
- **One typo could lock you out repeatedly.** After a single lockout, the very
  next wrong digit re-locked for another five minutes, indefinitely.
- **A check-in the booth had rejected showed as a green tick** on the checklist
  tab, while the leader's board showed that person as absent.

### Fixed — the sound desk could freeze everything

A console that stopped responding — a hung desk, or a network blip — could
freeze every part of ProDeck that reads it, for the rest of the service.
Separately, an X32/M32 that rebooted mid-service went on showing the mutes and
faders from before it vanished, with a green connected light. On a channel wall
that is the one thing that must never be wrong.

### New — Confidence Banner

Sending to **Confidence** from team chat, and the **Clear confidence banner**
button, have never done anything: the widget they were meant to drive was never
built. It exists now. Put it on a dashboard pointed at a confidence monitor and
messages appear as a large banner, clearing on their own after a minute or the
moment you clear them.

### Fixed — buttons that said they worked when they hadn't

- **Sunday setlist swap** reported *"✓ Placed 4 songs"* while writing your
  playlist back completely unchanged — and on a fresh launch that was the
  *normal* outcome. ProPresenter kept last week's songs.
- **Clear / Clear All** flashed "done" against a dead ProPresenter connection.
- **Renaming desk channels** claimed it wrote twelve names when all twelve
  failed.
- **Settings → Save** did nothing visible when the save failed — indistinguishable
  from a dead button.
- **Lobby TV buttons** reported success when the saved playlist had gone stale
  and the TVs stayed dark.

### Also fixed

- OBS showed a red "no connection to the stream service" at the exact moment
  you went live. Its "% dropped" is relabelled **% skipped (encoder)** — it was
  pointing at the network when the problem was the computer.
- Choosing a second playlist before the first finished loading could trigger the
  **wrong presentation** on the house screens.
- Chord charts wouldn't transpose on any song in a minor key.
- Double-tapping a camera in Multiview left the booth Mac encoding that feed all
  day; a shared camera could be torn away from everyone watching it.
- The LAN relay restarted on every keystroke while editing its address.
- Editing a dashboard and immediately switching pages lost the change.
- Your diagnostics bundle no longer includes your Planning Center application ID
  or your public web address.

### For the technically minded

The web gateway now requires JSON content on its command endpoint, which forces
browsers to ask permission before talking to it — without that, any web page a
crew phone happened to visit on your network could drive ProDeck and read the
replies. Gateway passwords also have attempt limits now; they had none.

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
