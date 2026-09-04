#!/bin/bash
# Install the freshly built ProDeck.app into /Applications and hand the
# process to the watchdog LaunchAgent (com.prodeck.watchdog), so launchd owns
# it and relaunches it on any crash.
#
# Order matters, learned the hard way (SIGKILL "Code Signature Invalid"
# crash-loops during installs):
#   1. Boot OUT the watchdog first — otherwise it treats the install as a
#      crash and relaunches the half-copied bundle, which the kernel kills,
#      repeatedly, until the copy finishes.
#   2. Wait for the process to actually EXIT, not a fixed sleep — copying
#      over a running binary invalidates its signature pages mid-flight.
#   3. Swap the bundle via rename (atomic per path), never ditto-in-place.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BUNDLE="$REPO_DIR/src-tauri/target/release/bundle/macos/ProDeck.app"
APP="/Applications/ProDeck.app"
PLIST="$HOME/Library/LaunchAgents/com.prodeck.watchdog.plist"
UID_N="$(id -u)"

# Gate on signature + version before touching /Applications. Capture codesign
# output rather than piping into grep -q: with pipefail, grep -q's early exit
# SIGPIPEs codesign and fails the pipeline even on a match.
codesign --verify --deep --strict "$BUNDLE"
SIGN_INFO="$(codesign -dv "$BUNDLE" 2>&1)"
case "$SIGN_INFO" in
  *"flags=0x0(none)"*) ;;
  *) echo "refusing: unexpected signing flags (expected flags=0x0)"; exit 1 ;;
esac
V="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$BUNDLE/Contents/Info.plist")"
echo "installing ProDeck $V"

# 1. Take the watchdog out of the picture so nothing respawns mid-install.
launchctl bootout "gui/$UID_N/com.prodeck.watchdog" 2>/dev/null || true

# 2. Ask nicely, then wait for a REAL exit (up to 15 s), then insist.
osascript -e 'tell application "ProDeck" to quit' 2>/dev/null || true
for _ in $(seq 1 30); do
  pgrep -x prodeck >/dev/null || break
  sleep 0.5
done
if pgrep -x prodeck >/dev/null; then
  pkill -x prodeck || true
  sleep 1
fi

# 3. Stage next to the target, then swap by rename.
rm -rf "$APP.new" "$APP.old"
ditto "$BUNDLE" "$APP.new"
[ -d "$APP" ] && mv "$APP" "$APP.old"
mv "$APP.new" "$APP"
rm -rf "$APP.old"

# 4. Watchdog back in charge; kickstart launches the new build under launchd.
#    Refresh the plist from the repo template first — the binary name inside
#    the bundle changed once (legacy rename) and can again.
if ! cmp -s "$REPO_DIR/deploy/launchagents/com.prodeck.watchdog.plist" "$PLIST"; then
  cp "$REPO_DIR/deploy/launchagents/com.prodeck.watchdog.plist" "$PLIST"
fi
launchctl bootstrap "gui/$UID_N" "$PLIST"
launchctl kickstart -k "gui/$UID_N/com.prodeck.watchdog"

echo "ProDeck $V running under com.prodeck.watchdog"

# 5. Keep the edge-served shell (crew-edge static assets = this repo's dist/)
#    in lockstep with the build just installed, so the booth-off fallback
#    never mixes an origin index.html with stale edge asset hashes. Non-fatal:
#    installing while offline just leaves the previous edge copy in place.
EDGE_CFG="wrangler.jsonc"
[ -f "$REPO_DIR/crew-edge/wrangler.local.jsonc" ] && EDGE_CFG="wrangler.local.jsonc"
if (cd "$REPO_DIR/crew-edge" && npx wrangler deploy -c "$EDGE_CFG" >/dev/null 2>&1); then
  echo "crew-edge shell updated to match $V"
else
  echo "WARN: crew-edge deploy skipped/failed — edge booth-off shell may lag this build"
fi
