# P1 — Slot-tap / drag creation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tap or drag directly on the wall's week/month calendar slots to create events via one unified Quick Add form with inline category chips, retiring the two-step AddChooser.

**Architecture:** FullCalendar's already-loaded interaction plugin gains `selectable`/`selectMirror`; a pure mapper (`slotSelection.ts`) converts FC selections to prefill data and a pure builder (`quickAddPayload.ts`) converts form drafts to `POST /api/events` bodies — both fully unit-tested. `QuickAddSheet` becomes a thin `Sheet` shell around a new reusable `EventQuickAddForm` (the desktop popover reuses it in P3). Spec: `docs/superpowers/specs/2026-06-11-ui-slot-create-voice-desktop-design.md`.

**Tech Stack:** React 18 + TS (ESM), FullCalendar 6 (MIT plugins), luxon, TanStack Query, vitest (pure-function tests only — no DOM test lib in this repo).

**Branch:** `feat/calendar-ui-v2`

**Conscious deviation from spec wording:** the spec says the Dinner chip "swaps the form body to the dinner editor's meal field". `DinnerEditorSheet` already owns meal entry + week strip + suggestions; duplicating its body inside Quick Add violates DRY. Instead, picking the Dinner chip closes Quick Add and opens `DinnerEditorSheet` prefilled with the selected date — functionally identical, zero duplication.

**House rules that bind every task:** immutable state updates, files small and focused, comments explain WHY only, no `console.log`, locale `en-au`, all stored timestamps UTC ISO (Brisbane only at display).

---

### Task 1: Slot-selection mapper (pure logic)

**Files:**
- Create: `frontend/src/components/calendar/slotSelection.ts`
- Test: `frontend/src/components/calendar/slotSelection.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// frontend/src/components/calendar/slotSelection.test.ts
import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import { mapSlotSelection, defaultSlot } from './slotSelection';
import { ZONE } from '../../core/util/time';

// FC hands us local JS Dates; the kiosk/desktop browser runs in Brisbane.
const bne = (iso: string) => DateTime.fromISO(iso, { zone: ZONE }).toJSDate();
const NOW = DateTime.fromISO('2026-06-11T09:10:00', { zone: ZONE });

describe('mapSlotSelection — week (timeGrid)', () => {
  it('widens a bare 30-min tap to a 1-hour draft', () => {
    expect(
      mapSlotSelection({ start: bne('2026-06-11T14:00:00'), end: bne('2026-06-11T14:30:00'), allDay: false }, NOW),
    ).toEqual({ date: '2026-06-11', time: '14:00', endTime: '15:00', allDay: false });
  });

  it('keeps an explicit drag range exactly', () => {
    expect(
      mapSlotSelection({ start: bne('2026-06-11T14:00:00'), end: bne('2026-06-11T16:00:00'), allDay: false }, NOW),
    ).toEqual({ date: '2026-06-11', time: '14:00', endTime: '16:00', allDay: false });
  });

  it('widening a 23:30 tap rolls endTime past midnight', () => {
    expect(
      mapSlotSelection({ start: bne('2026-06-11T23:30:00'), end: bne('2026-06-12T00:00:00'), allDay: false }, NOW),
    ).toEqual({ date: '2026-06-11', time: '23:30', endTime: '00:30', allDay: false });
  });
});

describe('mapSlotSelection — month (dayGrid)', () => {
  it('single day tap → timed draft at next half-hour on that day', () => {
    // NOW is 09:10 → nextHalfHour is 09:30
    expect(
      mapSlotSelection({ start: bne('2026-06-20T00:00:00'), end: bne('2026-06-21T00:00:00'), allDay: true }, NOW),
    ).toEqual({ date: '2026-06-20', time: '09:30', endTime: '10:30', allDay: false });
  });

  it('multi-day drag → all-day range (FC end is exclusive)', () => {
    expect(
      mapSlotSelection({ start: bne('2026-06-20T00:00:00'), end: bne('2026-06-23T00:00:00'), allDay: true }, NOW),
    ).toEqual({ date: '2026-06-20', endDate: '2026-06-22', allDay: true });
  });
});

describe('defaultSlot', () => {
  it('today at next half-hour, 1h duration (the + button path)', () => {
    expect(defaultSlot(NOW)).toEqual({ date: '2026-06-11', time: '09:30', endTime: '10:30', allDay: false });
  });

  it('rolls 09:40 up to 10:00', () => {
    expect(defaultSlot(DateTime.fromISO('2026-06-11T09:40:00', { zone: ZONE }))).toEqual({
      date: '2026-06-11', time: '10:00', endTime: '11:00', allDay: false,
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/components/calendar/slotSelection.test.ts`
Expected: FAIL — `Cannot find module './slotSelection'`

