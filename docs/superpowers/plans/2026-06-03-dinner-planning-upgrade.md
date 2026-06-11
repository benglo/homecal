# Dinner Planning Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Revision history

Plan rev 2 (post 3-persona review — senior engineer / UX / DBA). Changes keyed to reviewer findings:

- **R1 (senior + DBA)** — Task 2 test pattern rewritten: drop the `globalThis.__testDb` hack (`getDb()` opens its own connection from `config.dbPath` — the hack would silently run against the real dev DB). Use `setupIsolatedDb('dinners-repo')` + dynamic `await import('./dinners')` + direct `getDb()` for exact-`updated_at` seeding.
- **R2 (senior)** — Task 3 error-code assertion: `parseBody` throws `httpError(400, 'VALIDATION', …)` (see `routes/helpers.ts:11`). Test now asserts `'VALIDATION'`.
- **R3 (UX)** — Task 7 chevron buttons resized 36→64 to meet the wall's ≥64px finger-tap spec; strip pill `minHeight` 64→72.
- **R4 (UX)** — Task 11 WallLayout: pause idle dismiss while the dinner editor is open (smarter `useIdleReset` callback — no hook signature change). Other sheets keep their current 90s behaviour; planning needs longer engagement than quick edits.
- **R5 (senior)** — Tasks 9 / 11 / 12 merged into one atomic Task 9 commit so the build stays green at every commit. Bisect-safe.
- **R6 (UX)** — Editor adds a small inline "Saved" pulse next to the date title (3s) so the user gets positive feedback when Save runs.
- **R7 (UX)** — Footer button wording is dynamic: "Cancel" while edits are unsaved, "Done" once `meal === currentMeal`.
- **R8 (DBA)** — Window-function `ORDER BY updated_at DESC, meal` for a deterministic canonical-casing tiebreaker.
- **R9 (DBA)** — `dinnerUpsert` schema gains `.trim()` so `"Tacos "`, `"Tacos"` collapse on write (prevents long-tail history rot).
- **R10 (senior)** — Editor uses the existing `weekDates(anchor)` util for week alignment, so its `useDinners(start,end)` query key collides with the parent layouts' identical query and TanStack dedupes the network call.
- **R11 (senior)** — `key={selectedDate}` on the sheet content replaces the useEffect re-seed dance: cleaner React, identical effect.
- **R12 (UX + senior)** — Local invalidation of `['dinner-suggestions']` in `useDinnerMutations.settle()` for instant feedback; SSE is now the backstop, not the primary path.
- **R13 (UX)** — `DinnerSuggestionsList`: drop `maxHeight: 260` so the list flows inside the Sheet body's existing scroll (handles virtual keyboard via `var(--kb-height)`). Heading text becomes "Recent meals" (empty input) or "Matches" (filtering).
- **R14 (UX)** — HeroBand corner glyphs sized 12→18; meal `<div>` gains `paddingRight: 24` so long meals don't collide; `aria-label` uses formatted day name not ISO string.
- **R15 (senior)** — Task 13 verify script adds `npm run build` before `node backend/dist/server.js`.
- **R16 (senior)** — Use existing CSS token `--accent-ink` (verified — `--accent-ink-on` doesn't exist).
- **R17 (UX nit)** — Note added: unicode case-folding caveat (`LOWER('CAFÉ')` returns `'cafÉ'` in SQLite's default ASCII collation; acceptable for an Australian family naming dinners, documented in a code comment).
- **R18 (cross-ref)** — Self-review note typo fixed (Task 9 → Tasks 11/12, not 11/13).

Task count: 14 → 12 (Tasks 9+11+12 collapsed into one).

---

**Goal:** Make weekly dinner planning fast on the wall — pick any day from inside the editor (with next-week paging), tap a day card on the hero strip to open the editor pre-filled, and surface previously-used meals as a fuzzy typeahead derived from the growing dinner history.

**Architecture:**
- **Suggestions** are derived from the existing `dinners` table (no migration). A new `GET /api/dinners/suggestions` returns rows deduped case-insensitively, ordered by frequency then recency then meal-name (deterministic tiebreaker). Frontend caches them under a new `['dinner-suggestions']` query key, invalidated locally on mutation **and** by the existing `dinners` SSE poke.
- **DinnerEditorSheet** becomes self-contained: it owns the selected date + the visible week-anchor and fetches its own `useDinners(start, end)` via the shared `weekDates()` util (query keys collide with parent → TanStack dedupes). Save → cache patches → input keeps the saved meal, a small "Saved" pill flashes (3s), modal stays open on the same day.
- **HeroBand** day cells become buttons. Wall layout passes a callback that opens the editor with that date pre-filled; while the editor is open the wall's idle dismiss is suppressed (planning needs more than 90s). The "tap to add" CTA in the Tonight panel is removed; cards get a corner `+` (empty) or pencil (filled) glyph as the tappability affordance.

**Tech Stack:** Fastify + better-sqlite3 (SQLite window functions), Zod, React + TanStack Query, Luxon, Tailwind, Vitest (frontend), node:test (backend).

---

## File Structure

**Backend (modify):**
- `backend/src/repos/dinners.ts` — add `listSuggestions(limit)` using `ROW_NUMBER() OVER (PARTITION BY LOWER(meal) ORDER BY updated_at DESC, meal)` to dedup deterministically + return canonical (most-recent) casing.
- `backend/src/routes/dinners.ts` — add `GET /api/dinners/suggestions?limit=` route, Zod-validated.
- `backend/src/schemas.ts` — add `suggestionsQuery`; tighten `dinnerUpsert` with `.trim()`.
- `backend/src/model/types.ts` — add `DinnerSuggestion` shape.

**Backend (create):**
- `backend/src/repos/dinners.test.ts` — truth-table for the SQL: empty, single, frequency tie-break by recency, case-insensitive dedup canonical casing (with `updated_at` tie tiebroken by meal-name), limit honoured.
- `backend/src/routes/dinners.test.ts` — integration: validation 400 (code `VALIDATION`), default+explicit limit, returns sorted array; trim-on-write asserted.

**Frontend (modify):**
- `frontend/src/core/model/types.ts` — add `DinnerSuggestion`.
- `frontend/src/core/api/client.ts` — `dinnerSuggestions(limit?)`.
- `frontend/src/core/hooks/useData.ts` — `useDinnerSuggestions()`.
- `frontend/src/core/hooks/useRealtime.ts` — fan `'dinners'` poke out to `['dinners','dinner-suggestions']`.
- `frontend/src/core/hooks/useMutations.ts` — `useDinnerMutations.settle()` also invalidates `['dinner-suggestions']` for instant local feedback.
- `frontend/src/components/sheets/DinnerEditorSheet.tsx` — rewritten: owns `date` + `weekAnchor`, week paging (via `weekDates` util), suggestions list, stay-open-after-save with "Saved" pulse, dynamic Cancel/Done; public prop becomes `initialDate` only.
- `frontend/src/components/hero/HeroBand.tsx` — day cells become `<button>` with corner glyph (18px, padded); remove "— tap to add" CTA; accept `onTapDay`.
- `frontend/src/layouts/WallLayout.tsx` — pass `onTapDay` to HeroBand; switch `DinnerEditorSheet` to `initialDate`; idle dismiss skips when editor open.
- `frontend/src/layouts/PhoneLayout.tsx` — switch `DinnerEditorSheet` callsite to `initialDate`; simplify `dinnerTarget` state to `useState<string | null>`.

**Frontend (create):**
- `frontend/src/components/sheets/dinnerSuggestions.ts` — pure `filterSuggestions(list, q, limit)`: case-insensitive contains, stable order.
- `frontend/src/components/sheets/dinnerSuggestions.test.ts` — vitest unit tests for the filter.
- `frontend/src/components/sheets/DinnerDateStrip.tsx` — 7-day pill row (≥72px) with 64px prev/next week chevrons.
- `frontend/src/components/sheets/DinnerSuggestionsList.tsx` — typeahead dropdown UI (flex inside Sheet scroll, no fixed max-height).

---

## Task 1: Backend — `DinnerSuggestion` model type

**Files:**
- Modify: `backend/src/model/types.ts`

- [ ] **Step 1: Add the type**

Append to `backend/src/model/types.ts`:

```ts
export interface DinnerSuggestion {
  meal: string;       // canonical casing = most recent usage (deterministic — see repo)
  count: number;      // total times used (case-insensitive)
  lastUsed: string;   // ISO UTC of the most recent updated_at
}
```

- [ ] **Step 2: Verify backend still builds**

Run: `npm --workspace backend run build 2>&1 | tail -20`
Expected: no errors. Type is unused so far — that's fine.

- [ ] **Step 3: Commit**

```bash
git add backend/src/model/types.ts
git commit -m "feat(dinners): add DinnerSuggestion type"
```

---

## Task 2: Backend — `listSuggestions` repo function (TDD)

**Files:**
- Create: `backend/src/repos/dinners.test.ts`
- Modify: `backend/src/repos/dinners.ts`

This test follows the `routes/familyMembers.test.ts` pattern, NOT the inline-SQL pattern in `chores.test.ts` — we want to exercise the real `listSuggestions` function against an isolated DB owned by the test process.

- [ ] **Step 1: Write the failing repo test**

Create `backend/src/repos/dinners.test.ts`:

```ts
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type Database from 'better-sqlite3';
import { setupIsolatedDb } from '../test/util/bootstrap';

// MUST run before any module that reads process.env.DATA_DIR at load time.
// See backend/src/test/util/bootstrap.ts for the rationale; the dynamic
// import below pulls in db/config AFTER DATA_DIR is set.
setupIsolatedDb('dinners-repo');

let listSuggestions: typeof import('./dinners').listSuggestions;
let db: Database.Database;

before(async () => {
  const repo = await import('./dinners');
  listSuggestions = repo.listSuggestions;
  const dbMod = await import('../db');
  db = dbMod.getDb();
});

beforeEach(() => {
  db.exec('DELETE FROM dinners');
});

function seed(date: string, meal: string, updatedAt: string) {
  db.prepare('INSERT INTO dinners (date, meal, updated_at) VALUES (?, ?, ?)').run(
    date,
    meal,
    updatedAt,
  );
}

test('listSuggestions returns [] when no dinners exist', () => {
  assert.deepEqual(listSuggestions(20), []);
});

test('listSuggestions orders by frequency desc, then last_used desc', () => {
  seed('2026-05-01', 'Tacos',  '2026-05-01T09:00:00Z');
  seed('2026-05-02', 'Tacos',  '2026-05-02T09:00:00Z'); // count=2
  seed('2026-05-03', 'Pasta',  '2026-05-03T09:00:00Z'); // count=1, newest
  seed('2026-05-04', 'Soup',   '2026-04-30T09:00:00Z'); // count=1, oldest
  assert.deepEqual(
    listSuggestions(20).map((s) => s.meal),
    ['Tacos', 'Pasta', 'Soup'],
  );
});

test('listSuggestions dedupes case-insensitively; canonical = most-recent casing', () => {
  seed('2026-05-01', 'spaghetti bolognese', '2026-05-01T09:00:00Z');
  seed('2026-05-02', 'Spaghetti Bolognese', '2026-05-08T09:00:00Z'); // newest
  seed('2026-05-03', 'SPAGHETTI BOLOGNESE', '2026-05-05T09:00:00Z');
  const got = listSuggestions(20);
  assert.equal(got.length, 1);
  assert.equal(got[0].meal, 'Spaghetti Bolognese');
  assert.equal(got[0].count, 3);
  assert.equal(got[0].lastUsed, '2026-05-08T09:00:00Z');
});

test('listSuggestions canonical casing is deterministic when updated_at ties', () => {
  // Same updated_at — ties broken by meal ASC so canonical is stable.
  seed('2026-05-01', 'tacos', '2026-05-01T09:00:00Z');
  seed('2026-05-02', 'Tacos', '2026-05-01T09:00:00Z');
  seed('2026-05-03', 'TACOS', '2026-05-01T09:00:00Z');
  const got = listSuggestions(20);
  assert.equal(got.length, 1);
  // ASCII sort: 'T' < 't', and 'TACOS' < 'Tacos' < 'tacos', so 'TACOS' wins.
  assert.equal(got[0].meal, 'TACOS');
});

test('listSuggestions respects the limit', () => {
  for (let i = 0; i < 10; i++) {
    const d = String(i + 1).padStart(2, '0');
    seed(`2026-04-${d}`, `Meal ${i}`, `2026-04-${d}T09:00:00Z`);
  }
  assert.equal(listSuggestions(3).length, 3);
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npm --workspace backend test 2>&1 | grep -A2 'listSuggestions\|dinners-repo'`
Expected: FAIL — `listSuggestions is not a function` or similar.

- [ ] **Step 3: Implement `listSuggestions`**

Add to `backend/src/repos/dinners.ts` (imports + function):

```ts
import type { Dinner, DinnerSuggestion } from '../model/types';

interface SuggestionRow {
  meal: string;
  count: number;
  last_used: string;
}

/** Distinct meal names ranked for typeahead, deduped case-insensitively.
 *  Canonical casing = the spelling from the most recent usage (ties broken
 *  by ASCII order of `meal` so the output is fully deterministic).
 *  Uses SQLite window functions (≥3.25 — bundled with better-sqlite3).
 *
 *  Caveat: SQLite's default LOWER() is ASCII-only — "CAFÉ" and "café" are
 *  NOT collapsed. Accept this for a small family table; revisit only if a
 *  unicode-heavy meal vocabulary becomes a real issue. */
export function listSuggestions(limit: number): DinnerSuggestion[] {
  const rows = getDb()
    .prepare(
      `SELECT meal, count, last_used
         FROM (
           SELECT
             meal,
             COUNT(*)  OVER (PARTITION BY LOWER(meal)) AS count,
             MAX(updated_at) OVER (PARTITION BY LOWER(meal)) AS last_used,
             ROW_NUMBER() OVER (
               PARTITION BY LOWER(meal)
               ORDER BY updated_at DESC, meal
             ) AS rn
           FROM dinners
         )
        WHERE rn = 1
        ORDER BY count DESC, last_used DESC, meal
        LIMIT ?`
    )
    .all(limit) as SuggestionRow[];
  return rows.map((r) => ({ meal: r.meal, count: r.count, lastUsed: r.last_used }));
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `npm --workspace backend test 2>&1 | grep -E 'listSuggestions|tests|pass|fail'`
Expected: 5 tests pass.

- [ ] **Step 5: Run the full backend suite**

Run: `npm --workspace backend test`
Expected: 119/119 (was 114, +5).

- [ ] **Step 6: Commit**

```bash
git add backend/src/repos/dinners.ts backend/src/repos/dinners.test.ts
git commit -m "feat(dinners): listSuggestions with case-insensitive dedup

Window-function query partitions by LOWER(meal); ORDER BY updated_at DESC,
meal makes the canonical casing fully deterministic even when seed data
ties on updated_at."
```

---

## Task 3: Backend — `GET /api/dinners/suggestions` route + trim-on-write (TDD)

**Files:**
- Create: `backend/src/routes/dinners.test.ts`
- Modify: `backend/src/routes/dinners.ts`
- Modify: `backend/src/schemas.ts` (add `suggestionsQuery`; tighten `dinnerUpsert`)

- [ ] **Step 1: Write the failing route test**

Create `backend/src/routes/dinners.test.ts`:

```ts
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { setupIsolatedDb, createTestApp } from '../test/util/bootstrap';

setupIsolatedDb('dinners-route');

let app: FastifyInstance;

before(async () => {
  const { dinnerRoutes } = await import('./dinners');
  app = await createTestApp(dinnerRoutes);

  // Seed via the real PUT path so trim-on-write is exercised too.
  await app.inject({ method: 'PUT', url: '/api/dinners/2026-05-01', payload: { meal: 'Tacos' } });
  await app.inject({ method: 'PUT', url: '/api/dinners/2026-05-02', payload: { meal: '  Tacos  ' } }); // trims to 'Tacos'
  await app.inject({ method: 'PUT', url: '/api/dinners/2026-05-03', payload: { meal: 'Pasta' } });
});

after(async () => {
  await app.close();
});

test('PUT /api/dinners trims whitespace before persisting', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/dinners?start=2026-05-02&end=2026-05-02' });
  assert.equal(res.statusCode, 200);
  const body = res.json() as Array<{ date: string; meal: string }>;
  assert.equal(body[0].meal, 'Tacos'); // not '  Tacos  '
});

test('GET /api/dinners/suggestions returns ranked suggestions with default limit', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/dinners/suggestions' });
  assert.equal(res.statusCode, 200);
  const body = res.json() as Array<{ meal: string; count: number; lastUsed: string }>;
  // 'Tacos' appears twice (after trim), 'Pasta' once.
  assert.deepEqual(body.map((s) => s.meal), ['Tacos', 'Pasta']);
  assert.equal(body[0].count, 2);
  assert.equal(body[1].count, 1);
});

