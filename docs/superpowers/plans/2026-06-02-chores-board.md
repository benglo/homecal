# Chores Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a chores board with star rewards — kids tap the wall to complete chores and earn stars; parents manage via phone.

**Architecture:** Standalone subsystem: 3 new SQLite tables (family_members, chores, chore_completions), Fastify CRUD + board endpoint, React wall component (full-panel view in ControlBar), phone management screens. Follows existing patterns exactly. SSE poke on mutations, optimistic completion with animation.

**Tech Stack:** Fastify, better-sqlite3, Zod, React, TanStack Query, Tailwind, Luxon, Web Audio API (chime), CSS keyframes (animations).

**Spec:** `docs/superpowers/specs/2026-06-02-chores-board-design.md`

---

## File Map

### Backend — Create

| File | Responsibility |
|------|----------------|
| `backend/src/repos/familyMembers.ts` | DB queries: list, get, create, update, delete family members |
| `backend/src/repos/chores.ts` | DB queries: CRUD chores, complete/uncomplete, getBoard |
| `backend/src/routes/familyMembers.ts` | Fastify routes: GET/POST/PUT/DELETE /api/family-members |
| `backend/src/routes/chores.ts` | Fastify routes: chores CRUD, /api/chore-board, complete/uncomplete |
| `backend/src/repos/chores.test.ts` | Board computation + repo tests (node:test) |
| `backend/src/routes/chores.test.ts` | Route integration tests (node:test) |
| `backend/src/routes/familyMembers.test.ts` | Route integration tests (node:test) |

### Backend — Modify

| File | Change |
|------|--------|
| `backend/src/db/migrate.ts` | Append migration v2: 3 tables + indexes |
| `backend/src/schemas.ts` | Append Zod schemas for family members + chores |
| `backend/src/model/types.ts` | Append backend types |
| `backend/src/realtime.ts` | Add 'chores' and 'family-members' to PokeKind |
| `backend/src/server.ts` | Register familyMemberRoutes + choreRoutes |

### Frontend — Create

| File | Responsibility |
|------|----------------|
| `frontend/src/core/hooks/useBrisbaneDate.ts` | Clock-driven YYYY-MM-DD, re-evaluates at midnight |
| `frontend/src/components/chores/ChoresBoard.tsx` | Wall board: member columns, empty/celebration states |
| `frontend/src/components/chores/MemberColumn.tsx` | Per-member column: header + chore cards |
| `frontend/src/components/chores/ChoreCard.tsx` | Single chore card: tap target, animation trigger |
| `frontend/src/components/chores/StarBurst.tsx` | Star-fly + confetti CSS-only animations |
| `frontend/src/components/chores/useChimeSound.ts` | Web Audio API chime (muted 8pm–7am) |
| `frontend/src/components/manage/FamilyMemberManager.tsx` | Phone: manage family members |
| `frontend/src/components/manage/ChoreManager.tsx` | Phone: manage chore definitions |

### Frontend — Modify

| File | Change |
|------|--------|
| `frontend/src/core/model/types.ts` | Append FamilyMember, Chore, BoardMember, BoardChore, ChoreBoard types; extend WallView |
| `frontend/src/core/api/client.ts` | Append API methods for family-members, chores, chore-board, complete |
| `frontend/src/core/hooks/useData.ts` | Append useFamilyMembers, useChores, useChoreBoard hooks |
| `frontend/src/core/hooks/useMutations.ts` | Append useFamilyMemberMutations, useChoreMutations, useChoreCompletion hooks |
| `frontend/src/core/hooks/useRealtime.ts` | Add KIND_TO_KEYS lookup for 1:N SSE invalidation |
| `frontend/src/layouts/WallLayout.tsx` | Add 'chores' view + ChoresBoard rendering |
| `frontend/src/layouts/PhoneLayout.tsx` | Add FamilyMemberManager + ChoreManager to manage tab |
| `frontend/src/components/controls/ControlBar.tsx` | Add ⭐ Chores button to view switcher |

---

## Task 1: Migration — 3 new tables

**Files:**
- Modify: `backend/src/db/migrate.ts`

- [ ] **Step 1: Append the v2 migration**

Add to the `MIGRATIONS` array in `backend/src/db/migrate.ts`:

```typescript
  // v2 — chores board (family members, chores, completions)
  (db) => {
    db.exec(`
      CREATE TABLE family_members (
        id         TEXT PRIMARY KEY,
        name       TEXT NOT NULL UNIQUE,
        icon       TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
      );

      CREATE TABLE chores (
        id          TEXT PRIMARY KEY,
        title       TEXT NOT NULL CHECK (length(title) > 0),
        icon        TEXT NOT NULL,
        stars       INTEGER NOT NULL DEFAULT 1 CHECK (stars >= 1 AND stars <= 5),
        frequency   TEXT NOT NULL CHECK (frequency IN ('daily', 'weekly')),
        day_of_week INTEGER,
        assigned_to TEXT NOT NULL REFERENCES family_members(id) ON DELETE CASCADE,
        position    INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
        updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
        CHECK (
          (frequency = 'weekly' AND day_of_week BETWEEN 0 AND 6) OR
          (frequency = 'daily'  AND day_of_week IS NULL)
        )
      );

      CREATE TABLE chore_completions (
        chore_id       TEXT NOT NULL REFERENCES chores(id) ON DELETE CASCADE,
        completed_date TEXT NOT NULL CHECK (completed_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
        completed_at   TEXT NOT NULL,
        PRIMARY KEY (chore_id, completed_date)
      );

      CREATE INDEX idx_chores_assigned_to ON chores(assigned_to);
      CREATE INDEX idx_chore_completions_date ON chore_completions(completed_date);
    `);
  },
```

- [ ] **Step 2: Verify migration runs**

```bash
rm -rf /home/ben/Development/homecal/data/calendar.db*
npm run dev:backend
# Should start without errors. Check logs for no migration failures.
# Ctrl+C to stop.
```

- [ ] **Step 3: Verify tables exist**

```bash
sqlite3 /home/ben/Development/homecal/data/calendar.db ".schema family_members" ".schema chores" ".schema chore_completions" "PRAGMA user_version;"
```

Expected: all 3 tables shown, user_version = 2.

- [ ] **Step 4: Commit**

```bash
git add backend/src/db/migrate.ts
git commit -m "feat: add chores board migration (family_members, chores, chore_completions)"
```

---

## Task 2: Backend types + Zod schemas

**Files:**
- Modify: `backend/src/model/types.ts`
- Modify: `backend/src/schemas.ts`
- Modify: `backend/src/realtime.ts`

- [ ] **Step 1: Add backend types**

Append to `backend/src/model/types.ts`:

```typescript
export interface FamilyMember {
  id: string;
  name: string;
  icon: string;
  updatedAt: string;
}

export type ChoreFrequency = 'daily' | 'weekly';

export interface Chore {
  id: string;
  title: string;
  icon: string;
  stars: number;
  frequency: ChoreFrequency;
  dayOfWeek: number | null;
  assignedTo: string;
  position: number;
  updatedAt: string;
}

export interface ChoreCompletion {
  choreId: string;
  completedDate: string;
  completedAt: string;
}

export interface BoardChore {
  id: string;
  title: string;
  icon: string;
  stars: number;
  completed: boolean;
  completedAt: string | null;
}

export interface BoardMember {
  id: string;
  name: string;
  icon: string;
  totalStars: number;
  chores: BoardChore[];
}

export interface ChoreBoard {
  date: string;
  members: BoardMember[];
}
```

- [ ] **Step 2: Add Zod schemas**

Append to `backend/src/schemas.ts`:

```typescript
export const familyMemberCreate = z.object({
  name: z.string().min(1).max(64),
  icon: z.string().min(1).max(16),
});
export const familyMemberUpdate = familyMemberCreate;

export const choreCreate = z
  .object({
    title: z.string().min(1).max(256),
    icon: z.string().min(1).max(16),
    stars: z.number().int().min(1).max(5).default(1),
    frequency: z.enum(['daily', 'weekly']),
    dayOfWeek: z.number().int().min(0).max(6).nullable().optional(),
    assignedTo: z.string().min(1),
    position: z.number().int().min(0).default(0),
  })
  .refine(
    (o) =>
      o.frequency === 'daily'
        ? o.dayOfWeek == null
        : o.dayOfWeek != null && o.dayOfWeek >= 0 && o.dayOfWeek <= 6,
    { message: 'weekly chores require dayOfWeek (0-6); daily chores must not have dayOfWeek', path: ['dayOfWeek'] }
  );

export const choreUpdate = z
  .object({
    title: z.string().min(1).max(256).optional(),
    icon: z.string().min(1).max(16).optional(),
    stars: z.number().int().min(1).max(5).optional(),
    frequency: z.enum(['daily', 'weekly']).optional(),
    dayOfWeek: z.number().int().min(0).max(6).nullable().optional(),
    assignedTo: z.string().min(1).optional(),
    position: z.number().int().min(0).optional(),
  })
  .refine((o) => Object.keys(o).length > 0, { message: 'no fields to update' });

export const choreCompleteBody = z.object({
  date: dateParam,
});

export type FamilyMemberCreate = z.infer<typeof familyMemberCreate>;
export type ChoreCreate = z.output<typeof choreCreate>;
export type ChoreUpdate = z.infer<typeof choreUpdate>;
```

- [ ] **Step 3: Extend PokeKind**

In `backend/src/realtime.ts`, update the type:

```typescript
export type PokeKind = 'events' | 'dinners' | 'categories' | 'photos' | 'chores' | 'family-members';
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/model/types.ts backend/src/schemas.ts backend/src/realtime.ts
git commit -m "feat: add chores board types, Zod schemas, and SSE poke kinds"
```

---

## Task 3: Family members repo + routes

**Files:**
- Create: `backend/src/repos/familyMembers.ts`
- Create: `backend/src/routes/familyMembers.ts`
- Modify: `backend/src/server.ts`

- [ ] **Step 1: Create the family members repo**

Create `backend/src/repos/familyMembers.ts`:

```typescript
import { getDb } from '../db';
import { newId } from '../util/ids';
import { isoUtc } from '../util/time';
import { httpError } from '../util/errors';
import type { FamilyMember, FamilyMemberCreate } from '../model/types';

interface Row {
  id: string;
  name: string;
  icon: string;
  updated_at: string;
}

const toMember = (r: Row): FamilyMember => ({
  id: r.id,
  name: r.name,
  icon: r.icon,
  updatedAt: r.updated_at,
});

const now = () => isoUtc(new Date());

export function listFamilyMembers(): FamilyMember[] {
  return (getDb().prepare('SELECT * FROM family_members ORDER BY name').all() as Row[]).map(toMember);
}

export function getFamilyMember(id: string): FamilyMember | null {
  const r = getDb().prepare('SELECT * FROM family_members WHERE id = ?').get(id) as Row | undefined;
  return r ? toMember(r) : null;
}

export function createFamilyMember(input: FamilyMemberCreate): FamilyMember {
  const db = getDb();
  const id = newId();
  const ts = now();
  try {
    db.prepare(
      `INSERT INTO family_members (id, name, icon, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(id, input.name, input.icon, ts, ts);
  } catch (e) {
    if (e instanceof Error && /UNIQUE constraint failed/.test(e.message)) {
      throw httpError(409, 'DUPLICATE_NAME', 'A family member with that name already exists');
    }
    throw e;
  }
  return getFamilyMember(id)!;
}