- [ ] **Step 3: Write the implementation**

```ts
// frontend/src/components/calendar/slotSelection.ts
import { DateTime } from 'luxon';
import { nextHalfHour, ZONE } from '../../core/util/time';

/** Prefill produced by tapping/dragging a calendar slot (all values Brisbane-local). */
export interface SlotSelection {
  date: string; // yyyy-LL-dd
  time?: string; // HH:mm — absent for all-day
  endTime?: string; // HH:mm
  endDate?: string; // yyyy-LL-dd — multi-day all-day ranges only
  allDay: boolean;
}

/** The subset of FullCalendar's DateSelectArg we consume (keeps tests FC-free). */
export interface FcSelectLike {
  start: Date;
  end: Date;
  allDay: boolean;
}

const DRAFT_MINUTES = 60;

/** FC selection → Quick Add prefill. Bare timeGrid taps select one 30-min slot,
 *  so anything shorter than the 1h draft is widened; real drags keep their range.
 *  dayGrid single-day taps become timed drafts (all-day is one toggle away). */
export function mapSlotSelection(sel: FcSelectLike, now: DateTime): SlotSelection {
  const start = DateTime.fromJSDate(sel.start).setZone(ZONE);
  const end = DateTime.fromJSDate(sel.end).setZone(ZONE);

  if (!sel.allDay) {
    const minutes = end.diff(start, 'minutes').minutes;
    const finalEnd = minutes < DRAFT_MINUTES ? start.plus({ minutes: DRAFT_MINUTES }) : end;
    return {
      date: start.toFormat('yyyy-LL-dd'),
      time: start.toFormat('HH:mm'),
      endTime: finalEnd.toFormat('HH:mm'),
      allDay: false,
    };
  }

  const lastDay = end.minus({ days: 1 }); // FC all-day end is exclusive
  if (!start.hasSame(lastDay, 'day')) {
    return { date: start.toFormat('yyyy-LL-dd'), endDate: lastDay.toFormat('yyyy-LL-dd'), allDay: true };
  }
  const t = nextHalfHour(now.setZone(ZONE));
  return {
    date: start.toFormat('yyyy-LL-dd'),
    time: t.toFormat('HH:mm'),
    endTime: t.plus({ hours: 1 }).toFormat('HH:mm'),
    allDay: false,
  };
}

/** Prefill for slot-less entry points (ControlBar +, phone FAB). */
export function defaultSlot(now: DateTime): SlotSelection {
  const t = nextHalfHour(now.setZone(ZONE));
  return {
    date: now.setZone(ZONE).toFormat('yyyy-LL-dd'),
    time: t.toFormat('HH:mm'),
    endTime: t.plus({ hours: 1 }).toFormat('HH:mm'),
    allDay: false,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/components/calendar/slotSelection.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/calendar/slotSelection.ts frontend/src/components/calendar/slotSelection.test.ts
git commit -m "feat: pure mapper from FullCalendar selections to quick-add prefill"
```

---

### Task 2: Quick-add payload builder (pure logic)

