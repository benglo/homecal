#!/usr/bin/env bash
# Reload the Pi kiosk remotely via Chrome DevTools Protocol.
# Usage: ./reload.sh [pi-ip] [debug-port]
set -euo pipefail

PI="${1:-192.168.1.135}"
PORT="${2:-9223}"

TAB=$(curl -s "http://${PI}:${PORT}/json" | python3 -c "import sys,json;print(json.load(sys.stdin)[0]['id'])")

node -e "
const ws = new (require('/tmp/node_modules/ws'))('ws://${PI}:${PORT}/devtools/page/${TAB}');
ws.on('open', () => ws.send(JSON.stringify({id:1,method:'Page.reload'})));
ws.on('message', () => { console.log('Reloaded'); ws.close(); });
ws.on('error', (e) => { console.error(e.message); process.exit(1); });
setTimeout(() => process.exit(1), 5000);
"