export function updateFamilyMember(id: string, input: FamilyMemberCreate): FamilyMember {
  const db = getDb();
  if (!getFamilyMember(id)) throw httpError(404, 'NOT_FOUND', 'Family member not found');
  try {
    db.prepare('UPDATE family_members SET name=?, icon=?, updated_at=? WHERE id=?').run(
      input.name,
      input.icon,
      now(),
      id
    );
  } catch (e) {
    if (e instanceof Error && /UNIQUE constraint failed/.test(e.message)) {
      throw httpError(409, 'DUPLICATE_NAME', 'A family member with that name already exists');
    }
    throw e;
  }
  return getFamilyMember(id)!;
}

export function deleteFamilyMember(id: string): void {
  if (!getFamilyMember(id)) throw httpError(404, 'NOT_FOUND', 'Family member not found');
  getDb().prepare('DELETE FROM family_members WHERE id = ?').run(id);
}

export function familyMemberExists(id: string): boolean {
  return !!getDb().prepare('SELECT 1 FROM family_members WHERE id = ?').get(id);
}
```

Note: `FamilyMemberCreate` is the same shape as the Zod output: `{ name: string; icon: string }`. Add this type alias to `backend/src/model/types.ts` if not already inferred — or use the Zod type from schemas directly. The repo imports it from `model/types.ts`, so add:

```typescript
export type FamilyMemberCreate = { name: string; icon: string };
```

to `backend/src/model/types.ts` alongside the `FamilyMember` interface.

- [ ] **Step 2: Create the family members routes**

Create `backend/src/routes/familyMembers.ts`:

```typescript
import type { FastifyInstance } from 'fastify';
import { familyMemberCreate } from '../schemas';
import {
  createFamilyMember,
  deleteFamilyMember,
  listFamilyMembers,
  updateFamilyMember,
} from '../repos/familyMembers';
import { broker } from '../realtime';
import { parseBody } from './helpers';

export async function familyMemberRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/family-members', async () => listFamilyMembers());

  app.post('/api/family-members', async (req, reply) => {
    const member = createFamilyMember(parseBody(familyMemberCreate, req.body));
    broker.poke('family-members');
    reply.status(201);
    return member;
  });

  app.put<{ Params: { id: string } }>('/api/family-members/:id', async (req) => {
    const member = updateFamilyMember(req.params.id, parseBody(familyMemberCreate, req.body));
    broker.poke('family-members');
    return member;
  });

  app.delete<{ Params: { id: string } }>('/api/family-members/:id', async (req, reply) => {
    deleteFamilyMember(req.params.id);
    broker.poke('family-members');
    reply.status(204);
  });
}
```

- [ ] **Step 3: Register routes in server.ts**

In `backend/src/server.ts`, add the import and registration:

```typescript
import { familyMemberRoutes } from './routes/familyMembers';
```

Add after the `weatherRoutes` registration:

```typescript
  await app.register(familyMemberRoutes);
```

- [ ] **Step 4: Verify routes work**

```bash
npm run dev:backend &
sleep 2
curl -s -X POST http://localhost:8787/api/family-members \
  -H 'Content-Type: application/json' \
  -d '{"name":"Charlie","icon":"🚀"}' | jq .
curl -s http://localhost:8787/api/family-members | jq .
kill %1
```

Expected: 201 with the member object, then GET returns the array with Charlie.

- [ ] **Step 5: Commit**

```bash
git add backend/src/repos/familyMembers.ts backend/src/routes/familyMembers.ts backend/src/server.ts backend/src/model/types.ts
git commit -m "feat: family members CRUD (repo + routes)"
```

---

## Task 4: Chores repo — CRUD + board computation

**Files:**
- Create: `backend/src/repos/chores.ts`

This is the riskiest code — the board computation. Build it with tests in the next task.

- [ ] **Step 1: Create the chores repo**

Create `backend/src/repos/chores.ts`:

```typescript
import { getDb } from '../db';
import { newId } from '../util/ids';
import { isoUtc } from '../util/time';
import { httpError } from '../util/errors';
import { familyMemberExists } from './familyMembers';
import type { Chore, ChoreCompletion, ChoreBoard, BoardMember, BoardChore } from '../model/types';
import type { ChoreCreate, ChoreUpdate } from '../schemas';

interface ChoreRow {
  id: string;
  title: string;
  icon: string;
  stars: number;
  frequency: string;
  day_of_week: number | null;
  assigned_to: string;
  position: number;
  updated_at: string;
}

