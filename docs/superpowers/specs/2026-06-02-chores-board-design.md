# Chores Board with Star Rewards — Design Spec

A chore tracker for the wall-mounted family calendar. Kids tap the touchscreen to mark
chores done and earn stars. Parents manage chores and family members via phone. Designed
for ages 4–6: big icons, minimal text, satisfying feedback.

---

## 1. Data Model

Three new tables, appended as the next migration in `backend/src/db/migrate.ts`.

### `family_members`

| Column       | Type    | Constraints                              |
|-------------|---------|------------------------------------------|
| `id`        | TEXT PK | UUIDv7, server-generated                 |
| `name`      | TEXT    | NOT NULL, UNIQUE                         |
| `icon`      | TEXT    | NOT NULL (emoji — kid picks their avatar)|
| `created_at`| TEXT    | ISO-8601 UTC, server default             |
| `updated_at`| TEXT    | ISO-8601 UTC, server-set on write        |

Seeded empty. Parents add members via phone. The `icon` is an emoji (🚀, 🦄, ⭐) that
serves as the kid's visual identifier on the wall — critical for pre-readers.

### `chores`

| Column        | Type    | Constraints                                          |
|--------------|---------|------------------------------------------------------|
| `id`         | TEXT PK | UUIDv7, server-generated                             |
| `title`      | TEXT    | NOT NULL, length > 0                                 |
| `icon`       | TEXT    | NOT NULL (emoji — 🪥, 🧹, 🛏️)                       |
| `stars`      | INTEGER | NOT NULL, DEFAULT 1, CHECK (stars >= 1 AND stars <= 5)|
| `frequency`  | TEXT    | NOT NULL, CHECK (frequency IN ('daily', 'weekly'))   |
| `day_of_week`| INTEGER | NULL for daily; 0–6 (Sun–Sat) for weekly             |
| `assigned_to`| TEXT    | NOT NULL, FK → family_members(id) ON DELETE CASCADE  |
| `position`   | INTEGER | NOT NULL, DEFAULT 0 (sort order)                     |
| `created_at` | TEXT    | ISO-8601 UTC                                         |
| `updated_at` | TEXT    | ISO-8601 UTC, server-set                             |

`day_of_week` uses SQLite convention: 0 = Sunday, 6 = Saturday (matches
`strftime('%w')`). Required when `frequency = 'weekly'`, NULL when `frequency = 'daily'`.

**Composite CHECK enforces the frequency/day_of_week invariant at the DB level:**
```sql
CHECK (
  (frequency = 'weekly' AND day_of_week BETWEEN 0 AND 6) OR
  (frequency = 'daily'  AND day_of_week IS NULL)
)
```

Also: `CHECK (length(title) > 0)` (matches the events table pattern).

`ON DELETE CASCADE` from family_members: removing a kid removes their chores and
completions.

### `chore_completions`

| Column          | Type | Constraints                                    |
|----------------|------|------------------------------------------------|
| `chore_id`     | TEXT | NOT NULL, FK → chores(id) ON DELETE CASCADE    |
| `completed_date`| TEXT | NOT NULL, CHECK (GLOB pattern, YYYY-MM-DD)     |
| `completed_at` | TEXT | NOT NULL, ISO-8601 UTC (tap timestamp)         |
| PK             |      | (`chore_id`, `completed_date`)                 |

`completed_date` CHECK uses the same GLOB pattern as `dinners.date`:
`CHECK (completed_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')`.

