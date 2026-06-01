# Session Log — homecal

Running log of work per session. Newest first. Pair with `git log` for exact diffs.

---

## 2026-06-01 (cont.) — M4 post-deploy fixes + kiosk tuning

### Code review fixes (from high-effort 7-angle review)
- **SW undefined fallback** — API/static handlers now return a 503 Response on cache-miss +
  network-failure instead of undefined (TypeError).
- **SW fire-and-forget cache write** — navigation cache write wrapped in `event.waitUntil()`.
- **Backup concurrency guard** — 409 `BACKUP_IN_PROGRESS` prevents concurrent `VACUUM INTO`.
- **Dev buildId** — defaults to `'dev'` instead of `Date.now()` to avoid stale cache accumulation.
- **`__BUILD_ID__` declare** — moved from inline in main.tsx to `vite-env.d.ts`.

### Sheet focus steal fix
- `Sheet.tsx` effect depended on `[open, onClose]` — since `onClose` was a new arrow each render
  (from SSE-triggered re-renders in WallLayout), the effect re-fired and yanked focus from inputs
  to the panel div after ~2-3s. Fixed with a stable ref pattern (`onCloseRef` + `useCallback`).

### Kiosk deployment
- Pi autostart: `~/.config/labwc/autostart` with Chromium Wayland kiosk flags pointed at
  `http://192.168.1.94:8787/?mode=wall`.
- **Remote debugging:** `--remote-debugging-port=9222` on Chromium (binds localhost only on
  Bookworm); `socat` on port 9223 forwards from LAN. Reload script at `kiosk/reload.sh`.
- **On-screen keyboard:** Wayland virtual keyboard (wvkbd/squeekboard) failed to trigger from
  Chromium kiosk. Solved with `react-simple-keyboard` — JS keyboard portaled to `document.body`
  (z-index 200, above Sheet portal at z-50), wall-only (mounted in `WallLayout`, not phone).
  Activates on text/search input focus, ignores date/time/checkbox. `useIsWall` hook extracted
  from `ModeRouter` for shared wall-mode detection.

### Deploy docs updated
- Remote debugging section with `socat` workaround and reload one-liner.
- `kiosk/launch.sh` updated with `--remote-debugging-port=9222`.

### Pi details (for reference)
- Pi IP: `192.168.1.135`, server IP: `192.168.1.94`
- Pi user: `hbadmin`, hostname: `homebuddy`
- Chromium 142.0.7444.175, labwc 0.9.2, Bookworm (trixie)
- `socat` required (`sudo apt install socat`) for LAN debug access

---

## 2026-06-01 — M4: deploy + kiosk + backup

### What was built
- **`POST /api/backup`** — `VACUUM INTO` creates a timestamped standalone `.db` in the data dir.
  Auto-prunes to 10 most recent. Tests-first (3/3 in `backup.test.ts`): path format, round-trip
  integrity, and prune behaviour.
- **Graceful SSE shutdown** — `drainSSE()` tracks all hijacked SSE `ServerResponse` objects in a
  module-level `Set`; the SIGTERM handler calls `drainSSE()` → `.end()` on every open connection
  before `app.close()` + WAL checkpoint. `stop_grace_period: 30s` in compose so Docker waits for
  the drain instead of SIGKILL-ing.
- **SW cache versioning** — shell cache name now includes a build-time ID (`__BUILD_ID__` via Vite
  `define`); SW registration passes `?v=${buildId}` so the browser byte-compares and activates a
  new worker after each redeploy. Navigation switched from cache-first to **network-first with
  cache fallback** — the wall always gets the latest `index.html` when the server is up, but still
  renders last-good when it's down. On activate, old shell caches are evicted.
- **Prod logging** — Fastify logger level set to `warn` when `NODE_ENV=production` (overridable
  via `LOG_LEVEL`). Docker compose adds `json-file` log driver with `max-size: 10m`, `max-file: 3`.
- **Kiosk launcher** — `kiosk/launch.sh`: polls `/api/health` until 200 (up to 5 min), then
  launches Chromium in kiosk mode with Wayland flags. Falls back to launching anyway after timeout
  (SW may have a cached shell).
