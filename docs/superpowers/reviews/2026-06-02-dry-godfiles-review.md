# Whole-codebase DRY + God-files review

**Date:** 2026-06-02
**Scope:** `backend/src/`, `frontend/src/`, cross-cutting boundary
**Base SHA:** `46b8d20` (post-chores-board, pushed to master)

Three parallel review agents covered backend, frontend, and cross-cutting concerns. Findings consolidated and triaged below.

---

## Top priorities (DRY + god files)

### 1. Manage-screen primitives — biggest win
Three managers (CategoryManager, FamilyMemberManager, ChoreManager) open-code the same section header + row + 48×48 icon buttons + inline confirm-delete + inline add-form.

**Action:** Extract to `frontend/src/components/manage/primitives/`:
- `<SectionHeading>` (uppercase, letterSpacing 0.5, fontSize 13)
- `<ManagerRow leading|title|subtitle|actions>`
- `<InlineConfirmDelete>`
- `<InlineAddButton>`

**Impact:** ChoreManager 642 → ~150 lines; FamilyMemberManager 322 → ~80.
**Effort:** M.
**Files:** `CategoryManager.tsx:44-100`, `FamilyMemberManager.tsx:59-238`, `ChoreManager.tsx:110-388`, `PhotoManager.tsx:83`.

### 2. Split `ChoreManager.tsx` (642 lines)
Even after #1, split into `ChoreManager` (list+state) + `ChoreForm` (form, ~230 lines) + `ChoreRow` (row+actions).
**Effort:** S. Do alongside #1.

### 3. Split `EventEditorSheet.tsx` (349 lines)
Extract `EventForm`, `EventRecurrenceField`, `EventDeleteConfirm`. Natural seams: the two delete-confirm blocks (lines 305-346) + recurrence picker (lines 269-299).
**Effort:** S.

### 4. `TogglePill` primitive
Same `active ? var(--accent-weak) : var(--surface)` recipe reimplemented in 6 places:
- `ChoreManager.tsx:540-555` (frequency)
- `ChoreManager.tsx:567-588` (day-of-week)
- `EventEditorSheet.tsx:271-289` (repeat freq)
- `EventEditorSheet.tsx:236-252` (all-day)
- `QuickAddSheet.tsx:100-115` (all-day)
- `CategoryEditorSheet.tsx:120-138` (icon picker)

**Action:** `<TogglePill aria-pressed value …>` + `<TogglePillGroup options>`.
**Effort:** S.

### 5. Backend `now()` + `uniqueOr` to shared util
- `const now = () => isoUtc(new Date())` declared in every repo (`categories.ts:24`, `familyMembers.ts:23`, `chores.ts:40`).
- `uniqueOr(e, msg)` byte-identical in `categories.ts:97` and `familyMembers.ts:76`.

**Action:** Lift `now` → `util/time.ts` (export `nowIso()`); lift `uniqueOr` → `util/errors.ts` (export `mapUniqueViolation`).
**Effort:** XS, mechanical.

### 6. Backend `registerCrud` helper
Four route files repeat the same 4-handler shape: `GET list / POST 201+poke / PUT 200+poke / DELETE 204+poke`. ~20 lines × 4 files of structural duplication.

**Action:** `registerCrud(app, { prefix, channel, schemas, repo })`. Sub-resources (`/occurrences/:date`, `/complete`) stay bespoke per route.
**Files:** `routes/categories.ts`, `routes/familyMembers.ts`, `routes/events.ts`, `routes/chores.ts`.
**Effort:** M.

### 7. Test bootstrap helper
`routes/familyMembers.test.ts:1-48` and `routes/chores.test.ts:1-63` (+ `repos/chores.test.ts:17-23`) repeat the `mkdtemp` + `process.env.DATA_DIR` + dynamic-import + mirrored-error-handler ritual.

**Action:** Lift into `backend/src/test/util/bootstrap.ts` exporting `createTestApp(...routeFactories)` and `setupIsolatedDb()`. The mirrored error handler (~10 lines) is the worst offender.
**Effort:** S. Will de-risk the next route test.

### 8. Optimistic-rollback DRY
`patchEventQueries` (`useMutations.ts:16-27`) already exists, but `useChoreCompletion` re-implements the same `getQueriesData → for-loop setQueryData → rollback closure` shape at `useMutations.ts:215-248`.

**Action:** Generalize to `optimisticPatch(qc, key, fn)` and use from both event and chore-board mutations.
**Effort:** S.

---

## Real bugs surfaced incidentally

These aren't DRY but the reviewers caught them; worth their own fixes:

- **Frontend missing `maxLength` on TextInputs.** Backend Zod caps (title 256, name 64, icon 16, location 256) aren't enforced client-side → long input fails with generic 400. Apply `maxLength` in `EventEditorSheet`, `CategoryEditorSheet`, `FamilyMemberManager`, `ChoreManager`.

- **Frontend allows blank icon submission.** `MemberForm.canSave` and `ChoreForm.canSave` only check title/name + assignedTo; icon can be empty whitespace → silent 400. Add to both `canSave` checks.