Composite PK makes completion idempotent — a chore can only be completed once per day.
The PK index covers the board query's `LEFT JOIN ... ON chore_id = ? AND
completed_date = ?` lookup efficiently. `ON DELETE CASCADE` from chores: deleting a chore
removes its history.

### Indexes

```sql
CREATE INDEX idx_chores_assigned_to ON chores(assigned_to);
CREATE INDEX idx_chore_completions_date ON chore_completions(completed_date);
```

`idx_chores_assigned_to` supports the board's group-by-member query. 
`idx_chore_completions_date` supports the star summary's date-range scans.

### DDL defaults

All `created_at`/`updated_at` columns use:
`DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))` — matching existing tables.

### Auto-reset

No cron job or reset logic needed. The board is computed per-date:

- **Daily chores:** due every day. Check if a completion row exists for today.
- **Weekly chores:** due on their `day_of_week`. Check if a completion row exists for the
  current week's occurrence of that day.

A new day simply has no completion rows yet. Yesterday's completions stay in the database
as history (for star totals).

### Stars

Stars are a derived value, never stored as a running total:

```sql
SELECT SUM(c.stars)
FROM chore_completions cc
JOIN chores c ON cc.chore_id = c.id
WHERE c.assigned_to = :memberId;
```

All-time total. No expiry, no decay. Parents decide off-screen what stars are worth.

---

## 2. API Routes

All routes follow the existing patterns: Zod validation at the boundary, error envelope
`{ error: { code, message } }`, `broker.poke('chores')` after mutations. SSE kind is
`'chores'`.

### Family Members

| Method | Path                       | Purpose                     |
|--------|----------------------------|-----------------------------|
| GET    | `/api/family-members`      | List all members            |
| POST   | `/api/family-members`      | Create member               |
| PUT    | `/api/family-members/:id`  | Update name/icon            |
| DELETE | `/api/family-members/:id`  | Delete (cascades chores)    |

**POST/PUT body:** `{ name: string, icon: string }`

**DELETE:** Returns 204. Cascade deletes all chores and completions for this member.

### Chores

| Method | Path                | Purpose                              |
|--------|---------------------|--------------------------------------|
| GET    | `/api/chores`       | List all chore definitions           |
| POST   | `/api/chores`       | Create chore                         |
| PUT    | `/api/chores/:id`   | Update chore                         |
| DELETE | `/api/chores/:id`   | Delete chore (cascades completions)  |

**POST/PUT body:**
```typescript
{
  title: string;
  icon: string;
  stars: number;         // 1–5
  frequency: 'daily' | 'weekly';
  dayOfWeek?: number;    // 0–6 (Sun–Sat), required when frequency = 'weekly'
  assignedTo: string;    // family_member id
  position?: number;     // sort order
}
```

**GET response** returns the chore definition with `assignedTo` as a member ID (the phone
joins client-side via `useFamilyMembers()`):
```typescript
{
  id: string;
  title: string;
  icon: string;
  stars: number;
  frequency: 'daily' | 'weekly';
  dayOfWeek: number | null;
  assignedTo: string;
  position: number;
  updatedAt: string;
}
```

**Validation:**
- `dayOfWeek` required and 0–6 when `frequency = 'weekly'`; must be null/absent for daily
- `assignedTo` must reference an existing family member (FK check → 400 on bad ref)
- `stars` 1–5
- `icon` non-empty string

### Chore Board (read-only, computed)

| Method | Path                    | Purpose                                    |
|--------|-------------------------|--------------------------------------------|
| GET    | `/api/chore-board`      | Today's board: chores + completion status   |

**Note:** separate top-level path avoids route collision with `GET /api/chores/:id`
(Fastify would match `/board` as `:id`).

**Query params:** `date` (optional, YYYY-MM-DD, defaults to server "today" in Brisbane).

**Response:** grouped by family member, with completion status and star totals.

```typescript
{
  date: string;  // YYYY-MM-DD
  members: Array<{
    id: string;
    name: string;
    icon: string;
    totalStars: number;
    chores: Array<{
      id: string;
      title: string;
      icon: string;
      stars: number;
      completed: boolean;
      completedAt: string | null;
    }>;
  }>;
}
```

The board includes only chores that are **due on the requested date**: all daily chores,
plus weekly chores whose `day_of_week` matches that date's day. The board query filters
with `WHERE frequency = 'daily' OR (frequency = 'weekly' AND day_of_week =
CAST(strftime('%w', :date) AS INTEGER))` — no conversion needed since `day_of_week` uses
the same 0=Sunday encoding as SQLite's `strftime('%w')`.

This is the primary endpoint the wall UI calls. It avoids N+1 queries by doing a single
joined fetch.

### Completions

| Method | Path                                   | Purpose              |
|--------|----------------------------------------|----------------------|
| POST   | `/api/chores/:id/complete`             | Mark chore done today|
| DELETE | `/api/chores/:id/complete/:date`       | Undo completion      |

**POST body:** `{ date: string }` — YYYY-MM-DD. The wall must always send the displayed
board date explicitly to avoid midnight-boundary races.

Inserts via `INSERT ... ON CONFLICT DO NOTHING`, then `SELECT` to return the row
(whether just-inserted or already-existing).

**POST response:** 201 on first completion, 200 if already exists. Both return:
```typescript
{ choreId: string; completedDate: string; completedAt: string }
```

**DELETE:** Removes the completion row. Returns 204. Phone-only (parent undo/correction);
the wall does not expose undo (see §3).

Both poke SSE with kind `'chores'`.

---

## 3. Wall UI — Chores Board Component

### Placement

The chores board is a new view accessible from the wall's ControlBar view switcher,
alongside Agenda/Week/Month. It's a **full-panel view** (replaces the calendar area), not
a sidebar or overlay. This keeps it big and tappable for small fingers.

The HeroBand (clock + dinner + weather) stays visible above the board.

### Layout

```
┌─────────────────────────────────────────────────┐
│  HeroBand (clock · dinner · weather)            │
├──────────────────────┬──────────────────────────┤
│         🚀           │          🦄              │
│      Charlie         │        Maisie            │
│     ⭐ 47 stars      │      ⭐ 52 stars         │
│                      │                          │
│  ┌────────────────┐  │  ┌────────────────┐      │
│  │ 🪥 Brush teeth │  │  │ 🪥 Brush teeth │      │
│  │            ⭐  │  │  │         ✅ ⭐  │      │
│  └────────────────┘  │  └────────────────┘      │
│  ┌────────────────┐  │  ┌────────────────┐      │
│  │ 🛏️ Make bed    │  │  │ 🛏️ Make bed    │      │
│  │          ⭐⭐  │  │  │          ⭐⭐  │      │
│  └────────────────┘  │  └────────────────┘      │
│  ┌────────────────┐  │  ┌────────────────┐      │
│  │ 🧹 Tidy toys   │  │  │ 🎒 Pack bag    │      │
│  │            ⭐  │  │  │            ⭐  │      │
│  └────────────────┘  │  └────────────────┘      │
│                      │                          │
├──────────────────────┴──────────────────────────┤
│  ControlBar (Agenda · Week · Month · ⭐ Chores) │
└─────────────────────────────────────────────────┘
```

**Per-member column:** each family member gets a vertical lane. Two members = two columns
(50/50 split). Minimum column width 280px; at 4+ members the board scrolls horizontally
rather than compressing. One member = centred single column (max-width 500px).

**Member header:** the emoji avatar is the **dominant element** — 72px, centred at the top
of the column. Name below in 18px muted text (parents can read it; pre-readers recognise
the emoji). Star count beneath: ⭐ icon + total in 22px bold.

**Chore cards:** large touch targets, **minimum 120px tall** (sized for 4yo fingers, not
adults). 8px gap between cards — fits 4 chores before scrolling at 2 members, which is
plenty. Each card shows:
- Chore icon (emoji, 48px) on the left
- Title (22px) in the centre
- Star value (⭐ × N, 20px) on the right
- **Incomplete state:** white/light background, subtle border
- **Completed state:** green-tinted background, large ✅ overlay, muted text, gold star
  icons

**Tap interaction (incomplete cards only):**
1. Kid taps an incomplete chore card
2. **Immediate optimistic update** — card flips to completed state
3. **Star-fly animation:** star particles launch from the card and arc toward the star
   counter in the header (~800ms, CSS keyframes + transforms). Card does a brief
   scale-up "pop" (1.05×, 150ms) before settling into completed state
4. **Sound cue:** short chime via Web Audio API (a single-note synth, ~200ms — no audio
   file dependency). Muted between 8pm–7am (night hours)
5. Star counter increments with a scale-bounce (1.2×, 300ms ease-out)
6. POST fires to `/api/chores/:id/complete`
7. If the POST fails, card reverts (optimistic rollback)

**Completed cards are non-interactive on the wall.** Tapping a completed card does nothing.
This prevents accidental undo by excited 4-year-olds re-tapping. Undo is a parent action
via the phone's chore management screen.

**Two distinct empty states:**
- **No chores assigned** (member has zero chores defined for this day): "No chores today"
  with a relaxed emoji (😊). Informational, not celebratory.
- **All chores completed:** 🎉 celebration state — CSS-only confetti animation (no
  external library — absolute-positioned coloured squares with randomised keyframe
  delays, similar to the star-fly pattern), large "All done!" text, trophy emoji. This
  is the primary motivating moment of the feature.

### ControlBar integration

The chores view button uses a ⭐ emoji icon alongside the "Chores" text label, so
pre-readers can locate it without help. Same sizing as the existing view buttons.

### Midnight rollover

The board date is driven by a `useBrisbaneDate()` hook that returns today's YYYY-MM-DD in
UTC+10 and re-evaluates at midnight (via `setTimeout` to the next midnight boundary). When
the date changes, `useChoreBoard(date)` automatically refetches with the new date — the
board transitions to a fresh day with no completions. This avoids stale-day bugs where a
child taps at 12:01am against yesterday's board.

### Zero members state

When no family members exist (`members: []`), the board shows a centred message: "Set up
family members on your phone" with a 📱 emoji. This is a setup-time prompt, not an error.

### Idle reset

The existing 90s `useIdleReset` returns the view to Agenda. The chores board resets to
its current state (no navigation to reset), so idle reset just switches back to Agenda
view — same as leaving week/month view.

### Screensaver

The 5-min screensaver already overlays everything — no chores-specific handling needed.

---

## 4. Phone UI — Chores Management

Two new screens accessible from the phone layout's management area (alongside existing
category management, photo management). Star summary is deferred (§10).

### Family Members Manager

Pattern: follows `CategoryManager.tsx` — a list with add/edit/delete.

- List of members with icon + name
- "Add member" button → inline form (name + emoji picker)
- Edit: tap to change name/icon
- Delete: confirmation dialog ("This will delete all their chores and stars. Are you
  sure?")

### Chores Manager

- Grouped by family member (expandable sections)
- Each chore shows: icon + title + stars + frequency badge (Daily / Weekly + day name)
- "Add chore" button → form:
  - Title (text input)
  - Icon (emoji picker or text input)
  - Stars (1–5, tap to set)
  - Frequency (Daily / Weekly toggle)
  - Day of week (picker, shown only when Weekly selected)
  - Assigned to (member picker)
- Edit: same form, pre-filled
- Delete: confirmation dialog
- Up/down buttons for position reordering (drag-to-reorder deferred — §10)

**Day-of-week picker note:** Australian locale displays weeks starting Monday, but the
stored value uses 0=Sunday (SQLite convention). The picker must convert between display
order (Mon-first) and storage value (0=Sunday).

---

## 5. Frontend Types

```typescript
interface FamilyMember {
  id: string;
  name: string;
  icon: string;
  updatedAt: string;
}