- **Deploy guide** — `docs/deploy.md` covers: Docker build-on-target-arch, config env vars,
  backup endpoint usage, reverse-proxy SSE snippets (nginx + Caddy), Pi kiosk setup (labwc
  autostart + systemd alternative), screen blanking, and chaos-test checklist.

### Verify
```bash
npm --workspace backend test          # 19/19 (16 recurrence/broker + 3 backup)
npm --workspace frontend test         # 15/15 (rrule + color + time)
npm run build                         # tsc both workspaces + vite (clean)
rm -rf /tmp/d && DATA_DIR=/tmp/d STATIC_DIR=frontend/dist PORT=8794 node backend/dist/server.js &
curl -s localhost:8794/api/health     # {"ok":true,...}
curl -s -X POST localhost:8794/api/backup  # {"ok":true,"file":"backup-...","sizeBytes":...}
ls /tmp/d/backup-*                    # standalone .db, no -wal/-shm
kill %1                               # SIGTERM → drainSSE → WAL checkpoint → exit
```

### State at end
- All M0–M4 milestones complete. Backend 19/19 tests, frontend 15/15 tests, build clean.
- Tree clean (no uncommitted changes yet — ready for commit).
- M4 acceptance criteria from the spec: backup endpoint works, SW serves fresh assets after
  rebuild, kiosk launcher + deploy docs written, graceful shutdown drains SSE.

---

## 2026-06-01 — M3 hardening (pre-M4 persona review fixes)

Ran a 2-lens check-in (principal-engineer/deploy-readiness + UX) on the built M0–M3 product;
actioned all findings except the ones that are genuinely M4 scope (see "Deferred to M4").