**Files:**
- Create: `frontend/src/components/sheets/quickAddPayload.ts`
- Test: `frontend/src/components/sheets/quickAddPayload.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// frontend/src/components/sheets/quickAddPayload.test.ts
import { describe, it, expect } from 'vitest';
import { buildQuickAddPayload } from './quickAddPayload';

const base = {
  categoryId: 'cat-family',
  title: 'Soccer practice',
  date: '2026-06-11',
  time: '14:00',
  endTime: '16:00',
  allDay: false,
};

describe('buildQuickAddPayload', () => {
  it('timed event → UTC ISO start/end (Brisbane is UTC+10)', () => {
    expect(buildQuickAddPayload(base)).toEqual({
      categoryId: 'cat-family',
      title: 'Soccer practice',
      start: '2026-06-11T04:00:00Z',
      end: '2026-06-11T06:00:00Z',
      allDay: false,
    });
  });

  it('trims the title', () => {
    expect(buildQuickAddPayload({ ...base, title: '  Soccer  ' })?.title).toBe('Soccer');
  });

  it('end at/before start rolls end to the next day (23:30 → 00:30)', () => {
    const p = buildQuickAddPayload({ ...base, time: '23:30', endTime: '00:30' });
    expect(p?.start).toBe('2026-06-11T13:30:00Z');
    expect(p?.end).toBe('2026-06-11T14:30:00Z'); // 00:30 on 12 Jun Brisbane
  });

  it('all-day single date → bare dates', () => {
    expect(buildQuickAddPayload({ ...base, allDay: true })).toEqual({
      categoryId: 'cat-family',
      title: 'Soccer practice',
      start: '2026-06-11',
      end: '2026-06-11',
      allDay: true,
    });
  });

  it('all-day multi-day range uses endDate', () => {
    expect(buildQuickAddPayload({ ...base, allDay: true, endDate: '2026-06-13' })?.end).toBe('2026-06-13');
  });

  it('returns null without a title or category', () => {
    expect(buildQuickAddPayload({ ...base, title: '   ' })).toBeNull();
    expect(buildQuickAddPayload({ ...base, categoryId: '' })).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/components/sheets/quickAddPayload.test.ts`
Expected: FAIL — `Cannot find module './quickAddPayload'`

- [ ] **Step 3: Write the implementation**

```ts
// frontend/src/components/sheets/quickAddPayload.ts
import { DateTime } from 'luxon';
import { ZONE } from '../../core/util/time';
import type { EventCreateInput } from '../../core/model/types';

/** Everything the unified Quick Add form holds; Brisbane-local values. */
export interface QuickAddDraft {
  categoryId: string;
  title: string;
  date: string; // yyyy-LL-dd
  time: string; // HH:mm — ignored when allDay
  endTime: string; // HH:mm — ignored when allDay
  endDate?: string; // multi-day all-day only
  allDay: boolean;
}

/** Draft → POST /api/events body, or null when not yet submittable. */
export function buildQuickAddPayload(d: QuickAddDraft): EventCreateInput | null {
  const title = d.title.trim();
  if (!title || !d.categoryId) return null;

  if (d.allDay) {
    return { categoryId: d.categoryId, title, start: d.date, end: d.endDate ?? d.date, allDay: true };
  }

  const startLocal = DateTime.fromISO(`${d.date}T${d.time}`, { zone: ZONE });
  let endLocal = DateTime.fromISO(`${d.date}T${d.endTime}`, { zone: ZONE });
  // A drag can't produce end <= start, but manual time edits can; treat it as
  // crossing midnight rather than rejecting (matches user intent for 23:30→00:30).
  if (endLocal <= startLocal) endLocal = endLocal.plus({ days: 1 });

  return {
    categoryId: d.categoryId,
    title,
    start: startLocal.toUTC().toISO({ suppressMilliseconds: true })!,
    end: endLocal.toUTC().toISO({ suppressMilliseconds: true })!,
    allDay: false,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/components/sheets/quickAddPayload.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/sheets/quickAddPayload.ts frontend/src/components/sheets/quickAddPayload.test.ts
git commit -m "feat: pure builder from quick-add drafts to event create payloads"
```

---

### Task 3: GridCalendar gains slot selection

**Files:**
- Modify: `frontend/src/components/calendar/GridCalendar.tsx`

No new unit test (DOM component; this repo tests pure logic only). Verified by `tsc` build here and manually in Task 7.

- [ ] **Step 1: Replace the component with the selectable version**

