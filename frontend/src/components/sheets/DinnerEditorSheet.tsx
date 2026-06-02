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

  return (
    <Sheet open onClose={onClose} title={`Dinner · ${pretty}`} actions={actions}>
      {savedAt > 0 && (
        <span
          aria-live="polite"
          className="absolute rounded-full"
          style={{
            top: 24,
            right: 90,
            fontSize: 12,
            padding: '4px 10px',
            background: 'var(--accent-weak)',
            color: 'var(--accent-ink)',
            fontWeight: 600,
            zIndex: 1,
          }}
        >
          Saved
        </span>
      )}
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
