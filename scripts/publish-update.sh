#!/usr/bin/env bash
# Build a SIGNED, universal ProDeck release and publish it to the local update
# server directory (update-server/). Run scripts/serve-updates.sh to serve it.
#
#   scripts/publish-update.sh ["release notes"]
#
# Requires the updater private key at ~/.prodeck/updater.key (generated once
# with `tauri signer generate`). The matching public key is baked into the app.
set -euo pipefail
cd "$(dirname "$0")/.."

KEY_PATH="${TAURI_SIGNING_PRIVATE_KEY_PATH:-$HOME/.prodeck/updater.key}"
# Persistent, off-machine update channel: a public GitHub repo's Releases.
REPO="${UPDATE_REPO:?set UPDATE_REPO=owner/your-updates-repo}"
ASSET="ProDeck-Clone.app.tar.gz"
OUT="update-server"
export PATH="/opt/homebrew/bin:$HOME/.cargo/bin:$PATH"

if [ ! -f "$KEY_PATH" ]; then
  echo "✗ Signing key not found at $KEY_PATH" >&2
  echo "  Generate once:  npx tauri signer generate -w \"$KEY_PATH\" -p \"\"" >&2
  exit 1
fi

VERSION=$(node -p "require('./src-tauri/tauri.conf.json').version")
NOTES="${1:-Update to v$VERSION}"
echo "▸ Building signed update v$VERSION …"

export TAURI_SIGNING_PRIVATE_KEY="$(cat "$KEY_PATH")"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}"
export PATH="$HOME/.cargo/bin:$PATH"

# The updater config (endpoint, pubkey, createUpdaterArtifacts) and your
# signing identity live in the gitignored local overlay.
LOCAL_CONF="src-tauri/tauri.local.conf.json"
[ -f "$LOCAL_CONF" ] || { echo "✗ $LOCAL_CONF missing — it must carry plugins.updater + bundle.createUpdaterArtifacts=true" >&2; exit 1; }
BUNDLE_DIR="src-tauri/target/universal-apple-darwin/release/bundle/macos"
# Never pick up a stale artifact from an earlier build.
rm -f "$BUNDLE_DIR"/*.app.tar.gz "$BUNDLE_DIR"/*.app.tar.gz.sig
rustup target add aarch64-apple-darwin x86_64-apple-darwin >/dev/null
npm run tauri -- build --target universal-apple-darwin --bundles app --config "$LOCAL_CONF"

ART="$BUNDLE_DIR/ProDeck.app.tar.gz"
if [ ! -f "$ART" ] || [ ! -f "${ART}.sig" ]; then
  echo "✗ Updater artifact / signature not produced — is createUpdaterArtifacts enabled in $LOCAL_CONF and the key set?" >&2
  exit 1
fi

mkdir -p "$OUT"
cp "$ART" "$OUT/ProDeck-Clone.app.tar.gz"
SIG=$(tr -d '\n' < "${ART}.sig")

# Include the DMG for fresh installs alongside the updater feed.
DMG=$(ls -1t src-tauri/target/universal-apple-darwin/release/bundle/dmg/*.dmg 2>/dev/null | head -1 || true)
[ -n "${DMG:-}" ] && cp "$DMG" "$OUT/ProDeck-Clone-Installer.dmg"

cat > "$OUT/latest.json" <<JSON
{
  "version": "$VERSION",
  "notes": $(node -p "JSON.stringify(process.argv[1])" "$NOTES"),
  "pub_date": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "platforms": {
    "darwin-aarch64": {
      "signature": "$SIG",
      "url": "https://github.com/$REPO/releases/latest/download/$ASSET"
    },
    "darwin-x86_64": {
      "signature": "$SIG",
      "url": "https://github.com/$REPO/releases/latest/download/$ASSET"
    }
  }
}
JSON

# ---- Publish to GitHub Releases (persistent, HTTPS, off this machine) --------
if ! command -v gh >/dev/null 2>&1; then
  echo "✗ gh CLI not found — install with 'brew install gh' and 'gh auth login'." >&2
  exit 1
fi
TAG="v$VERSION"
ASSETS=("$OUT/$ASSET" "$OUT/latest.json")
[ -n "${DMG:-}" ] && ASSETS+=("$OUT/ProDeck-Clone-Installer.dmg")

echo "▸ Publishing $TAG to github.com/$REPO …"
if gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then
  gh release upload "$TAG" "${ASSETS[@]}" --repo "$REPO" --clobber
  # Re-point "latest" at this tag so releases/latest/download resolves here.
  gh release edit "$TAG" --repo "$REPO" --latest >/dev/null
else
  gh release create "$TAG" "${ASSETS[@]}" --repo "$REPO" \
    --title "ProDeck $TAG" --notes "$NOTES" --latest
fi

echo "✓ Published v$VERSION → https://github.com/$REPO/releases/tag/$TAG"
echo "  Updater feed: https://github.com/$REPO/releases/latest/download/latest.json"
