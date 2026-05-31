# Family Calendar (homecal)

A self-hosted, LAN-only family calendar — a wall-mounted touchscreen kiosk backed by a single Docker
container on your home server. No cloud, no accounts; works with the internet unplugged.

- **Backend:** Node + TypeScript (Fastify), SQLite via `better-sqlite3` (WAL). Serves the JSON API
  **and** the built frontend from one origin.
- **Frontend:** Vite + React + TypeScript. Wall (glanceable) + phone (editing) layouts.
- **Kiosk:** Raspberry Pi 5 running only Chromium pointed at the server URL.

See `family-calendar-build-spec.md` (build brief), `docs/frontend-design.md` (visual system),
`docs/frontend-components.md` (component architecture), and `docs/mockups/family-calendar.html`
(visual sign-off mockup).

> **Status:** M0 — scaffold + container. API health + placeholder page over a single origin; SQLite
> (WAL) initialised via a migration runner with seed categories. M1+ add the real API and UI.

---

## Prerequisites (human setup)

1. A home server with **Docker + Docker Compose**.
2. A **host directory for the SQLite volume**, covered by your server's backups (defaults to `./data`).
3. A stable way for the Pi + phones to reach the server (mDNS hostname or reserved IP),
   e.g. `http://server.local:8787`.

---

## Quick start (Docker — the supported path)

```bash
# from the repo root, on the server
docker compose up -d --build

# then from any device on the LAN:
#   http://<server-ip>:8787/             -> placeholder page
#   http://<server-ip>:8787/api/health   -> { ok: true, db: "ok", schemaVersion: 1 }
```

Configure via env (optional):

| Var | Default | Meaning |
|-----|---------|---------|
| `HOMECAL_PORT` | `8787` | host port published on the LAN |
| `HOMECAL_DATA_DIR` | `./data` | host directory bind-mounted to `/data` (the SQLite DB lives here) |

**DB persistence:** the SQLite files (`calendar.db`, `-wal`, `-shm`) live in the bind-mounted
**directory** — they survive image rebuilds. Back up that directory.

**Native module note:** `better-sqlite3` is compiled **inside the image for the server's architecture**.
Build the image on (or for) the server's platform; never copy a host/Pi-arch `node_modules` in.

---

## Local development (without Docker)

```bash
npm install                 # installs both workspaces (compiles better-sqlite3 for your machine)

# terminal 1 — API on :8787 (writes to ./data)
npm run dev:backend

# terminal 2 — Vite dev server on :5173, proxies /api to :8787
npm run dev:frontend
```

Or test the production single-origin path locally:

```bash
npm run build               # builds frontend/dist + backend/dist
STATIC_DIR=frontend/dist npm start
# -> http://localhost:8787/
```

---

## Layout

```
backend/      Fastify API + static server, SQLite (WAL) + migration runner
frontend/     Vite + React + TS app (M0 placeholder)
docs/         design system, component architecture, HTML mockup
Dockerfile    multi-stage build (frontend + backend, native compile, lean runtime)
docker-compose.yml
```
