#!/usr/bin/env bash
# Serve the ProDeck Clone update feed on the LAN. Run this on the booth
# (Command-Center) machine; clients auto-update from it.
#
#   scripts/serve-updates.sh            # serves on :8787
#   UPDATE_PORT=9000 scripts/serve-updates.sh
set -euo pipefail
cd "$(dirname "$0")/../update-server"
PORT="${UPDATE_PORT:-8787}"
echo "Serving ProDeck updates on http://0.0.0.0:${PORT}/  (Ctrl-C to stop)"
echo "  manifest:  http://$(scutil --get LocalHostName 2>/dev/null || hostname).local:${PORT}/latest.json"
exec python3 -m http.server "$PORT" --bind 0.0.0.0