```tsx
// frontend/src/components/calendar/GridCalendar.tsx
import { useEffect, useMemo, useRef } from 'react';
import FullCalendar from '@fullcalendar/react';
import type { EventInput } from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import type { Category, EventOccurrence } from '../../core/model/types';
import { nowBne } from '../../core/util/time';
import { makeRenderChip } from './renderChip';
import { mapSlotSelection, type SlotSelection } from './slotSelection';

interface Props {
  view: 'week' | 'month';
  date: string; // ISO date for the FC instance
  occurrences: EventOccurrence[];
  categories: Map<string, Category>;
  onEventClick?: (occ: EventOccurrence) => void;
  /** Enables tap/drag-to-create. Absent → grid is read-only as before. */
  onSlotSelect?: (sel: SlotSelection) => void;
  /** Keep FC's selection highlight while the create form is open; flipping
   *  back to false clears the ghost. */
  selectionOpen?: boolean;
}

/** FullCalendar week (timeGrid) / month (dayGrid). MIT plugins only.
 *  Built-in toolbar disabled — nav is driven by our ControlBar. */
export function GridCalendar({ view, date, occurrences, categories, onEventClick, onSlotSelect, selectionOpen }: Props) {
  const calRef = useRef<FullCalendar>(null);

  const events: EventInput[] = useMemo(
    () =>
      occurrences.map((o) => ({
        id: o.id,
        title: o.title,
        start: o.start,
        end: o.end,
        allDay: o.allDay,
        extendedProps: { categoryId: o.categoryId, occ: o },
      })),
    [occurrences]
  );
  const renderChip = useMemo(() => makeRenderChip(categories), [categories]);

  // unselectAuto is off so the ghost survives the sheet opening; we clear it
  // ourselves when the form closes.
  useEffect(() => {
    if (!selectionOpen) calRef.current?.getApi().unselect();
  }, [selectionOpen]);

  return (
    <div className="flex-1 overflow-hidden" style={{ padding: '12px 16px' }}>
      <FullCalendar
        ref={calRef}
        key={`${view}-${date}`}
        plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
        initialView={view === 'week' ? 'timeGridWeek' : 'dayGridMonth'}
        initialDate={date}
        headerToolbar={false}
        locale="en-au"
        firstDay={1}
        height="100%"
        expandRows
        nowIndicator
        allDaySlot
        slotMinTime="06:00:00"
        slotMaxTime="22:00:00"
        dayMaxEvents={3}
        fixedWeekCount={false}
        selectable={!!onSlotSelect}
        selectMirror
        unselectAuto={false}
        selectLongPressDelay={250}
        events={events}
        eventContent={renderChip}
        eventClick={(arg) => onEventClick?.(arg.event.extendedProps.occ as EventOccurrence)}
        select={(arg) => onSlotSelect?.(mapSlotSelection(arg, nowBne()))}
      />
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: clean (no errors)

- [ ] **Step 3: Run the full frontend suite (no regressions)**

Run: `cd frontend && npx vitest run`
Expected: all tests pass (33 existing + 13 from Tasks 1–2)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/calendar/GridCalendar.tsx
git commit -m "feat: selectable slots with drag mirror in GridCalendar"
```

---

### Task 4: EventQuickAddForm + QuickAddSheet shell

**Files:**
- Create: `frontend/src/components/sheets/EventQuickAddForm.tsx`
- Modify: `frontend/src/components/sheets/QuickAddSheet.tsx` (full rewrite)

The form is shell-agnostic so the P3 desktop popover can host it unchanged. `CategoryPicker` from `fields.tsx` is reused for the chip row (it already has the colours/icons/touch targets).

- [ ] **Step 1: Create the form component**

