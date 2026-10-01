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
  *)
    echo "refusing: the bundle is not signed with your identity (expected flags=0x0(none))."
    echo "  Sign it first, WITHOUT hardened runtime, then rerun:"
    echo "    codesign --force --deep --sign \"ProDeck Self Sign\" \"$BUNDLE\""
    exit 1 ;;
esac
V="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$BUNDLE/Contents/Info.plist")"
echo "installing ProDeck $V"

# 1. Take the watchdog out of the picture so nothing respawns mid-install.
launchctl bootout "gui/$UID_N/com.prodeck.watchdog" 2>/dev/null || true

# 2. Ask nicely, then wait for a REAL exit (up to 15 s), then insist.
osascript -e 'tell application "ProDeck" to quit' 2>/dev/null || true
running() { pgrep -x prodeck >/dev/null; }
for _ in $(seq 1 30); do
  running || break
  sleep 0.5
done
if running; then
  pkill -x prodeck 2>/dev/null || true
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
mkdir -p "$(dirname "$PLIST")"
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

# 6. Did macOS keep letting ProDeck onto the local network?
#
#    Since Sequoia this is a per-app permission, and macOS keys it to the app
#    bundle — so replacing ProDeck can land it back in the list switched OFF.
#    The failure is silent and badly disguised: Planning Center still works
#    (that's the internet), the crew gateway still works (that's loopback), and
#    only ProPresenter, the sound desk and the kiosks go dark. It cost an
#    afternoon here before anyone thought to check, and an install on a
#    Saturday would be discovered at 7am on a Sunday.
#
#    So check it now, while whoever ran the install is still at the keyboard.
#    The test is comparative: if THIS SHELL can reach ProPresenter and ProDeck
#    cannot, the network is fine and the permission is not.
PP_HOST="$(python3 -c "import json,os;print(json.load(open(os.path.expanduser('~/Library/Application Support/ProDeck/settings.json'))).get('pp_host',''))" 2>/dev/null || true)"
PP_PORT="$(python3 -c "import json,os;print(json.load(open(os.path.expanduser('~/Library/Application Support/ProDeck/settings.json'))).get('pp_port',0))" 2>/dev/null || true)"
if [ -n "$PP_HOST" ] && [ "${PP_PORT:-0}" != "0" ]; then
  if curl -s -o /dev/null --max-time 4 "http://$PP_HOST:$PP_PORT/version"; then
    # ProPresenter is up and this shell can see it. Give ProDeck 45s to open a
    # socket of its own before concluding anything.
    PID=""; OK=""
    for _ in $(seq 1 15); do
      sleep 3
      PID="$(launchctl list com.prodeck.watchdog 2>/dev/null | awk -F'= ' '/"PID"/{print $2}' | tr -d ';')"
      [ -n "$PID" ] || continue
      if lsof -nP -iTCP -a -p "$PID" 2>/dev/null | grep -q ":$PP_PORT "; then OK=1; break; fi
    done
    if [ -n "$OK" ]; then
      echo "local network OK — ProDeck reached ProPresenter at $PP_HOST:$PP_PORT"
    else
      echo ""
      echo "  ⚠️  ProDeck CANNOT reach your local network."
      echo "     This shell reached ProPresenter at $PP_HOST:$PP_PORT, ProDeck did not —"
      echo "     so the network is fine and macOS has switched off ProDeck's"
      echo "     Local Network permission (it does this when the app is replaced)."
      echo ""
      echo "     Fix, ~10 seconds, no restart needed:"
      echo "       open \"x-apple.systempreferences:com.apple.preference.security?Privacy_LocalNetwork\""
      echo "     then turn ProDeck ON. ProPresenter, the desk and the kiosks all come back."
      echo ""
    fi
  else
    echo "local network check skipped — ProPresenter not answering at $PP_HOST:$PP_PORT right now"
  fi
fi