interface Chore {
  id: string;
  title: string;
  icon: string;
  stars: number;
  frequency: 'daily' | 'weekly';
  dayOfWeek: number | null;
  assignedTo: string;
  position: number;
  updatedAt: string;
}

interface BoardMember {
  id: string;
  name: string;
  icon: string;
  totalStars: number;
  chores: BoardChore[];
}

interface BoardChore {
  id: string;
  title: string;
  icon: string;
  stars: number;
  completed: boolean;
  completedAt: string | null;
}

interface ChoreBoard {
  date: string;
  members: BoardMember[];
}
```

---

## 6. TanStack Query Hooks

```typescript
// Board data for the wall (primary query)
useChoreBoard(date: string)
  queryKey: ['chore-board', date]
  staleTime: 0 (SSE-driven)
  placeholderData: keepPreviousData (prevent flash-of-empty on date change)

// Chore definitions for phone management
useChores()
  queryKey: ['chores']
  staleTime: 5 * 60_000 (static-ish, like categories)

// Family members
useFamilyMembers()
  queryKey: ['family-members']
  staleTime: 5 * 60_000

// Mutations
useChoreMutations()        → create/update/delete chores
useFamilyMemberMutations() → create/update/delete members
useChoreCompletion()       → complete/uncomplete (optimistic)
```

All mutations call `broker.poke('chores')`. The `useRealtime` hook already handles
arbitrary SSE kinds — adding `'chores'` invalidation requires one line in the existing
`useRealtime.ts`.

The `useChoreCompletion` hook uses optimistic updates on the board query (same pattern as
the existing optimistic event mutations):
1. Snapshot current board data
2. Optimistically set the chore's `completed` state to true and increment `totalStars`
3. POST to `/api/chores/:id/complete`
4. On error, rollback to snapshot
5. On settle, invalidate `['chore-board']` (prefix match — covers all dates)

Undo (DELETE) is phone-only — no optimistic update needed; the SSE poke refreshes the
board after a parent uncompletes a chore.

---

## 7. SSE Integration

Minimal wiring — the infrastructure exists but needs a small extension:

1. **Backend:** mutation routes call `broker.poke('chores')` (and
   `broker.poke('family-members')` for member mutations)
2. **Frontend:** the current `useRealtime` maps kind 1:1 to a query key prefix. Chores
   needs 1:N mapping (one poke invalidates multiple query families). Extend
   `useRealtime.ts` with a lookup table:
   ```typescript
   const KIND_TO_KEYS: Record<string, string[]> = {
     chores: ['chores', 'chore-board'],
     'family-members': ['family-members', 'chore-board'],
   };
   ```
   On poke, look up the kind — if it's in the table, invalidate each key; otherwise
   fall through to the existing 1:1 `invalidateQueries({ queryKey: [kind] })` behaviour.
   Existing kinds (events, dinners, categories, photos) are unaffected.

When kid A taps a chore on the wall, the SSE poke invalidates the board query. If kid B
(or a phone) is also viewing the board, they see the update within a round-trip.

---

## 8. Backend File Structure

Following existing patterns:

```
backend/src/
  repos/chores.ts          — DB queries (getBoard, createChore, complete, etc.)
  repos/chores.test.ts     — Board computation + repo-level tests (riskiest code)
  repos/familyMembers.ts   — DB queries for family members
  routes/chores.ts         — Fastify route handlers (board, CRUD, complete/uncomplete)
  routes/chores.test.ts    — Route-level integration tests
  routes/familyMembers.ts  — Fastify route handlers (CRUD)
  routes/familyMembers.test.ts — Route-level integration tests
  schemas.ts               — Append Zod schemas for chores + family members
  db/migrate.ts            — Append migration (next user_version)
