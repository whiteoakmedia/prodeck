#!/bin/bash
# Build a distributable ProDeck.dmg — the drag-to-Applications installer.
#
#   bash scripts/build-dmg.sh              # unsigned-identity build (Gatekeeper will warn)
#   SIGN_IDENTITY="Your Name" bash scripts/build-dmg.sh   # sign with your cert
#
# Produces src-tauri/target/release/bundle/dmg/ProDeck_<version>_aarch64.dmg
set -euo pipefail
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOCAL_CONF="$REPO_DIR/src-tauri/tauri.local.conf.json"

cd "$REPO_DIR"
ARGS=(build --bundles app,dmg)
[ -f "$LOCAL_CONF" ] && ARGS+=(--config "$LOCAL_CONF")
npm run tauri -- "${ARGS[@]}"

APP="$REPO_DIR/src-tauri/target/release/bundle/macos/ProDeck.app"
if [ -n "${SIGN_IDENTITY:-}" ]; then
  codesign --force --deep --sign "$SIGN_IDENTITY" "$APP"
  codesign --verify --deep --strict "$APP"
  echo "signed with: $SIGN_IDENTITY"
else
  cat <<'NOTE'

Note: built with the ad-hoc/dev identity. On another Mac, macOS Gatekeeper will
warn on first open ("unidentified developer") — right-click the app → Open, or
System Settings → Privacy & Security → Open Anyway. To avoid the warning, build
with SIGN_IDENTITY set to a Developer ID certificate.
NOTE
fi

DMG="$(ls -t "$REPO_DIR"/src-tauri/target/release/bundle/dmg/*.dmg 2>/dev/null | head -1)"
echo ""
echo "DMG ready: ${DMG:-<none produced — scroll up for the error>}"
