#!/usr/bin/env bash
# Tiny HTTP listener that accepts POST /shutdown and powers off the Pi.
# Runs as a systemd service so it has permission to call shutdown.
#
# Install:
#   sudo cp kiosk/shutdown-service.sh /usr/local/bin/homecal-shutdown
#   sudo chmod +x /usr/local/bin/homecal-shutdown
#   sudo cp kiosk/homecal-shutdown.service /etc/systemd/system/
#   sudo systemctl enable --now homecal-shutdown
#
# The homecal server proxies POST /api/kiosk/shutdown → POST http://PI:8788/shutdown

set -euo pipefail

PORT="${SHUTDOWN_PORT:-8788}"

echo "[shutdown-service] Listening on port ${PORT}"

while true; do
  # socat handles one request at a time — fine for a shutdown endpoint
  socat TCP-LISTEN:"${PORT}",reuseaddr,fork SYSTEM:'
    read -r REQUEST_LINE
    read -r _  # consume headers until blank line
    while read -r HEADER && [ -n "$(echo "$HEADER" | tr -d "\r\n")" ]; do :; done

    METHOD=$(echo "$REQUEST_LINE" | cut -d" " -f1)
    PATH_INFO=$(echo "$REQUEST_LINE" | cut -d" " -f2)

    if [ "$METHOD" = "POST" ] && [ "$PATH_INFO" = "/shutdown" ]; then
      BODY="{\"ok\":true,\"message\":\"Shutting down in 3 seconds\"}"
      echo -e "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${#BODY}\r\nConnection: close\r\n\r\n${BODY}"
      sleep 1
      sudo shutdown -h +0 "homecal remote shutdown" &
    else
      BODY="{\"error\":{\"code\":\"NOT_FOUND\",\"message\":\"POST /shutdown only\"}}"
      echo -e "HTTP/1.1 404 Not Found\r\nContent-Type: application/json\r\nContent-Length: ${#BODY}\r\nConnection: close\r\n\r\n${BODY}"
    fi
  ' 2>/dev/null || true
done
