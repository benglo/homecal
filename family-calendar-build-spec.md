# Family Calendar Display — Build Spec (v2, post-review)

A wall-mounted, touchscreen family calendar (a self-hosted "Skylight Calendar" clone). The
**Raspberry Pi 5 + 10.1" touchscreen is a thin kiosk client**; the **backend runs as a Docker
container on the home server** and holds all data in a local SQLite database. **Fully self-contained
on the LAN: no cloud, no external calendar service, no Apple/Google account.** This document is the
build brief for an agentic coding session (e.g. Claude Code). Work through the milestones in order;
each has acceptance criteria. Read the **Decisions**, **Prerequisites**, and **Gotchas** sections
before writing code — they contain constraints that are easy to get wrong.

> **v2 of this spec** folds in a three-persona review (principal engineer, UX, DBA). Items added or
> changed by that review are tagged **[R]** inline, and the binding choices are collected in
> **§0 Post-Review Decisions (locked)**. Where §0 conflicts with older prose, §0 wins.

-----

## 0. Post-Review Decisions (locked) **[R]**

These are decided. Don't relitigate them; implement them.

**Data & correctness**
- **Timestamps:** stored as **TEXT, ISO-8601, UTC, fixed-width, `Z`-suffixed** (e.g.
  `2026-05-31T09:30:00Z`). Lexicographically sortable → indexable window queries. Convert to
  `Australia/Brisbane` only at the presentation edge. Date-only values (`dinners.date`, all-day
  bounds) are a distinct `YYYY-MM-DD` TEXT type — never mixed with instants.
- **Timezone assumption:** the system assumes **fixed UTC+10, no DST** (Brisbane). Documented
  limitation: it will mis-expand recurrence if relocated to a DST zone.
- **Recurrence read path:** RRULE stored on the master event; **expand on read in the app**, never in
  SQL. Two-query candidate fetch: (1) non-recurring rows via the `(start,end)` window predicate, (2)
  **all** recurring masters via the partial `rrule` index, then `RRule.between(start, end, true)`.
  Every generated RRULE **must carry `UNTIL` or `COUNT`**; the expander caps total occurrences.
- **Single-occurrence edits/skips:** ship an `event_exceptions` table in M1 (EXDATE + override model).
  v1 wires **"cancel this occurrence"** (`cancelled`); single-occurrence **overrides** (`modified`)
  may be deferred to v2 but the schema lands now (no painful later migration).
- **IDs:** server-generated **UUIDv7** strings for `categories`/`events`. Never trust a client `id`.
- **`updated_at`:** **server-generated on every write** (phone clocks drift). It is the change-signal
  for polling/cache dedupe; last-write-wins falls out of the single serialized writer.
- **Category delete:** `category_id` is `NOT NULL`, FK `ON DELETE RESTRICT`. Deleting a category with
  events returns **409** with the event count ("move or delete its events first"). Seed an
  `Uncategorized` category to enable a "reassign then delete" UX.
- **PRAGMAs (every startup):** `journal_mode=WAL`, `synchronous=NORMAL`, `foreign_keys=ON`,
  `busy_timeout=5000`. Single in-process `better-sqlite3` connection (no pool).
- **Migrations:** `user_version`-based runner from M0 (append-only, forward-only, each in a txn).
  Seed data idempotent (`ON CONFLICT … DO NOTHING`).
- **Backups:** the M4 endpoint uses **`VACUUM INTO`** (never `cp` a live WAL DB). **Bind-mount the
  data *directory*** so `.db` + `.db-wal` + `.db-shm` all persist.

**API**
- **Validation at the boundary** (Fastify JSON-schema or zod): hex `color`; `end >= start`; all-day
  consistency; `categoryId` exists; **`rrule` parses** (try/catch — a malformed stored rule throws on
  every read and blanks the wall). **Cap window size** (reject ranges > ~1 year) and **cap total
  expanded occurrences**.
- **Error envelope:** `{ "error": { "code": string, "message": string } }` with a status map (400
  validation, 404 not found, 409 conflict/FK, 500). The wall uses this to tell "transient → use cache"
  from "bad edit → show message."
- **Added endpoints:** `GET /api/events/:id` (fetch master rule for editing),
  `DELETE /api/dinners/:date` (clear a meal), `DELETE /api/events/:id/occurrences/:date` (cancel one
  occurrence). Backup/export reconciled into §7.