### Fixed
- **Never-blank, two holes closed:** (1) `ErrorBoundary` at the top of `AppProviders` — a render
  throw now falls back to the live clock + "Reconnecting…" (auto-retries after 4s) instead of
  white-screening the wall. (2) **Bad stored RRULE no longer blanks the calendar** — `expandEvent`
  wraps parse/expand and returns `[]` on failure; `listOccurrences` also try/catches per master.
  Tests-first (recurrence test #16: malformed rule is skipped, not thrown).
- **Wall idle reset** (`useIdleReset`, 90s) — returns to Agenda + today and dismisses sheets, so the
  wall is never stuck on a paged-away view. (Was specced but missing.)
- **Loading ≠ empty** — `AgendaView` shows "Loading today…" on cold load instead of "Nothing scheduled".
- **Whole-series edit is now explicit** — `EventEditorSheet` titles "Edit series", shows a repeat banner,
  and a Save on a recurring event asks "apply to every occurrence?" before mutating (no silent rewrite).
- **Wall staleness covers events** (not just dinners) — `StatusDot` driven by the older/errored of both.
- **Category delete 409 → guided recovery** — new `POST /api/categories/:id/reassign {toId}` +
  `reassignEvents` repo; Manage offers "Move to Uncategorized & delete" in one tap, reworded as guidance.
- **Wall touch targets to spec** — ControlBar bar 72→88px, segments/Today/nav ≥64, quick-add 72;
  CategoryManager edit/delete 40→48.
- **Frontend tests exist now** — added vitest (`npm --workspace frontend test`); 15 tests covering
  `rrule` build/parse round-trip + bounded, `color` contrast/isHex6/fgForBg, and `inWindow`.

Verify: backend 16/16, frontend 15/15, build clean. Playwright re-verified Edit-series title+banner+
save-confirm, category-in-use → reassign offer, bigger wall controls. Screenshots `/tmp/m3shots/h*`.

### Deferred to M4 (written down, not lost)
`POST /api/backup` (VACUUM INTO) · SW shell cache versioning (cache-first `v1` can pin the wall to an
old build after redeploy — fix during M4, the first redeploy over a live wall) · graceful-shutdown SSE
socket drain + `stop_grace_period: 30s` · reverse-proxy SSE snippet (or "direct host:port" note) ·
Fastify log level + Docker log rotation · build-on-target-arch runbook note.

---

## 2026-05-31 (cont.) — M3: editing (phone + sheets + mutations + SSE)

### What was built
- **Backend realtime:** `realtime.ts` in-process pub/sub `broker` (tests-first, 5/5) + `GET /api/stream`
  SSE route (hijacked raw socket, `retry`/heartbeat, double-cleanup guard). Every event/dinner/category
  mutation route now `poke()`s. Also fixed the test script glob (`find src -name '*.test.ts'`) — the old
  `src/**/*.test.ts` matched nothing under npm's `sh`, so tests had been silently not running.
- **Frontend data layer:** `api/client.ts` gained POST/PUT/DELETE + a typed `ApiError` (carries
  `code`/`status`). `useMutations.ts` — event/dinner/category mutations (optimistic create + cache patch,
  invalidate-on-settle). `useRealtime.ts` — SSE → invalidate matching query family; reconnect refetches.
  `useEventMaster` hook. `usePhoneTheme` (OS scheme).
- **Sheets:** `Sheet` primitive (portal, focus, Esc/tap-out, scroll-lock, slide-up). `EventEditorSheet`
  (full fields, repeat→bounded RRULE via `util/rrule.ts` build/parse, delete scope This/All),
  `QuickAddSheet` (wall fast path, optimistic/quiet), `DayDetailSheet` (wall read), `DinnerEditorSheet`,
  `CategoryEditorSheet` (Okabe–Ito presets + hex + icon + AA-contrast warning via `contrastRatio`).
- **Phone:** `PhoneLayout` (Agenda/Week/Manage tabs) + `PhoneHeader` + `TabBar` + `Fab`; `CategoryManager`
  (edit/delete → 409 surfaced) + `DinnerWeekEditor`. `AgendaView`/`EventRow` gained a `phone` density.
  `ModeRouter` now renders `PhoneLayout` unless `?mode=wall`.
- **Wall wiring:** event tap → `DayDetailSheet`; quick-add → `QuickAddSheet`.

### Decisions / deviations
- Forms use plain controlled state + light client validation, **not** react-hook-form/zod (avoid deps;
  API Zod is authoritative; `ApiError.code` drives UX). Recorded in CLAUDE.md.
- M3 recurrence editing = whole-series edit + This/All delete only; following-split + modified overrides
  are v2 (no backend route).

### Verify
```bash
npm --workspace backend test          # 15/15 (10 recurrence + 5 broker)
npm run build                         # tsc both workspaces + vite
rm -rf /tmp/d && DATA_DIR=/tmp/d STATIC_DIR=frontend/dist PORT=8793 node backend/dist/server.js &
# phone: http://<ip>:8793/   ·   wall: http://<ip>:8793/?mode=wall
```
Playwright (cached chromium, `waitUntil:'load'`) verified: phone adds weekly event → appears on a fresh
wall (recurrence expanded 31 May + 7 Jun); delete "This event only" → cancels just that instance (server
left with only 7 Jun; UI converges to 1). Screenshots in `/tmp/m3shots`.

### Post-build code review (HIGH/MED fixed)
EventEditorSheet now shows an error state on master-load failure (was stuck on "Loading…"); phone agenda
chip shows icon+**label** (was icon-only, breaking the "colour-never-alone" rule); SSE cleanup guarded;
QuickAddSheet fully resets on close; dropped the unused `RecurrenceScope` `'following'`.

### Carried forward
- Bundle ~565KB (FullCalendar) — fine for LAN; code-split in M4 polish if wanted.
- No frontend test runner yet; `util/rrule.ts` + `color.ts` contrast were validated via the live flow,
  not unit tests. Consider vitest in M4 for those pure helpers.

---

## 2026-05-31 — Spec review → design sign-off → M0/M1/M2

### What happened (in order)
1. **Read the build spec** (`family-calendar-build-spec.md`).
2. **Three-persona review** (principal engineer, UX, DBA) of the spec, then **folded the findings in** —
   produced spec **v2** with the binding **§0 Post-Review Decisions (locked)**. Key additions: UTC date
   convention, app-side bounded recurrence + `event_exceptions` (EXDATE/override), category-delete RESTRICT,
   error envelope, service-worker never-blank, colour+icon+label chips, custom agenda default view.
3. **Locked frontend design** → `docs/frontend-design.md` (Calm & minimal · auto day/night · dinner
   top-hero band) and **component architecture** → `docs/frontend-components.md` (FullCalendar MIT for
   week/month, custom AgendaView; FAB/toolbars/view-switcher per surface).
4. **HTML sign-off mockup** → `docs/mockups/family-calendar.html` (3 views, day/night toggle). User signed
   off; tweaks applied: removed the always-on "live" status badge (AI-slop); showed all 3 views statically.
5. **M0 — scaffold + container** (`f419063`): Fastify (CJS) serving API + built frontend single origin;
   SQLite WAL + `user_version` migration runner + seeded Okabe–Ito categories; multi-stage Dockerfile
   (target-arch native build) + compose with host-volume **data dir**; Vite/React placeholder. Verified
   LAN serving + **DB persists across image rebuild** (PERSIST-MARKER test). `f01b0c6` = gitignore cleanup.
6. **M1 — data + API** (`24d7651`): categories/events/dinners CRUD on Fastify + zod validation + error
   envelope. Bounded app-side `rrule` expansion with EXDATE cancel + modified-override. Endpoints incl.
   `GET /events/:id`, `DELETE /events/:id/occurrences/:date`, dinners get/set/clear. **Tests-first:**
   10/10 recurrence truth-table. All §7 endpoints curl-verified incl. 400/404/409 paths.
7. **M2 — wall UI** (`5b3d5ed`): tokens + Tailwind (day/night), TanStack Query data layer, custom
   AgendaView + FullCalendar week/month (restyled, toolbar off), shared colour+icon+label chip, HeroBand
   (dinner rolls to tomorrow after 8pm), StatusDot (stale-only), ControlBar (view switch + DateNav +
   legend + FAB), service-worker never-blank, Geist self-hosted. **Verified via 1280×800 screenshots** of
   all 3 views (caught the auto night theme live at 20:28 Brisbane).

### State at end of session
- Commits: `f419063` (M0) → `f01b0c6` (gitignore) → `24d7651` (M1) → `5b3d5ed` (M2). Tree clean.
- Backend: full §7 API working, recurrence engine tested. Frontend: read-only wall complete.
- No test servers left running; `data/` is gitignored (root-owned from container runs — harmless).

### Verify the current build
```bash
npm install
npm --workspace backend test            # 10/10 recurrence tests
npm run build
rm -rf /tmp/d && DATA_DIR=/tmp/d STATIC_DIR=frontend/dist PORT=8791 node backend/dist/server.js &
curl -s localhost:8791/api/health       # {"ok":true,...}
# open http://<lan-ip>:8791/?mode=wall   (wall) ; switch Agenda/Week/Month
```

### Next session — M3 (editing)
Build the phone side + write paths (see `docs/frontend-components.md` §3–4):
- `PhoneLayout` + `TabBar` (Agenda/Week/Manage) + floating `Fab`.
- Sheets: `EventEditorSheet` (full fields + **recurrence scope** This/This-and-following/All),
  `QuickAddSheet` (wall fast path), `DayDetailSheet`, `DinnerEditorSheet`, `CategoryEditorSheet`.
- `CategoryManager` (colour+icon, AA-contrast warning, delete→409 reassign), `DinnerWeekEditor`.
- **Mutations** (POST/PUT/DELETE) with optimistic update + invalidate; wire wall quick-add + tap→sheet.
- Add `GET /api/stream` (SSE) on the backend → client refetch on poke (M2 currently polls 30s).
- Acceptance: phone adds a weekly event → appears on wall within refresh; cancel one occurrence removes
  only that instance.

### Watch-outs carried forward
- Tool channel drops output intermittently — verify, don't trust silence.
- Recurrence is the riskiest code; keep it tests-first.
- Bundle is ~530KB (FullCalendar) — fine for LAN; code-split later if wanted (M4 polish).
- `npm audit` shows dev/build-dep vulns only (no runtime path); revisit before v1 ship.
