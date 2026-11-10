# CLAUDE.md — homecal

Self-hosted family calendar: a wall-mounted Pi touchscreen kiosk + phone editor, **LAN-only, no cloud**.
The `calendar` Docker container on the home server serves the JSON API **and** the built frontend from a
single origin, backed by local SQLite. Works with the internet unplugged. Voice (Pi-side, optional) is the
only WAN-dependent feature. An optional `kokoro-tts` container provides LAN speech synthesis.

## Source of truth (read these before changing behaviour)
- `family-calendar-build-spec.md` — the build brief. **§0 "Post-Review Decisions (locked)"** is binding;
  if anything conflicts with older prose in that file, §0 wins.
- `docs/frontend-design.md` — visual system + annotated wireframes (tokens, day/night, layouts).
- `docs/frontend-components.md` — frontend component architecture + the calendar-library decision.
- `docs/mockups/family-calendar.html` — the signed-off visual mock (static).
- `docs/SESSION-LOG.md` — running log of what was built each session + how to verify.

## Architecture
- **Monorepo, npm workspaces:** `backend/` (Fastify, CommonJS TS) + `frontend/` (Vite/React/TS, ESM).
- **Backend** serves `/api/*` and the built frontend (single origin, no CORS). SQLite via
  `better-sqlite3` (WAL), single in-process connection. `rrule` expanded **app-side** on read.
- **Frontend** is read-mostly wall (`?mode=wall` → `WallLayout`) + phone editor (M3). TanStack Query is
  the state; SSE/poll → invalidate; service worker = never-blank. FullCalendar (MIT plugins) for
  week/month, custom `AgendaView` for the default wall view.
- **`kiosk/voice/`** is a separate **Python** package (`homecal-voice`, pytest, `*_test.py` beside the
  code) that runs on the Pi under systemd, configured by `/etc/homecal-voice.env`. It talks to the
  backend over HTTP with the `X-Pi-Token` shared secret (`PI_API_TOKEN`) and receives pokes via SSE.
- **`kokoro-tts/`** is a FastAPI sidecar (`/tts`, `/catalog/{noise,joke}/{key}`, `/healthz`), `linux/amd64`
  only. Its `models/` dir is gitignored, so run `make pull-models` before `docker compose build`.
- **`hardware/`** is the 3D-printable wall housing (build123d, Python). It's independent of the app.

## Locked decisions (don't relitigate — see spec §0)
- **Timestamps:** stored TEXT, ISO-8601, **UTC**, `Z`-suffixed. Brisbane (fixed UTC+10, no DST) only at
  display. Date-only (`dinners.date`, all-day) is `YYYY-MM-DD`.
- **Recurrence:** RRULE on the master, **expanded app-side** (never in SQL). RRULEs must be **bounded**
  (`UNTIL`/`COUNT`). Single-occurrence skip = `event_exceptions` (EXDATE `cancelled`; `modified` override
  schema exists, full overrides are v2).
- **IDs** UUIDv7, server-generated. **`updated_at`** server-set. Never trust client `id`/`updatedAt`.
- **Category delete** = `ON DELETE RESTRICT` → 409 when in use. `PRAGMA foreign_keys=ON` every connection.
- **API** uses the envelope `{ error: { code, message } }`; zod validation at the boundary; event window
  capped at 1 year; occurrence count capped.
- **Colour is never the only signal** — every event chip carries icon + label (colourblind-safe,
  Okabe–Ito palette). No permanent "live" status badge — the ticking clock is the alive signal; a stale
  indicator shows only when data is old.
- Frontend: **FullCalendar `headerToolbar={false}`** — all nav driven by our ControlBar. Geist fonts
  **self-hosted** (offline). Two layouts switched by `?mode=wall`, not viewport width.

