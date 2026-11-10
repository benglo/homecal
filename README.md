# Family Calendar (homecal)

A self-hosted, **LAN-only** family calendar — a wall-mounted touchscreen kiosk plus a phone editor,
backed by Docker on your home server. No cloud, no accounts; the calendar works with the internet
unplugged (voice is the one optional feature that uses the WAN).

- **Backend:** Node + TypeScript (Fastify, CommonJS), SQLite via `better-sqlite3` (WAL). Serves the
  JSON API **and** the built frontend from one origin (no CORS).
- **Frontend:** Vite + React + TypeScript (ESM). A glanceable **wall** layout and an M3 **phone**
  editor, switched by `?mode=wall` (not viewport width). TanStack Query for state; SSE + poll for
  realtime; a service worker so the wall never goes blank.
- **Kiosk:** Raspberry Pi 5 running only Chromium pointed at the server URL, on a Waveshare 10.1"
  DSI touchscreen, plus the Python `homecal-voice` service.
- **Kokoro TTS sidecar:** optional second container (FastAPI + kokoro-onnx) for LAN-local speech
  synthesis, so voice replies don't need a cloud TTS call.
- **Hardware:** a parametric, 3D-printable wall housing for the screen, Pi and speaker (`hardware/`).

See `family-calendar-build-spec.md` (build brief — §0 decisions are binding), `docs/frontend-design.md`
(visual system), `docs/frontend-components.md` (component architecture), `docs/deploy.md`
(server + Pi deploy guide), and `docs/SESSION-LOG.md` (build log).

---

## Features

**Calendar & events**
- Events with categories; **colour is never the only signal** — every chip carries an icon + label
  (colourblind-safe Okabe–Ito palette).
- **Recurrence** via RRULE on the master event, expanded **app-side** (never in SQL). RRULEs are
  bounded (`UNTIL`/`COUNT`); single-occurrence skips are EXDATE exceptions.
- Categories with **`ON DELETE RESTRICT`** (409 when a category is still in use).
- **Timezone-correct:** timestamps stored UTC (`Z`-suffixed ISO-8601), displayed in Brisbane
  (fixed UTC+10). Server-generated UUIDv7 IDs and `updated_at`.
- API uses a consistent `{ error: { code, message } }` envelope with zod validation at the boundary.

**Wall (kiosk) UI**
- Default **Agenda** view plus **week/month** via FullCalendar (MIT plugins; all nav driven by our
  own ControlBar, `headerToolbar={false}`). Self-hosted Geist fonts (offline).
- **HeroBand** with a live ticking clock (the "alive" signal) and a **weather sidebar**.
- Two independent idle timers: 90s reset-to-today, and a 5-min **photo screensaver**.

**Chores board**
- Family members + chores (daily/weekly frequency), **tap-to-complete** on the wall with a star-fly
  animation and chime (muted 8pm–7am). Optimistic updates, SSE sync. Phone managers for both.

**Voice**
- Pi-side `homecal-voice` service: **"hey luna"** wake word (custom openWakeWord model) or
  **tap-to-talk** on the wall, silero-vad endpointing.
- **STT:** Gemini Flash via OpenRouter by default, with local **whisper.cpp** (`whisper-server`) as
  the offline fallback. **Intent parsing:** Haiku 4.5 via OpenRouter.
- **TTS:** `TTS_BACKEND=cloud` (Kokoro-82M via OpenRouter, the default) or `lan` (the local
  `kokoro-tts` sidecar, which falls back to cloud on timeout).
- **Intents:** set/query dinner, complete a chore, query the agenda, add an event (always confirmed),
  set volume (absolute or relative), timers, and kid-friendly intents: jokes, animal/fun noises
  (pre-rendered catalogs) and general questions behind a tiered safety prompt.
- The wall **voice band** shows transcript → thinking → reply. Mid-confidence intents show a
  confirmation card and briefly listen for yes/no/edit.
- **Volume control:** popover on the wall ControlBar and in the phone Voice section. The Pi applies
  master volume/mute through PipeWire (`wpctl`).
- Mic mute toggle (ControlBar + phone), audit log (`voice_utterances`), daily request cap. Voice is the
  only WAN-dependent feature; the rest of the calendar stays fully offline-capable.