const toChore = (r: ChoreRow): Chore => ({
  id: r.id,
  title: r.title,
  icon: r.icon,
  stars: r.stars,
  frequency: r.frequency as 'daily' | 'weekly',
  dayOfWeek: r.day_of_week,
  assignedTo: r.assigned_to,
  position: r.position,
  updatedAt: r.updated_at,
});

const now = () => isoUtc(new Date());

export function listChores(): Chore[] {
  return (getDb().prepare('SELECT * FROM chores ORDER BY assigned_to, position, title').all() as ChoreRow[]).map(toChore);
}

export function getChore(id: string): Chore | null {
  const r = getDb().prepare('SELECT * FROM chores WHERE id = ?').get(id) as ChoreRow | undefined;
  return r ? toChore(r) : null;
}

export function createChore(input: ChoreCreate): Chore {
  const db = getDb();
  if (!familyMemberExists(input.assignedTo)) {
    throw httpError(400, 'INVALID_MEMBER', 'Family member does not exist');
  }
  const id = newId();
  const ts = now();
  db.prepare(
    `INSERT INTO chores (id, title, icon, stars, frequency, day_of_week, assigned_to, position, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, input.title, input.icon, input.stars, input.frequency, input.dayOfWeek ?? null, input.assignedTo, input.position, ts, ts);
  return getChore(id)!;
}

export function updateChore(id: string, patch: ChoreUpdate): Chore {
  const db = getDb();
  const existing = getChore(id);
  if (!existing) throw httpError(404, 'NOT_FOUND', 'Chore not found');
  if (patch.assignedTo && !familyMemberExists(patch.assignedTo)) {
    throw httpError(400, 'INVALID_MEMBER', 'Family member does not exist');
  }
  const next = {
    title: patch.title ?? existing.title,
    icon: patch.icon ?? existing.icon,
    stars: patch.stars ?? existing.stars,
    frequency: patch.frequency ?? existing.frequency,
    dayOfWeek: patch.dayOfWeek !== undefined ? patch.dayOfWeek : existing.dayOfWeek,
    assignedTo: patch.assignedTo ?? existing.assignedTo,
    position: patch.position ?? existing.position,
  };
  db.prepare(
    `UPDATE chores SET title=?, icon=?, stars=?, frequency=?, day_of_week=?, assigned_to=?, position=?, updated_at=?
     WHERE id=?`
  ).run(next.title, next.icon, next.stars, next.frequency, next.dayOfWeek, next.assignedTo, next.position, now(), id);
  return getChore(id)!;
}

export function deleteChore(id: string): void {
  if (!getChore(id)) throw httpError(404, 'NOT_FOUND', 'Chore not found');
  getDb().prepare('DELETE FROM chores WHERE id = ?').run(id);
}

export function completeChore(choreId: string, date: string): { completion: ChoreCompletion; created: boolean } {
  const db = getDb();
  if (!getChore(choreId)) throw httpError(404, 'NOT_FOUND', 'Chore not found');
  const ts = now();
  const info = db.prepare(
    `INSERT INTO chore_completions (chore_id, completed_date, completed_at)
     VALUES (?, ?, ?)
     ON CONFLICT(chore_id, completed_date) DO NOTHING`
  ).run(choreId, date, ts);
  const row = db.prepare(
    'SELECT chore_id, completed_date, completed_at FROM chore_completions WHERE chore_id = ? AND completed_date = ?'
  ).get(choreId, date) as { chore_id: string; completed_date: string; completed_at: string };
  return {
    completion: { choreId: row.chore_id, completedDate: row.completed_date, completedAt: row.completed_at },
    created: info.changes > 0,
  };
}

export function uncompleteChore(choreId: string, date: string): void {
  const info = getDb().prepare(
    'DELETE FROM chore_completions WHERE chore_id = ? AND completed_date = ?'
  ).run(choreId, date);
  if (info.changes === 0) throw httpError(404, 'NOT_FOUND', 'Completion not found');
}

export function getBoard(date: string): ChoreBoard {
  const db = getDb();

  const members = db.prepare('SELECT * FROM family_members ORDER BY name').all() as Array<{
    id: string; name: string; icon: string;
  }>;

  const dueChores = db.prepare(
    `SELECT c.*, cc.completed_date, cc.completed_at
     FROM chores c
     LEFT JOIN chore_completions cc ON cc.chore_id = c.id AND cc.completed_date = ?
     WHERE c.frequency = 'daily'
        OR (c.frequency = 'weekly' AND c.day_of_week = CAST(strftime('%w', ?) AS INTEGER))
     ORDER BY c.assigned_to, c.position, c.title`
  ).all(date, date) as Array<ChoreRow & { completed_date: string | null; completed_at: string | null }>;

  const starTotals = new Map<string, number>();
  const starRows = db.prepare(
    `SELECT c.assigned_to, COALESCE(SUM(c.stars), 0) as total
     FROM chore_completions cc
     JOIN chores c ON cc.chore_id = c.id
     GROUP BY c.assigned_to`
  ).all() as Array<{ assigned_to: string; total: number }>;
  for (const r of starRows) starTotals.set(r.assigned_to, r.total);

  const choresByMember = new Map<string, BoardChore[]>();
  for (const r of dueChores) {
    const list = choresByMember.get(r.assigned_to) ?? [];
    list.push({
      id: r.id,
      title: r.title,
      icon: r.icon,
      stars: r.stars,
      completed: r.completed_date !== null,
      completedAt: r.completed_at,
    });
    choresByMember.set(r.assigned_to, list);
  }

  const boardMembers: BoardMember[] = members.map((m) => ({
    id: m.id,
    name: m.name,
    icon: m.icon,
    totalStars: starTotals.get(m.id) ?? 0,
    chores: choresByMember.get(m.id) ?? [],
  }));

  return { date, members: boardMembers };
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/repos/chores.ts
git commit -m "feat: chores repo with board computation"
```

---

## Task 5: Board computation tests (TDD — the riskiest code)

**Files:**
- Create: `backend/src/repos/chores.test.ts`

- [ ] **Step 1: Write the board computation tests**

Create `backend/src/repos/chores.test.ts`:

```typescript
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { runMigrations } from '../db/migrate';

let db: Database.Database;

function setupTestDb() {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
}

function addMember(name: string, icon: string): string {
  const id = `member-${name}`;
  db.prepare('INSERT INTO family_members (id, name, icon) VALUES (?, ?, ?)').run(id, name, icon);
  return id;
}

function addChore(opts: {
  id?: string; title: string; icon: string; stars?: number;
  frequency?: string; dayOfWeek?: number | null; assignedTo: string; position?: number;
}): string {
  const id = opts.id ?? `chore-${opts.title}-${opts.assignedTo}`;
  db.prepare(
    `INSERT INTO chores (id, title, icon, stars, frequency, day_of_week, assigned_to, position)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, opts.title, opts.icon, opts.stars ?? 1, opts.frequency ?? 'daily', opts.dayOfWeek ?? null, opts.assignedTo, opts.position ?? 0);
  return id;
}

function complete(choreId: string, date: string) {
  db.prepare(
    `INSERT INTO chore_completions (chore_id, completed_date, completed_at) VALUES (?, ?, ?)`
  ).run(choreId, date, '2026-06-02T08:00:00Z');
}