## Commands
```bash
npm install                              # both workspaces (compiles better-sqlite3 natively)
npm run dev:backend                      # API on :8787 (writes ./data)
npm run dev:frontend                     # Vite :5173, proxies /api -> :8787
npm run build                            # frontend/dist + backend/dist
STATIC_DIR=frontend/dist npm start       # prod single-origin path locally
npm --workspace backend test             # node:test + tsx (POSIX shell — use Git Bash on Windows)
npm --workspace frontend test            # Vitest
(cd kiosk/voice && pytest)               # Pi voice service tests (venv with `pip install -e '.[dev]'`)
(cd kokoro-tts && make pull-models)      # one-off before building the sidecar
docker compose up -d --build             # the supported deploy path (calendar + kokoro-tts)
docker compose up -d --build calendar    # calendar only (no models needed)
bash kiosk/reload.sh                     # reload Pi kiosk browser via CDP (or /reload-kiosk)
bash kiosk/voice-install.sh             # one-shot Pi-side install (whisper.cpp + systemd units)
ssh hbadmin@192.168.1.135 'journalctl -u homecal-voice -f'   # tail Pi-side service logs
curl localhost:8787/api/voice/status    # mic_online + mute state
```

## Conventions
- **Locale is `en-au`** — day-first dates everywhere (FullCalendar locale, ControlBar labels).
- **Many small files**, immutable patterns, errors handled explicitly, no hardcoded secrets (none needed
  — LAN, no auth in v1).
- Backend is **CommonJS** (`module: CommonJS`); frontend is **ESM**. Don't mix.
- New DB schema → append a migration in `backend/src/db/migrate.ts` (`user_version` runner,
  append-only, forward-only). Seeds are idempotent.
- **DB lives in a host-mounted DIRECTORY** (`/data`), never a single file — `.db` + `-wal` + `-shm` must
  persist together. It's gitignored; `data/` may be root-owned (created by the container).
- Tests-first for anything touching recurrence; that engine is the riskiest code (`backend/src/recurrence.ts`).
- **Comments explain WHY, not WHAT** — only add one when the reason isn't obvious from the code: a hidden
  constraint, a library footgun, a vendor quirk that produced a real bug. Skip everything else: no dated
  debug logs ("Measured live 2026-06-05"), no specific measured numbers that rot when hardware changes
  ("peak ~3800/32768"), no narrative referencing past sessions or "the X saga". Research-log content goes
  in `docs/SESSION-LOG.md`; the code keeps the rule, not the story behind it.