**Photos & feeds**
- **Photo screensaver:** upload/serve/delete (sharp resize), dual-buffer Ken Burns crossfade after
  5 min idle; phone PhotoManager.
- **iCal feed:** `GET /api/feed.ics` (native RRULE + EXDATE) to subscribe from other calendar apps.
- **Weather:** `GET /api/weather` proxies the BOM with a 15-min cache, eager prefetch, and stale
  fallback; day/night icons.

**Platform & resilience**
- **Realtime:** in-process SSE broker (`GET /api/stream`); mutations `poke()`, client invalidates +
  30s poll backstop.
- **Backup:** `POST /api/backup` (`VACUUM INTO`, auto-prune to 10 snapshots).
- **Kiosk control:** health-poll launcher, CDP reload, remote shutdown; on-screen virtual keyboard.
- **Service worker:** network-first navigation with cache fallback, shell cache keyed to the build ID.
- **Graceful shutdown:** drains open SSE connections, then WAL-checkpoints before close.

---

## Prerequisites (human setup)

1. A home server with **Docker + Docker Compose**.
2. A **host directory for the SQLite volume**, covered by your server's backups (defaults to `./data`).
3. A stable way for the Pi + phones to reach the server (mDNS hostname or reserved IP),
   e.g. `http://server.local:8787`.
4. (Voice only) an **OpenRouter API key**, a mic + speaker on the Pi, and a shared
   **`PI_API_TOKEN`** secret (any long random string) known to both the server and the Pi.
5. (Kokoro sidecar only) an **x86-64** server with ~1.5 GB RAM spare. The image is `linux/amd64` only.

---

## Quick start (Docker — the supported path)

```bash
# from the repo root, on the server
cp .env.example .env                        # then set PI_API_TOKEN (needed for voice)
(cd kokoro-tts && make pull-models)         # one-off: downloads the Kokoro model + voices files
docker compose up -d --build                # starts `calendar` (:8787) + `kokoro-tts` (:8789)

# no voice / no sidecar? start just the calendar and skip the steps above:
docker compose up -d --build calendar

# then from any device on the LAN:
#   http://<server-ip>:8787/             -> the wall (add ?mode=wall) / phone editor
#   http://<server-ip>:8787/api/health   -> { ok: true, db: "ok", schemaVersion: ... }
```

> The `kokoro-tts` build copies `kokoro-tts/models/`, which is gitignored. On a fresh clone,
> `docker compose up --build` fails until you run `make pull-models` (or use the `calendar`-only
> command above).

Configure via `.env` (compose reads it from the repo root; see `.env.example`):

| Var | Default | Meaning |
|-----|---------|---------|
| `HOMECAL_PORT` | `8787` | host port published on the LAN |
| `HOMECAL_DATA_DIR` | `./data` | host directory bind-mounted to `/data` (the SQLite DB lives here) |
| `PI_API_TOKEN` | _(empty)_ | shared secret with the Pi voice service and the Kokoro sidecar. Empty = voice routes return 503 |

Backend settings read by the server process (`backend/src/config.ts`). Compose sets
`PORT`/`HOST`/`DATA_DIR`/`STATIC_DIR`. Pass any others through `environment:` in
`docker-compose.yml`, or set them in your shell for local dev:

| Var | Default | Meaning |
|-----|---------|---------|
| `PORT` / `HOST` | `8787` / `0.0.0.0` | listen address |
| `DATA_DIR` | `./data` | SQLite + photos directory |
| `DB_FILENAME` | `calendar.db` | database file name inside `DATA_DIR` |
| `STATIC_DIR` | _(unset)_ | serve the built frontend from here (single-origin mode) |
| `LOG_LEVEL` | `warn` | Fastify log level (`info`, `warn`, `error`) |
| `BOM_STATION_CODE` / `BOM_STATION_ID` / `BOM_STATION_NAME` | Brisbane | weather station for the BOM proxy |
| `WEATHER_CACHE_TTL_MS` | `900000` | weather cache lifetime (15 min) |
| `MAX_PHOTO_COUNT` | `500` | cap on uploaded screensaver photos |
| `KIOSK_HOST` / `KIOSK_PORT` | _(empty)_ / `8788` | Pi shutdown listener for `POST /api/kiosk/shutdown` |