```tsx
// frontend/src/components/sheets/EventQuickAddForm.tsx
import { useState } from 'react';
import type { Category, EventCreateInput } from '../../core/model/types';
import type { SlotSelection } from '../calendar/slotSelection';
import { buildQuickAddPayload, type QuickAddDraft } from './quickAddPayload';
import { Button } from '../primitives/Button';
import { CategoryPicker, Field, TextInput } from './fields';
import { TogglePill } from '../ui/TogglePill';

const DINNER_CATEGORY_ID = 'cat-dinner';

interface Props {
  categories: Category[]; // full list — dinner is rendered as a chip too
  slot: SlotSelection;
  onSubmit: (body: EventCreateInput) => void;
  /** Dinner chip tapped — host closes this form and opens the dinner editor. */
  onDinner: (date: string) => void;
  onCancel: () => void;
}

/** The one create form: inline category chips, prefilled when from a slot.
 *  Hosted by QuickAddSheet (wall/phone) and the desktop popover (P3). */
export function EventQuickAddForm({ categories, slot, onSubmit, onDinner, onCancel }: Props) {
  const eventCats = categories.filter((c) => c.id !== DINNER_CATEGORY_ID);
  const [draft, setDraft] = useState<QuickAddDraft>({
    categoryId: eventCats[0]?.id ?? '',
    title: '',
    date: slot.date,
    time: slot.time ?? '09:00',
    endTime: slot.endTime ?? '10:00',
    endDate: slot.endDate,
    allDay: slot.allDay,
  });

  const patch = (p: Partial<QuickAddDraft>) => setDraft((d) => ({ ...d, ...p }));

  const payload = buildQuickAddPayload(draft);
  const submit = () => payload && onSubmit(payload);

  const pickCategory = (id: string) => {
    if (id === DINNER_CATEGORY_ID) onDinner(draft.date);
    else patch({ categoryId: id });
  };

  return (
    <>
      <Field label="Category">
        <CategoryPicker categories={categories} value={draft.categoryId} onChange={pickCategory} />
      </Field>

      <Field label="Title">
        <TextInput
          value={draft.title}
          onChange={(e) => patch({ title: e.target.value })}
          placeholder="What's happening?"
          autoFocus
          maxLength={256}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
      </Field>

      <Field label="When">
        <div className="flex flex-wrap items-center gap-2">
          <TextInput type="date" value={draft.date} onChange={(e) => patch({ date: e.target.value })} style={{ width: 'auto', flex: '1 1 150px' }} />
          {!draft.allDay && (
            <>
              <TextInput type="time" value={draft.time} onChange={(e) => patch({ time: e.target.value })} style={{ width: 'auto', flex: '0 1 110px' }} />
              <TextInput type="time" value={draft.endTime} onChange={(e) => patch({ endTime: e.target.value })} aria-label="End time" style={{ width: 'auto', flex: '0 1 110px' }} />
            </>
          )}
          {draft.allDay && draft.endDate && (
            <TextInput type="date" value={draft.endDate} onChange={(e) => patch({ endDate: e.target.value })} aria-label="End date" style={{ width: 'auto', flex: '1 1 150px' }} />
          )}
          <TogglePill active={draft.allDay} onClick={() => patch({ allDay: !draft.allDay })} style={{ minHeight: 46, padding: '0 14px' }}>
            All day
          </TogglePill>
        </div>
      </Field>

      <div className="flex justify-end gap-2" style={{ marginTop: 8 }}>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" onClick={submit} disabled={!payload}>
          Add
        </Button>
      </div>
    </>
  );
}
```

- [ ] **Step 2: Rewrite QuickAddSheet as a thin shell**

```tsx
// frontend/src/components/sheets/QuickAddSheet.tsx
import type { Category } from '../../core/model/types';
import type { SlotSelection } from '../calendar/slotSelection';
import { useEventMutations } from '../../core/hooks/useMutations';
import { Sheet } from './Sheet';
import { EventQuickAddForm } from './EventQuickAddForm';

interface Props {
  open: boolean;
  onClose: () => void;
  categories: Category[];
  /** Prefill from a grid tap/drag or defaultSlot() for the +/FAB path. */
  slot: SlotSelection | null;
  /** Dinner chip tapped — host swaps to the DinnerEditorSheet for this date. */
  onDinner: (date: string) => void;
}

/** Wall/phone shell for the unified create form (desktop gets a popover in P3). */
export function QuickAddSheet({ open, onClose, categories, slot, onDinner }: Props) {
  const { create } = useEventMutations();

  if (!open || !slot) return null;

  return (
    <Sheet open onClose={onClose} title="Quick add">
      <EventQuickAddForm
        key={`${slot.date}-${slot.time ?? 'allday'}`}
        categories={categories}
        slot={slot}
        onSubmit={(body) => {
          create.mutate(body);
          onClose();
        }}
        onDinner={onDinner}
        onCancel={onClose}
      />
    </Sheet>
  );
}
```

- [ ] **Step 3: Type-check (expect WallLayout errors — fixed next task)**

Run: `cd frontend && npx tsc --noEmit`
Expected: errors ONLY in `WallLayout.tsx` (old `defaultCategoryId`/`defaultDate` props gone). Anything else: fix before continuing.

- [ ] **Step 4: Commit (WallLayout fix lands with Task 5; commit is intentionally form-only)**

