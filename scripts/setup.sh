#!/bin/bash
# ProDeck setup — takes a fresh clone to a running app, and fills in YOUR
# environment as you go. Everything site-specific lands in gitignored local
# files, so your fork never has to carry your church's values in code.
#
#   bash scripts/setup.sh            # check prereqs, configure, run in dev mode
#   bash scripts/setup.sh --install  # …then build signed + install permanently
#
# Just want a double-click installer? scripts/build-dmg.sh makes a
# drag-to-Applications ProDeck.dmg.
#
# Safe to re-run: every step detects what already exists and skips it.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOCAL_CONF="$REPO_DIR/src-tauri/tauri.local.conf.json"
MODE="${1:-dev}"

say()  { printf "\n\033[1m%s\033[0m\n" "$*"; }
note() { printf "  %s\n" "$*"; }
die()  { printf "\n\033[31m%s\033[0m\n" "$*"; exit 1; }

[ "$(uname -s)" = "Darwin" ] || die "ProDeck's booth app is macOS-only (the phones/kiosks that connect to it can be anything)."

# ---------------------------------------------------------------- prereqs
say "1/5 · Prerequisites"
if ! xcode-select -p >/dev/null 2>&1; then
  note "Xcode command-line tools missing — launching the installer (rerun this script after it finishes)."
  xcode-select --install || true
  exit 1
fi
note "✓ Xcode command-line tools"

if ! command -v cargo >/dev/null 2>&1; then
  note "Rust missing — installing via rustup (official installer)…"
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
  # shellcheck disable=SC1091
  . "$HOME/.cargo/env"
fi
note "✓ Rust $(rustc --version 2>/dev/null | awk '{print $2}')"

if ! [ -e /opt/homebrew/opt/openssl@3/lib/libssl.3.dylib ] && ! [ -e /usr/local/opt/openssl@3/lib/libssl.3.dylib ]; then
  die "OpenSSL 3 is required (the app links it): brew install openssl@3 — then rerun."
fi
note "✓ OpenSSL 3"

command -v node >/dev/null 2>&1 || die "Node.js 20+ is required — install from nodejs.org or 'brew install node', then rerun."
NODE_MAJOR="$(node -v | sed 's/^v//' | cut -d. -f1)"
[ "$NODE_MAJOR" -ge 18 ] || die "Node $(node -v) is too old — 20+ recommended."
note "✓ Node $(node -v)"

say "2/5 · Dependencies"
(cd "$REPO_DIR" && npm install --no-fund --no-audit)
note "✓ npm packages"

# ------------------------------------------------- your environment (local)
say "3/5 · Your environment (written to gitignored local files)"
if [ -f "$LOCAL_CONF" ]; then
  note "✓ src-tauri/tauri.local.conf.json already exists — keeping it."
else
  note "macOS ties microphone/screen permissions to the bundle identifier — pick once, keep forever."
  printf "  App bundle identifier [com.prodeck.app]: "
  read -r IDENT; IDENT="${IDENT:-com.prodeck.app}"
  cat > "$LOCAL_CONF" <<EOF
{
  "identifier": "$IDENT"
}
EOF
  note "✓ wrote src-tauri/tauri.local.conf.json (add your updater endpoint/pubkey here later if you publish updates)"
fi

note ""
note "Connect your tools inside the app once it runs (all optional, Settings page):"
note "  · ProPresenter — enable its Network API, then Find it (or use the host + port ProPresenter shows in Preferences → Network)"
note "  · Planning Center — a Personal Access Token from any PCO admin"
note "  · Public URL — your own domain/tunnel, once you have one (Browser Access)"
note "  · Audio input, Avantis IP, MIDI ports, GA4 — each per its Settings card"
note "Cloud pieces (crew phones anywhere, tap discs) are Phase 2 — see docs/ADOPTERS_GUIDE.html."

# ---------------------------------------------------------------- dev mode
if [ "$MODE" != "--install" ]; then
  say "4/5 · Starting in dev mode (Ctrl-C to stop; rerun with --install to make it permanent)"
  cd "$REPO_DIR" && exec npm run tauri dev
fi

# ------------------------------------------------------------- install mode
say "4/5 · Signed build"
IDENTITY="${SIGN_IDENTITY:-ProDeck Self Sign}"
if ! security find-identity -p codesigning -v 2>/dev/null | grep -q "$IDENTITY"; then
  cat <<EOM

  No codesigning identity named "$IDENTITY".
  Create one (once): Keychain Access → Certificate Assistant → Create a
  Certificate… → name it "$IDENTITY", Identity Type "Self-Signed Root",
  Certificate Type "Code Signing". Then rerun with --install.
  (Or set SIGN_IDENTITY=YourName to use an identity you already have.)
EOM
  exit 1
fi
note "✓ signing identity: $IDENTITY"

cd "$REPO_DIR"
BUILD_ARGS=(build)
[ -f "$LOCAL_CONF" ] && BUILD_ARGS+=(--config "$LOCAL_CONF")
if [ -f "$HOME/.prodeck/updater.key" ]; then
  TAURI_SIGNING_PRIVATE_KEY="$(cat "$HOME/.prodeck/updater.key")" npm run tauri -- "${BUILD_ARGS[@]}" || true
else
  npm run tauri -- "${BUILD_ARGS[@]}" || true
fi
APP="$REPO_DIR/src-tauri/target/release/bundle/macos/ProDeck.app"
[ -d "$APP" ] || die "Build did not produce $APP — scroll up for the real error."
codesign --force --deep --sign "$IDENTITY" "$APP"
codesign --verify --deep --strict "$APP"
note "✓ built and signed"

say "5/5 · Install + keep-alive"
mkdir -p "$HOME/Library/LaunchAgents"
for plist in com.prodeck.watchdog com.prodeck.caffeinate; do
  cp "$REPO_DIR/deploy/launchagents/$plist.plist" "$HOME/Library/LaunchAgents/"
done
bash "$REPO_DIR/scripts/install-local.sh"
cat <<'EOM'

Done. ProDeck is installed, running, and will relaunch itself on any crash or
reboot. First stops inside the app:
  1. ProPresenter page — connect to your Pro machine
  2. Settings → Planning Center — paste your PCO token
  3. Settings → Browser Access — turn on the web gateway, set passwords
The full evaluate-and-adopt guide is docs/ADOPTERS_GUIDE.html in this repo.
EOM
