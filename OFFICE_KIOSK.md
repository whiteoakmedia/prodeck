# Office Kiosk (Mac mini)

A chrome-less, read-only ProDeck screen for an unattended machine. It pins ONE
dashboard (edited on the booth Mac like any other), reconnects forever, and
shows a "Command Center offline" splash whenever the booth Mac is unreachable —
recovering by itself, including after ProDeck updates.

## The URL

```
http://command-center.local:8088/?kiosk=Office&token=<access password>
```

- `kiosk=` — the dashboard name to pin (create/edit it on the booth Mac; the
  kiosk re-reads the layout every 60s and on every reconnect). Wrong name →
  the screen lists the available dashboards.
- `token=` — the web access password, carried in the bookmark so a machine
  with no keyboard never types it.
- `command-center.local` — the booth Mac's Bonjour name; re-resolves on every
  attempt, so booth IP changes never require reconfiguring the mini.

## One-time Mac mini setup (borrow a keyboard once)

1. System Settings → Users & Groups → auto-login the kiosk user.
2. System Settings → Energy: never sleep; **Start up automatically after a
   power failure**. Displays never sleep (or `sudo pmset -a displaysleep 0
   sleep 0`).
3. Install Chrome, then make it launch fullscreen at login:
   - Script Editor → paste →
     `do shell script "open -na 'Google Chrome' --args --kiosk --noerrdialogs --disable-session-crashed-bubble --autoplay-policy=no-user-gesture-required 'http://command-center.local:8088/?kiosk=Office&token=PASSWORD'"`
     (the autoplay flag lets the Overflow Listen widget start booth audio by
     itself — add that widget to the kiosk dashboard for always-on audio, and
     control loudness on the TV)
   - Save as an Application, add it to Login Items.
4. Reboot to test: it should land on the pinned dashboard with zero input.

Chrome's `--kiosk` gives true fullscreen with no bars; if ProDeck (or the
whole booth Mac) is down at boot, the offline splash appears once the page has
loaded at least once before — for a cold first load while the booth is down,
Chrome shows its retry page and the login-item relaunch after the next reboot
(or the booth returning before the mini boots) covers it. Practical order:
boot the booth Mac first, mini second — or just leave the mini on always,
which is the design.

## Behavior summary

- Booth reachable → pinned dashboard, live, nothing interactive
  (pointer-events disabled — a stray mouse can't shift anything).
- Booth unreachable ≥ ~10s → fullscreen "Command Center offline —
  reconnecting…" splash with last-seen time.
- Booth returns → the page reloads itself (fresh state + fresh frontend if
  ProDeck was updated during the outage).
- Layout changes made on the booth Mac appear within ~60s.