- **Realtime:** **SSE is the default**, treated as a *"poke to refetch,"* not a delta stream;
  client refetches the current window on each ping and on reconnect. **Fallback poll every 60s.**

**Frontend / resilience**
- **Never-blank mechanism = service worker** (cache app shell **and** last-good API responses), not
  IndexedDB-alone — IndexedDB can't help when the shell itself fails to load at boot. Optional
  IndexedDB for structured payload.
- **Stale indicator:** when serving cache after a failed fetch, show a subtle "last updated HH:MM" /
  amber dot when stale (> ~2 min). Never a spinner/banner/error page on the wall.
- **No colour-only encoding:** every event chip carries a **text label and/or icon** in addition to
  category colour (colourblind accessibility). Per-category text colour auto-picked by luminance for
  contrast (target AA min, AAA on the wall).
- **Default wall view = a custom agenda/multi-day list** (not FullCalendar month). Month is opt-in
  "zoom out." Global wall type scale ~1.6–2× FullCalendar defaults.
- **Two layouts, one app:** `WallLayout` vs `PhoneLayout` over a shared data layer, selected by an
  explicit kiosk flag (`?mode=wall`), **not** inferred from viewport width.
- **Idle reset** returns to the **default view *and* today's date**; live clock always ticking.

**Build / deploy**
- Backend module strategy resolved up front for **better-sqlite3 (CJS)** interop.
- Dockerfile `npm ci` **inside the target-arch build stage**; `.dockerignore` excludes host
  `node_modules` (native-binary arch trap).
- FullCalendar limited to the **free MIT plugins** (`dayGridMonth`, `timeGridWeek`, `timeGridDay`).
- Reverse-proxy notes for SSE (disable buffering, long read timeout) belong in M4.
- Kiosk flags include `--noerrdialogs --disable-session-crashed-bubble`; two-layer auto-retry
  (OS-level pre-launch URL probe + in-page reload watchdog).
- `PRAGMA wal_checkpoint(TRUNCATE)` on graceful shutdown; `PRAGMA integrity_check` at startup/health.

-----

## 1. Goal

Replace a paper wall calendar with an always-on touchscreen display that shows:

1. A shared family calendar — events colour-coded by **entry type**, in agenda / week / month views.
2. **Tonight's dinner**, prominently — plus the rest of the week's meals.

The home server is the system of record: a containerised app serves **one web app on the LAN** (API +
UI from a single origin), backed by a local SQLite database. The **Pi is a stateless kiosk** that just
displays that web app fullscreen and accepts touch. Family members add/edit events and meals through the
app — from their phones on the LAN, or on the touchscreen. Everything is local; it works with the
internet unplugged. The wall must never blank or error, including when the server briefly restarts.

-----

## 2. Target environment

- **Backend host:** existing always-on home server with **Docker + Docker Compose**. Runs the app
  container; stores the SQLite DB on a host volume that's part of the server's backups.
- **Kiosk client:** Raspberry Pi 5, Raspberry Pi OS (Bookworm, 64-bit), Wayland + labwc. Runs **only**
  Chromium in kiosk mode pointed at the server URL — no app code, no data on the Pi.
- **Display:** Waveshare 10.1-DSI-TOUCH-A, native 800×1280, **rotated to landscape (1280×800)** —
  already configured; do **not** change it. Capacitive 10-point touch; design for finger taps
  (≥ 48px on phone, **≥ 64–80px primary controls on the wall [R]**, no hover-only UI).
- **Network:** home LAN only, never exposed to the internet. Phones + Pi reach the server by hostname
  (mDNS / reserved IP) or via an existing reverse proxy.
- **Locale / timezone:** `Australia/Brisbane` (no daylight saving).

-----

## 3. Key decisions (already made — don't relitigate)

- **Data source: local SQLite on the home server.** No external calendar, no CalDAV, no cloud, no
  account. The server is the single source of truth.
- **Deployment:** the backend is **one Docker container** on the home server. It serves the JSON API
  **and** the built frontend as static files from a single origin (no CORS). The SQLite file lives on a
  **host-mounted volume** so it survives image rebuilds and rides the server's backup regime.
