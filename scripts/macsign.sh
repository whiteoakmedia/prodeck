#!/bin/bash
# Developer ID signing and notarization for ProDeck on macOS, sourced by
# release-public.sh (and usable for booth installs). One identity for every
# build means macOS keeps ProDeck's permissions (microphone, local network,
# automation) across updates, and notarization means it opens like any app:
# no "Open Anyway".
#
# Set up once with scripts/apple-signing.sh. Needs:
#   - a "Developer ID Application" certificate in the login keychain
#   - notarization credentials saved as the keychain profile below
#       xcrun notarytool store-credentials prodeck-notary --apple-id <you> --team-id <TEAM>

NOTARY_PROFILE="${NOTARY_PROFILE:-prodeck-notary}"
MACSIGN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENTITLEMENTS="$MACSIGN_DIR/src-tauri/entitlements.plist"

# "Developer ID Application: Name (TEAMID)", or nothing.
devid_identity() {
  security find-identity -v -p codesigning 2>/dev/null \
    | sed -n 's/.*"\(Developer ID Application: [^"]*\)".*/\1/p' | head -1
}

notary_ready() {
  xcrun notarytool history --keychain-profile "$NOTARY_PROFILE" >/dev/null 2>&1
}

# Sign an .app with the hardened runtime, a secure timestamp and our entitlements.
sign_app() {
  local app="$1" id
  id="$(devid_identity)"
  [ -n "$id" ] || { echo "✗ no Developer ID Application certificate (run scripts/apple-signing.sh)"; return 1; }
  codesign --force --deep --options runtime --timestamp --entitlements "$ENTITLEMENTS" --sign "$id" "$app" || return 1
  codesign --verify --deep --strict "$app" || return 1
  echo "  ✓ signed by $id (hardened runtime)"
}

sign_dmg() {
  local dmg="$1" id
  id="$(devid_identity)"
  codesign --force --timestamp --sign "$id" "$dmg" || return 1
}

# Send a .app (zipped) or .dmg to Apple and wait; on rejection print Apple's reasons.
notarize() {
  local file="$1" submit="$1" tmpzip="" out id status
  if [[ "$file" == *.app ]]; then
    tmpzip="$(mktemp -d)/$(basename "$file").zip"
    ditto -c -k --keepParent "$file" "$tmpzip" || return 1
    submit="$tmpzip"
  fi
  echo "  ▸ Apple is checking $(basename "$file") (a few minutes)"
  out="$(xcrun notarytool submit "$submit" --keychain-profile "$NOTARY_PROFILE" --wait --output-format json 2>&1)"
  [ -n "$tmpzip" ] && rm -rf "$(dirname "$tmpzip")"
  id="$(printf '%s' "$out" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("id",""))' 2>/dev/null)"
  status="$(printf '%s' "$out" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("status",""))' 2>/dev/null)"
  if [ "$status" != "Accepted" ]; then
    echo "✗ notarization: ${status:-failed}"
    printf '%s\n' "$out" | tail -5
    [ -n "$id" ] && xcrun notarytool log "$id" --keychain-profile "$NOTARY_PROFILE" 2>/dev/null | head -60
    return 1
  fi
  xcrun stapler staple "$file" >/dev/null || { echo "✗ couldn't staple $(basename "$file")"; return 1; }
  echo "  ✓ notarized and stapled"
}

# What Gatekeeper will say on another Mac.
gatekeeper_ok() {
  spctl -a -vvv -t exec "$1" 2>&1 | grep -q "source=Notarized Developer ID"
}
