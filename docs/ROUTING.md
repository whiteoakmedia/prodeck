# Routing — the signal map and the "No sound?" walk

Every console channel, traced back to the thing that makes the sound: the
stage socket, the wireless pack, the playback laptop. Written for the
volunteer who has to answer "why is there no sound" alone at 9am. This mirrors
the in-app Help topics *Building your routing map* and *When something has no
sound*; the app's Help is the canonical copy.

## The one rule

**Channel names change every service. Numbers don't.** Console channel 39 is
channel 39 every week; who is singing into it changes. So the map is keyed by
numbers — console channel, door socket, receiver slot — and the two things that
move arrive live:

| changes weekly | where ProDeck gets it |
|---|---|
| channel names | the desk mirror (Avantis, dLive, SQ, X32/M32) |
| who is on which mic | Planning Center mic assignments |

That is why the walk can say "Ruth's mic — channel 39 is open" while the map
itself says nothing about Ruth.

## Building the map

**Routing → Edit → Paste patch list.** One line per channel:

```
CH    NAME       PORT         SOCKET   UPSTREAM
1     Kick IN    SLink        1        stage 1
39    vox 3      I/O Port 1   43       ULXD4Q-5-8 07
11-12 Loop (st)  I/O Port 1   1+2      Playback-Mac 01+02
13    Synth L    —            —        not patched
```

Tabs (straight from a spreadsheet) or commas. A header row is fine.

- **PORT** — the door the signal comes in through. SLink / stage box, I/O Port 1
  (Dante), Local (an XLR on the rack), ME, Analog.
- **SOCKET** — the number on that door. `1+2` for a stereo pair.
- **UPSTREAM** — what feeds the socket. `stage 41` is a stage panel socket;
  `ULXD4Q-5-8 07` is slot 7 on that receiver; `Playback-Mac 05` is output 5 on
  that machine. ProDeck classifies it from the words (receiver, stage, laptop,
  Spotify…) and picks the right checklist.

Existing channels with the same number are updated in place; their steps,
notes and verification survive. **Copy as text** gives the whole map back in
the same format.

### Steps, dead sockets, verification

Click a row for its steps — what to walk to when that channel is the suspect.
Every kind of source ships with a template (pack on · RF light · battery ·
swap the pack, keep the receiver). Edit the text to name *your* receivers,
panels and sockets: second person, one action per line, name the physical
thing.

Tick **Dead** on a socket that looks perfectly normal and goes nowhere. It is
skipped in the walk and the volunteer is told to use the one beside it.

**Mark all verified** (or the ✓ on a row) stamps today. The map nags after
90 days. Maps rot; the person who just fixed a mic is the best verifier there
will ever be.

### Stage pockets

**Routing → Stage** draws the wall: each floor pocket (panel, box) as its
sockets, and for every socket the door input it reaches and the console
channel that is, with the desk's live state and any external insert on the
channel. Add pockets in Edit — a name and a socket range. Free sockets are
dashed; mark a socket **dead** when it looks normal and goes nowhere. Phones
get the same tiles under *No sound? → Stage*, which is where "which socket do
I plug into" gets answered on the floor.

### Things to watch

Known faults with a symptom — "synth L and R come from different machines".
If a walk crosses one, it shows before anything else.

## The map as a picture

**Routing → Map** draws the same map as boxes and lines: sources → doors →
channels → buses → outputs → destinations, one column each. Colour is the
door (amber SLink, blue Dante, green Local); the number on a line is the
socket. Layout is by kind, never by hand — nudge a box and only that box
moves. *Only SLink / Only Dante / Only Local* show one door's world.

Live paint: muted channels turn amber, open ones show their fader, dead
sockets are dashed, unverified hops dotted, and a line glows when ProDeck
hears signal on its own input. Double-click a box to walk it.

In Edit: drag right-port → left-port to connect (kinds decide what may
connect; a link into a door or channel asks for the socket), select + Delete
to remove, **Add** for a new node in its column, then Save. The node view is
a separate download the phones never fetch.

## The walk

**Phone: Home → No sound?** **Booth: Routing → No sound?**

Pick a person, a channel or a place. Then:

1. **What ProDeck already checked.** Channel muted or fader down on the desk →
   ✗ with the fix. Channel open → ✓, with the fader level and the desk's name
   for it. Desk connected and the door patched → ✓. Signal reaching ProDeck's
   own input → ✓ or ✗. A twin channel on the same socket is explained.
2. **What is left to walk to, most likely first.** Source steps, then the door,
   then the desk channel — minus anything already ticked. Rules appear under
   the step they explain: gain belongs to the socket; stereo is odd/even.

Every ✓ is a place nobody had to walk to. Nothing here reasons or guesses; if
ProDeck can't see a hop it says so and hands over the checklist.

Phones read the map; the booth edits it. Booth edits reach phones live.

## Ask ProDeck

With an Anthropic key in **Settings → Troubleshooter**, a box appears above
the walk: type what is wrong in your own words. The answer is grounded — the
model can only use the routing map, your knowledge files (plain markdown in
a folder on the booth) and the desk's live state, must cite every building
fact (shown as links to the walk), and cannot change anything. Its general
method ships with ProDeck as text (`src/assist/doctrine.md`) so it can be
read and improved. Phones ask through the booth; the key never leaves it.
Everything asked is logged on the booth. Spec: `design/TROUBLESHOOTER.md`.

## Coming from the old Routing page

Maps saved by ProDeck 1.0 (linear chains of hops) are converted on first
open: every hop becomes a node with its steps kept, kinds guessed from
position, flagged *imported* so you can assign them. Nothing is dropped, and
nothing is written until you press Save.

## What is deliberately not here

- Any AI reasoning over the map. A model will confidently invent a socket.
- Free-form canvas placement. The node view lays out by kind; a nudge moves one box.
- Reading A&H input patching over MIDI — the protocol does not expose it.
