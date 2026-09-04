# ProDeck

The production booth, in one app. ProDeck runs on a Mac in your booth and ties
the room together: ProPresenter, Planning Center, your consoles, crew phones,
kiosk screens, lobby NFC discs, and your livestream — all feeding drag-and-drop
dashboards that the whole team can see from anywhere.

Built with Tauri 2 (Rust) + React/TypeScript, plus two small Cloudflare
Workers for the optional cloud features.

## What it does

- **Dashboards** — widget grids (rundown with computed clock times, now/next,
  slide grid, SPL + RTA, timers, readiness lights, stage feed…) served to the
  booth screen, browsers, phones, and kiosks from a built-in web gateway.
- **ProPresenter** — live status, slide thumbnails, transport, layer clears,
  playlist control, slide-note-driven automation.
- **Planning Center** — plans, rundown, teams, per-song key/leader/mic chips,
  PCO Live control, mic-assignment maps that push channel names to the desk.
- **Crew phones** — installable web app: pages that buzz (scoped to who's
  actually serving), team chat, checklists, auto check-in by network or
  geofence, poster-QR signup with booth approval.
- **TapLink** — NFC discs whose destination follows the service: a slide with
  `tap: give` in its notes retargets every disc in the building the moment it
  goes live.
- **Consoles** — Allen & Heath Avantis mirror (names, mutes, faders, scenes) with
  an optional tamper watchdog; song-key MIDI send for FOH plugins.
- **Booth-off resilience** — with the optional Cloudflare setup, your domain
  serves a read-only plan + working chat even when the booth Mac is off.
- **Live viewers** — realtime watch-page count via GA4.

Every feature is independent: run the core with nothing but a Mac,
ProPresenter, and Planning Center, and add the rest when you want it.

## Install (the easy way)

1. **[Download ProDeck.dmg](../../releases/latest)** from the latest release.
2. Open it and drag **ProDeck** to Applications.
3. First open only: right-click ProDeck → **Open** (or System Settings →
   Privacy & Security → **Open Anyway**). macOS asks once because the app is
   free and unsigned — after that it opens normally.

That's it — no toolchain, no terminal. Apple Silicon Mac required.

Then connect your tools inside the app (all in Settings, all optional): the
first-run walkthrough covers ProPresenter, Planning Center, and browser access;
everything else has its own Settings card.

## Build it yourself (developers)

Prefer to build from source, run in dev mode, or make your own signed installer?

```bash
git clone https://github.com/whiteoakmedia/prodeck.git
cd prodeck
bash scripts/setup.sh            # prereqs, config, run in dev mode
bash scripts/setup.sh --install  # …make it a permanent, self-relaunching booth install
bash scripts/build-dmg.sh        # …or just produce a fresh ProDeck.dmg
```

The setup script checks prerequisites (Xcode tools, Rust, Node, OpenSSL),
asks for your environment as it goes, and writes site-specific values to
**gitignored local files** — your fork never carries your church's config in
code.

## The full guide

[`docs/ADOPTERS_GUIDE.html`](docs/ADOPTERS_GUIDE.html) is the honest
evaluate-then-adopt handbook: every feature with its requirements, what's
site-specific, realistic effort estimates, and the phased path from a spare-Mac
trial to tap discs, kiosks, and a booth-off-resilient domain.

## Requirements

- Apple Silicon Mac for the booth app (clients can be anything with a browser)
- ProPresenter 7 with its network API enabled
- Planning Center Services
- Optional per feature: Cloudflare (free) + a domain, an audio input, an
  Avantis, NDI, a Stream Deck + Bitfocus Companion, NFC tags, GA4

## Honest posture

This is one church's production tool, shared as-is: no support contract, no
warranty, and a single maintainer whose priority is his own Sunday. It fails
soft by design — nothing here can take down ProPresenter, your consoles, or
your stream — but read the guide's limitations section before betting a
service on it.

## Contact

Zach Green — zach@whiteoakmedia.io
