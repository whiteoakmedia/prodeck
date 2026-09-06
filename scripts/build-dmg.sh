#!/bin/bash
# Build the distributable ProDeck.dmg — universal (Intel + Apple Silicon),
# self-contained, and signed so it opens on ANY Mac (after the one-time
# System Settings → Privacy & Security → Open Anyway approval).
#
#   bash scripts/build-dmg.sh                          # ad-hoc signed (default)
#   SIGN_IDENTITY="Developer ID Application: …" bash scripts/build-dmg.sh
#
# Output: ProDeck.dmg in the repo root.
#
# What this deliberately does NOT do — each was a shipped bug once:
#   - use src-tauri/tauri.local.conf.json: that overlay carries a booth's
#     personal signing identity / updater key, which makes the app fail to
#     open on every other Mac ("cannot be opened because of a problem").
#   - sign with hardened runtime: without Apple notarization that turns a
#     clearable Gatekeeper prompt into a hard reject.
#   - trust the build blindly: it verifies both architectures are present and
#     that no dev-machine library (Homebrew OpenSSL) is linked.
set -euo pipefail
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_DIR"

BUNDLE_DIR="src-tauri/target/universal-apple-darwin/release/bundle/macos"
APP="$BUNDLE_DIR/ProDeck.app"
OUT="$REPO_DIR/ProDeck.dmg"

echo "▸ Rust targets"
rustup target add aarch64-apple-darwin x86_64-apple-darwin >/dev/null

echo "▸ Building universal app (clean bundle dir first so a stale app can't ship)"
rm -rf "$APP"
# Explicit override: no signing identity, no updater artifacts — regardless of
# what a local overlay says. Signing is done below, once, the right way.
npm run tauri -- build --target universal-apple-darwin --bundles app \
  --config '{"bundle":{"createUpdaterArtifacts":false,"macOS":{"signingIdentity":null}}}'
[ -d "$APP" ] || { echo "✗ build did not produce $APP — scroll up for the error"; exit 1; }

BIN="$APP/Contents/MacOS/prodeck"
echo "▸ Verifying the binary is universal and self-contained"
ARCHS="$(lipo -archs "$BIN")"
case "$ARCHS" in *x86_64*arm64*|*arm64*x86_64*) ;; *) echo "✗ not universal: $ARCHS"; exit 1 ;; esac
for arch in arm64 x86_64; do
  if otool -arch "$arch" -L "$BIN" | grep -E '^\s' | grep -vE '/usr/lib/|/System/' ; then
    echo "✗ $arch slice links a non-system library (above) — it would crash on other Macs."
    echo "  Check OPENSSL_DIR / OPENSSL_NO_VENDOR are NOT set in your shell."
    exit 1
  fi
done
echo "  ✓ $ARCHS · all links are system libraries"

echo "▸ Signing"
if [ -n "${SIGN_IDENTITY:-}" ]; then
  # A real Developer ID: hardened runtime is fine here (you'll notarize).
  codesign --force --deep --options runtime --sign "$SIGN_IDENTITY" "$APP"
  echo "  signed with: $SIGN_IDENTITY (notarize with: xcrun notarytool submit …)"
else
  # Ad-hoc, no hardened runtime: valid on every Mac; one-time Open Anyway.
  codesign --force --deep --sign - "$APP"
  echo "  ad-hoc signed (no Developer ID). First open on another Mac:"
  echo "  System Settings → Privacy & Security → Open Anyway."
fi
codesign --verify --deep --strict "$APP"

echo "▸ Packaging DMG"
STAGING="$(mktemp -d)"
cp -R "$APP" "$STAGING/"
ln -s /Applications "$STAGING/Applications"
rm -f "$OUT"
hdiutil create -volname "ProDeck" -srcfolder "$STAGING" -ov -format UDZO "$OUT" >/dev/null
rm -rf "$STAGING"

echo ""
echo "✓ DMG ready: $OUT ($(du -h "$OUT" | cut -f1))"