function getBoard(date: string) {
  const members = db.prepare('SELECT * FROM family_members ORDER BY name').all() as Array<{
    id: string; name: string; icon: string;
  }>;
  const dueChores = db.prepare(
    `SELECT c.*, cc.completed_date, cc.completed_at
     FROM chores c
     LEFT JOIN chore_completions cc ON cc.chore_id = c.id AND cc.completed_date = ?
     WHERE c.frequency = 'daily'
        OR (c.frequency = 'weekly' AND c.day_of_week = CAST(strftime('%w', ?) AS INTEGER))
     ORDER BY c.assigned_to, c.position, c.title`
  ).all(date, date) as Array<any>;
  const starRows = db.prepare(
    `SELECT c.assigned_to, COALESCE(SUM(c.stars), 0) as total
     FROM chore_completions cc JOIN chores c ON cc.chore_id = c.id
     GROUP BY c.assigned_to`
  ).all() as Array<{ assigned_to: string; total: number }>;
  const starTotals = new Map(starRows.map((r) => [r.assigned_to, r.total]));
  const choresByMember = new Map<string, any[]>();
  for (const r of dueChores) {
    const list = choresByMember.get(r.assigned_to) ?? [];
    list.push({
      id: r.id, title: r.title, icon: r.icon, stars: r.stars,
      completed: r.completed_date !== null, completedAt: r.completed_at,
    });
    choresByMember.set(r.assigned_to, list);
  }
  return {
    date,
    members: members.map((m) => ({
      id: m.id, name: m.name, icon: m.icon,
      totalStars: starTotals.get(m.id) ?? 0,
      chores: choresByMember.get(m.id) ?? [],
    })),
  };
}

describe('chores board computation', () => {
  before(() => setupTestDb());
  after(() => db.close());

  it('daily chore appears every day', () => {
    const mid = addMember('Alice', '🚀');
    addChore({ title: 'Brush teeth', icon: '🪥', assignedTo: mid });
    const board = getBoard('2026-06-02');
    assert.equal(board.members[0].chores.length, 1);
    assert.equal(board.members[0].chores[0].title, 'Brush teeth');
    assert.equal(board.members[0].chores[0].completed, false);
  });

  it('weekly chore appears only on its day_of_week', () => {
    const mid = addMember('Bob', '🦄');
    // 2026-06-02 is a Tuesday = strftime('%w') = 2
    addChore({ title: 'Clean room', icon: '🧹', frequency: 'weekly', dayOfWeek: 2, assignedTo: mid });
    addChore({ title: 'Laundry', icon: '👕', frequency: 'weekly', dayOfWeek: 5, assignedTo: mid });
    const tuesdayBoard = getBoard('2026-06-02');
    const bobTues = tuesdayBoard.members.find((m) => m.name === 'Bob')!;
    assert.equal(bobTues.chores.length, 1);
    assert.equal(bobTues.chores[0].title, 'Clean room');
    const fridayBoard = getBoard('2026-06-05');
    const bobFri = fridayBoard.members.find((m) => m.name === 'Bob')!;
    assert.equal(bobFri.chores.length, 1);
    assert.equal(bobFri.chores[0].title, 'Laundry');
  });

  it('completed chore shows as completed', () => {
    const mid = addMember('Charlie', '⭐');
    const cid = addChore({ title: 'Make bed', icon: '🛏️', assignedTo: mid });
    complete(cid, '2026-06-02');
    const board = getBoard('2026-06-02');
    const charlie = board.members.find((m) => m.name === 'Charlie')!;
    assert.equal(charlie.chores[0].completed, true);
    assert.equal(charlie.chores[0].completedAt, '2026-06-02T08:00:00Z');
  });

  it('completion on a different date does not show as completed today', () => {
    const mid = addMember('Diana', '🌟');
    const cid = addChore({ title: 'Tidy toys', icon: '🧸', assignedTo: mid });
    complete(cid, '2026-06-01');
    const board = getBoard('2026-06-02');
    const diana = board.members.find((m) => m.name === 'Diana')!;
    assert.equal(diana.chores[0].completed, false);
  });

  it('star total sums correctly across multiple chores and days', () => {
    const mid = addMember('Eve', '🎯');
    const c1 = addChore({ title: 'Task A', icon: '📝', stars: 2, assignedTo: mid });
    const c2 = addChore({ title: 'Task B', icon: '📎', stars: 3, assignedTo: mid });
    complete(c1, '2026-06-01');
    complete(c2, '2026-06-01');
    complete(c1, '2026-06-02');
    const board = getBoard('2026-06-02');
    const eve = board.members.find((m) => m.name === 'Eve')!;
    assert.equal(eve.totalStars, 7); // 2 + 3 + 2
  });

  it('multiple members get their own chores (no cross-contamination)', () => {
    const m1 = addMember('Fay', '🎵');
    const m2 = addMember('Gus', '🎸');
    addChore({ title: 'Fay chore', icon: '🔵', assignedTo: m1 });
    addChore({ title: 'Gus chore', icon: '🔴', assignedTo: m2 });
    const board = getBoard('2026-06-02');
    const fay = board.members.find((m) => m.name === 'Fay')!;
    const gus = board.members.find((m) => m.name === 'Gus')!;
    assert.equal(fay.chores.length, 1);
    assert.equal(fay.chores[0].title, 'Fay chore');
    assert.equal(gus.chores.length, 1);
    assert.equal(gus.chores[0].title, 'Gus chore');
  });

  it('completion is idempotent (composite PK)', () => {
    const mid = addMember('Hal', '🏀');
    const cid = addChore({ title: 'Read', icon: '📖', assignedTo: mid });
    complete(cid, '2026-06-02');
    assert.doesNotThrow(() => {
      db.prepare(
        `INSERT INTO chore_completions (chore_id, completed_date, completed_at) VALUES (?, ?, ?)
         ON CONFLICT(chore_id, completed_date) DO NOTHING`
      ).run(cid, '2026-06-02', '2026-06-02T09:00:00Z');
    });
    const rows = db.prepare('SELECT * FROM chore_completions WHERE chore_id = ? AND completed_date = ?').all(cid, '2026-06-02');
    assert.equal(rows.length, 1);
  });

  it('board for a day with no due chores returns empty chore arrays', () => {
    const mid = addMember('Ivy', '🌺');
    // Weekly chore on Monday (1) — checking a Tuesday (2026-06-02 = Tuesday)
    addChore({ title: 'Monday only', icon: '📅', frequency: 'weekly', dayOfWeek: 1, assignedTo: mid });
    const board = getBoard('2026-06-02');
    const ivy = board.members.find((m) => m.name === 'Ivy')!;
    assert.equal(ivy.chores.length, 0);
  });

  it('deleting a member cascades chores and completions', () => {
    const mid = addMember('Jack', '🎭');
    const cid = addChore({ title: 'Gone chore', icon: '👻', assignedTo: mid });
    complete(cid, '2026-06-02');
    db.prepare('DELETE FROM family_members WHERE id = ?').run(mid);
    const chores = db.prepare('SELECT * FROM chores WHERE assigned_to = ?').all(mid);
    const completions = db.prepare('SELECT * FROM chore_completions WHERE chore_id = ?').all(cid);
    assert.equal(chores.length, 0);
    assert.equal(completions.length, 0);
  });

  it('deleting a chore cascades completions', () => {
    const mid = addMember('Kay', '🦋');
    const cid = addChore({ title: 'Temp chore', icon: '⏳', assignedTo: mid });
    complete(cid, '2026-06-02');
    db.prepare('DELETE FROM chores WHERE id = ?').run(cid);
    const completions = db.prepare('SELECT * FROM chore_completions WHERE chore_id = ?').all(cid);
    assert.equal(completions.length, 0);
  });

  it('DB rejects daily chore with day_of_week set', () => {
    const mid = addMember('Leo', '🦁');
    assert.throws(() => {
      db.prepare(
        `INSERT INTO chores (id, title, icon, stars, frequency, day_of_week, assigned_to, position)
         VALUES ('bad1', 'Bad', '❌', 1, 'daily', 3, ?, 0)`
      ).run(mid);
    });
  });

  it('DB rejects weekly chore without day_of_week', () => {
    const mid = addMember('Mia', '🦊');
    assert.throws(() => {
      db.prepare(
        `INSERT INTO chores (id, title, icon, stars, frequency, day_of_week, assigned_to, position)
         VALUES ('bad2', 'Bad', '❌', 1, 'weekly', NULL, ?, 0)`
      ).run(mid);
    });
  });
});
```

- [ ] **Step 2: Run the tests**

```bash
npm --workspace backend test
```

Expected: all chores board tests pass alongside existing tests.

- [ ] **Step 3: Commit**

```bash
git add backend/src/repos/chores.test.ts
git commit -m "test: board computation truth table (12 cases)"
```

---

## Task 6: Chores routes

**Files:**
- Create: `backend/src/routes/chores.ts`
- Modify: `backend/src/server.ts`

- [ ] **Step 1: Create the chores routes**

Create `backend/src/routes/chores.ts`:

```typescript
import type { FastifyInstance } from 'fastify';
import { choreCreate, choreUpdate, choreCompleteBody, dateParam } from '../schemas';
import {
  listChores,
  getChore,
  createChore,
  updateChore,
  deleteChore,
  completeChore,
  uncompleteChore,
  getBoard,
} from '../repos/chores';
import { httpError } from '../util/errors';
import { broker } from '../realtime';
import { parseBody } from './helpers';
import { DateTime } from 'luxon';

