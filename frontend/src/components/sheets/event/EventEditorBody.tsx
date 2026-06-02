import type { Category, EventOccurrence } from '../../../core/model/types';
import { useEventMaster } from '../../../core/hooks/useData';
import { ApiError } from '../../../core/api/client';
import { parseRRule } from '../../../core/util/rrule';
import { nextHalfHour, nowBne, toInputDate, toInputDateTime } from '../../../core/util/time';
import { Sheet } from '../Sheet';
import { EventForm } from './EventForm';

interface Props {
  onClose: () => void;
  categories: Category[];
  occurrence: EventOccurrence | null;
  prefill?: { start?: string; end?: string; allDay?: boolean };
}

/** Inner editor — only mounted when the parent sheet is open, so this hook tree
 *  doesn't trigger a master fetch for a closed sheet. */
export function EventEditorBody({ onClose, categories, occurrence, prefill }: Props) {
  const editing = !!occurrence;
  const masterQ = useEventMaster(editing ? occurrence!.masterId : null);

  // For edit, wait for the master (carries rrule). For create, render immediately.
  if (editing && masterQ.isError) {
    return (
      <Sheet open onClose={onClose} title="Edit event">
        <p className="text-stale" role="alert">
          Couldn’t load this event — {masterQ.error instanceof ApiError ? masterQ.error.message : 'try again.'}
        </p>
      </Sheet>
    );
  }
  if (editing && !masterQ.data) {
    return (
      <Sheet open onClose={onClose} title="Edit event">
        <p className="text-text-muted">Loading…</p>
      </Sheet>
    );
  }

  const m = masterQ.data;
  const repeat = parseRRule(m?.rrule ?? null);
  const defaultStart = prefill?.start ?? nextHalfHour(nowBne()).toUTC().toISO()!;
  const defaultEnd =
    prefill?.end ?? nextHalfHour(nowBne()).plus({ hours: 1 }).toUTC().toISO()!;
  const allDay = m?.allDay ?? prefill?.allDay ?? false;

  return (
    <EventForm
      key={editing ? `edit-${m!.id}-${m!.updatedAt}` : 'create'}
      onClose={onClose}
      categories={categories}
      editing={editing}
      masterId={m?.id}
      occurrence={occurrence}
      init={{
        title: m?.title ?? '',
        categoryId: m?.categoryId ?? categories[0]?.id ?? '',
        allDay,
        start: allDay ? toInputDate(m?.start ?? defaultStart) : toInputDateTime(m?.start ?? defaultStart),
        end: allDay ? toInputDate(m?.end ?? defaultEnd) : toInputDateTime(m?.end ?? defaultEnd),
        location: m?.location ?? '',
        freq: repeat.freq,
        until: repeat.until,
      }}
    />
  );
}
