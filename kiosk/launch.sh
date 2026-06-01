#!/usr/bin/env bash
# Family Calendar kiosk launcher for Raspberry Pi (Bookworm, labwc/Wayland).
#
# Two-layer auto-retry (spec §9):
#   1. This script polls until the server responds 200, then launches Chromium.
#   2. The in-page service worker + ErrorBoundary handle blips after load.
#
# Install: copy to the Pi, chmod +x, and add to labwc autostart or a systemd
# user service (see docs/deploy.md).

set -euo pipefail

CALENDAR_URL="${CALENDAR_URL:-http://homeserver:8787/?mode=wall}"
POLL_INTERVAL=5
MAX_WAIT=300  # seconds before giving up (5 min)

echo "[kiosk] Waiting for server at ${CALENDAR_URL} ..."

elapsed=0
until curl -sf --max-time 3 "${CALENDAR_URL%\?*}/api/health" >/dev/null 2>&1; do
  sleep "$POLL_INTERVAL"
  elapsed=$((elapsed + POLL_INTERVAL))
  if [ "$elapsed" -ge "$MAX_WAIT" ]; then
    echo "[kiosk] Server not reachable after ${MAX_WAIT}s — launching anyway (SW may have a cached shell)."
    break
  fi
done

echo "[kiosk] Launching Chromium kiosk → ${CALENDAR_URL}"

exec chromium-browser \
  --kiosk \
  --ozone-platform=wayland \
  --app="${CALENDAR_URL}" \
  --noerrdialogs \
  --disable-session-crashed-bubble \
  --disable-infobars \
  --hide-scrollbars \
  --autoplay-policy=no-user-gesture-required \
  --check-for-update-interval=31536000 \
  --disable-features=Translate \
  --remote-debugging-port=9222
