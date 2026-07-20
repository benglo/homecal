# Deployment Guide

## Server (Docker)

### Build & run

```bash
# Build on the TARGET architecture (better-sqlite3 is a native module).
# On the server itself:
docker compose up -d --build

# Or cross-build for a different arch (e.g. building for arm64 on x86):
docker buildx build --platform linux/arm64 -t homecal:latest .
```

> **Important:** never copy host `node_modules` into the image — `better-sqlite3`
> is compiled for the build stage's architecture. The `.dockerignore` excludes them.

### Configuration

All config via environment in `docker-compose.yml`:

| Variable | Default | Notes |
|----------|---------|-------|
| `HOMECAL_PORT` | `8787` | Host port mapping |
| `HOMECAL_DATA_DIR` | `./data` | Host path for the SQLite data directory |
| `LOG_LEVEL` | `warn` (prod) | Fastify log level (`info`, `warn`, `error`) |

### Backups

The data directory contains the SQLite database. It should be included in your
server's regular backup regime.

On-demand snapshot (creates a standalone `.db` in the data dir):

```bash
curl -X POST http://localhost:8787/api/backup
# → { "ok": true, "file": "backup-2026-06-01T10-30-00Z.db", "sizeBytes": 12345 }
```

Old backups are pruned automatically (keeps the 10 most recent).

`VACUUM INTO` produces a self-contained file (no WAL) — safe to copy off the server.

### Reverse proxy (optional)

If placing behind nginx/Caddy, SSE requires special handling:

**nginx:**

```nginx
location /api/stream {
    proxy_pass http://homecal:8787;
    proxy_http_version 1.1;
    proxy_set_header Connection '';
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 86400s;
}

location / {
    proxy_pass http://homecal:8787;
}
```

**Caddy:**

```caddyfile
reverse_proxy homecal:8787 {
    flush_interval -1
}
```

If you don't need a reverse proxy, accessing the server directly on its LAN IP
and port works fine — the container binds `0.0.0.0`.

---

## Pi Kiosk (Bookworm / labwc / Wayland)

### As-deployed unit reference

Concrete values for the installed wall unit (avoids re-discovery):

| Thing | Value |
|-------|-------|
| SSH | `hbadmin@192.168.1.135` |
| Homecal server (kiosk points here) | `http://192.168.1.94:8787/?mode=wall` |
| OS | Debian 13 (trixie) — Pi OS, Wayland session |
| Compositor | labwc (`/usr/bin/labwc -m`) |
| Wayland socket | `WAYLAND_DISPLAY=wayland-0`, `XDG_RUNTIME_DIR=/run/user/1000` |
| Screen | Waveshare 10.1" DSI touch (`10.1-dsi-touch-a`), 800×1280 IPS, Goodix GT9271 touch; overlay `vc4-kms-dsi-waveshare-panel-v2,10_1_inch_a`. No onboard audio |
| Display output | `DSI-2` — native `800x1280` portrait, transform `270` = landscape |
| Autostart | `~/.config/labwc/autostart` (launches Chromium kiosk + `socat 9223→9222` + `wvkbd-mobintl`) |
| CDP debug | `9222` local, exposed on `9223` via socat |

To run `wlr-randr`/CDP tools over SSH you must export the session env, e.g.:

```bash
ssh hbadmin@192.168.1.135 \
  'XDG_RUNTIME_DIR=/run/user/1000 WAYLAND_DISPLAY=wayland-0 wlr-randr'
```

### Prerequisites

- Raspberry Pi OS Bookworm (64-bit recommended for Pi 5)
- Chromium browser installed (ships with the desktop image)
- labwc compositor running (default on Bookworm desktop)

### Install the launcher

```bash
# Copy the script to the Pi
scp kiosk/launch.sh pi@raspberrypi:~/

# Make it executable
ssh pi@raspberrypi chmod +x ~/launch.sh
```

### Set the server URL

Edit `~/.config/environment.d/homecal.conf`:

```
CALENDAR_URL=http://<server-ip>:8787/?mode=wall
```

### Autostart (labwc)

Add to `~/.config/labwc/autostart`:

```bash
~/launch.sh &
```

### Display rotation (as deployed)

The wall Pi uses a **DSI touchscreen** whose native panel is portrait
(`800x1280`). labwc rotates it to landscape via an output transform. The
**correct** transform is `270` — `90` produces an upside-down image.

```bash
# Output name + current transform:
wlr-randr            # output is DSI-2 on this unit

# Apply live (takes effect immediately, no reboot):
wlr-randr --output DSI-2 --transform 270
```

Persist it by prepending this line to `~/.config/labwc/autostart` (it must run
before Chromium launches):

```bash
wlr-randr --output DSI-2 --transform 270
```

> Transforms: `normal`/`90`/`180`/`270` rotate; `flipped-*` mirror. If a future
> panel boots portrait or mirrored, try the others — `270` is specific to this
> unit's panel + ribbon orientation in its frame.

### Remote debugging (recommended)

Add `--remote-debugging-port=9222` to the Chromium flags in your autostart.
This lets you reload, inspect, and screenshot the wall from any device on the
LAN without rebooting the Pi.

**Force a reload from the server:**

```bash
# One-liner: reload the active tab
curl -X POST "http://<pi-ip>:9222/json/reload/$(curl -s http://<pi-ip>:9222/json | python3 -c 'import sys,json;print(json.load(sys.stdin)[0]["id"])')"
```

**Take a screenshot:**

```bash
# Requires websocat or a CDP client; simplest via browser at:
# http://<pi-ip>:9222
```

### Disable screen blanking

```bash
# In ~/.config/labwc/autostart, before the launcher:
wlr-randr  # confirm output name, then:
# Or via raspi-config → Display Options → Screen Blanking → Off

# Alternatively, for DPMS:
xset -dpms s off  # if using X11 fallback
```

### Systemd alternative

```ini
# ~/.config/systemd/user/homecal-kiosk.service
[Unit]
Description=Family Calendar Kiosk
After=graphical-session.target

[Service]
Environment=CALENDAR_URL=http://<server-ip>:8787/?mode=wall
ExecStart=%h/launch.sh
Restart=on-failure
RestartSec=10

[Install]
WantedBy=graphical-session.target
```

```bash
systemctl --user enable --now homecal-kiosk
```

---

## Verification (chaos test)

1. **Cold boot both boxes** — the Pi should land on the calendar unattended.
2. **`docker compose stop`** — the wall stays populated (SW cache).
3. **`docker compose up -d`** — the wall recovers within ~30s (SSE reconnect + poll).
4. **Unplug the internet** — everything still works (LAN-only, no cloud deps).
5. **Redeploy** (`docker compose up -d --build`) — the wall picks up the new
   build on next navigation (network-first SW).