```bash
git add frontend/src/components/sheets/EventQuickAddForm.tsx frontend/src/components/sheets/QuickAddSheet.tsx
git commit -m "feat: unified quick-add form with inline category chips"
```

---

### Task 5: Wire the wall — slot taps in, AddChooser out

**Files:**
- Modify: `frontend/src/layouts/WallLayout.tsx`
- Delete: `frontend/src/components/controls/AddChooser.tsx`

- [ ] **Step 1: Update WallLayout**

In `frontend/src/layouts/WallLayout.tsx`:

1. Replace the imports of `AddChooser` with the new pieces:

```tsx
// remove:
import { AddChooser } from '../components/controls/AddChooser';
// add:
import { defaultSlot, type SlotSelection } from '../components/calendar/slotSelection';
```

(`QuickAddSheet`, `nowBne`, `toInputDate` imports already exist.)

2. Replace the chooser/category state (lines around `const [chooserOpen, …]`):

```tsx
// remove:
const [chooserOpen, setChooserOpen] = useState(false);
const [quickAddCategoryId, setQuickAddCategoryId] = useState<string | null>(null);
// add:
const [slotTarget, setSlotTarget] = useState<SlotSelection | null>(null);
```

3. Update `dismissAll`:

```tsx
const dismissAll = () => {
  setSlotTarget(null);
  setDinnerDate(null);
  setDetailDate(null);
};
```

4. Replace `openChooser` with:

```tsx
const openQuickAdd = (slot: SlotSelection) => {
  dismissAll();
  setSlotTarget(slot);
};
```

5. `ControlBar` prop: `onQuickAdd={() => openQuickAdd(defaultSlot(nowBne()))}`.

6. `GridCalendar` call gains the selection props:

```tsx
<GridCalendar
  view={view}
  date={anchor.toUTC().toISO()!}
  occurrences={occurrences}
  categories={cats}
  onEventClick={onTap}
  onSlotSelect={openQuickAdd}
  selectionOpen={slotTarget !== null}
/>
```

7. Replace the `<AddChooser …/>` block and the old `<QuickAddSheet …/>` block with:

```tsx
<QuickAddSheet
  open={slotTarget !== null}
  onClose={() => setSlotTarget(null)}
  categories={categoriesQ.data ?? []}
  slot={slotTarget}
  onDinner={(date) => {
    dismissAll();
    setDinnerDate(date);
  }}
/>
```

8. Delete the now-unused `todayStr` line (`const todayStr = toInputDate(...)`) and, if `toInputDate` is then unused, drop it from the time-util import.

- [ ] **Step 2: Delete AddChooser**

```bash
rm frontend/src/components/controls/AddChooser.tsx
```

(Nothing else imports it; `grep -r "AddChooser" frontend/src` must come back empty.)

- [ ] **Step 3: Type-check + full suite**

Run: `cd frontend && npx tsc --noEmit && npx vitest run`
Expected: clean build, all tests pass

- [ ] **Step 4: Commit**

```bash
git add frontend/src/layouts/WallLayout.tsx
git rm frontend/src/components/controls/AddChooser.tsx
git commit -m "feat: wall slot-tap/drag creates events; retire AddChooser"
```

---

### Task 6: Phone FAB opens the unified form

**Files:**
- Modify: `frontend/src/layouts/PhoneLayout.tsx`

Phone's agenda/week FAB currently opens the full `EventEditorSheet` with `occ: null`. It now opens the same Quick Add (manage-tab FAB still creates a category). Phone's week grid stays non-selectable (locked decision: phone untouched otherwise).

- [ ] **Step 1: Update PhoneLayout**

1. Add imports:

```tsx
import { QuickAddSheet } from '../components/sheets/QuickAddSheet';
import { defaultSlot, type SlotSelection } from '../components/calendar/slotSelection';
```