- **The Pi is a thin client.** It runs nothing but a Chromium kiosk pointed at the server URL. It is
  stateless and disposable — reflashing it loses nothing.
- **Entry path:** all create/edit/delete happens through the app — phone browsers on the LAN and the
  touchscreen. This is core v1 (there is no other way in).
- **Colour = entry type, not person.** Events belong to a **category** (e.g. `Appointments`,
  `Activities`, `School`, `Sport`, `Dinner`); colour is per category and configurable. **Colour is
  never the only encoding — chips also carry a label/icon. [R]**
- **Dinner model:** one meal per day, surfaced as a prominent banner + a weekly strip; stored locally,
  not drawn in the event grid.
- **Recurrence:** simple (none / daily / weekly / monthly) via an RRULE stored on the event, expanded
  on read with `rrule`, **plus an exception/EXDATE model for single-occurrence skips. [R]**

**Known consequence (accepted):** events exist only in this app — they do **not** appear in native
phone calendars and there are no iOS notifications. The no-account bridge, if ever wanted, is a
read-only `.ics` feed phones can subscribe to (see v2).

-----

## 4. Tech stack

**Backend (in the container)**

- Node + TypeScript, **Fastify** (built-in JSON-schema validation + serialization). **[R]**
- **SQLite** via `better-sqlite3` (CJS — interop decided in M0), **WAL mode**, single in-process
  connection.
- `rrule` for expanding recurring events within a date window (bounded, app-side).
- Serves the built frontend as static files (single origin).

**Frontend**

- Vite + React + TypeScript, Tailwind CSS.
- `@fullcalendar/react` — **free MIT plugins only** (`daygrid`, `timegrid`); plus a **custom Wall
  agenda view** as the kiosk default. **[R]**
- **Two layouts** (`WallLayout` / `PhoneLayout`) over a shared data/API layer, switched by an explicit
  kiosk flag. **[R]**
- **Service worker** caches the app shell **and** last-successful API payloads so a server/LAN blip
  (including server-down-at-boot) never blanks the wall. **[R]**

**Packaging / deploy**

- Multi-stage `Dockerfile` (build frontend → runtime image runs the Node server serving API + static);
  `npm ci` inside the **target-arch** build stage; `.dockerignore` excludes host `node_modules`. **[R]**
- `docker-compose.yml`: published port, **host-volume-mounted DB *directory***, `restart: unless-stopped`.

**Kiosk (on the Pi)**

- Chromium kiosk under labwc/Wayland, pointed at the server URL (`?mode=wall`), with two-layer
  auto-retry/reload and `--noerrdialogs --disable-session-crashed-bubble`. **[R]**

-----

## 5. Prerequisites (human setup — small)

1. Home server with **Docker + Compose**. Pick a **published port** (and, optionally, front it with your
   existing **reverse proxy** for a clean hostname / TLS — **disable buffering + long read timeout on
   the SSE route**). **[R]**
2. Choose a **host directory for the SQLite volume** and make sure it's covered by the server's backups.
3. Make the server reachable from the Pi and phones by a stable name (mDNS hostname or a reserved IP),
   e.g. `http://server.local:PORT` or `https://calendar.lan`.
4. The Pi only needs network + Chromium — nothing else.

-----

## 6. Data model

### 6.1 Conceptual types

```ts
type Category = {
  id: string;          // UUIDv7, server-generated
  name: string;        // entry type, e.g. "Appointments", "Sport"
  color: string;       // hex '#RRGGBB'
  icon?: string;       // [R] optional icon key for chips (label/icon redundancy)
  updatedAt: string;   // ISO-8601 UTC
};

type Event = {
  id: string;          // UUIDv7
  categoryId: string;  // FK -> categories.id (NOT NULL, RESTRICT)
  title: string;
  start: string;       // ISO-8601 UTC ('start' instant; DTSTART for recurring)
  end: string;         // ISO-8601 UTC (api name; stored as end_at)
  allDay: boolean;
  location?: string;
  rrule?: string;      // optional; none/daily/weekly/monthly, always with UNTIL/COUNT
  updatedAt: string;   // server-generated, for last-write-wins / change detection
};

type EventException = {        // [R] single-occurrence skip/override
  eventId: string;             // FK -> events.id (CASCADE)
  occurrenceDate: string;      // original occurrence start, ISO-8601 UTC
  kind: 'cancelled' | 'modified';
  title?: string; start?: string; end?: string; location?: string; // for 'modified'
};

type Dinner = {
  date: string;        // YYYY-MM-DD (one meal per day, natural PK)
  meal: string;
  updatedAt: string;
};
```