**DB persistence:** the SQLite files (`.db`, `-wal`, `-shm`) live in the bind-mounted **directory** —
they survive image rebuilds. Back up that directory.

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
npm run build                       # builds frontend/dist + backend/dist
STATIC_DIR=frontend/dist npm start  # -> http://localhost:8787/
```

Run the tests:

```bash
npm --workspace backend test        # recurrence truth-table + API (node:test + tsx)
npm --workspace frontend test       # component/view-model tests (Vitest)

# Python services (pytest), each in its own venv:
cd kiosk/voice && pip install -e '.[dev]' && pytest
cd kokoro-tts  && pip install -r requirements.txt pytest httpx && pytest
```

**On Windows:** the commands above assume a POSIX shell. `STATIC_DIR=… npm start` is bash syntax
(in PowerShell, use `$env:STATIC_DIR='frontend/dist'; npm start`). The backend `test` script uses
`$(find …)`, so run it from Git Bash. Two backup-path tests assert `/`-separated paths and fail
on Windows; they pass on Linux/macOS and in Docker.

---

## Kiosk (Raspberry Pi)

The Pi runs Chromium in kiosk mode pointed at `http://<server-ip>:8787/?mode=wall`. Full setup —
autostart, display rotation, remote debugging, and the voice service — is in **`docs/deploy.md`**,
which also records the as-deployed unit's concrete facts (screen model, display output, session env).

```bash
bash kiosk/reload.sh        # reload the Pi browser via CDP (or the /reload-kiosk skill)
bash kiosk/voice-install.sh # one-shot Pi-side voice install (whisper.cpp + systemd units)
```

After `voice-install.sh`, fill in **`/etc/homecal-voice.env`** on the Pi (the script prints a
template) and start the service: `sudo systemctl start homecal-voice`. Required keys:
`OPENROUTER_API_KEY`, `HOMECAL_API_BASE` (e.g. `http://<server-ip>:8787`) and `PI_API_TOKEN`
(must match the server's). All optional tuning keys (wake threshold, mic gain, TTS backend, audio
sink…) are listed in **`kiosk/voice/README.md`**.

## Hardware

`hardware/` holds a parametric, 3D-printable wall housing (build123d): screen flush in front, a
wedge-tapered body, a rear-firing 3" speaker, and the Pi + amp inside. STL/STEP exports and the
regenerate steps are in **`hardware/README.md`**.

---

## Layout

```
backend/      Fastify API + static server, SQLite (WAL) + append-only migration runner
frontend/     Vite + React + TS app (wall + phone layouts)
kiosk/        Pi launcher/reload/shutdown scripts + systemd units
kiosk/voice/  homecal-voice (Python): wake word, STT, intents, TTS, catalogs
kokoro-tts/   LAN TTS sidecar (FastAPI + kokoro-onnx, linux/amd64)
hardware/     3D-printable wall housing (build123d model, STL/STEP)
docs/         design system, deploy guide, session log, superpowers/ specs + plans
Dockerfile    multi-stage build (frontend + backend, native compile, lean runtime)
docker-compose.yml   calendar + kokoro-tts services
.env.example  compose variables (copy to .env)
```

---

## Status

**M0–M5 complete and merged**, plus voice and hardware:

- **M0** scaffold + container · **M1** data + API (recurrence tests) · **M2** wall UI (3 views)
- **M3** editing (phone + sheets + mutations + SSE) · **M4** deploy + kiosk + backup · **M5** chores board
- **Voice** — v1 (wake word, STT, intents, mute, audit log), kid intents + catalogs, Kokoro LAN TTS
  sidecar, tap-to-talk + voice-band event add, slot tap-to-create, volume control
- **Hardware** — v3 integrated wedge wall housing (STL + STEP)

Conventions: locale `en-au` (day-first dates), many small files, immutable patterns, no secrets
(LAN, no auth in v1). New schema is added as append-only migrations in `backend/src/db/migrate.ts`.