```

### Frontend File Structure

```
frontend/src/
  core/model/types.ts              — Append new interfaces
  core/api/client.ts               — Append API methods
  core/hooks/useData.ts            — Append query hooks
  core/hooks/useMutations.ts       — Append mutation hooks
  core/hooks/useRealtime.ts        — Extend with KIND_TO_KEYS lookup table
  core/hooks/useBrisbaneDate.ts    — Clock-driven YYYY-MM-DD, re-evaluates at midnight
  components/chores/
    ChoresBoard.tsx                — Wall board (columns, cards, animations)
    ChoreCard.tsx                  — Single chore card (tap target, animation)
    MemberColumn.tsx               — Per-member column with header + cards
    StarBurst.tsx                  — Star-fly + confetti animations (CSS-only, no deps)
  components/manage/
    FamilyMemberManager.tsx        — Phone: manage members
    ChoreManager.tsx               — Phone: manage chore definitions
  layouts/WallLayout.tsx           — Add 'chores' view option
  components/controls/ControlBar.tsx — Add chores view button
```

---

## 9. Testing Strategy

Tests-first for the board computation logic (the riskiest code — similar to recurrence
expansion).

### Backend Tests (target: ~30-40 tests)

**Board computation (highest priority):**
- Daily chore appears every day
- Weekly chore appears only on its day_of_week
- Completed chore shows as completed
- Uncompleted chore shows as not completed
- Completion is idempotent (second POST returns 200, not error)
- Star total sums correctly across multiple chores and days
- Board respects the date parameter (not just "today")
- Multiple members get their own chores (no cross-contamination)

**CRUD:**
- Family member create/update/delete
- Chore create with daily/weekly frequency
- Validation: weekly chore requires day_of_week
- Validation: stars 1–5
- Validation: assignedTo references existing member
- Delete member cascades chores and completions
- Delete chore cascades completions

**Edge cases:**
- Board for a day with no chores → empty member arrays
- Board for a member with all chores done → all completed
- Complete/uncomplete round-trip preserves star count
- Weekly chore on Monday doesn't appear on Tuesday

### Frontend Tests (target: ~10-15 tests)

- ChoresBoard renders member columns
- ChoreCard tap triggers completion mutation
- Completed card shows checkmark state (non-interactive — no tap handler)
- Star count updates optimistically on completion
- "No chores today" state renders when no chores assigned
- "All done!" celebration state renders when all chores completed
- ControlBar shows ⭐ Chores button

---

## 10. Scope Boundaries

**In scope (v1):**
- Family member CRUD
- Chore definitions with daily/weekly frequency
- Wall chores board view (tap to complete, star count)
- Phone management (members + chores)
- SSE realtime sync
- Optimistic completion with animation

**Deferred:**
- Star summary / history view on phone (nice-to-have, not core)
- Drag-to-reorder chores (use position field + up/down buttons instead)
- Chore templates / presets
- Star goals / rewards tracking
- Streak tracking / badges
- Per-chore approval workflow
- Chore rotation (auto-assign different kid each week)

---

## 11. Migration Safety

The migration adds three new tables with no changes to existing tables. Zero risk to
existing data. Rollback = drop the three tables (though the forward-only migration
pattern means we don't build rollback scripts).

`PRAGMA foreign_keys=ON` is already enforced on every connection, so the new FKs work
immediately.