function todayBrisbane(): string {
  return DateTime.now().setZone('Australia/Brisbane').toFormat('yyyy-LL-dd');
}

export async function choreRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/chores', async () => listChores());

  app.get<{ Params: { id: string } }>('/api/chores/:id', async (req) => {
    const chore = getChore(req.params.id);
    if (!chore) throw httpError(404, 'NOT_FOUND', 'Chore not found');
    return chore;
  });

  app.post('/api/chores', async (req, reply) => {
    const chore = createChore(parseBody(choreCreate, req.body));
    broker.poke('chores');
    reply.status(201);
    return chore;
  });

  app.put<{ Params: { id: string } }>('/api/chores/:id', async (req) => {
    const chore = updateChore(req.params.id, parseBody(choreUpdate, req.body));
    broker.poke('chores');
    return chore;
  });

  app.delete<{ Params: { id: string } }>('/api/chores/:id', async (req, reply) => {
    deleteChore(req.params.id);
    broker.poke('chores');
    reply.status(204);
  });

  // Board (read-only, computed)
  app.get('/api/chore-board', async (req) => {
    const query = req.query as { date?: string };
    const date = query.date ? parseBody(dateParam, query.date) : todayBrisbane();
    return getBoard(date);
  });

  // Complete a chore
  app.post<{ Params: { id: string } }>('/api/chores/:id/complete', async (req, reply) => {
    const { date } = parseBody(choreCompleteBody, req.body);
    const { completion, created } = completeChore(req.params.id, date);
    broker.poke('chores');
    reply.status(created ? 201 : 200);
    return completion;
  });

  // Uncomplete a chore (parent undo)
  app.delete<{ Params: { id: string; date: string } }>(
    '/api/chores/:id/complete/:date',
    async (req, reply) => {
      const date = parseBody(dateParam, req.params.date);
      uncompleteChore(req.params.id, date);
      broker.poke('chores');
      reply.status(204);
    }
  );
}
```

- [ ] **Step 2: Register in server.ts**

In `backend/src/server.ts`, add:

```typescript
import { choreRoutes } from './routes/chores';
```

Add after the `familyMemberRoutes` registration:

```typescript
  await app.register(choreRoutes);
```

- [ ] **Step 3: Verify full flow**

```bash
npm run dev:backend &
sleep 2

# Create a member
MID=$(curl -s -X POST http://localhost:8787/api/family-members \
  -H 'Content-Type: application/json' \
  -d '{"name":"Test Kid","icon":"🚀"}' | jq -r .id)

# Create a daily chore
CID=$(curl -s -X POST http://localhost:8787/api/chores \
  -H 'Content-Type: application/json' \
  -d "{\"title\":\"Brush teeth\",\"icon\":\"🪥\",\"stars\":1,\"frequency\":\"daily\",\"assignedTo\":\"$MID\"}" | jq -r .id)

# Get the board
curl -s "http://localhost:8787/api/chore-board?date=2026-06-02" | jq .

# Complete the chore
curl -s -X POST "http://localhost:8787/api/chores/$CID/complete" \
  -H 'Content-Type: application/json' \
  -d '{"date":"2026-06-02"}' | jq .

# Board should show completed
curl -s "http://localhost:8787/api/chore-board?date=2026-06-02" | jq '.members[0].chores[0].completed'

kill %1
```

Expected: board returns member with chore, completion returns 201, board then shows `completed: true`.

- [ ] **Step 4: Commit**

```bash
git add backend/src/routes/chores.ts backend/src/server.ts
git commit -m "feat: chores routes (CRUD, board, complete/uncomplete)"
```

---

## Task 7: Route-level integration tests

**Files:**
- Create: `backend/src/routes/chores.test.ts`
- Create: `backend/src/routes/familyMembers.test.ts`

- [ ] **Step 1: Write family member route tests**

Create `backend/src/routes/familyMembers.test.ts` — test the full HTTP round-trip through the Fastify routes. Follow the pattern from existing route tests (use `app.inject()` for in-process HTTP).

Key test cases:
- POST creates a member (201)
- GET lists members
- PUT updates name/icon
- DELETE returns 204
- POST with duplicate name returns 409
- DELETE cascades (verify via GET /api/chores returning empty for that member)

- [ ] **Step 2: Write chore route tests**

Create `backend/src/routes/chores.test.ts` — test:
- POST creates chore (201)
- GET lists chores
- PUT updates chore
- DELETE returns 204
- POST with invalid member returns 400
- Weekly chore without dayOfWeek returns 400
- GET /api/chore-board returns correct structure
- POST complete returns 201 first time, 200 second time (idempotent)
- DELETE complete returns 204
- DELETE complete on non-existent returns 404

- [ ] **Step 3: Run all tests**

```bash
npm --workspace backend test
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add backend/src/routes/chores.test.ts backend/src/routes/familyMembers.test.ts
git commit -m "test: chores + family members route integration tests"
```

---

## Task 8: Frontend types + API client + hooks

**Files:**
- Modify: `frontend/src/core/model/types.ts`
- Modify: `frontend/src/core/api/client.ts`
- Modify: `frontend/src/core/hooks/useData.ts`
- Modify: `frontend/src/core/hooks/useMutations.ts`
- Modify: `frontend/src/core/hooks/useRealtime.ts`
- Create: `frontend/src/core/hooks/useBrisbaneDate.ts`

- [ ] **Step 1: Add frontend types**

Append to `frontend/src/core/model/types.ts`:

```typescript
export interface FamilyMember {
  id: string;
  name: string;
  icon: string;
  updatedAt: string;
}

export interface Chore {
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

export interface BoardChore {
  id: string;
  title: string;
  icon: string;
  stars: number;
  completed: boolean;
  completedAt: string | null;
}

export interface BoardMember {
  id: string;
  name: string;
  icon: string;
  totalStars: number;
  chores: BoardChore[];
}

export interface ChoreBoard {
  date: string;
  members: BoardMember[];
}

export interface ChoreCompletion {
  choreId: string;
  completedDate: string;
  completedAt: string;
}

export interface FamilyMemberInput {
  name: string;
  icon: string;
}

export interface ChoreInput {
  title: string;
  icon: string;
  stars?: number;
  frequency: 'daily' | 'weekly';
  dayOfWeek?: number | null;
  assignedTo: string;
  position?: number;
}

export type ChoreUpdateInput = Partial<ChoreInput>;
```

Also update the `WallView` type:

```typescript
export type WallView = 'agenda' | 'week' | 'month' | 'chores';
```

- [ ] **Step 2: Add API client methods**

Append to the `api` object in `frontend/src/core/api/client.ts`:

```typescript
  // family members
  familyMembers: () => get<FamilyMember[]>('/api/family-members'),
  createFamilyMember: (body: FamilyMemberInput) => send<FamilyMember>('POST', '/api/family-members', body),
  updateFamilyMember: (id: string, body: FamilyMemberInput) => send<FamilyMember>('PUT', `/api/family-members/${id}`, body),
  deleteFamilyMember: (id: string) => send<void>('DELETE', `/api/family-members/${id}`),

  // chores
  chores: () => get<Chore[]>('/api/chores'),
  createChore: (body: ChoreInput) => send<Chore>('POST', '/api/chores', body),
  updateChore: (id: string, body: ChoreUpdateInput) => send<Chore>('PUT', `/api/chores/${id}`, body),
  deleteChore: (id: string) => send<void>('DELETE', `/api/chores/${id}`),

