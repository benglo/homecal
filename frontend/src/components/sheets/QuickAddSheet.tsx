import { useState } from 'react';
import { DateTime } from 'luxon';
import type { Category } from '../../core/model/types';
import { useEventMutations } from '../../core/hooks/useMutations';
import { fromInputDateTime, nextHalfHour, nowBne, toInputDate } from '../../core/util/time';
import { chipFill } from '../../core/util/color';
import { iconFor } from '../../core/util/icons';
import { Sheet } from './Sheet';
import { Button } from '../primitives/Button';
import { Field, TextInput } from './fields';

interface Props {
  open: boolean;
  onClose: () => void;
  categories: Category[];
  /** Pre-selected category from the AddChooser. */
  defaultCategoryId?: string;
  /** Optional prefilled day (yyyy-MM-dd, Brisbane) from a grid tap. */
  defaultDate?: string;
}

export function QuickAddSheet({ open, onClose, categories, defaultCategoryId, defaultDate }: Props) {
  const { create } = useEventMutations();
  const today = defaultDate ?? toInputDate(nowBne().toUTC().toISO()!);
  const catId = defaultCategoryId ?? categories[0]?.id ?? '';
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(today);
  const [allDay, setAllDay] = useState(false);
  const [time, setTime] = useState(() => nextHalfHour(nowBne()).toFormat('HH:mm'));

  if (!open) return null;

  const category = categories.find((c) => c.id === catId);
  const CatIcon = iconFor(category?.icon);

  const reset = () => {
    setTitle('');
    setDate(today);
    setAllDay(false);
    setTime(nextHalfHour(nowBne()).toFormat('HH:mm'));
  };
  const close = () => {
    reset();
    onClose();
  };

  const submit = () => {
    if (!title.trim() || !catId) return;
    let start: string;
    let end: string;
    if (allDay) {
      start = date;
      end = date;
    } else {
      start = fromInputDateTime(`${date}T${time}`);
      end = DateTime.fromISO(start, { zone: 'utc' }).plus({ hours: 1 }).toISO({ suppressMilliseconds: true })!;
    }
    create.mutate({ categoryId: catId, title: title.trim(), start, end, allDay });
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
      {category && (
        <div
          className="inline-flex items-center gap-2 rounded-md font-semibold"
          style={{
            padding: '8px 14px',
            marginBottom: 18,
            fontSize: 15,
            background: chipFill(category.color, 0.18),
            color: category.color,
          }}
        >
          <CatIcon size={18} strokeWidth={2} />
          {category.name}
        </div>
      )}

      <Field label="Title">
        <TextInput value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What's happening?" autoFocus />
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