- **`ChoreManager.move` second mutation has no `onError`** (`ChoreManager.tsx:91-101`). If PUT 1 succeeds and PUT 2 fails, duplicate positions silently. Either chain via `onSuccess` or add server-side swap endpoint.

- **`QuickAddSheet` doesn't update `defaultDate` on reopen** (`QuickAddSheet.tsx:31`). `useState` captures initial value at first render; reopening with a different date silently keeps stale value. Either key the component on `defaultDate` or unmount at layout level (EventEditorSheet does this).

- **`BRISBANE_OFFSET_MS` silently encodes "no DST" assumption** (`backend/src/util/time.ts`). Frontend Luxon uses `'Australia/Brisbane'` which would auto-switch if Brisbane ever adopted DST; backend wouldn't. Result: 1-hour skew between server `todayBrisbane()` and frontend `useBrisbaneDate()`. Add a comment on the constant.

---

## Cross-cutting recommendation: lightweight `packages/shared`

**Types + constraint constants only, not Zod.** Extract ~150 lines of mirrored types plus exported constants:

```ts
export const EVENT_TITLE_MAX = 256;
export const NAME_MAX = 64;
export const ICON_MAX = 16;
export const ICON_MIN = 1;
export const STARS_MIN = 1;
export const STARS_MAX = 5;
```

Frontend imports constants to apply `maxLength` / `required` without importing Zod. Closes the silent-400 bug cases above with ~30 lines of shared code + one tsc/Vite path alias.

**Don't share Zod itself** — full shared validation isn't worth it for a LAN two-workspace project where the boundary is one fetch wrapper.

---

## Suspect patterns (lower priority)

### Backend
- `err: any` in `photos.ts:140,153,165` — only place using `any`. Use `NodeJS.ErrnoException` or `unknown` + type guard.
- Silent catch in `listOccurrences` (`repos/events.ts:78-82`) — intentional but truly silent; add `app.log.warn` for observability.
- `routes/backup.ts:42-45` builds error envelope by hand instead of throwing via `httpError`.
- `schemas.ts:65` has `366 * 86_400_000` inline; reuse `DAY_MS` from `util/time.ts`.

### Frontend
- **`Sheet.tsx:19` mutates `onCloseRef.current = onClose` outside an effect** (runs during render). Idiomatic React would wrap in `useEffect` or use `useCallback`.
- **`EventEditorSheet`** `if (!open) return null` sits *after* hooks (line 27); currently safe but fragile.
- **`PhotoManager.refetch()`** after `Promise.allSettled` can fail silently — no surfaced error UI.
- Inline-style numerics (`fontSize: 13/14/15/16/18`, `padding: '10px 12px'`) scattered everywhere. Worth adding `--space-*` and `--font-*` CSS tokens.

---

## God files / functions

| File | Lines | Notes |
|------|-------|-------|
| `frontend/src/components/manage/ChoreManager.tsx` | 642 | 5 concerns tangled — split per #2 |
| `frontend/src/components/sheets/EventEditorSheet.tsx` | 349 | EventForm + recurrence + delete-confirm — split per #3 |
| `frontend/src/components/manage/FamilyMemberManager.tsx` | 322 | Same shape as ChoreManager; collapses with #1 |
| `frontend/src/layouts/WallLayout.tsx` | 179 | Borderline; coordinate mutually-exclusive overlays into `useOverlayState` reducer. Not urgent. |

No backend god files. Largest backend production file is `repos/chores.ts` (233), cohesive (CRUD + completions + getBoard), 55-line `getBoard` is one SQL aggregation — leave.

---

## Leave alone

- Per-repo `Row → toX` mapper (trust boundary between snake_case SQL and camelCase domain — duplication is signal, not noise).
- Per-table INSERT/UPDATE strings (query-builder costs more than it saves at this scale).
- CommonJS backend + ESM frontend split (locked per CLAUDE.md).
- Frontend no-Zod policy (locked per CLAUDE.md).
- DinnerEditorSheet (too small to abstract).
- `categoryExists` / `familyMemberExists` duplication (only 2 instances; threshold is 3).
- Two visual systems (Tailwind + inline styles with CSS vars) — project convention.

---

## Suggested batching

| PR | Effort | Contents |
|----|--------|----------|
| **PR 1** | XS-S | #5 `now`/`uniqueOr` lift + bug fixes (`maxLength`, blank icon, BRISBANE_OFFSET_MS comment, ChoreManager.move chaining) |
| **PR 2** | M | #1 manage primitives + #2 ChoreManager split + #4 TogglePill |
| **PR 3** | M | #6 `registerCrud` + #7 test bootstrap |
| **PR 4** | S | #3 EventEditorSheet split + #8 optimisticPatch |
| **PR 5** | M-L | `packages/shared` types + constants (only if a 3rd workspace consumer is on the roadmap) |

Each PR ships independently. PR 1 is the cheapest big-clarity gain. PR 2 is the biggest single-PR impact.
