# ProDeck — UI/UX Design Brief

A component-by-component functional specification for a designer to produce a fresh visual design.

> **Scope of this document.** This brief describes *what each component is, the data it presents, the states it can be in, and how the operator interacts with it.* It intentionally says **nothing about the current look** — no colors, type, spacing, iconography, or styling. Those are yours to design. Where a state "must be distinguishable" (e.g. a live item, an error), that is a functional requirement about hierarchy/meaning, not a prescription of how to express it.

---

## 1. Product overview

**What it is.** A desktop control surface for running live church/production services. One operator uses it during a service to drive presentation software (ProPresenter), follow the service plan (Planning Center Online, "PCO"), monitor audio, watch video feeds, and track how the service is running against plan.

**Who uses it & where.** A single technical operator at front-of-house or a production booth, usually in **low ambient light**, often **glancing from a short distance** while doing other things. The app frequently runs on a secondary monitor alongside other production tools.

**The core jobs it does**
1. **Drive ProPresenter** — advance slides, trigger looks/macros/props/messages, control timers, post stage messages, clear layers.
2. **Follow the plan (PCO)** — load a service plan, see the rundown ("show flow"), see who's scheduled, run PCO Live (next/previous item), and keep PCO and ProPresenter in sync in either direction.
3. **Manage microphones** — assign physical mic numbers to the people scheduled on the plan, with reusable templates and conflict detection; show a "mic wall" view.
4. **Monitor audio** — an SPL (loudness) meter and an RTA (frequency spectrum) fed from an audio input (e.g. a measurement mic via Dante), with calibration against a real SPL meter.
5. **Monitor video** — preview NDI video sources individually or as a multiview.
6. **Captions** — live speech-to-text into a lower-third, with manual override.
7. **Track the service** — planned vs. actual duration per item, plus loudness per item.
8. **Build custom dashboards** — the operator composes their own screens from a library of widgets on a drag/resize grid.

**Design priorities (in order)**
1. **Glanceability under pressure.** The operator must read the critical state (what's live, what's next, are we over time, how loud are we) in a fraction of a second, possibly from across a booth.
2. **"On-air" clarity.** The single most important signal in the whole app is *what is currently live*. This must be unmistakable everywhere it appears.
3. **No costly mis-clicks.** Transport and destructive actions happen during a live service. Affordances must be clear and accidental activation hard.
4. **Tolerates constant motion.** Meters, spectrum, and timers update many times per second. The design must not flicker or fatigue when data is moving continuously.
5. **Dense but scannable.** Operators want a lot on screen at once; grouping and hierarchy must keep it legible.

**Platform & canvas**
- Desktop app (resizable window). Mouse/trackpad driven.
- Two themes exist today (a default dark and a "midnight"); please deliver a **token-based theme system** (light/dark or multiple) rather than one-off colors. A dark theme is the primary use case given the environment.
- The Dashboard is a **12-column grid**, base row height ~70px, with per-widget minimum of 2×2 cells. Widget "footprint" hints below are given in grid cells (width × height) to convey relative size/density — not exact pixels.

---

## 2. Global shell & navigation

### 2.1 App shell + sidebar navigation
- **Purpose:** persistent left navigation between the six top-level screens.
- **Content:** brand mark + product name; a vertical list of six destinations, each an **icon + label**: Dashboard, ProPresenter, Multiview, Captions, Planning Center, Settings; a footer **connection status** element.
- **States:**
  - Nav item: default / active (current page) / hover.
  - **Collapsed:** the entire sidebar can be hidden to maximize content area; when hidden, a small floating "show" affordance brings it back. Design both the collapse control (in the sidebar) and the reveal control (floating over content).
  - Connection footer: **online** (shows the connected host/name) vs **offline** ("Disconnected").
- **Interactions:** click to switch page; toggle collapse; collapse state persists between launches.

### 2.2 Page header (pattern, used by most screens)
- **Content:** screen title; optional right-aligned actions (buttons) and/or a status chip.
- Needs to work with 0–4 trailing controls and an optional status chip.

---

## 3. Shared primitives (design these once; reused everywhere)