The API returns **expanded occurrences** for the requested window (with `cancelled` exceptions removed
and `modified` exceptions overlaid), not the master rule. Synthetic occurrence IDs are
`${masterId}:${occurrenceISO}` so the UI and single-occurrence ops can address them.

### 6.2 SQLite schema (M0/M1 starting DDL) **[R]**

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous  = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

CREATE TABLE categories (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  color      TEXT NOT NULL,
  icon       TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  CHECK (color GLOB '#[0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f]')
);

CREATE TABLE events (
  id          TEXT PRIMARY KEY,
  category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  title       TEXT NOT NULL CHECK (length(title) > 0),
  start       TEXT NOT NULL,              -- ISO-8601 UTC; DTSTART for recurring
  end_at      TEXT NOT NULL,              -- 'end' is reserved; store as end_at
  all_day     INTEGER NOT NULL DEFAULT 0 CHECK (all_day IN (0,1)),
  location    TEXT,
  rrule       TEXT,                       -- NULL = single occurrence
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  CHECK (end_at >= start)
);

CREATE TABLE event_exceptions (
  event_id        TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  occurrence_date TEXT NOT NULL,          -- original occurrence start, ISO-8601 UTC
  kind            TEXT NOT NULL CHECK (kind IN ('cancelled','modified')),
  title    TEXT, start TEXT, end_at TEXT, location TEXT,   -- override fields (modified)
  PRIMARY KEY (event_id, occurrence_date)
);

