# CLAUDE.md — homecal

Self-hosted family calendar: a wall-mounted Pi touchscreen kiosk + phone editor, **LAN-only, no cloud**.
One Docker container on the home server serves the JSON API **and** the built frontend from a single
origin, backed by local SQLite. Works with the internet unplugged.

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
npm --workspace backend test             # recurrence truth-table (node:test + tsx)
docker compose up -d --build             # the supported deploy path
```

## Conventions
- **Many small files**, immutable patterns, errors handled explicitly, no hardcoded secrets (none needed
  — LAN, no auth in v1).
- Backend is **CommonJS** (`module: CommonJS`); frontend is **ESM**. Don't mix.
- New DB schema → append a migration in `backend/src/db/migrate.ts` (`user_version` runner,
  append-only, forward-only). Seeds are idempotent.
- **DB lives in a host-mounted DIRECTORY** (`/data`), never a single file — `.db` + `-wal` + `-shm` must
  persist together. It's gitignored; `data/` may be root-owned (created by the container).
- Tests-first for anything touching recurrence; that engine is the riskiest code (`backend/src/recurrence.ts`).

## Status (2026-06-01)
- **M0** scaffold + container — done (`f419063`)
- **M1** data + API — done (`24d7651`), recurrence tests
- **M2** wall UI — done (`5b3d5ed`), all 3 views verified via screenshot
- **M3** editing (phone + sheets + mutations + SSE) — done; hardened after a pre-M4 review.
  Backend 16/16, frontend 15/15 (vitest), phone↔wall sync + cancel-one-occurrence verified.
- **M4** deploy + kiosk + backup — **next**

### M4 must-do (carried from the pre-M4 review — see SESSION-LOG 2026-06-01)
- **`POST /api/backup`** (`VACUUM INTO` a timestamped snapshot in the data dir) — named deliverable.
- **SW shell cache versioning:** `frontend/public/sw.js` caches the shell cache-first under a static
  `v1`; after a redeploy the wall can keep serving the OLD bundle. Version the cache per build (or make
  navigation network-first-with-cache-fallback). M4 is the first redeploy over a live wall, so fix here.
- **Graceful shutdown drains SSE:** `/api/stream` hijacks the raw socket, so `app.close()` doesn't own
  it — track open SSE sockets and `.end()` them on SIGTERM, and set `stop_grace_period: 30s` in compose,
  else a busy restart can SIGKILL before the WAL checkpoint.
- Reverse-proxy SSE snippet (buffering off + long read timeout) or document "direct host:port, no proxy".
- Fastify `logger: { level: 'warn' }` + Docker `max-size`/`max-file` log rotation (always-on box).
- Build the image **on the target arch** (Pi/server) — better-sqlite3 is native; cross-arch = crash-loop.

### M3 notes
- **Realtime:** in-process `broker` (`backend/src/realtime.ts`) + `GET /api/stream` SSE; every
  event/dinner/category mutation `poke()`s. Client `useRealtime` invalidates the matching query family;
  the 30s poll is the backstop. SSE holds connections open → use `waitUntil:'load'` (NOT `networkidle`)
  in any browser automation or `goto` times out.
- **Forms:** plain controlled React state + lightweight client validation (NOT react-hook-form/zod — kept
  off the frontend to avoid deps; the API Zod schema is authoritative and `ApiError.code` drives UX such
  as the 409 `CATEGORY_IN_USE`).
- **Recurrence editing (M3 scope):** edits apply to the **whole series** (PUT master); delete offers
  **This occurrence** (cancel → EXDATE) vs **All**. "This-and-following" + modified-occurrence overrides
  are v2 (no backend route yet).
- **Backend test glob fixed:** `find src -name '*.test.ts'` (npm's `sh` lacks globstar, so the old
  `src/**/*.test.ts` matched nothing — tests silently never ran).

## Gotchas
- `better-sqlite3` is native — compiled for the **server's** arch inside the Docker build; `.dockerignore`
  excludes host `node_modules`. Never copy a host/Pi binary in.
- The sandbox tool channel in this environment intermittently drops command output — re-run/verify rather
  than trusting silence. `docker compose` may need `dangerouslyDisableSandbox`.
- Playwright MCP wants the `chrome` channel (needs sudo); use the cached chromium at
  `~/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome` via a `playwright-core` require for screenshots.