These appear across many screens; the designer should produce a small system for them.

- **Buttons.** Variants: **primary** (main action), **default**, **ghost** (low-emphasis), **danger** (destructive/stop). Modifiers: **small**, **icon** (icon + label or icon-only), **toggle** (on/off — used for Edit, Auto, Follow Pro, Calibrate, etc.; needs a clear active vs. inactive read), **disabled**.
- **Inputs.** Text, number, password, and **select/dropdown**. A common **field** pattern = label + control (stacked) and an inline **field-row** pattern = input + button(s) on one line.
- **Card.** A titled container: header (title + optional count, chip, or inline controls) and a body. The workhorse layout block on every non-dashboard page.
- **Chips / badges.** Small status tokens: generic **count**, **online**, **subtle/state** (e.g. a timer state), and a **LIVE badge** that pairs with a recording dot.
- **"Rec" / live dot.** A small indicator denoting on-air/live/recording; appears on video tiles, live badges, and PCO live state. Motion (e.g. a pulse) is acceptable and probably desirable, but must not be distracting at scale.
- **Banner.** A full-width inline message: informational, **warn**, and **danger** variants; may include a trailing action button (e.g. "Connect").
- **Empty state.** Icon + heading + supporting copy + optional call-to-action button. Used when a screen/widget has no data yet.
- **Avatar.** A person image; **falls back to initials** when no photo or the image fails to load. Multiple sizes (≈24–52px equivalents). Used in team and mic components.

---

## 4. Screens (pages)

### 4.1 Dashboard
The operator's customizable home. A grid of widgets they arrange themselves.

- **Purpose:** compose and operate custom layouts of live widgets.
- **Content / structure:**
  - **Dashboard tabs** — multiple named dashboards; a row of tabs plus an **add (+)** tab.
  - **Action area** — an **Edit** toggle. In edit mode it also exposes **Rename**, **Delete**, and **Add Widget**.
  - **PCO switcher bar** (see 5.2) sits directly under the header.
  - **Connection banner** — when ProPresenter is not connected: a banner explaining live widgets are idle, with a **Connect** action.
  - **Widget picker** — when adding: a browsable list of every widget type (by label) to insert.
  - **The grid** — widgets laid out on a 12-col grid.
  - **Empty dashboard** — when a dashboard has no widgets: empty state with a "Start building" CTA.
- **Widget chrome (frame around every widget):** a title bar showing the widget's name, which doubles as the **drag handle** in edit mode, plus a **remove (×)** affordance in edit mode; and the widget body below.
- **States:**
  - **View mode** — widgets static, no drag/resize, no remove buttons.
  - **Edit mode** — widgets draggable + resizable; remove buttons shown; picker available. The visual difference between view and edit should be obvious.
  - Per-widget **config mode** — some widgets switch their body to a small settings form while editing (pick a device, source, timer, screen, calibration, etc.). Design a consistent "widget is being configured" body treatment.
- **Interactions:** switch tabs; add/rename/delete dashboards; toggle edit; add/remove widgets; drag to move; drag corner to resize. Layout changes persist automatically.

### 4.2 ProPresenter control
Direct manual control of the presentation software. Shown only when connected; otherwise shows the **Connect card** (5.1) centered.

- **Cards (top to bottom):**
  - **Transport** — large **Previous** / **Next** actions (the most-used controls in the app — should be big and unmistakable), plus a wrapping **Clear** row with one button per layer: Audio, Slide, Media, Video Input, Props, Messages, Announce.
  - **Looks** — list of looks; each has a **Trigger** action. Shows a count.
  - **Macros** — list; each has a **Run** action. Count.
  - **Props** — list; each has **Show** + **Clear**. Count.
  - **Messages** — list; each has **Show** + **Clear**. Count.
  - **Timers** — list; each row: name + **state chip** (running/stopped/etc.) + **Start/Stop/Reset**.
  - **Stage Message** — text input + **Send** + **Clear** to post a message to performers' stage displays.
- **Shared sub-component — Trigger list row:** an item name + one or two action buttons. Empty-list message per section.
- **States:** disconnected (connect card) / connected; loading (Refresh in progress); empty per section.