CREATE TABLE dinners (
  date       TEXT PRIMARY KEY CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  meal       TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX idx_events_window   ON events(start, end_at);
CREATE INDEX idx_events_rrule    ON events(rrule) WHERE rrule IS NOT NULL;
CREATE INDEX idx_events_category ON events(category_id);
-- dinners(date) PK serves the dinners window query; no extra index needed.
```

-----

## 7. Backend API (full CRUD — the only way data gets in)

- `GET  /api/health` → `{ ok }` (includes a cheap `integrity_check` signal) **[R]**
- `GET  /api/categories` / `POST` / `PUT /:id` / `DELETE /:id` (409 if events reference it) **[R]**
- `GET  /api/events?start=ISO&end=ISO` → expanded occurrences in window (capped) **[R]**
- `GET  /api/events/:id` → the **master rule** (for editing a series) **[R]**
- `POST /api/events` / `PUT /api/events/:id` / `DELETE /api/events/:id`
- `DELETE /api/events/:id/occurrences/:date` → cancel a single occurrence (EXDATE) **[R]**
- `GET  /api/dinners?start=ISO&end=ISO` / `PUT /api/dinners/:date` / `DELETE /api/dinners/:date` **[R]**
- `GET  /api/stream` → **SSE (default)**: a change "poke"; client refetches the window. **[R]**
- `POST /api/backup` → `VACUUM INTO` a timestamped snapshot in the data dir **[R]**

All responses use the **error envelope** `{ error: { code, message } }` on failure with the status map
above. Inputs validated at the boundary; `rrule` parse-checked on write; window + occurrence counts
capped. Same server serves the built frontend (single origin). Bind `0.0.0.0` inside the container. No
auth on the trusted LAN for v1 (optional shared PIN later).

-----

## 8. Frontend requirements

> Visual design system + annotated wireframes are locked in a companion doc:
> **`docs/frontend-design.md`** (the build must follow it). **[R]**

**Wall / kiosk layout (landscape 1280×800, glanceable across a room):**

- Header: large live clock + date (Brisbane), always ticking.
- Dinner banner: prominent "Tonight: {meal}" (hero, 48px+) + a compact strip of the week's meals;
  **reserved height** with an inviting "tap to add" empty state (no layout jump); "tonight" rolls to
  tomorrow after ~8pm. **[R]**
- Calendar: **custom agenda/multi-day Wall view by default**; FullCalendar week/month as opt-in via a
  bottom-anchored, large-target view switcher. Events coloured by category **and labelled/iconed**;
  today highlighted with a high-contrast treatment. Dinner is the banner, not a grid event. **[R]**
- Legend: small key of category → colour (de-emphasised; chips are self-labelling). **[R]**
- Quick-add on touch (title + category + day; minimal fields). Grid taps open a **day-detail sheet**,
  not in-grid chip selection. **[R]**
- Live updates (SSE) with 60s fallback poll; **never blank on a failed fetch — service-worker cache +
  subtle stale indicator.** **[R]**
- Idle: after no touch (~60–120s), cross-fade back to the default view **and reset to today**. **[R]**

**Phone layout (responsive, same app over the LAN):**

- Add / edit / delete events (title, category, date/time, all-day, simple repeat, location), incl.
  **cancel-this-occurrence** for a series. **[R]**
- Set / clear the dinner for a day.
- Manage categories + colours **+ icon**. **[R]**

Aesthetic: clean, high-contrast, glanceable across a room; large text; no clutter. **Contrast beats
prettiness on the wall** (AA min, AAA target); the phone may be softer. **[R]**

-----

## 9. Deployment & kiosk

**Backend (home server):**

- Build the multi-stage image; run via `docker compose up -d` with the DB **directory** bind-mounted and
  `restart: unless-stopped` so it returns after a server reboot.
- Reach it on the LAN by host:port, or behind your existing reverse proxy for a clean hostname.
  **Disable proxy buffering + set long read timeout on `/api/stream` (SSE).** **[R]**

**Kiosk (Pi):**

- Launch Chromium fullscreen kiosk at the server URL `?mode=wall` under labwc/Wayland
  (`chromium-browser --kiosk --ozone-platform=wayland --app=URL --noerrdialogs
  --disable-session-crashed-bubble`, hide cursor, disable infobars). Use a labwc autostart entry or
  systemd user service — **not** the old X11/lxsession method. **[R]**
- **Two-layer auto-retry:** OS-level pre-launch loop that curls the URL until 200 before launching
  Chromium, **plus** an in-page watchdog that reloads on repeated fetch failure — so the wall recovers
  itself instead of parking on a Chromium error page. **[R]**
- **Disable screen blanking / sleep.** Enclosed shadow-box frame with an active cooler; don't busy-loop.

-----

## 10. Milestones (build in this order)

**M0 — Scaffold + container.** Single repo; backend (TS/Fastify) + `/frontend` (Vite/React/TS); backend
serves the built frontend; SQLite (WAL) via a **`user_version` migration runner** with schema + seed
categories; **better-sqlite3 CJS/ESM interop decided**; multi-stage `Dockerfile` (target-arch `npm ci`,
`.dockerignore` node_modules) + `docker-compose.yml` with the DB **directory** on a host volume; README
with §5 setup. *Done when `docker compose up` serves a placeholder page reachable from another device on
the LAN, and the DB persists across an image rebuild.* **[R]**

**M1 — Data + API.** Categories CRUD (delete→409 on refs), events CRUD with **bounded app-side `rrule`
expansion** + `event_exceptions` (cancel-occurrence), `GET /api/events/:id`, dinners get/set/clear,
health, error envelope, boundary validation. **Tests first:** a table-driven `(rrule, window) →
occurrences` truth-table covering all-day weekly, timed weekly across a month boundary, an
EXDATE-excluded week, and a window starting mid-series. *Done when all §7 endpoints work and recurrence
expands correctly across windows per the truth-table.* **[R]**

**M2 — Wall UI.** Custom agenda Wall view (default) + FullCalendar week/month opt-in, **colour + label/
icon** per category + legend, dinner banner + weekly strip (reserved height, empty state, tonight
roll-over), today high-contrast highlight, live/auto refresh, **service-worker last-good cache + stale
indicator**. *Done when data renders correctly in agenda/week/month on the Pi screen, and stopping the
server then reloading still renders last-good (no blank/error).* **[R]**

**M3 — Editing.** Responsive add/edit/delete for events (incl. simple repeat **and
cancel-this-occurrence**), set/clear dinner, manage categories (colour + icon) — usable on a phone
browser and via touch; changes propagate to the wall live (SSE poke → refetch; 60s fallback). *Done when
a phone on the LAN adds an event (incl. a weekly repeat) and it appears on the wall within the refresh
interval, and cancelling one occurrence removes only that instance.* **[R]**

**M4 — Deploy + kiosk.** Container on the server with restart policy + host-volume DB **directory**
(survives a server reboot); **`POST /api/backup` via `VACUUM INTO`** + confirmation the data dir is in
the server's backups; reverse-proxy SSE notes applied; Pi boots into the kiosk (`?mode=wall`) with
**two-layer auto-retry**; screen-blanking disabled; verified to work with the internet unplugged. *Done
when a cold boot of both boxes lands on the live display unattended, restarting the server recovers the
wall on its own (chaos test: `docker compose stop` → wall stays populated → `up` → recovers).* **[R]**

**v2 / stretch (note only):** single-occurrence **overrides** (`modified` exceptions, full RRULE
`RECURRENCE-ID` semantics); read-only `.ics` feed for phone subscription (no account); photo screensaver
on idle; weather + clock sidebar; chores/rewards; night dimming via the panel's software backlight;
optional shared PIN.

-----

## 11. Gotchas (read before coding)

- **DB persistence:** the SQLite files live on a **host bind-mounted *directory*** (`.db` + `-wal` +
  `-shm`), not the single `.db` file and not inside the container — a rebuild must never wipe data, and
  mounting only `.db` silently loses uncheckpointed WAL commits. Enable **WAL + `synchronous=NORMAL`**;
  `wal_checkpoint(TRUNCATE)` on graceful shutdown. **[R]**
- **Native module arch:** `better-sqlite3` compiles for the **server's** architecture inside the image.
  `npm ci` in the target-arch build stage; `.dockerignore` host `node_modules`; never copy a host/Pi
  binary. It's **CJS** — resolve interop in M0. **[R]**
- **Foreign keys are per-connection and OFF by default** — `PRAGMA foreign_keys=ON` every connection or
  RESTRICT/CASCADE silently don't fire. **[R]**
- **Recurrence can't be filtered in SQL:** fetch all recurring masters (partial index) + expand
  app-side, bounded by the window; force `UNTIL`/`COUNT`; cap occurrence count; **validate `rrule` on
  write** (a bad stored rule throws on every read and blanks the wall). Handle all-day (date-anchored)
  vs timed; keep everything UTC in storage, Brisbane only at display. **[R]**
- **Kiosk ↔ server is a network hop:** the Pi must tolerate the server being down at boot or during a
  restart — two-layer auto-retry rather than erroring — and the **service-worker** last-good cache (shell
  + API) covers blips so the wall stays populated. IndexedDB-alone is insufficient at boot. **[R]**
- **SSE behind a reverse proxy** dies silently unless buffering is off and read timeout is long; treat
  SSE as a refetch poke and always run the 60s fallback poll. **[R]**
- **Single origin:** the container serves API + static frontend together to avoid CORS.
- **Concurrency:** single in-process writer serializes writes; last-write-wins via **server-generated**
  `updated_at` is fine; don't over-engineer. **[R]**
- **Bookworm kiosk is Wayland/labwc**, not X11; use `--ozone-platform=wayland` + `--noerrdialogs`. **[R]**
- **Display rotation is already set** — leave it alone.
- **Accessibility:** never encode category by colour alone (labels/icons); AA contrast min, AAA on the
  wall; wall type scale ~1.6–2× defaults. **[R]**
- **Security:** trusted LAN only, no internet exposure; never trust client-supplied `id`/`updatedAt`; no
  auth in v1 (optional PIN later).
- **Resilience first:** a failed fetch, a server restart, or a reboot must never leave a blank or error
  screen on the wall.

-----

## 12. Acceptance (v1 done)

The app runs as a container on the home server (survives a server reboot via its restart policy), with
SQLite on a backed-up host-volume **directory**. The Pi cold-boots into a fullscreen kiosk (`?mode=wall`)
pointed at the server, showing the calendar colour-coded **and labelled** by entry type with a legend,
today highlighted, tonight's dinner prominent and the week's meals visible — and it recovers on its own
if the server restarts (verified by a `docker compose stop`/`up` chaos test). A family member opens the
app on their phone over wifi, adds an event (incl. a weekly repeat), cancels one occurrence of a series,
and sets a dinner, and all appear correctly on the wall within the refresh interval. Everything works
with the internet unplugged.
