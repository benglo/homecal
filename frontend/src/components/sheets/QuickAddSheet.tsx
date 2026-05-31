import { useState } from 'react';
import { DateTime } from 'luxon';
import type { Category } from '../../core/model/types';
import { useEventMutations } from '../../core/hooks/useMutations';
import { fromInputDateTime, nextHalfHour, nowBne, toInputDate } from '../../core/util/time';
import { Sheet } from './Sheet';
import { Button } from '../primitives/Button';
import { CategoryPicker, Field, TextInput } from './fields';

interface Props {
  open: boolean;
  onClose: () => void;
  categories: Category[];
  /** Optional prefilled day (yyyy-MM-dd, Brisbane) from a grid tap. */
  defaultDate?: string;
}

/** The wall's fast create path: title · category · day · time. No recurrence/location
 *  (richer edits say "do it on your phone"). Optimistic; a failed create never throws
 *  a red error on the wall — we just close and let reconciliation correct it. */
export function QuickAddSheet({ open, onClose, categories, defaultDate }: Props) {
  const { create } = useEventMutations();
  const today = defaultDate ?? toInputDate(nowBne().toUTC().toISO()!);
  const [title, setTitle] = useState('');
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? '');
  const [date, setDate] = useState(today);
  const [allDay, setAllDay] = useState(false);
  const [time, setTime] = useState(() => nextHalfHour(nowBne()).toFormat('HH:mm'));

  if (!open) return null;

  // WallLayout keeps this sheet mounted, so reset every field on close.
  const reset = () => {
    setTitle('');
    setDate(today);
    setAllDay(false);
    setTime(nextHalfHour(nowBne()).toFormat('HH:mm'));
    setCategoryId(categories[0]?.id ?? '');
  };
  const close = () => {
    reset();
    onClose();
  };

  const submit = () => {
    if (!title.trim() || !categoryId) return;
    let start: string;
    let end: string;
    if (allDay) {
      start = date;
      end = date;
    } else {
      start = fromInputDateTime(`${date}T${time}`);
      end = DateTime.fromISO(start, { zone: 'utc' }).plus({ hours: 1 }).toISO({ suppressMilliseconds: true })!;
    }
    // Optimistic + quiet: fire and close. No error surfaced on the wall.
    create.mutate({ categoryId, title: title.trim(), start, end, allDay });
    close();
  };

  const actions = (
    <>
      <Button variant="ghost" onClick={close}>
        Cancel
      </Button>
      <Button variant="primary" onClick={submit} disabled={!title.trim()}>
        Add
      </Button>
    </>
  );

  return (
    <Sheet open onClose={close} title="Quick add" actions={actions}>
      <Field label="Title">
        <TextInput value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What's happening?" autoFocus />
      </Field>
      <Field label="Category">
        <CategoryPicker categories={categories} value={categoryId} onChange={setCategoryId} />
      </Field>
      <Field label="When">
        <div className="flex flex-wrap items-center gap-2">
          <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ width: 'auto', flex: '1 1 150px' }} />
          {!allDay && (
            <TextInput type="time" value={time} onChange={(e) => setTime(e.target.value)} style={{ width: 'auto', flex: '0 1 120px' }} />
          )}
          <button
            type="button"
            onClick={() => setAllDay((v) => !v)}
            aria-pressed={allDay}
            className="rounded-md border font-medium"
            style={{
              minHeight: 46,
              padding: '0 14px',
              fontSize: 14,
              background: allDay ? 'var(--accent-weak)' : 'var(--surface)',
              borderColor: allDay ? 'var(--accent)' : 'var(--border)',
              color: allDay ? 'var(--accent-ink)' : 'var(--text-muted)',
            }}
          >
            All day
          </button>
        </div>
      </Field>
    </Sheet>
  );
}