### 4.3 Multiview (NDI video)
- **Purpose:** preview one or many NDI video sources.
- **Content:** a **Scan NDI** action in the header; a **sources sidebar** listing discovered NDI feeds (click to add); a **viewer grid** of video tiles.
- **Video tile:** the live video; an **overlay** with a live dot + source name; a **footer** with the source address + **Remove**.
- **States:** scanning / no sources found / sources listed; viewer empty (prompt to add) / tiles present; per-tile "receiver unavailable" fallback.

### 4.4 Captions
- **Purpose:** live speech-to-text to a lower-third, with manual entry.
- **Content:**
  - Header with a **status chip** (listening/idle).
  - A **warning banner** when the transcription engine isn't fully configured (with a pointer to Settings; manual entry still works).
  - **Controls row** — input-device select + **Start Listening** / **Stop**.
  - **Audio level bar** (a simple horizontal level indicator).
  - **Lower-Third Preview** card — a "stage" area showing the most recent caption as it would appear on screen.
  - **Transcript** card — a scrolling, auto-scrolling feed of timestamped caption lines + **Clear**; plus a manual **caption input + Push** to send text straight to the lower-third.
- **States:** listening vs idle; configured vs not; transcript empty vs populated; error message.

### 4.5 Planning Center
The plan/rundown hub. Two top-level states: **not connected** and **connected**.