test('GET /api/dinners/suggestions honours ?limit=', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/dinners/suggestions?limit=1' });
  assert.equal(res.statusCode, 200);
  assert.equal((res.json() as unknown[]).length, 1);
});

test('GET /api/dinners/suggestions rejects non-positive limit with VALIDATION code', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/dinners/suggestions?limit=0' });
  assert.equal(res.statusCode, 400);
  const body = res.json() as { error: { code: string; message: string } };
  assert.equal(body.error.code, 'VALIDATION');
});

test('GET /api/dinners/suggestions rejects non-numeric limit', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/dinners/suggestions?limit=foo' });
  assert.equal(res.statusCode, 400);
  const body = res.json() as { error: { code: string; message: string } };
  assert.equal(body.error.code, 'VALIDATION');
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npm --workspace backend test 2>&1 | grep -E 'suggestions|dinners-route'`
Expected: FAIL — route 404, schema doesn't trim.

- [ ] **Step 3: Tighten `dinnerUpsert` + add `suggestionsQuery` schema**

Modify `backend/src/schemas.ts`. Find:
```ts
export const dinnerUpsert = z.object({ meal: z.string().min(1).max(256) });
```
Replace with:
```ts
export const dinnerUpsert = z.object({ meal: z.string().trim().min(1).max(256) });

export const suggestionsQuery = z.object({
  limit: z.coerce.number().int().positive().max(200).default(50),
});
```

- [ ] **Step 4: Register the route**

Modify `backend/src/routes/dinners.ts`. Extend imports to include `listSuggestions` and `suggestionsQuery`. Inside `dinnerRoutes(app)`, add the suggestions handler **above** the existing `app.get('/api/dinners', …)` registration:

```ts
import { deleteDinner, listDinners, listSuggestions, setDinner } from '../repos/dinners';
import { dateParam, dinnerUpsert, suggestionsQuery } from '../schemas';

// …inside dinnerRoutes(app):
app.get('/api/dinners/suggestions', async (req) => {
  const { limit } = parseBody(suggestionsQuery, req.query);
  return listSuggestions(limit);
});
```

Verify by reading the existing route file that there is no `GET /api/dinners/:date` handler that could pattern-collide (only PUT/DELETE exist on `:date`). If a future maintainer adds one, our `/suggestions` registration above keeps Fastify's longest-static-prefix routing on our side.

- [ ] **Step 5: Run the test, verify it passes**

Run: `npm --workspace backend test 2>&1 | grep -E 'suggestions|trims|dinners-route'`
Expected: 5 tests pass.

- [ ] **Step 6: Run full backend suite**

Run: `npm --workspace backend test`
Expected: 124/124 (was 119, +5).

- [ ] **Step 7: Commit**

```bash
git add backend/src/routes/dinners.ts backend/src/routes/dinners.test.ts backend/src/schemas.ts
git commit -m "feat(dinners): GET /api/dinners/suggestions + trim-on-write

Suggestions endpoint serves the typeahead. dinnerUpsert now trims input so
'Tacos ' and 'Tacos' collapse on write, preventing long-tail history rot."
```

---

## Task 4: Frontend — API client + types

**Files:**
- Modify: `frontend/src/core/model/types.ts`
- Modify: `frontend/src/core/api/client.ts`

- [ ] **Step 1: Add the frontend type**

Append to `frontend/src/core/model/types.ts`:

```ts
export interface DinnerSuggestion {
  meal: string;
  count: number;
  lastUsed: string;
}
```

- [ ] **Step 2: Add the API client method**

Modify `frontend/src/core/api/client.ts`. Extend the type-import line to include `DinnerSuggestion`. Add the method inside the `api` object near the existing `setDinner`:

```ts
dinnerSuggestions: (limit = 50) =>
  get<DinnerSuggestion[]>(`/api/dinners/suggestions?limit=${limit}`),
```

- [ ] **Step 3: Verify build**

Run: `npm --workspace frontend run build 2>&1 | tail -10`
Expected: clean build.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/core/model/types.ts frontend/src/core/api/client.ts
git commit -m "feat(dinners): frontend API client for dinner suggestions"
```

---

## Task 5: Frontend — `useDinnerSuggestions` hook, SSE fan-out, mutation invalidation

**Files:**
- Modify: `frontend/src/core/hooks/useData.ts`
- Modify: `frontend/src/core/hooks/useRealtime.ts`
- Modify: `frontend/src/core/hooks/useMutations.ts`

- [ ] **Step 1: Add the hook**

Modify `frontend/src/core/hooks/useData.ts`. Extend the type-import line to include `DinnerSuggestion`. Append the hook:

```ts
/** Distinct meal history for the editor's typeahead. Invalidated locally on
 *  every dinner mutation (useDinnerMutations.settle) AND fanned out by the
 *  SSE 'dinners' poke (useRealtime.KIND_TO_KEYS) — the local invalidation
 *  is the fast path; SSE is the backstop for cross-device edits. */
export function useDinnerSuggestions() {
  return useQuery<DinnerSuggestion[]>({
    queryKey: ['dinner-suggestions'],
    queryFn: () => api.dinnerSuggestions(),
    staleTime: 60_000,
  });
}
```

- [ ] **Step 2: Wire SSE fan-out**

Modify `frontend/src/core/hooks/useRealtime.ts`:

```ts
const KIND_TO_KEYS: Record<string, string[]> = {
  chores: ['chores', 'chore-board'],
  'family-members': ['family-members', 'chore-board'],
  dinners: ['dinners', 'dinner-suggestions'],
};
```

- [ ] **Step 3: Wire local mutation invalidation**

Modify `frontend/src/core/hooks/useMutations.ts`. Update `useDinnerMutations.settle`:

```ts
export function useDinnerMutations() {
  const qc = useQueryClient();
  const settle = () => {
    void qc.invalidateQueries({ queryKey: ['dinners'] });
    void qc.invalidateQueries({ queryKey: ['dinner-suggestions'] });
  };
  // …rest unchanged
}
```

- [ ] **Step 4: Verify build + existing tests**

Run: `npm --workspace frontend run build && npm --workspace frontend test`
Expected: clean build, 23/23 tests still pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/core/hooks/useData.ts frontend/src/core/hooks/useRealtime.ts frontend/src/core/hooks/useMutations.ts
git commit -m "feat(dinners): useDinnerSuggestions hook + invalidation wiring

Local invalidation in useDinnerMutations gives instant typeahead refresh;
SSE fan-out keeps it fresh for cross-device edits."
```

---

## Task 6: Frontend — `filterSuggestions` pure util (TDD)

**Files:**
- Create: `frontend/src/components/sheets/dinnerSuggestions.test.ts`
- Create: `frontend/src/components/sheets/dinnerSuggestions.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/sheets/dinnerSuggestions.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { filterSuggestions } from './dinnerSuggestions';
import type { DinnerSuggestion } from '../../core/model/types';

const list: DinnerSuggestion[] = [
  { meal: 'Spaghetti Bolognese', count: 8, lastUsed: '2026-05-30T00:00:00Z' },
  { meal: 'Chicken Curry',       count: 5, lastUsed: '2026-05-29T00:00:00Z' },
  { meal: 'Tacos',               count: 4, lastUsed: '2026-05-28T00:00:00Z' },
  { meal: 'Pumpkin Soup',        count: 1, lastUsed: '2026-05-01T00:00:00Z' },
];

describe('filterSuggestions', () => {
  it('returns the top N (by input order) on an empty query', () => {
    expect(filterSuggestions(list, '', 2)).toEqual([list[0], list[1]]);
  });

  it('matches case-insensitively', () => {
    expect(filterSuggestions(list, 'CURRY', 10).map((s) => s.meal)).toEqual(['Chicken Curry']);
  });

  it('does fuzzy contains, not just starts-with', () => {
    expect(filterSuggestions(list, 'curry', 10).map((s) => s.meal)).toEqual(['Chicken Curry']);
    expect(filterSuggestions(list, 'soup', 10).map((s) => s.meal)).toEqual(['Pumpkin Soup']);
  });

  it('preserves input order (already frequency-sorted by the server)', () => {
    expect(filterSuggestions(list, 'a', 10).map((s) => s.meal)).toEqual([
      'Spaghetti Bolognese',
      'Tacos',
    ]);
  });

  it('trims whitespace and ignores blank queries', () => {
    expect(filterSuggestions(list, '   ', 3)).toEqual(list.slice(0, 3));
  });

  it('returns [] when nothing matches', () => {
    expect(filterSuggestions(list, 'zzz', 10)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run, verify it fails**

Run: `npm --workspace frontend test -- dinnerSuggestions`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `frontend/src/components/sheets/dinnerSuggestions.ts`:

```ts
import type { DinnerSuggestion } from '../../core/model/types';

/** Case-insensitive contains filter over a list the server has already ranked.
 *  Empty / whitespace-only query → top N untouched. */
export function filterSuggestions(
  list: DinnerSuggestion[],
  query: string,
  limit: number,
): DinnerSuggestion[] {
  const q = query.trim().toLowerCase();
  if (!q) return list.slice(0, limit);
  const out: DinnerSuggestion[] = [];
  for (const s of list) {
    if (s.meal.toLowerCase().includes(q)) {
      out.push(s);
      if (out.length >= limit) break;
    }
  }
  return out;
}
```

- [ ] **Step 4: Run, verify it passes**

Run: `npm --workspace frontend test -- dinnerSuggestions`
Expected: PASS (6 tests).

- [ ] **Step 5: Full frontend suite**

Run: `npm --workspace frontend test`
Expected: 29/29 (was 23, +6).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/sheets/dinnerSuggestions.ts frontend/src/components/sheets/dinnerSuggestions.test.ts
git commit -m "feat(dinners): pure filterSuggestions util for typeahead"
```

---

## Task 7: Frontend — `DinnerDateStrip` component

**Files:**
- Create: `frontend/src/components/sheets/DinnerDateStrip.tsx`

- [ ] **Step 1: Write the component**

Create `frontend/src/components/sheets/DinnerDateStrip.tsx`:

```tsx
import { DateTime } from 'luxon';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { ZONE } from '../../core/util/time';

interface Props {
  /** ISO start-of-week (Mon) in Brisbane, as yyyy-LL-dd. */
  weekStart: string;
  /** Currently selected yyyy-LL-dd. */
  selected: string;
  /** Map yyyy-LL-dd → meal (truthy = planned). */
  plannedByDate: Map<string, string>;
  /** yyyy-LL-dd of today in Brisbane (for the highlight). */
  today: string;
  onSelectDate: (date: string) => void;
  onPrevWeek: () => void;
  onNextWeek: () => void;
}

const WEEKDAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Mini week strip used at the top of DinnerEditorSheet. Mon–Sun pills (≥72px),
 *  64px chevrons step ±1 week. Selected pill is filled; today gets a ★. */
export function DinnerDateStrip({
  weekStart,
  selected,
  plannedByDate,
  today,
  onSelectDate,
  onPrevWeek,
  onNextWeek,
}: Props) {
  const monday = DateTime.fromISO(weekStart, { zone: ZONE });
  const days = Array.from({ length: 7 }, (_, i) => monday.plus({ days: i }));
  const rangeLabel = `${days[0].toFormat('d LLL')} – ${days[6].toFormat('d LLL')}`;

  return (
    <div style={{ marginBottom: 18 }}>
      <div className="flex items-center justify-between" style={{ marginBottom: 12 }}>
        <button
          type="button"
          onClick={onPrevWeek}
          aria-label="Previous week"
          className="grid place-items-center rounded-full text-text-muted"
          style={{ width: 64, height: 64, background: 'var(--surface)', border: '1px solid var(--border)' }}
        >
          <ChevronLeft size={28} />
        </button>
        <span className="font-semibold text-text-muted" style={{ fontSize: 15, letterSpacing: 0.4, textTransform: 'uppercase' }}>
          {rangeLabel}
        </span>
        <button
          type="button"
          onClick={onNextWeek}
          aria-label="Next week"
          className="grid place-items-center rounded-full text-text-muted"
          style={{ width: 64, height: 64, background: 'var(--surface)', border: '1px solid var(--border)' }}
        >
          <ChevronRight size={28} />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-2">
        {days.map((d, i) => {
          const date = d.toFormat('yyyy-LL-dd');
          const isSelected = date === selected;
          const isToday = date === today;
          const planned = !!plannedByDate.get(date);
          return (
            <button
              key={date}
              type="button"
              onClick={() => onSelectDate(date)}
              aria-pressed={isSelected}
              aria-label={d.toFormat('cccc d LLLL')}
              className="flex flex-col items-center justify-center rounded-md border"
              style={{
                minHeight: 72,
                background: isSelected
                  ? 'var(--accent)'
                  : isToday
                    ? 'var(--accent-weak)'
                    : 'var(--surface)',
                color: isSelected ? 'var(--accent-ink)' : 'var(--text)',
                borderColor: isSelected ? 'var(--accent)' : 'var(--border)',
                fontWeight: 600,
              }}
            >
              <span style={{ fontSize: 11, letterSpacing: 0.5, opacity: 0.85 }}>
                {WEEKDAY[i]}{isToday ? ' ★' : ''}
              </span>
              <span style={{ fontSize: 20 }}>{d.day}</span>
              <span
                aria-hidden
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  marginTop: 5,
                  background: planned ? (isSelected ? 'var(--accent-ink)' : 'var(--accent)') : 'transparent',
                }}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npm --workspace frontend run build 2>&1 | tail -10`
Expected: clean (component unused so far — fine).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/sheets/DinnerDateStrip.tsx
git commit -m "feat(dinners): DinnerDateStrip week picker with 64px chevrons"
```

---

## Task 8: Frontend — `DinnerSuggestionsList` component

**Files:**
- Create: `frontend/src/components/sheets/DinnerSuggestionsList.tsx`

- [ ] **Step 1: Write the component**

Create `frontend/src/components/sheets/DinnerSuggestionsList.tsx`:

```tsx
import type { DinnerSuggestion } from '../../core/model/types';

interface Props {
  items: DinnerSuggestion[];
  onPick: (meal: string) => void;
  /** True when the input is empty (heading reads "Recent meals" vs "Matches"). */
  isEmptyQuery: boolean;
}

/** Typeahead suggestion list shown under the meal input. Flows inside the
 *  Sheet body's existing scroll (no fixed max-height) so the virtual keyboard
 *  shrinks the visible area cleanly via Sheet's var(--kb-height) math. */
export function DinnerSuggestionsList({ items, onPick, isEmptyQuery }: Props) {
  if (items.length === 0) return null;

  return (
    <div style={{ marginTop: 12 }}>
      <p
        className="text-text-faint"
        style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}
      >
        {isEmptyQuery ? 'Recent meals' : 'Matches'}
      </p>
      <ul className="flex flex-col">
        {items.map((s) => (
          <li key={s.meal}>
            <button
              type="button"
              onClick={() => onPick(s.meal)}
              className="flex items-center justify-between w-full text-left rounded-md"
              style={{
                padding: '12px 14px',
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                marginBottom: 8,
                fontSize: 15,
                color: 'var(--text)',
                minHeight: 48,
              }}
            >
              <span className="truncate" style={{ minWidth: 0 }}>{s.meal}</span>
              <span className="shrink-0 text-text-faint" style={{ fontSize: 12, marginLeft: 12 }}>
                ×{s.count}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npm --workspace frontend run build 2>&1 | tail -10`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/sheets/DinnerSuggestionsList.tsx
git commit -m "feat(dinners): DinnerSuggestionsList typeahead component"
```

---

## Task 9: Frontend — rewrite editor + tappable hero cells + both layouts (single atomic commit)

This task makes three tightly-coupled changes that must land together so the build never breaks between commits (R5):
1. `DinnerEditorSheet` rewrite (date+week state, suggestions, stay-open save, dynamic Cancel/Done, "Saved" pulse).
2. `HeroBand` day cells become buttons with corner glyphs and accept `onTapDay`.
3. `WallLayout` + `PhoneLayout` updated for the new prop shape; WallLayout guards `useIdleReset` to skip dismiss when the editor is open.

**Files (all modify):**
- `frontend/src/components/sheets/DinnerEditorSheet.tsx`
- `frontend/src/components/hero/HeroBand.tsx`
- `frontend/src/layouts/WallLayout.tsx`
- `frontend/src/layouts/PhoneLayout.tsx`

- [ ] **Step 1: Rewrite `DinnerEditorSheet`**

Replace `frontend/src/components/sheets/DinnerEditorSheet.tsx` entirely:

```tsx
import { useEffect, useMemo, useState } from 'react';
import { DateTime } from 'luxon';
import { useDinnerMutations } from '../../core/hooks/useMutations';
import { useDinners, useDinnerSuggestions } from '../../core/hooks/useData';
import { weekDates, ZONE } from '../../core/util/time';
import { Sheet } from './Sheet';
import { Button } from '../primitives/Button';
import { Field, TextInput } from './fields';
import { DinnerDateStrip } from './DinnerDateStrip';
import { DinnerSuggestionsList } from './DinnerSuggestionsList';
import { filterSuggestions } from './dinnerSuggestions';

interface Props {
  open: boolean;
  onClose: () => void;
  /** yyyy-LL-dd of the day to pre-select; set to null to keep closed. */
  initialDate: string | null;
}

const SUGGESTION_LIMIT = 8;
const SAVED_PULSE_MS = 2200;

/** Anchor day → the same week's Mon..Sun window (via the shared `weekDates`
 *  util so this query key collides with the parent layouts' weekly dinner
 *  query and TanStack dedupes the network call). */
function weekWindowFor(dateIso: string) {
  return weekDates(DateTime.fromISO(dateIso, { zone: ZONE }));
}

/** Plan dinners for the visible week (and any forward week). Tap a day → load
 *  that day's planned meal. Save → cache settles → modal stays open with the
 *  saved meal pre-filled; the user closes manually. Suggestions are derived
 *  from the growing dinners table. The wall's idle dismiss is suppressed by
 *  WallLayout while this sheet is open. */
export function DinnerEditorSheet({ open, onClose, initialDate }: Props) {
  const { set, clear } = useDinnerMutations();

  // Selected day & visible week are independent so paging weeks doesn't
  // clobber a "Friday next week" selection. weekAnchor is a yyyy-LL-dd Monday.
  const [selectedDate, setSelectedDate] = useState<string>(initialDate ?? '');
  const [weekAnchor, setWeekAnchor] = useState<string>(() =>
    initialDate ? weekWindowFor(initialDate).start : weekDates(DateTime.now()).start
  );
  const [meal, setMeal] = useState('');
  const [savedAt, setSavedAt] = useState<number>(0);

  const week = useMemo(
    () => weekDates(DateTime.fromISO(weekAnchor, { zone: ZONE })),
    [weekAnchor]
  );
  const dinnersQ = useDinners(week.start, week.end);
  const suggestionsQ = useDinnerSuggestions();
  const today = DateTime.now().setZone(ZONE).toFormat('yyyy-LL-dd');

  const plannedByDate = useMemo(
    () => new Map((dinnersQ.data ?? []).map((d) => [d.date, d.meal])),
    [dinnersQ.data]
  );

  // Seed input whenever the selected day changes or the cache updates.
  useEffect(() => {
    if (!selectedDate) return;
    setMeal(plannedByDate.get(selectedDate) ?? '');
  }, [selectedDate, plannedByDate]);

  // Auto-clear the "Saved" pulse.
  useEffect(() => {
    if (!savedAt) return;
    const t = window.setTimeout(() => setSavedAt(0), SAVED_PULSE_MS);
    return () => window.clearTimeout(t);
  }, [savedAt]);

  if (!open || !selectedDate) return null;

  const filtered = filterSuggestions(suggestionsQ.data ?? [], meal, SUGGESTION_LIMIT);
  const currentMeal = plannedByDate.get(selectedDate) ?? '';
  const isDirty = meal.trim() !== currentMeal;
  const canSave = meal.trim().length > 0 && isDirty;
  const pretty = DateTime.fromISO(selectedDate, { zone: ZONE }).toFormat('cccc d LLLL');

  const save = () => {
    const v = meal.trim();
    if (!v) return;
    set.mutate(
      { date: selectedDate, meal: v },
      { onSuccess: () => setSavedAt(Date.now()) }
    );
  };

  const handleClear = () => {
    clear.mutate(selectedDate);
  };

  const actions = (
    <>
      {currentMeal && (
        <Button variant="danger" onClick={handleClear} style={{ marginRight: 'auto' }}>
          Clear
        </Button>
      )}
      <Button variant="ghost" onClick={onClose}>
        {isDirty ? 'Cancel' : 'Done'}
      </Button>
      <Button variant="primary" onClick={save} disabled={!canSave}>
        Save
      </Button>
    </>
  );

  const title = (
    <span className="flex items-center gap-2">
      <span>Dinner · {pretty}</span>
      {savedAt > 0 && (
        <span
          aria-live="polite"
          className="rounded-full"
          style={{
            fontSize: 12,
            padding: '2px 8px',
            background: 'var(--accent-weak)',
            color: 'var(--accent-ink)',
            fontWeight: 600,
          }}
        >
          Saved
        </span>
      )}
    </span>
  );

  return (
    <Sheet open onClose={onClose} title={title as unknown as string} actions={actions}>
      <DinnerDateStrip
        weekStart={week.start}
        selected={selectedDate}
        plannedByDate={plannedByDate}
        today={today}
        onSelectDate={setSelectedDate}
        onPrevWeek={() => setWeekAnchor(weekDates(DateTime.fromISO(week.start, { zone: ZONE }).minus({ weeks: 1 })).start)}
        onNextWeek={() => setWeekAnchor(weekDates(DateTime.fromISO(week.start, { zone: ZONE }).plus({ weeks: 1 })).start)}
      />

      <Field label="Meal">
        <TextInput
          value={meal}
          onChange={(e) => setMeal(e.target.value)}
          placeholder="What's for dinner?"
          autoFocus
          onKeyDown={(e) => e.key === 'Enter' && canSave && save()}
        />
      </Field>

      <DinnerSuggestionsList
        items={filtered}
        onPick={(m) => setMeal(m)}
        isEmptyQuery={meal.trim() === ''}
      />
    </Sheet>
  );
}
```

Note on `title`: `Sheet`'s `title` prop is typed `string` (it's also used for `aria-label`). Before implementing, verify by re-reading `frontend/src/components/sheets/Sheet.tsx`. If a `ReactNode` title is unwelcome, two options: (a) keep the title string and render the "Saved" pulse as an absolutely-positioned badge inside the body (top:8 right:60); (b) loosen `Sheet`'s `title` to `string | ReactNode` and use a derived `aria-label` (the formatted date). Pick (a) for the smaller blast radius unless `Sheet` is already used with rich titles elsewhere.

- [ ] **Step 2: Rewrite `HeroBand`**

Replace `frontend/src/components/hero/HeroBand.tsx` entirely:

```tsx
import type { DateTime } from 'luxon';
import { DateTime as DT } from 'luxon';
import { Utensils, Pencil, Plus } from 'lucide-react';
import type { Dinner, WeatherData } from '../../core/model/types';
import { ZONE } from '../../core/util/time';
import { Clock } from '../primitives/Clock';
import { StatusDot } from '../primitives/StatusDot';
import { WeatherSidebar } from '../weather/WeatherSidebar';

interface Props {
  now: DateTime;
  weekDays: string[]; // 7 YYYY-MM-DD (Mon..Sun)
  dinners: Dinner[];
  dataUpdatedAt: number;
  isError: boolean;
  weather?: WeatherData;
  /** Tap a day pill → open DinnerEditorSheet with that date pre-filled. */
  onTapDay: (date: string) => void;
}

const WEEKDAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Hero band: Tonight dinner (rolls to tomorrow after 20:00) + week strip + clock.
 *  Day pills are buttons; empty cells show a corner +, filled cells a pencil. */
export function HeroBand({ now, weekDays, dinners, dataUpdatedAt, isError, weather, onTapDay }: Props) {
  const byDate = new Map(dinners.map((d) => [d.date, d.meal]));
  const todayKey = now.toFormat('yyyy-LL-dd');
  const rollToTomorrow = now.hour >= 20;
  const focusKey = rollToTomorrow ? now.plus({ days: 1 }).toFormat('yyyy-LL-dd') : todayKey;
  const focusMeal = byDate.get(focusKey);

  return (
    <div className="flex shrink-0 bg-surface border-b border-border" style={{ height: 200 }}>
      <div className="flex-1 flex flex-col justify-between" style={{ padding: '30px 36px' }}>
        <div>
          <div className="uppercase text-text-faint font-semibold" style={{ fontSize: 14, letterSpacing: '0.22em' }}>
            {rollToTomorrow ? 'Tomorrow' : 'Tonight'}
          </div>
          <div className="flex items-center gap-4 mt-2.5">
            <span
              className="grid place-items-center rounded-md shrink-0"
              style={{ width: 56, height: 56, background: 'color-mix(in srgb, var(--c-dinner) 16%, transparent)', color: 'var(--c-dinner)' }}
            >
              <Utensils size={30} />
            </span>
            <span className="font-bold leading-none" style={{ fontSize: 56, letterSpacing: '-0.02em' }}>
              {focusMeal ?? <span className="text-text-muted font-medium" style={{ fontSize: 38 }}>No dinner planned</span>}
            </span>
          </div>
        </div>
        <div className="grid grid-cols-7 gap-2.5">
          {weekDays.map((date, i) => {
            const isToday = date === todayKey;
            const meal = byDate.get(date);
            const friendly = DT.fromISO(date, { zone: ZONE }).toFormat('cccc d LLLL');
            return (
              <button
                key={date}
                type="button"
                onClick={() => onTapDay(date)}
                aria-label={meal ? `Edit dinner for ${friendly}` : `Plan dinner for ${friendly}`}
                className="relative rounded-md border flex flex-col gap-1 text-left"
                style={{
                  padding: '9px 10px 11px',
                  paddingRight: 28,
                  minHeight: 64,
                  background: isToday ? 'var(--accent-weak)' : 'var(--surface-2)',
                  borderColor: isToday ? 'color-mix(in srgb, var(--accent) 40%, transparent)' : 'var(--border)',
                }}
              >
                <div className="uppercase font-bold flex items-center gap-1.5" style={{ fontSize: 13, letterSpacing: '0.08em', color: isToday ? 'var(--accent)' : 'var(--text-faint)' }}>
                  {isToday && <span style={{ color: 'var(--accent)' }}>★</span>}
                  {WEEKDAY[i]}
                </div>
                <div className="leading-tight" style={{ fontSize: 18, color: meal ? 'var(--text)' : 'var(--text-faint)' }}>
                  {meal ?? '—'}
                </div>
                <span
                  aria-hidden
                  className="absolute"
                  style={{ top: 8, right: 8, color: 'var(--text-faint)', opacity: 0.75 }}
                >
                  {meal ? <Pencil size={18} /> : <Plus size={20} />}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="shrink-0 border-l border-border flex flex-col items-end justify-between" style={{ width: 340, padding: '24px 36px' }}>
        <Clock now={now} />
        <WeatherSidebar weather={weather} isNight={now.hour < 6 || now.hour >= 20} />
        <StatusDot dataUpdatedAt={dataUpdatedAt} isError={isError} />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Update `WallLayout` — swap editor state to date-holding, wire HeroBand, guard idle dismiss**

Modify `frontend/src/layouts/WallLayout.tsx`:

Replace:
```ts
const [dinnerEditorOpen, setDinnerEditorOpen] = useState(false);
```
with:
```ts
const [dinnerDate, setDinnerDate] = useState<string | null>(null);
```

Replace the `dismissAll` body's `setDinnerEditorOpen(false);` with `setDinnerDate(null);`.

Replace the existing `useIdleReset` block with the guarded version (planning needs more than 90s; other sheets retain default behaviour):

```ts
useIdleReset(90_000, () => {
  if (dinnerDate !== null) return; // planning in progress — let the user finish
  setView('agenda');
  setAnchor(now.startOf('day'));
  dismissAll();
});
```

Pass `onTapDay` to `HeroBand`:
```tsx
<HeroBand
  now={now}
  weekDays={week.days}
  dinners={dinners}
  dataUpdatedAt={dataUpdatedAt}
  isError={dataIsError}
  weather={weatherQ.data}
  onTapDay={(date) => {
    dismissAll();
    setDinnerDate(date);
  }}
/>
```

Update the AddChooser's dinner branch:
```tsx
onDinner={() => {
  dismissAll();
  setDinnerDate(todayStr);
}}
```

Replace the `DinnerEditorSheet` block (use `key={dinnerDate}` so each open is a fresh component instance — R11):
```tsx
<DinnerEditorSheet
  key={dinnerDate ?? 'closed'}
  open={dinnerDate !== null}
  onClose={() => setDinnerDate(null)}
  initialDate={dinnerDate}
/>
```

Delete the now-unused `todayMeal` derivation (keep `todayStr` — still used by `onDinner`).

- [ ] **Step 4: Update `PhoneLayout` — simplify state, switch prop**

Modify `frontend/src/layouts/PhoneLayout.tsx`:

Change:
```ts
const [dinnerTarget, setDinnerTarget] = useState<{ date: string; meal: string } | null>(null);
```
to:
```ts
const [dinnerDate, setDinnerDate] = useState<string | null>(null);
```

Update the two call sites that previously read `.date` and `.meal`:
- The agenda-banner button: `onClick={() => setDinnerDate(today)}`
- `DinnerWeekEditor`'s `onTapDay`: `onTapDay={(date) => setDinnerDate(date)}` (the second `meal` arg is now ignored — the sheet looks it up itself).

Replace the sheet render:
```tsx
{dinnerDate && (
  <DinnerEditorSheet
    key={dinnerDate}
    open
    onClose={() => setDinnerDate(null)}
    initialDate={dinnerDate}
  />
)}
```

Update the FAB-visibility guard (replace the `!dinnerTarget` clause with `!dinnerDate`).

- [ ] **Step 5: Build the whole frontend**

Run: `npm --workspace frontend run build 2>&1 | tail -20`
Expected: clean build.

- [ ] **Step 6: Run all tests**

```bash
npm --workspace backend test
npm --workspace frontend test
```
Expected: backend 124/124, frontend 29/29.

- [ ] **Step 7: Commit (atomic)**

```bash
git add frontend/src/components/sheets/DinnerEditorSheet.tsx \
        frontend/src/components/hero/HeroBand.tsx \
        frontend/src/layouts/WallLayout.tsx \
        frontend/src/layouts/PhoneLayout.tsx
git commit -m "feat(dinners): tap-to-edit hero cells + week-aware editor

DinnerEditorSheet rewritten to own date + week-anchor state, with a
suggestions typeahead and stay-open-after-save flow (Saved pulse, dynamic
Cancel/Done). HeroBand day cells are now buttons with +/pencil corner
glyphs; WallLayout pauses the 90s idle dismiss while the editor is open."
```

---

## Task 10: Manual verification (Playwright screenshots)

The wall has no component-test layer; verify visually via the cached chromium per `CLAUDE.md` (`waitUntil:'load'`, never `networkidle`, because SSE holds connections).

- [ ] **Step 1: Build backend + frontend**

```bash
npm run build
```
Expected: backend + frontend `dist/` produced.

- [ ] **Step 2: Start a clean prod-mode server with a tmp DB**

```bash
rm -rf /tmp/dinner-verify-data
DATA_DIR=/tmp/dinner-verify-data STATIC_DIR=frontend/dist PORT=8794 node backend/dist/server.js &
sleep 2
curl -s localhost:8794/api/health
```
Expected: `{"ok":true,...}`

- [ ] **Step 3: Seed dinners spanning the current and previous week**

```bash
for pair in "2026-05-25:Spaghetti Bolognese" "2026-05-26:Tacos" "2026-05-27:Spaghetti Bolognese" \
            "2026-05-28:Chicken Curry" "2026-06-01:Tacos" "2026-06-02:Pumpkin Soup"; do
  date="${pair%%:*}"; meal="${pair#*:}"
  curl -s -X PUT "localhost:8794/api/dinners/$date" -H 'content-type: application/json' \
       -d "{\"meal\":\"$meal\"}" >/dev/null
done
curl -s 'localhost:8794/api/dinners/suggestions?limit=10' | jq .
```
Expected: 4 suggestions ordered Tacos(2) → Spaghetti Bolognese(2) → Chicken Curry(1) → Pumpkin Soup(1); the two count=2 entries ordered by `lastUsed` desc.

- [ ] **Step 4: Screenshot the wall at 1280×800 with the dinner editor open**

Use the cached chromium pattern from CLAUDE.md. Navigate to `http://localhost:8794/?mode=wall`, click an empty day pill in the hero band, wait 500ms, screenshot.

- [ ] **Step 5: Visually confirm**

Check the screenshot:
- Tonight panel no longer says "tap to add" (just "No dinner planned" when empty).
- Each hero day pill has a `+` (empty days) or pencil (filled days) glyph in the top-right corner, ~18–20px and visible.
- The editor opens with the tapped date pre-selected in the week strip, today highlighted with `★`, and the input pre-filled with whatever was planned (empty here).
- Chevrons are 64×64.
- Typing `tac` shows "Tacos" under a "Matches" heading with `×2`. Clearing the input shows the full "Recent meals" list.
- Tapping prev/next week chevrons updates the range label (`2 Jun – 8 Jun` ↔ `9 Jun – 15 Jun`), pill dates change, planned dots update.

- [ ] **Step 6: End-to-end save check**

In the editor: tap a Friday pill, type "Roast chicken", press Save. The "Saved" pill appears next to the date title for ~2s. The Save button greys (meal === currentMeal). Footer button reads "Done" (not "Cancel"). Tap Done. The hero strip's Friday cell now shows "Roast chicken" with a pencil glyph instead of `+`.

- [ ] **Step 7: Idle behaviour check**

Open the editor, tap a day, do nothing for 100s. The sheet should still be open (idle dismiss is suppressed while editor open). Close manually. Idle reset returns the wall to Agenda+today within 90s as usual.

- [ ] **Step 8: Teardown**

```bash
pkill -f 'node backend/dist/server.js' || true
rm -rf /tmp/dinner-verify-data
```

- [ ] **Step 9: If anything visual is off, fix and re-verify; otherwise no commit needed.**

---

## Task 11: Docs — session log entry

**Files:**
- Modify: `docs/SESSION-LOG.md`

- [ ] **Step 1: Prepend a new session entry**

Add a new section at the top of `docs/SESSION-LOG.md` (newest first per the file convention):

```markdown
## 2026-06-03 — Dinner planning upgrade

### What was built
- **`GET /api/dinners/suggestions`** — derived from the dinners table via a
  SQLite window-function query that deduplicates case-insensitively and ranks
  by frequency then recency then meal-name (deterministic tiebreaker for
  canonical casing). Returns `{ meal, count, lastUsed }[]`; Zod-validated
  `?limit=` (default 50, max 200, `VALIDATION` 400 on bad input).
- **`dinnerUpsert`** schema gained `.trim()` so `"Tacos "` and `"Tacos"`
  collapse on write (prevents long-tail history rot).
- **`DinnerEditorSheet`** rebuilt to own its own date + week-anchor state. A
  new `DinnerDateStrip` (7×72px pills, 64×64 chevrons) sits at the top; the
  sheet fetches its own `useDinners(start, end)` via the shared `weekDates`
  util so its query key collides with the parent layouts' identical query
  and TanStack dedupes the network call. Save no longer auto-closes — the
  user closes with Done/X. A "Saved" pill flashes for ~2s on successful
  save. Footer wording is dynamic: "Cancel" while edits are unsaved, "Done"
  once `meal === currentMeal`. A new `DinnerSuggestionsList` renders below
  the input; `filterSuggestions` does case-insensitive contains.
- **HeroBand day cells** are now `<button>`s. Empty cells show a `+`;
  planned cells show a pencil (18–20px, opacity 0.75). The "— tap to add"
  CTA in the Tonight panel is gone (cards make the affordance now).
  WallLayout passes `onTapDay` → opens the editor pre-filled. While the
  editor is open the wall's 90s idle dismiss is suppressed.
- **Cache invalidation** — `useDinnerMutations.settle` now also invalidates
  `['dinner-suggestions']` for instant local feedback; the `dinners` SSE
  poke fans out to the same key so cross-device edits stay fresh.

### Tests
- +5 backend repo tests (`listSuggestions` truth-table incl. deterministic
  tiebreaker).
- +5 backend route tests (default + explicit limit + non-numeric + zero +
  trim-on-write).
- +6 frontend unit tests (`filterSuggestions`).
- Backend 124/124, frontend 29/29, build clean.

### Verify
\`\`\`bash
npm --workspace backend test
npm --workspace frontend test
npm run build
docker compose up -d --build
bash kiosk/reload.sh
# Wall: tap any day pill in the hero strip → editor opens with that date.
#       chevrons in the strip step weeks; typing partial meal name → matches.
\`\`\`
```

- [ ] **Step 2: Commit**

```bash
git add docs/SESSION-LOG.md
git commit -m "docs: log dinner planning upgrade session"
```

---

## Out of scope (don't add unless asked)

- A dedicated `meal_library` table (decided: derive from `dinners` for v1).
- A "favourites" star / pin so a meal can be promoted without scheduling.
- Levenshtein / typo-tolerant fuzzy match (decided: substring contains is enough).
- Multi-day batch save UI (decided: stay-open-on-same-day suffices for the family planning use case).
- Tappable Tonight hero panel itself (only the 7 day cells become tappable in this work).
- A new SSE poke kind for suggestions — reusing `dinners` is enough.
- Unicode-aware `LOWER()` (SQLite default is ASCII; documented in the repo).

---

## Self-review notes

- Spec coverage: all three user asks (date selection in modal incl. next week, hero tap-to-open with pre-fill, growing-history suggestions with dedup + fuzzy contains) map to specific tasks. Reviewer findings R1–R18 are folded into the relevant tasks above.
- Public-API change of `DinnerEditorSheet` (Task 9 step 1) is followed immediately by both call-site fixes (Task 9 steps 3 + 4) inside the same commit (Task 9 step 7) — build green at every commit.
- `useDinnerSuggestions` (Task 5) is consumed in Task 9; SSE fan-out + local invalidation (Task 5) keep it fresh.
- `listSuggestions` SQL hand-walked with `[(Tacos, 09:00Z), (Tacos, 10:00Z), (tacos, 09:30Z)]` → `{meal:'Tacos', count:3, lastUsed:'2026-…T10:00:00Z'}` ✓; with all-ties (R8 case) → `'TACOS'` deterministically.
- Type consistency: `DinnerSuggestion { meal, count, lastUsed }` is identical between backend (Task 1) and frontend (Task 4). `listSuggestions(limit: number): DinnerSuggestion[]` matches the call site in Task 3.
