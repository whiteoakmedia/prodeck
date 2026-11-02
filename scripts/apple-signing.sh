#!/bin/bash
# One-time Developer ID setup for ProDeck releases.
#
#   scripts/apple-signing.sh csr             make a key and certificate request
#   scripts/apple-signing.sh install <.cer>  put the certificate Apple gave you in the keychain
#   scripts/apple-signing.sh check           is everything ready to release?
#
# The private key is made here and only ever lives in ~/.prodeck/keys/devid
# (owner-only) and the login keychain. Never commit or share it; back up the
# .p12 this writes somewhere safe off this Mac.
set -euo pipefail
DIR="$HOME/.prodeck/keys/devid"
source "$(cd "$(dirname "$0")" && pwd)/macsign.sh"

case "${1:-}" in
  csr)
    mkdir -p "$DIR"; chmod 700 "$DIR"
    if [ -f "$DIR/devid.key" ]; then echo "✗ $DIR/devid.key already exists; use it (or move it aside first)."; exit 1; fi
    openssl genrsa -out "$DIR/devid.key" 2048 2>/dev/null
    chmod 600 "$DIR/devid.key"
    openssl req -new -key "$DIR/devid.key" -out "$DIR/ProDeck.certSigningRequest" -subj "/CN=ProDeck Developer ID/O=White Oak Media"
    echo "✓ Certificate request: $DIR/ProDeck.certSigningRequest"
    echo ""
    echo "Now, at https://developer.apple.com/account/resources/certificates/add :"
    echo "  1. Choose 'Developer ID Application', Continue."
    echo "  2. Profile type 'G2 Sub-CA', upload the file above, Continue."
    echo "  3. Download the certificate (developerID_application.cer)."
    echo "Then run:  scripts/apple-signing.sh install ~/Downloads/developerID_application.cer"
    ;;
  install)
    cer="${2:-}"
    [ -f "$cer" ] || { echo "✗ give the path to the .cer Apple gave you"; exit 1; }
    [ -f "$DIR/devid.key" ] || { echo "✗ no $DIR/devid.key: this certificate's key was made somewhere else"; exit 1; }
    openssl x509 -inform DER -in "$cer" -out "$DIR/devid.pem" 2>/dev/null || cp "$cer" "$DIR/devid.pem"
    # The certificate must belong to our key.
    if [ "$(openssl x509 -noout -pubkey -in "$DIR/devid.pem" | openssl sha256)" != "$(openssl pkey -pubout -in "$DIR/devid.key" | openssl sha256)" ]; then
      echo "✗ that certificate wasn't made from this Mac's request"; exit 1
    fi
    pass="$(openssl rand -hex 16)"
    openssl pkcs12 -export -legacy -inkey "$DIR/devid.key" -in "$DIR/devid.pem" -out "$DIR/devid.p12" -passout "pass:$pass" 2>/dev/null \
      || openssl pkcs12 -export -inkey "$DIR/devid.key" -in "$DIR/devid.pem" -out "$DIR/devid.p12" -passout "pass:$pass"
    printf '%s' "$pass" > "$DIR/devid.p12.password"; chmod 600 "$DIR/devid.p12" "$DIR/devid.p12.password"
    # Apple's Developer ID G2 intermediate, so the chain is complete.
    curl -fsSL https://www.apple.com/certificateauthority/DeveloperIDG2CA.cer -o "$DIR/DeveloperIDG2CA.cer"
    security import "$DIR/DeveloperIDG2CA.cer" -k "$HOME/Library/Keychains/login.keychain-db" 2>/dev/null || true
    # -T: codesign may use the key without asking every time.
    security import "$DIR/devid.p12" -k "$HOME/Library/Keychains/login.keychain-db" -P "$pass" -T /usr/bin/codesign -T /usr/bin/security
    echo ""
    "$0" check || true
    echo ""
    echo "Back up $DIR/devid.p12 and devid.p12.password somewhere safe off this Mac."
    ;;
  check)
    id="$(devid_identity)"
    if [ -n "$id" ]; then echo "✓ signing identity: $id"; else echo "✗ no Developer ID Application certificate in the keychain"; fi
    if notary_ready; then echo "✓ notarization credentials: $NOTARY_PROFILE"; else
      echo "✗ no notarization credentials. Make an app-specific password at https://account.apple.com (Sign-In and Security),"
      echo "  then run:  xcrun notarytool store-credentials $NOTARY_PROFILE --apple-id <your Apple ID> --team-id <your Team ID>"
    fi
    [ -n "$id" ] && notary_ready
    ;;
  *)
    sed -n '2,12p' "$0"; exit 1 ;;
esac