  // chore board
  choreBoard: (date: string) => get<ChoreBoard>(`/api/chore-board?date=${date}`),
  completeChore: (id: string, date: string) =>
    send<ChoreCompletion>('POST', `/api/chores/${id}/complete`, { date }),
  uncompleteChore: (id: string, date: string) =>
    send<void>('DELETE', `/api/chores/${id}/complete/${date}`),
```

Add the new type imports at the top of the file.

- [ ] **Step 3: Add query hooks**

Append to `frontend/src/core/hooks/useData.ts`:

```typescript
export function useFamilyMembers() {
  return useQuery({
    queryKey: ['family-members'],
    queryFn: api.familyMembers,
    staleTime: 5 * 60_000,
  });
}

export function useChores() {
  return useQuery({
    queryKey: ['chores'],
    queryFn: api.chores,
    staleTime: 5 * 60_000,
  });
}

export function useChoreBoard(date: string) {
  return useQuery({
    queryKey: ['chore-board', date],
    queryFn: () => api.choreBoard(date),
    placeholderData: keepPreviousData,
  });
}
```

Add the type imports as needed.

- [ ] **Step 4: Add mutation hooks**

Append to `frontend/src/core/hooks/useMutations.ts`:

```typescript
export function useFamilyMemberMutations() {
  const qc = useQueryClient();
  const settle = () => {
    void qc.invalidateQueries({ queryKey: ['family-members'] });
    void qc.invalidateQueries({ queryKey: ['chore-board'] });
  };

  const create = useMutation({
    mutationFn: (body: FamilyMemberInput) => api.createFamilyMember(body),
    onSettled: settle,
  });

  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: FamilyMemberInput }) =>
      api.updateFamilyMember(id, body),
    onSettled: settle,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteFamilyMember(id),
    onSettled: settle,
  });

  return { create, update, remove };
}

export function useChoreMutations() {
  const qc = useQueryClient();
  const settle = () => {
    void qc.invalidateQueries({ queryKey: ['chores'] });
    void qc.invalidateQueries({ queryKey: ['chore-board'] });
  };

  const create = useMutation({
    mutationFn: (body: ChoreInput) => api.createChore(body),
    onSettled: settle,
  });

  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: ChoreUpdateInput }) =>
      api.updateChore(id, body),
    onSettled: settle,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteChore(id),
    onSettled: settle,
  });

  return { create, update, remove };
}

export function useChoreCompletion() {
  const qc = useQueryClient();

  const complete = useMutation({
    mutationFn: ({ choreId, date }: { choreId: string; date: string }) =>
      api.completeChore(choreId, date),
    onMutate: async ({ choreId, date }) => {
      await qc.cancelQueries({ queryKey: ['chore-board'] });
      const queries = qc.getQueriesData<ChoreBoard>({ queryKey: ['chore-board'] });
      const rollback = () => queries.forEach(([k, d]) => qc.setQueryData(k, d));

      for (const [key, data] of queries) {
        if (!data) continue;
        qc.setQueryData(key, {
          ...data,
          members: data.members.map((m) => ({
            ...m,
            totalStars: m.totalStars + (m.chores.find((c) => c.id === choreId)?.stars ?? 0),
            chores: m.chores.map((c) =>
              c.id === choreId ? { ...c, completed: true, completedAt: new Date().toISOString() } : c
            ),
          })),
        });
      }
      return { rollback };
    },
    onError: (_e, _v, ctx) => ctx?.rollback(),
    onSettled: () => void qc.invalidateQueries({ queryKey: ['chore-board'] }),
  });

  const uncomplete = useMutation({
    mutationFn: ({ choreId, date }: { choreId: string; date: string }) =>
      api.uncompleteChore(choreId, date),
    onSettled: () => void qc.invalidateQueries({ queryKey: ['chore-board'] }),
  });

  return { complete, uncomplete };
}
```

Add the type imports for `FamilyMemberInput`, `ChoreInput`, `ChoreUpdateInput`, `ChoreBoard` at the top.

- [ ] **Step 5: Extend useRealtime with KIND_TO_KEYS**

In `frontend/src/core/hooks/useRealtime.ts`, replace the poke handler:

```typescript
const KIND_TO_KEYS: Record<string, string[]> = {
  chores: ['chores', 'chore-board'],
  'family-members': ['family-members', 'chore-board'],
};

// inside the useEffect, replace the poke listener:
es.addEventListener('poke', (e) => {
  try {
    const { kind } = JSON.parse((e as MessageEvent).data) as { kind: string };
    const keys = KIND_TO_KEYS[kind];
    if (keys) {
      for (const k of keys) void qc.invalidateQueries({ queryKey: [k] });
    } else {
      void qc.invalidateQueries({ queryKey: [kind] });
    }
  } catch {
    void qc.invalidateQueries();
  }
});
```

- [ ] **Step 6: Create useBrisbaneDate hook**

Create `frontend/src/core/hooks/useBrisbaneDate.ts`:

```typescript
import { useState, useEffect } from 'react';
import { DateTime } from 'luxon';
import { ZONE } from '../util/time';

export function useBrisbaneDate(): string {
  const [date, setDate] = useState(() =>
    DateTime.now().setZone(ZONE).toFormat('yyyy-LL-dd')
  );

  useEffect(() => {
    const tick = () => {
      const now = DateTime.now().setZone(ZONE);
      setDate(now.toFormat('yyyy-LL-dd'));
      const tomorrow = now.plus({ days: 1 }).startOf('day');
      const msUntilMidnight = tomorrow.diff(now).milliseconds + 100;
      return setTimeout(tick, msUntilMidnight);
    };

    const now = DateTime.now().setZone(ZONE);
    const tomorrow = now.plus({ days: 1 }).startOf('day');
    const msUntilMidnight = tomorrow.diff(now).milliseconds + 100;
    const timer = setTimeout(tick, msUntilMidnight);

    return () => clearTimeout(timer);
  }, []);

  return date;
}
```

- [ ] **Step 7: Verify build**

```bash
npm run build
```

Expected: clean build with no type errors.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/core/model/types.ts frontend/src/core/api/client.ts \
  frontend/src/core/hooks/useData.ts frontend/src/core/hooks/useMutations.ts \
  frontend/src/core/hooks/useRealtime.ts frontend/src/core/hooks/useBrisbaneDate.ts
git commit -m "feat: frontend types, API client, query/mutation hooks for chores"
```

---

## Task 9: Wall UI — ChoresBoard + ChoreCard + MemberColumn + animations

**Files:**
- Create: `frontend/src/components/chores/ChoreCard.tsx`
- Create: `frontend/src/components/chores/MemberColumn.tsx`
- Create: `frontend/src/components/chores/StarBurst.tsx`
- Create: `frontend/src/components/chores/useChimeSound.ts`
- Create: `frontend/src/components/chores/ChoresBoard.tsx`

- [ ] **Step 1: Create the chime sound hook**

Create `frontend/src/components/chores/useChimeSound.ts`:

```typescript
import { useCallback, useRef } from 'react';
import { DateTime } from 'luxon';
import { ZONE } from '../../core/util/time';

export function useChimeSound() {
  const ctxRef = useRef<AudioContext | null>(null);

  return useCallback(() => {
    const hour = DateTime.now().setZone(ZONE).hour;
    if (hour >= 20 || hour < 7) return;

    if (!ctxRef.current) ctxRef.current = new AudioContext();
    const ctx = ctxRef.current;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.2);
  }, []);
}
```

- [ ] **Step 2: Create StarBurst animation component**

Create `frontend/src/components/chores/StarBurst.tsx`:

```typescript
import { useEffect, useState } from 'react';

interface StarParticle {
  id: number;
  startX: number;
  startY: number;
  dx: number;
  dy: number;
}

interface Props {
  active: boolean;
  originRef: React.RefObject<HTMLElement | null>;
  targetRef: React.RefObject<HTMLElement | null>;
  count?: number;
}

export function StarBurst({ active, originRef, targetRef, count = 3 }: Props) {
  const [particles, setParticles] = useState<StarParticle[]>([]);

  useEffect(() => {
    if (!active || !originRef.current || !targetRef.current) return;
    const origin = originRef.current.getBoundingClientRect();
    const target = targetRef.current.getBoundingClientRect();
    const cx = origin.left + origin.width / 2;
    const cy = origin.top + origin.height / 2;
    const tx = target.left + target.width / 2;
    const ty = target.top + target.height / 2;

    setParticles(
      Array.from({ length: count }, (_, i) => ({
        id: Date.now() + i,
        startX: cx + (Math.random() - 0.5) * 40,
        startY: cy,
        dx: tx - cx + (Math.random() - 0.5) * 20,
        dy: ty - cy,
      }))
    );
    const timer = setTimeout(() => setParticles([]), 900);
    return () => clearTimeout(timer);
  }, [active, originRef, targetRef, count]);

  return (
    <>
      {particles.map((p) => (
        <span
          key={p.id}
          className="fixed pointer-events-none text-2xl"
          style={{
            left: p.startX,
            top: p.startY,
            animation: 'starFly 0.8s ease-out forwards',
            '--dx': `${p.dx}px`,
            '--dy': `${p.dy}px`,
          } as React.CSSProperties}
        >
          ⭐
        </span>
      ))}
    </>
  );
}
```

Add the `starFly` keyframe to `frontend/src/index.css` (or wherever global styles live):

```css
@keyframes starFly {
  0% { opacity: 1; transform: translate(0, 0) scale(1); }
  100% { opacity: 0; transform: translate(var(--dx), var(--dy)) scale(0.5); }
}
@keyframes counterBounce {
  0% { transform: scale(1); }
  50% { transform: scale(1.2); }
  100% { transform: scale(1); }
}
@keyframes choreCardPop {
  0% { transform: scale(1); }
  30% { transform: scale(1.05); }
  100% { transform: scale(1); }
}
@keyframes confettiFall {
  0% { opacity: 1; transform: translateY(0) rotate(0deg); }
  100% { opacity: 0; transform: translateY(200px) rotate(360deg); }
}
```

- [ ] **Step 3: Create ChoreCard**

Create `frontend/src/components/chores/ChoreCard.tsx`:

```typescript
import { useRef } from 'react';

interface Props {
  id: string;
  title: string;
  icon: string;
  stars: number;
  completed: boolean;
  onComplete: () => void;
  starTargetRef: React.RefObject<HTMLElement | null>;
}

export function ChoreCard({ id, title, icon, stars, completed, onComplete, starTargetRef }: Props) {
  const cardRef = useRef<HTMLButtonElement>(null);

  return (
    <button
      ref={cardRef}
      type="button"
      disabled={completed}
      onClick={completed ? undefined : onComplete}
      className="flex items-center w-full text-left transition-all"
      style={{
        minHeight: 120,
        padding: '16px 20px',
        borderRadius: 16,
        gap: 16,
        border: completed ? '1px solid rgba(34,197,94,0.25)' : '1px solid var(--border)',
        background: completed ? 'rgba(34,197,94,0.12)' : 'var(--surface)',
        opacity: completed ? 0.75 : 1,
        cursor: completed ? 'default' : 'pointer',
        animation: completed ? 'choreCardPop 0.6s ease-out' : undefined,
      }}
    >
      <span style={{ fontSize: 48, lineHeight: 1, flexShrink: 0 }}>{icon}</span>
      <span className="flex-1 min-w-0">
        <span
          className="block font-semibold"
          style={{
            fontSize: 22,
            color: completed ? 'var(--text-muted)' : 'var(--text)',
            textDecoration: completed ? 'line-through' : undefined,
          }}
        >
          {title}
        </span>
      </span>
      <span style={{ fontSize: 20, flexShrink: 0 }}>
        {completed && <span style={{ fontSize: 36, marginRight: 8 }}>✅</span>}
        {'⭐'.repeat(stars)}
      </span>
    </button>
  );
}
```

- [ ] **Step 4: Create MemberColumn**

Create `frontend/src/components/chores/MemberColumn.tsx`:

```typescript
import { useRef } from 'react';
import type { BoardMember } from '../../core/model/types';
import { ChoreCard } from './ChoreCard';

interface Props {
  member: BoardMember;
  onComplete: (choreId: string) => void;
}

export function MemberColumn({ member, onComplete }: Props) {
  const starCountRef = useRef<HTMLDivElement>(null);
  const allDone = member.chores.length > 0 && member.chores.every((c) => c.completed);
  const noChores = member.chores.length === 0;

  return (
    <div className="flex flex-col" style={{ minWidth: 280, flex: 1, padding: '20px 24px' }}>
      {/* Header */}
      <div className="text-center" style={{ marginBottom: 20 }}>
        <span style={{ fontSize: 72, lineHeight: 1, display: 'block' }}>{member.icon}</span>
        <div style={{ fontSize: 18, color: 'var(--text-muted)', marginTop: 4 }}>{member.name}</div>
        <div ref={starCountRef} style={{ fontSize: 22, fontWeight: 700, color: '#fbbf24', marginTop: 4 }}>
          ⭐ {member.totalStars}
        </div>
      </div>

      {/* Chore cards or empty states */}
      {noChores && (
        <div className="flex-1 flex flex-col items-center justify-center text-center" style={{ gap: 8, opacity: 0.6 }}>
          <span style={{ fontSize: 48 }}>😊</span>
          <span style={{ fontSize: 18 }}>No chores today</span>
        </div>
      )}

      {allDone && (
        <div className="flex-1 flex flex-col items-center justify-center text-center" style={{ gap: 12 }}>
          <span style={{ fontSize: 80, animation: 'choreCardPop 1s ease infinite' }}>🎉</span>
          <span style={{ fontSize: 28, fontWeight: 700, color: '#fbbf24' }}>All done!</span>
        </div>
      )}

      {!allDone && !noChores && (
        <div className="flex flex-col" style={{ gap: 8 }}>
          {member.chores.map((chore) => (
            <ChoreCard
              key={chore.id}
              id={chore.id}
              title={chore.title}
              icon={chore.icon}
              stars={chore.stars}
              completed={chore.completed}
              onComplete={() => onComplete(chore.id)}
              starTargetRef={starCountRef}
            />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Create ChoresBoard**

Create `frontend/src/components/chores/ChoresBoard.tsx`:

```typescript
import type { ChoreBoard } from '../../core/model/types';
import { useChoreBoard } from '../../core/hooks/useData';
import { useChoreCompletion } from '../../core/hooks/useMutations';
import { useBrisbaneDate } from '../../core/hooks/useBrisbaneDate';
import { useChimeSound } from './useChimeSound';
import { MemberColumn } from './MemberColumn';