- **Not connected:** a connect card — Application ID + Secret (password) inputs, **Connect**, an explanatory hint, and an error line.
- **Connected header:** title + a **"signed-in-as" chip**; a **service-type** select; a **plan** select (date — title); **Sync / Stop Sync** (Stop is destructive-styled, with a live dot); **Refresh**. A status banner appears below for messages.
- **No plan chosen:** empty state ("Select a plan").
- **Plan loaded — a four-card working area:**
  1. **Show Flow** (the rundown). Header shows total length, a **LIVE** badge when a live item exists, a **Take Control** button (only when the app isn't currently the PCO Live controller), an **Auto** toggle (auto-trigger the linked ProPresenter presentation when the live item changes), a **Follow Pro** toggle (advance PCO Live to match ProPresenter by name), and **Previous / Next**. The list contains:
     - **Headers** — section dividers within the plan (title only).
     - **Items** — a type indicator, the title, a **length**, a **LIVE** marker when live, and a **linking control**: either a **"link"** action (opens a presentation picker) or, when linked, a **▶ presentation-name** button (triggers that presentation) plus an **unlink (×)**.
     - **Link picker** (expands under an item) — a search field + a results list of ProPresenter presentations (or a "connect ProPresenter" note when unavailable).
  2. **Team** — count; people grouped by team; each row: avatar + name + position + a **status** (e.g. confirmed / unconfirmed / declined — needs distinct reads).
  3. **Mic Assignments** — a **mic count** number input; a grid of **mic cards** (see 6.2); a hint line. Empty when nobody is on a mic.
  4. **Mic Positions** — a list of every position seen on the plan/template; each row: a **checkbox** (is this position mic-eligible?) + the position name + a **default-mic select**. A hint explains template behavior. Empty until a plan loads.
- **States:** not connected / connected; no plan / plan loaded; syncing vs not; live vs not; "we have control" vs "take control"; per-card empty states.

### 4.6 Settings
A standard settings form, **Save** in the header (with a transient "Saved ✓" confirmation), and a status banner. Grouped into cards:
- **ProPresenter** — host/IP, port, auto-connect-on-launch checkbox.
- **Audio & Captions** — default audio input select; transcription engine binary path; model path.
- **Control Inputs** — OSC port + Start/Stop; MIDI input select + Connect/Disconnect; a hint describing the MIDI/OSC mappings; a small **log strip** showing the last few received control events.
- **Cloud Relay** — relay URL + device name + Connect/Disconnect.
- **Appearance** — theme select.
- **States:** unsaved/saving/saved; each toggle's on/off (OSC running, MIDI connected, relay connected).

---

## 5. Connection & control components

### 5.1 ProPresenter Connect card
- **Purpose:** find and connect to a ProPresenter instance.
- **Content:** a **Scan** action; a list of **discovered services** (each: live dot + name + a kind tag "API"/"Stage" + host:port); manual **host** + **port** inputs; **Connect**; an error line; a hint about enabling the network API.
- **States:** disconnected (form) / connected (shows host + Disconnect); scanning; connecting/busy; error.

### 5.2 PCO Switcher (compact bar on the Dashboard)
- **Purpose:** quick service-type/plan switching and live-follow control without leaving the dashboard.
- **Content:** a "PCO" label; **service-type** select; **plan** select; a **live** chip when syncing; a **Follow Pro** toggle; and a **match indicator** that appears while Follow Pro is on showing **"✓ matched"** vs **"✕ no match"** (with the ProPresenter presentation name on hover).
- **States:** hidden entirely until PCO credentials exist; syncing vs not; follow on/off; matched / no-match.
- **Note for design:** the **match indicator** is a live trust signal during a service ("is the follow actually working right now?") — it needs a confident positive read and a clearly different negative read.

---

## 6. Reusable domain components

### 6.1 Avatar — see 3 (shared primitives).

### 6.2 Mic Card
- **Purpose:** assign a physical mic number to one scheduled person.
- **Content (stacked, reads top→bottom):** the person's **photo** (avatar w/ initials fallback) → **name** → **position** → a **mic-number select**.
- **States / variants:**
  - **From template** — the mic value was auto-filled from a position template (vs. manually set). Must read as *secondary/auto* rather than a deliberate user choice.
  - **Conflict** — the same mic number is assigned to more than one person. This is an **error** and must read as such, on both the card and its select.
  - Empty (no mic assigned).

### 6.3 Mic Select
- A dropdown of "—" (none) + 1..N (N = configured mic count). Has **template** and **conflict** variants (see above). Used standalone (Mic Positions defaults) and inside the Mic Card.

### 6.4 RTA Graph (frequency spectrum)
- **Purpose:** a classic real-time analyzer — show the audio frequency spectrum.
- **Content:** a row of **log-frequency bars** (≈31 Hz to 16 kHz), each bar's height = level in that band; **peak-hold caps** that briefly hold each band's max then decay; a faint **dB grid**; and a **frequency axis** labeled at musical decades (63, 125, 250, 500, 1k, 2k, 4k, 8k).
- **Behavior:** updates ~15×/second — continuous motion is the norm; caps fall slowly. Level should map to bar height in a way that's readable at a glance (louder = taller). Consider how color/intensity can encode level without relying on it alone.
- **States:** analyzing (data flowing) / "analyzing…" (just started, no bands yet) / monitoring-off.

### 6.5 Slide thumbnail
- **Purpose:** show a single slide image from ProPresenter.
- **States:** image loaded / placeholder while loading / **"No preview"** when unavailable. Used live where the image changes as slides advance (and neighbors are prefetched, so changes are fast).

### 6.6 Icon set
A small consistent icon family is needed for: dashboard, slides/presentation, grid/multiview, captions, calendar/planning, settings, previous, next, clear, search/refresh, microphone. Plus the live/rec dot. Please design a cohesive set.

---

## 7. Widgets (the Dashboard library)

Every widget shares the **widget chrome** (4.1). Each entry below is the widget *body*. Footprint = default grid cells (w×h on a 12-col grid). Many widgets show a **"Not connected"** body when ProPresenter is down — design that shared idle/disconnected body once.

**ProPresenter-driven**
1. **Slide Preview** (5×5) — a **screen selector** (Program/active slide, or a specific output screen), the **live slide** thumbnail, a meta line (screen/presentation name + slide number), per-screen **layer chips** (which layers are on), and a **"slide layer off"** overlay/dim when that screen's slide layer is disabled.
2. **Current / Next** (6×4) — two slide thumbnails side by side, tagged **LIVE** and **NEXT**.
3. **Layers** (3×5) — a list of presentation layers; each shows on/off state and, when on, a **clear** action.
4. **Timer** (4×3) — either a **featured timer** (name + large time + Start/Stop/Reset) or, if none is pinned, a **compact list** of all timers (name + time). Time has **state variants** (e.g. running / stopped / overrun) that must be distinguishable. Config: pick which timer. Empty/disconnected states.
5. **Stage Message** (4×3) — shows the current stage message + an input with **Send** / **Clear**.
6. **Video Input (NDI)** (4×4) — a single assigned NDI feed with an overlay (live dot + source name). Config: source select + **Scan**. States: no source assigned / connecting / streaming.

**Planning Center-driven**
7. **Show Flow** (4×6) — compact rundown: a LIVE badge + Prev/Next, then the item list (headers vs. items, live highlight, item type indicator, length). Empty states for no plan / no items.
8. **Now / Next** (4×3) — the current item (**NOW**) and the next item (**NEXT**), each with title + length. The at-a-glance "where are we" widget.
9. **Team** (3×5) — people grouped by team: avatar + name + position + status.
10. **Mic Assignments** (4×5) — a grid of **Mic Cards** (6.2) for everyone on a mic, with conflict + template states. Empty when nobody's on a mic.
11. **Mic Wall** (12×6) — a **Shure-style channel wall**: a row of vertical **channel strips**, each with a large **channel number**, the performer's **photo** (or a solid fallback when no photo), the performer's **first name** over the photo, and the **role/position** at the foot. This is a "big board" view meant to be read across the room. Empty when no assignments.

**Audio**
12. **SPL Meter** (4×3) — a large **dB SPL** numeric readout; a horizontal **meter** with a **peak marker**; a footer line (raw dBFS + held peak); a **Cal** toggle and a **Monitor/Stop** control. Calibration sub-panel: prompt to play a steady tone, read a real SPL meter, and enter the value to calibrate. Config: input device + a calibration number. Idle vs running.
13. **RTA Spectrum** (5×3) — wraps the **RTA Graph** (6.4) with a start/idle state and a device config.
14. **SPL + RTA** (5×5) — the combined audio widget: top row = dB SPL readout + Cal/Monitor controls; a meter bar; the RTA spectrum below; a footer with raw dBFS + peak; plus the calibration sub-panel. Idle vs running.

**Utility**
15. **Clock** (4×2) — current time + date; config toggles 12/24-hour.
16. **Captions** (6×3) — a live audio-level bar + the last few caption lines; "listening…" vs "idle."
17. **Notes** (3×3) — a free, editable, auto-saving text area.
18. **Checklist** (3×4) — a checkable to-do list: toggle done, add via enter, delete items; done items read as completed.
19. **Service Tracking** (6×6) — a table comparing **planned vs. actual** per plan item with loudness. Header: planned/actual **totals** + **Reset**. Columns: **Item**, **Plan** (planned length), **Actual** (measured length), **Δ** (delta, with **over/under** semantics — over time vs under time must read differently), and **SPL peak/avg** for that item. The currently-live row is highlighted. Empty when no plan is loaded.

---

## 8. Cross-cutting states & behaviors (must be consistent everywhere)

Design these as a coherent language, because they recur across many components:

- **Connected vs. disconnected** — most live surfaces have an "idle/not connected" body. One shared treatment.
- **LIVE / on-air** — the highest-priority signal. Appears as: live plan item (Show Flow, Now/Next, Service Tracking row), live timer state, LIVE badges, video "rec" dots, PCO sync state. It must be the thing the eye finds first, consistently.
- **Continuous real-time motion** — SPL meter, RTA spectrum, timers, audio level bars update many times per second. Must be smooth and non-fatiguing; no layout jitter as numbers change (consider tabular/monospaced figures for changing numerics).
- **Conflict / error** — e.g. a mic assigned to two people. A consistent error read.
- **Auto/derived vs. user-set** — e.g. a mic value from a template vs. chosen by hand. A consistent "secondary/auto" read.
- **Over/under target** — e.g. actual time vs planned (Service Tracking Δ). A consistent positive/negative semantic.
- **Match / no-match** — Follow Pro's live trust indicator. Confident positive vs. clear negative.
- **Edit vs. view** — the Dashboard's two modes must be obviously different, and edit-only affordances (drag handles, remove, resize, picker) should appear only in edit.
- **Empty / loading / error** — every data surface needs all three.

---

## 9. Domain glossary (so the design reads correctly)

- **ProPresenter** — the presentation software that puts lyrics/slides/media on the screens. The app remote-controls it.
- **Look** — a saved arrangement of what shows on which output screen.
- **Macro** — a saved action/sequence in ProPresenter.
- **Prop** — an on-screen overlay graphic.
- **Message / Stage Message** — text shown to the audience (message) or to performers on stage displays (stage message).
- **Layer** — ProPresenter composites output as layers (audio, slide, media, video input, props, messages, announcements); each can be cleared independently.
- **Timer** — countdown/count-up clocks managed in ProPresenter (e.g. countdown to service start).
- **PCO (Planning Center Online)** — the service-planning service. Holds **service types** (e.g. "Sunday Morning," "Youth"), each with **plans** (one per dated service), each with **items** (the rundown) and **headers** (section dividers), and **team members** scheduled with **positions** and confirmation **status**.
- **PCO Live** — running the plan live; the app can step **next/previous item** and indicate the **live item**. (There's no random-jump; movement is sequential.)
- **Show Flow / rundown** — the ordered list of plan items.
- **Follow Pro** — a mode where the app watches what's live in ProPresenter and **advances PCO Live to the matching item by name**.
- **Auto (auto-advance)** — the inverse: when the PCO live item changes, **trigger the linked ProPresenter presentation**.
- **Link** — an operator-made association between a plan item and a specific ProPresenter presentation.
- **Mic roster** — the filtered list of scheduled people whose **position** is mic-eligible.
- **Mic template** — default mic-number-per-position rules (e.g. "Worship Leader → 6") applied automatically.
- **Mic conflict** — the same physical mic number assigned to two people.
- **SPL** — Sound Pressure Level (loudness) in dB; what a handheld meter reads in the room.
- **dBFS** — the digital signal level the app measures; **calibration** maps dBFS to real-room dB SPL using a one-time reading from a physical meter.
- **RTA** — Real-Time Analyzer; shows energy across frequency bands.
- **NDI** — network video; the app receives NDI sources for preview/multiview.
- **Multiview** — several video feeds tiled together on one screen.

---

## 10. Component checklist (one design per item)

**Shell & primitives:** sidebar nav (+ collapsed/reveal) · connection status pill · page header · buttons (primary/default/ghost/danger/small/icon/toggle/disabled) · text/number/password input · select · field & field-row · card · chips/badges (count/online/state/LIVE) · live/rec dot · banner (info/warn/danger, with action) · empty state · avatar (photo/initials).

**Screens:** Dashboard (tabs, edit/view, picker, widget chrome, empty, connection banner) · ProPresenter (transport, clear row, looks, macros, props, messages, timers, stage message, trigger row) · Multiview (sources list, video tile, empty) · Captions (controls, level bar, lower-third preview, transcript feed, manual push) · Planning Center (connect, header controls, show flow + headers/items/link/link-picker, team, mic assignments, mic positions, empties) · Settings (5 cards + save/saved + log strip).

**Connection/control:** ProPresenter Connect card · PCO Switcher bar (+ match indicator).

**Domain components:** Mic Card (default/template/conflict) · Mic Select (default/template/conflict) · RTA Graph (analyzing/idle) · Slide Thumbnail (loaded/loading/no-preview) · icon set.

**Widgets (19):** Slide Preview · Current/Next · Layers · Timer (featured + list) · Stage Message · Video Input (NDI) · Show Flow · Now/Next · Team · Mic Assignments · Mic Wall · SPL Meter · RTA Spectrum · SPL+RTA · Clock · Captions · Notes · Checklist · Service Tracking — each with its connected/idle/empty/config states.

**Cross-cutting languages:** connected/disconnected · LIVE/on-air · real-time motion · conflict/error · auto/derived · over/under · match/no-match · edit/view · empty/loading/error.