(`useClock`'s `now` is already a Brisbane DateTime — pass it straight to `defaultSlot`.)

2. Add state next to the other sheet state:

```tsx
const [slotTarget, setSlotTarget] = useState<SlotSelection | null>(null);
```

3. Change `openFab`:

```tsx
const openFab = () => {
  if (tab === 'manage') setCategoryTarget({ cat: null });
  else setSlotTarget(defaultSlot(now));
};
```

4. Hide the FAB while the quick add is open — extend the guard:

```tsx
{!eventTarget && !categoryTarget && !dinnerDate && !slotTarget && (
  <Fab onClick={openFab} label={tab === 'manage' ? 'Add category' : 'Add event'} />
)}
```

5. Render the sheet alongside the others:

```tsx
{slotTarget && (
  <QuickAddSheet
    open
    onClose={() => setSlotTarget(null)}
    categories={categories}
    slot={slotTarget}
    onDinner={(date) => {
      setSlotTarget(null);
      setDinnerDate(date);
    }}
  />
)}
```

- [ ] **Step 2: Type-check + full suite**

Run: `cd frontend && npx tsc --noEmit && npx vitest run`
Expected: clean, all pass

- [ ] **Step 3: Commit**

```bash
git add frontend/src/layouts/PhoneLayout.tsx
git commit -m "feat: phone FAB opens unified quick-add form"
```

---

### Task 7: Build, verify on the kiosk, log

**Files:**
- Modify: `docs/SESSION-LOG.md` (append session entry)

- [ ] **Step 1: Full build + both workspace suites**

```bash
npm run build && npm --workspace backend test && cd frontend && npx vitest run
```

Expected: build clean; backend 145/145; frontend = 33 existing + 13 new, all green.

- [ ] **Step 2: Manual verification (dev server)**

```bash
npm run dev:backend   # terminal 1
npm run dev:frontend  # terminal 2
```

Open `http://localhost:5173/?mode=wall`, then verify:
- Week view: tap an empty 30-min slot → ghost appears, Quick Add opens prefilled with that day + slot time → end = +1h.
- Week view: long-press-drag 14:00→16:00 (or mouse drag) → Quick Add shows 14:00→16:00.
- Add an event → it appears on the grid instantly (optimistic) and the ghost clears.
- Cancel → ghost clears, nothing created.
- Month view: tap an empty day → Quick Add for that date, timed at next half-hour; "All day" toggle works.
- Month view: drag across 3 days → all-day range prefill (start + end date inputs).
- Dinner chip in the category row → DinnerEditorSheet opens for the selected date.
- ControlBar `+` → Quick Add with today/next-half-hour (no AddChooser).
- Tapping an existing event still opens DayDetailSheet.
- Default page (phone mode): FAB on Agenda/Week → Quick Add; Manage FAB still creates a category.

If a kiosk is reachable, `bash kiosk/reload.sh` and spot-check the week-view tap on real touch hardware (the 250 ms long-press select vs scroll feel is the thing only hardware can validate).

- [ ] **Step 3: Append a SESSION-LOG entry**

Append to `docs/SESSION-LOG.md` under a `## 2026-06-XX — P1 slot-tap creation` heading: what shipped (selectable grid, unified Quick Add, AddChooser retired), the verification performed (suite counts + the manual checklist above), and any touch-feel tuning done to `selectLongPressDelay`.

- [ ] **Step 4: Commit + push**

```bash
git add docs/SESSION-LOG.md
git commit -m "docs: session log for P1 slot-tap creation"
git push
```

---

## Self-review notes

- **Spec coverage (P1 section):** selectable+mirror+long-press ✅ (Task 3) · `onSlotSelect` contract ✅ (Tasks 1, 3) · week tap=1h/drag=range ✅ (Task 1) · month tap=timed-next-half-hour ✅ (Task 1) · ghost cleared on close ✅ (Task 3 `selectionOpen` + Task 5 wiring) · inline category chips ✅ (Task 4, reusing `CategoryPicker`) · dinner chip → dinner editor ✅ (Tasks 4–6, documented deviation) · `+`/FAB secondary ✅ (Tasks 5–6) · AddChooser deleted ✅ (Task 5) · event taps unchanged ✅ (Task 3).
- **Beyond-spec addition, kept deliberately:** month multi-day drag → all-day range. Falls straight out of `select` handling; rejecting it would need extra code.
- **Type consistency:** `SlotSelection` (Task 1) is consumed by name in Tasks 3–6; `QuickAddDraft`/`buildQuickAddPayload` (Task 2) consumed in Task 4; prop names (`onSlotSelect`, `selectionOpen`, `slot`, `onDinner`) match across tasks.
- **P2/P3:** planned separately once P1 lands (specs's phases are independently shippable; later plans should be written against the then-current code).