export function ChoresBoard() {
  const date = useBrisbaneDate();
  const boardQ = useChoreBoard(date);
  const { complete } = useChoreCompletion();
  const playChime = useChimeSound();

  const board = boardQ.data;

  const handleComplete = (choreId: string) => {
    playChime();
    complete.mutate({ choreId, date });
  };

  if (!board || board.members.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-center" style={{ gap: 12, flexDirection: 'column' }}>
        <span style={{ fontSize: 64 }}>📱</span>
        <span style={{ fontSize: 22, color: 'var(--text-muted)' }}>Set up family members on your phone</span>
      </div>
    );
  }

  return (
    <div
      className="flex-1 flex overflow-x-auto"
      style={{ borderTop: '1px solid var(--border)' }}
    >
      {board.members.map((member, i) => (
        <div
          key={member.id}
          className="flex"
          style={{
            flex: board.members.length === 1 ? 'none' : 1,
            maxWidth: board.members.length === 1 ? 500 : undefined,
            margin: board.members.length === 1 ? '0 auto' : undefined,
            borderRight: i < board.members.length - 1 ? '1px solid var(--border)' : undefined,
          }}
        >
          <MemberColumn member={member} onComplete={handleComplete} />
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 6: Verify build**

```bash
npm run build
```

Expected: clean build.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/chores/ frontend/src/index.css
git commit -m "feat: wall chores board UI (columns, cards, animations, sound)"
```

---

## Task 10: Wire ChoresBoard into WallLayout + ControlBar

**Files:**
- Modify: `frontend/src/layouts/WallLayout.tsx`
- Modify: `frontend/src/components/controls/ControlBar.tsx`

- [ ] **Step 1: Add chores view to ControlBar**

In `frontend/src/components/controls/ControlBar.tsx`:

Update the `VIEWS` array:

```typescript
const VIEWS: WallView[] = ['agenda', 'week', 'month', 'chores'];
```

In the button render, add the star emoji for the chores button:

```typescript
            {v === 'chores' ? '⭐ Chores' : v}
```

- [ ] **Step 2: Add ChoresBoard to WallLayout**

In `frontend/src/layouts/WallLayout.tsx`, import:

```typescript
import { ChoresBoard } from '../components/chores/ChoresBoard';
```

Replace the view conditional rendering block (the `{view === 'agenda' ? ... : ...}` section) with:

```typescript
      {view === 'chores' ? (
        <ChoresBoard />
      ) : view === 'agenda' ? (
        <AgendaView occurrences={occurrences} categories={cats} now={now} loading={eventsQ.isPending} onTap={onTap} />
      ) : (
        <GridCalendar
          view={view}
          date={anchor.toUTC().toISO()!}
          occurrences={occurrences}
          categories={cats}
          onEventClick={onTap}
        />
      )}
```

Update the `step` function to handle the chores view (no navigation needed — it's always "today"):

```typescript
  const step = (dir: 1 | -1) => {
    if (view === 'chores') return;
    setAnchor((a) =>
      view === 'agenda' ? a.plus({ days: dir }) : view === 'week' ? a.plus({ weeks: dir }) : a.plus({ months: dir })
    );
  };
```

- [ ] **Step 3: Verify build + run**

```bash
npm run build
npm run dev:backend &
npm run dev:frontend &
```

Open `http://localhost:5173?mode=wall` in a browser. Click the ⭐ Chores button. Should show the "Set up family members" empty state.

Use curl to add a member and chore (from Task 6 step 3), then reload to see the board.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/layouts/WallLayout.tsx frontend/src/components/controls/ControlBar.tsx
git commit -m "feat: wire chores board into wall layout + control bar"
```

---

## Task 11: Phone UI — FamilyMemberManager

**Files:**
- Create: `frontend/src/components/manage/FamilyMemberManager.tsx`
- Modify: `frontend/src/layouts/PhoneLayout.tsx`

- [ ] **Step 1: Create FamilyMemberManager**

Create `frontend/src/components/manage/FamilyMemberManager.tsx` following the `CategoryManager.tsx` pattern:

- List of members with emoji icon + name
- Edit button → inline editable name + icon fields
- Delete button → confirm dialog warning about cascade
- "Add member" button at the bottom → inline form with name + icon text input
- Uses `useFamilyMemberMutations()` from the hooks

- [ ] **Step 2: Wire into PhoneLayout**

In `frontend/src/layouts/PhoneLayout.tsx`:

Import the component:
```typescript
import { FamilyMemberManager } from '../components/manage/FamilyMemberManager';
```

Add to the manage tab section (before `<CategoryManager>`):
```typescript
            <FamilyMemberManager />
```

- [ ] **Step 3: Verify on phone layout**

Open `http://localhost:5173` (no `?mode=wall`). Go to the Manage tab. Should see the Family Members section.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/manage/FamilyMemberManager.tsx frontend/src/layouts/PhoneLayout.tsx
git commit -m "feat: phone family member manager"
```

---

## Task 12: Phone UI — ChoreManager

**Files:**
- Create: `frontend/src/components/manage/ChoreManager.tsx`
- Modify: `frontend/src/layouts/PhoneLayout.tsx`

- [ ] **Step 1: Create ChoreManager**

Create `frontend/src/components/manage/ChoreManager.tsx`:

- Grouped by family member (expandable sections with member icon + name as header)
- Each chore shows: icon + title + stars (as ⭐ repeated) + frequency badge
- Add chore button → form with: title, icon, stars (1-5), frequency toggle, day picker (when weekly), member picker
- Edit → same form pre-filled
- Delete → confirm
- Up/down buttons for position reordering
- Day-of-week picker uses Mon-first display, stores 0=Sunday
- Uses `useChoreMutations()`, `useFamilyMembers()`, `useChores()` from hooks

- [ ] **Step 2: Wire into PhoneLayout**

Import and add after `<FamilyMemberManager />` in the manage tab:

```typescript
import { ChoreManager } from '../components/manage/ChoreManager';
```

```typescript
            <ChoreManager />
```

- [ ] **Step 3: End-to-end test on phone**

1. Open phone layout
2. Manage tab → add a family member
3. Add a chore (daily, 2 stars)
4. Add a weekly chore (Friday)
5. Open wall layout → click ⭐ Chores
6. Tap a chore → should animate and complete
7. Verify star count incremented

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/manage/ChoreManager.tsx frontend/src/layouts/PhoneLayout.tsx
git commit -m "feat: phone chore manager"
```

---

## Task 13: Frontend tests

**Files:**
- Create: `frontend/src/components/chores/ChoresBoard.test.tsx`
- Create: `frontend/src/core/hooks/useBrisbaneDate.test.ts`

- [ ] **Step 1: Write useBrisbaneDate test**

Create `frontend/src/core/hooks/useBrisbaneDate.test.ts`:

```typescript
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useBrisbaneDate } from './useBrisbaneDate';

describe('useBrisbaneDate', () => {
  afterEach(() => vi.useRealTimers());

  it('returns current Brisbane date as YYYY-MM-DD', () => {
    const { result } = renderHook(() => useBrisbaneDate());
    expect(result.current).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
```

- [ ] **Step 2: Run frontend tests**

```bash
npm --workspace frontend test
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/chores/ChoresBoard.test.tsx frontend/src/core/hooks/useBrisbaneDate.test.ts
git commit -m "test: frontend chores board + useBrisbaneDate tests"
```

---

## Task 14: Final verification + build

- [ ] **Step 1: Run all backend tests**

```bash
npm --workspace backend test
```

Expected: all pass.

- [ ] **Step 2: Run all frontend tests**

```bash
npm --workspace frontend test
```

Expected: all pass.

- [ ] **Step 3: Clean build**

```bash
npm run build
```

Expected: no errors.

- [ ] **Step 4: Docker build**

```bash
docker compose up -d --build
```

Expected: container starts, all existing features work, chores board accessible.

- [ ] **Step 5: End-to-end manual test**

1. Open phone → Manage → add family member "Kid 1" with 🚀 icon
2. Add a daily chore "Brush teeth" 🪥, 1 star, assigned to Kid 1
3. Add a weekly chore "Clean room" 🧹, 2 stars, assigned to Kid 1, Friday
4. Open wall → ⭐ Chores → see Kid 1's column with "Brush teeth" (daily appears every day)
5. Tap "Brush teeth" → animation plays, star count goes from 0 to 1
6. Verify completed card is non-interactive (tap does nothing)
7. On Friday, "Clean room" should also appear
8. Add a second family member "Kid 2" 🦄 → wall shows two columns
9. SSE test: complete a chore on one browser tab, verify the other tab updates

- [ ] **Step 6: Commit any final fixes**

```bash
git add -A
git commit -m "feat: chores board with star rewards — complete"
```

---

## Task 15: Update CLAUDE.md status

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update the feature inventory and status**

Add to the feature inventory section in CLAUDE.md:

```
- **Chores board** — family members + chores CRUD, daily/weekly frequency, tap-to-complete
  on wall with star-fly animation + chime, optimistic updates, SSE sync, phone management.
  3 new tables (family_members, chores, chore_completions). Tests: backend N + frontend N.
```

Update test counts to reflect the new totals.

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with chores board feature"
```
