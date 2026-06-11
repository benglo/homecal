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