## Status (2026-11-11)
- **M0** scaffold + container — done (`f419063`)
- **M1** data + API — done (`24d7651`), recurrence tests
- **M2** wall UI — done (`5b3d5ed`), all 3 views verified via screenshot
- **M3** editing (phone + sheets + mutations + SSE) — done; hardened after a pre-M4 review.
- **M4** deploy + kiosk + backup — done. Deploy guide in `docs/deploy.md`.
- **M5** chores board — done. Family members + chores + tap-to-complete on wall.
- **Voice v1** — merged and deployed to the Pi.
- **Voice follow-ups** — kid intents + joke/noise catalogs (PR #5), Kokoro LAN TTS sidecar,
  calendar UI v2 + slot tap-to-create (PRs #6–#7), tap-to-talk + voice-band `event_add` (PR #8), volume control (PR #10, migration v8).
- **Hardware** — wall housing v1→v3 integrated wedge shell + STEP export (PRs #12–#14).
- **Tests (2026-11-11):** backend 208 (206 pass on Windows; the 2 backup-path tests assume `/`
  separators and pass on Linux), frontend 121/121.

### Feature inventory (beyond core CRUD)
- **Realtime** — in-process SSE broker (`GET /api/stream`); mutations `poke()`;
  client `useRealtime` invalidates + 30s poll backstop.
- **Backup** — `POST /api/backup` (`VACUUM INTO`, auto-prune to 10). 3 tests.
- **Photo screensaver** — upload/serve/delete API (`sharp` resize, `@fastify/multipart@8`),
  5-min idle → dual-buffer Ken Burns crossfade, phone PhotoManager. 18 backend + 4 frontend tests.
- **iCal feed** — `GET /api/feed.ics` (`ical-generator`, native RRULE+EXDATE). 11 tests.
- **Weather** — `GET /api/weather` (BOM proxy, 15-min in-memory cache, eager prefetch, stale fallback).
  `WeatherSidebar` in HeroBand, day/night icons. 28 tests. No new deps (Node 20 `fetch`).
  Configurable via `BOM_STATION_CODE`/`BOM_STATION_ID`/`BOM_STATION_NAME`.
- **Kiosk** — `kiosk/launch.sh` (health-poll → Chromium kiosk), `kiosk/reload.sh` (CDP reload),
  remote shutdown (`POST /api/kiosk/shutdown` → Pi socat listener). Virtual keyboard (react-simple-keyboard).
- **SW** — network-first nav + cache fallback, shell cache keyed to `__BUILD_ID__`, old caches evicted.
- **Graceful shutdown** — `drainSSE()` ends open connections before `app.close()` + WAL checkpoint.
  `stop_grace_period: 30s`.
- **Forms** — plain controlled React state, no react-hook-form/zod on frontend; API Zod is authoritative.
- **Recurrence editing** — whole-series edit + This/All delete. "This-and-following" + modified overrides = v2.
- **Chores board** — family members + chores CRUD with daily/weekly frequency,
  tap-to-complete on wall with star-fly animation + chime (muted 8pm–7am),
  optimistic updates, SSE sync. Phone managers for family + chores. 3 new tables
  (`family_members`, `chores`, `chore_completions`). 38 backend + 4 frontend tests added.
- **Voice** — Pi-side service `homecal-voice` (under `kiosk/voice/`). Wake = openWakeWord
  `hey_luna` (custom-trained ONNX at `kiosk/voice/homecal_voice/wake_models/hey_luna.onnx`) or
  tap-to-talk. STT = Gemini 3 Flash via OpenRouter, falling back to local whisper.cpp `small.en-q5_1`
  (`whisper-server`). Intent = local pattern matchers first (`patterns_v1/kid/timer`), then Haiku 4.5
  via OpenRouter. TTS = `TTS_BACKEND=cloud` (Kokoro-82M via OpenRouter, default) or `lan`
  (`kokoro-tts` sidecar, falling back to cloud). Intents: dinner_set, chore_complete, query_dinner,
  query_agenda, event_add (always confirms), volume_set, timers, joke_tell, noise_play, ask_question
  (tiered safety prompt). Full env reference: `kiosk/voice/README.md`. Confirmation card on the wall via existing SSE (mid-confidence intents listen
  briefly for yes/no/edit via `confirm_loop`). Mute toggle in ControlBar + phone Manage tab
  (instant via SSE poke; 5s polling backstop). Audit log at `voice_utterances`; mute state at
  `voice_settings` (migration v3). Voice is the only WAN-dependent feature — calendar stays
  offline-capable.
- **Volume control** — `PUT /api/voice/volume` + `/api/voice/audio-mute` (migration v8),
  VolumeControl popover on the wall ControlBar + phone Voice section. The Pi applies it via `wpctl` on
  poke + at startup (`HOMECAL_AUDIO_SINK` pins the sink).

## Gotchas
- `better-sqlite3` is native — compiled for the **server's** arch inside the Docker build; `.dockerignore`
  excludes host `node_modules`. Never copy a host/Pi binary in.
- **Two idle timers** on the wall: 90s `useIdleReset` (returns to Agenda+today) and 5-min screensaver
  (`useScreensaver`). Independent — don't merge.
- **SSE holds connections open** — use `waitUntil:'load'` (NOT `networkidle`) in any browser
  automation or `goto` times out.
- **Windows dev:** the backend `test` script uses `$(find …)`, and README examples use `VAR=x cmd`.
  Both need a POSIX shell (Git Bash). Two `backup.test.ts` cases assert `/`-separated paths and fail on
  Windows only. npm ≥11 blocks install scripts, so after `npm ci` run
  `npm rebuild better-sqlite3 esbuild sharp` if native modules fail to load.
- `PI_API_TOKEN` must match on the server (`.env`), the Pi (`/etc/homecal-voice.env`) and kokoro-tts.
  Empty on the server → voice routes 503.
- The sandbox tool channel in this environment intermittently drops command output — re-run/verify rather
  than trusting silence. `docker compose` may need `dangerouslyDisableSandbox`.
- Playwright MCP wants the `chrome` channel (needs sudo); use the cached chromium at
  `~/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome` via a `playwright-core` require for screenshots.
