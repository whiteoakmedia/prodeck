#!/bin/bash
# Publish a public ProDeck release: the drag-to-install DMG PLUS the signed
# auto-update artifact, as one GitHub Release. Every installed copy checks
# .../releases/latest/download/latest.json at launch, so publishing here is
# what pushes the new version to everyone who downloaded the app.
#
#   scripts/release-public.sh "What changed"      # release notes (optional)
#
# Steps: bump "version" in src-tauri/tauri.conf.json first (tag = v<version>).
#
# Needs:
#   ~/.prodeck/public-updater.key   the PUBLIC-release signing key (passwordless).
#                                   Its public half is baked into tauri.conf.json;
#                                   the app refuses updates signed by anything else.
#                                   BACK IT UP — losing it strands every install on
#                                   its current version until they re-download.
#   gh (authenticated for the release repo)
#
# One signed app is used for BOTH the DMG and the updater tarball, so what a
# new downloader gets and what an updater installs are byte-identical.
set -euo pipefail
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_DIR"

REPO="${PUBLIC_REPO:-whiteoakmedia/prodeck}"
KEY_PATH="${PUBLIC_UPDATER_KEY:-$HOME/.prodeck/public-updater.key}"
NOTES="${1:-}"
OUT="$REPO_DIR/release"
BUNDLE_DIR="src-tauri/target/universal-apple-darwin/release/bundle/macos"
APP="$BUNDLE_DIR/ProDeck.app"

[ -f "$KEY_PATH" ] || { echo "✗ signing key not found at $KEY_PATH"; exit 1; }
command -v gh >/dev/null || { echo "✗ gh CLI required (brew install gh; gh auth login)"; exit 1; }
VERSION="$(node -p "require('./src-tauri/tauri.conf.json').version")"
TAG="v$VERSION"
EXPECT_PUB="$(tr -d '\n' < "${KEY_PATH}.pub" 2>/dev/null || true)"
CONF_PUB="$(node -p "require('./src-tauri/tauri.conf.json').plugins.updater.pubkey")"
if [ -n "$EXPECT_PUB" ] && [ "$EXPECT_PUB" != "$CONF_PUB" ]; then
  echo "✗ tauri.conf.json pubkey does not match $KEY_PATH.pub — installed apps would reject this update."
  exit 1
fi
echo "▸ Releasing ProDeck $TAG to github.com/$REPO"

echo "▸ Building universal app"
rustup target add aarch64-apple-darwin x86_64-apple-darwin >/dev/null
rm -rf "$APP"
# No personal signing identity, no tauri updater artifacts — we sign the app
# once below and tar it ourselves so DMG and updater carry the same bytes.
npm run tauri -- build --target universal-apple-darwin --bundles app \
  --config '{"bundle":{"createUpdaterArtifacts":false,"macOS":{"signingIdentity":null}}}'
[ -d "$APP" ] || { echo "✗ build produced no app — scroll up"; exit 1; }

BIN="$APP/Contents/MacOS/prodeck"
echo "▸ Verifying universal + self-contained"
ARCHS="$(lipo -archs "$BIN")"
case "$ARCHS" in *x86_64*arm64*|*arm64*x86_64*) ;; *) echo "✗ not universal: $ARCHS"; exit 1 ;; esac
for arch in arm64 x86_64; do
  if otool -arch "$arch" -L "$BIN" | grep -E '^\s' | grep -vE '/usr/lib/|/System/'; then
    echo "✗ $arch slice links a non-system library — would crash on other Macs"; exit 1
  fi
done
BUILT_V="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP/Contents/Info.plist")"
[ "$BUILT_V" = "$VERSION" ] || { echo "✗ built $BUILT_V but tauri.conf.json says $VERSION"; exit 1; }
echo "  ✓ $ARCHS · system libraries only · v$BUILT_V"

echo "▸ Signing (ad-hoc, no hardened runtime — opens on any Mac after one Open Anyway)"
codesign --force --deep --sign - "$APP"
codesign --verify --deep --strict "$APP"

rm -rf "$OUT"; mkdir -p "$OUT"

echo "▸ Updater artifact"
tar -czf "$OUT/ProDeck.app.tar.gz" -C "$BUNDLE_DIR" ProDeck.app
TAURI_SIGNING_PRIVATE_KEY="$(cat "$KEY_PATH")" TAURI_SIGNING_PRIVATE_KEY_PASSWORD="" \
  npm run tauri -- signer sign "$OUT/ProDeck.app.tar.gz" >/dev/null
[ -f "$OUT/ProDeck.app.tar.gz.sig" ] || { echo "✗ signing produced no .sig"; exit 1; }
SIG="$(tr -d '\n' < "$OUT/ProDeck.app.tar.gz.sig")"

echo "▸ DMG"
STAGING="$(mktemp -d)"; cp -R "$APP" "$STAGING/"; ln -s /Applications "$STAGING/Applications"
hdiutil create -volname "ProDeck" -srcfolder "$STAGING" -ov -format UDZO "$OUT/ProDeck.dmg" >/dev/null
rm -rf "$STAGING"

echo "▸ latest.json"
ASSET_URL="https://github.com/$REPO/releases/download/$TAG/ProDeck.app.tar.gz"
node -e '
const [version, notes, sig, url] = process.argv.slice(1);
const p = { signature: sig, url };
process.stdout.write(JSON.stringify({
  version, notes, pub_date: new Date().toISOString(),
  platforms: { "darwin-aarch64": p, "darwin-x86_64": p, "darwin-universal": p },
}, null, 2) + "\n");
' "$VERSION" "${NOTES:-ProDeck $TAG}" "$SIG" "$ASSET_URL" > "$OUT/latest.json"

echo "▸ Publishing $TAG"
ASSETS=("$OUT/ProDeck.dmg" "$OUT/ProDeck.app.tar.gz" "$OUT/latest.json")
BODY="${NOTES:-ProDeck $TAG}

## Install
1. Download **ProDeck.dmg**, open it, drag **ProDeck** to Applications.
2. First open only (macOS Sequoia/Tahoe): double-click → **System Settings → Privacy & Security** → **Open Anyway**.

Runs on Intel and Apple Silicon (macOS 10.15+). Installed copies update themselves from this release automatically."
if gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then
  gh release upload "$TAG" "${ASSETS[@]}" --repo "$REPO" --clobber
  gh release edit "$TAG" --repo "$REPO" --latest --notes "$BODY" >/dev/null
else
  gh release create "$TAG" "${ASSETS[@]}" --repo "$REPO" --title "ProDeck $TAG" --notes "$BODY" --latest
fi

echo ""
echo "✓ Published https://github.com/$REPO/releases/tag/$TAG"
echo "  Feed: https://github.com/$REPO/releases/latest/download/latest.json"
echo "  Every installed copy will offer $TAG at its next launch."
