# Session Log — homecal

Running log of work per session. Newest first. Pair with `git log` for exact diffs.

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
