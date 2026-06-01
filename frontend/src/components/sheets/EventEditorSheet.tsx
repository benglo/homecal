import { useState } from 'react';
import { Repeat } from 'lucide-react';
import type { Category, EventOccurrence } from '../../core/model/types';
import { useEventMaster } from '../../core/hooks/useData';
import { useEventMutations } from '../../core/hooks/useMutations';
import { ApiError } from '../../core/api/client';
import { buildRRule, parseRRule, REPEAT_LABELS, type RepeatFreq } from '../../core/util/rrule';
import { fromInputDateTime, nextHalfHour, nowBne, toInputDate, toInputDateTime } from '../../core/util/time';
import { Sheet } from './Sheet';
import { Button } from '../primitives/Button';
import { CategoryPicker, Field, FormError, TextInput } from './fields';

interface Props {
  open: boolean;
  onClose: () => void;
  categories: Category[];
  /** Present → edit that occurrence's series; absent → create. */
  occurrence?: EventOccurrence | null;
  /** Create prefill from a wall/FC selection (UTC ISO). */
  prefill?: { start?: string; end?: string; allDay?: boolean };
}

export function EventEditorSheet({ open, onClose, categories, occurrence, prefill }: Props) {
  const editing = !!occurrence;
  const masterQ = useEventMaster(editing ? occurrence!.masterId : null);

  if (!open) return null;

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
      occurrence={occurrence ?? null}
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

interface Init {
  title: string;
  categoryId: string;
  allDay: boolean;
  start: string; // input value: 'yyyy-MM-dd' (allDay) or 'yyyy-MM-ddTHH:mm'
  end: string;
  location: string;
  freq: RepeatFreq;
  until: string;
}

const FREQS: RepeatFreq[] = ['none', 'daily', 'weekly', 'monthly'];

function EventForm({
  init,
  categories,
  editing,
  masterId,
  occurrence,
  onClose,
}: {
  init: Init;
  categories: Category[];
  editing: boolean;
  masterId?: string;
  occurrence: EventOccurrence | null;
  onClose: () => void;
}) {
  const { create, update, remove, cancelOccurrence } = useEventMutations();
  const [title, setTitle] = useState(init.title);
  const [categoryId, setCategoryId] = useState(init.categoryId);
  const [allDay, setAllDay] = useState(init.allDay);
  const [start, setStart] = useState(init.start);
  const [end, setEnd] = useState(init.end);
  const [location, setLocation] = useState(init.location);
  const [freq, setFreq] = useState<RepeatFreq>(init.freq);
  const [until, setUntil] = useState(init.until);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmSeries, setConfirmSeries] = useState(false);

  const isRecurring = !!occurrence?.isRecurring;

  // Switch the start/end representation when all-day toggles (keep the date part).
  const toggleAllDay = (next: boolean) => {
    setAllDay(next);
    const conv = (v: string) => (next ? v.slice(0, 10) : `${v.slice(0, 10)}T09:00`);
    setStart((v) => conv(v));
    setEnd((v) => conv(v));
  };

  const validate = (): string => {
    if (!title.trim()) return 'Give the event a title.';
    if (!categoryId) return 'Pick a category.';
    if (!start || !end) return 'Set a start and end.';
    const s = allDay ? start : fromInputDateTime(start);
    const e = allDay ? end : fromInputDateTime(end);
    if (e < s) return 'End must be on or after the start.';
    if (freq !== 'none' && !until) return 'Choose a date for the repeat to end.';
    return '';
  };

  const performSave = () => {
    const rrule = buildRRule(freq, until);
    const body = {
      categoryId,
      title: title.trim(),
      start: allDay ? start : fromInputDateTime(start),
      end: allDay ? end : fromInputDateTime(end),
      allDay,
      location: location.trim() || undefined,
      rrule: rrule ?? undefined,
    };
    const onError = (err: unknown) =>
      setError(err instanceof ApiError ? err.message : 'Could not save — try again.');

    if (editing && masterId) {
      // M3: edits apply to the whole series (modified-occurrence overrides are v2).
      update.mutate(
        { id: masterId, body: { ...body, location: location.trim() || null, rrule } },
        { onSuccess: onClose, onError }
      );
    } else {
      create.mutate(body, { onSuccess: onClose, onError });
    }
  };

  const save = () => {
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    // Editing a recurring series is all-or-nothing in v1 — make that an explicit choice
    // rather than a silent whole-series rewrite (no "this & following" yet).
    if (editing && isRecurring && !confirmSeries) {
      setError('');
      setConfirmSeries(true);
      return;
    }
    performSave();
  };

  const deleteSeries = () => {
    if (!masterId) return;
    remove.mutate(masterId, { onSuccess: onClose });
  };
  const deleteThis = () => {
    if (!masterId || !occurrence?.occurrenceDate) return;
    cancelOccurrence.mutate(
      { id: masterId, occurrenceDate: occurrence.occurrenceDate },
      { onSuccess: onClose }
    );
  };

  const inputType = allDay ? 'date' : 'datetime-local';
  const busy = create.isPending || update.isPending || remove.isPending || cancelOccurrence.isPending;

  const actions = (
    <>
      {editing && (
        <Button variant="danger" onClick={() => setConfirmDelete(true)} style={{ marginRight: 'auto' }}>
          Delete
        </Button>
      )}
      <Button variant="ghost" onClick={onClose}>
        Cancel
      </Button>
      <Button variant="primary" onClick={save} disabled={busy}>
        {editing ? 'Save' : 'Add event'}
      </Button>
    </>
  );

  const title_ = editing ? (isRecurring ? 'Edit series' : 'Edit event') : 'New event';

  return (
    <Sheet open onClose={onClose} title={title_} actions={actions}>
      <FormError>{error}</FormError>

      {editing && isRecurring && (
        <div
          className="flex items-center gap-2 rounded-md"
          style={{ background: 'var(--accent-weak)', color: 'var(--accent-ink)', padding: '10px 12px', marginBottom: 16, fontSize: 14 }}
          role="note"
        >
          <Repeat size={16} className="shrink-0" />
          This event repeats — saving changes <strong>every</strong> occurrence.
        </div>
      )}

      <Field label="Title">
        <TextInput value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What's happening?" autoFocus />
      </Field>

      <Field label="Category">
        <CategoryPicker categories={categories} value={categoryId} onChange={setCategoryId} />
      </Field>

      <Field label="When">
        <button
          type="button"
          onClick={() => toggleAllDay(!allDay)}
          aria-pressed={allDay}
          className="inline-flex items-center gap-2 rounded-md border font-medium"
          style={{
            minHeight: 48,
            padding: '8px 14px',
            marginBottom: 12,
            fontSize: 14,
            background: allDay ? 'var(--accent-weak)' : 'var(--surface)',
            borderColor: allDay ? 'var(--accent)' : 'var(--border)',
            color: allDay ? 'var(--accent-ink)' : 'var(--text-muted)',
          }}
        >
          All day
        </button>
        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-3">
            <span className="text-text-muted" style={{ width: 48, fontSize: 14 }}>
              Start
            </span>
            <TextInput type={inputType} value={start} onChange={(e) => setStart(e.target.value)} />
          </label>
          <label className="flex items-center gap-3">
            <span className="text-text-muted" style={{ width: 48, fontSize: 14 }}>
              End
            </span>
            <TextInput type={inputType} value={end} onChange={(e) => setEnd(e.target.value)} />
          </label>
        </div>
      </Field>

      <Field label="Repeat" hint={editing && isRecurring ? 'Changes apply to the whole series.' : undefined}>
        <div className="flex flex-wrap gap-2" style={{ marginBottom: freq !== 'none' ? 12 : 0 }}>
          {FREQS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFreq(f)}
              aria-pressed={f === freq}
              className="rounded-md border font-medium"
              style={{
                minHeight: 48,
                padding: '8px 13px',
                fontSize: 14,
                background: f === freq ? 'var(--accent)' : 'var(--surface)',
                color: f === freq ? '#fff' : 'var(--text-muted)',
                borderColor: f === freq ? 'var(--accent)' : 'var(--border)',
              }}
            >
              {REPEAT_LABELS[f]}
            </button>
          ))}
        </div>
        {freq !== 'none' && (
          <label className="flex items-center gap-3">
            <span className="text-text-muted" style={{ width: 48, fontSize: 14 }}>
              Until
            </span>
            <TextInput type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
          </label>
        )}
      </Field>

      <Field label="Location">
        <TextInput value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Optional" />
      </Field>

      {confirmDelete && (
        <div className="rounded-md border border-border" style={{ padding: 14, marginTop: 4 }}>
          <p className="font-medium text-text" style={{ marginBottom: 12 }}>
            {isRecurring ? 'Delete which events?' : 'Delete this event?'}
          </p>
          <div className="flex flex-wrap gap-2">
            {isRecurring ? (
              <>
                <Button variant="danger" onClick={deleteThis} style={{ border: '1px solid var(--border)' }}>
                  This event only
                </Button>
                <Button variant="danger" onClick={deleteSeries} style={{ border: '1px solid var(--border)' }}>
                  Whole series
                </Button>
              </>
            ) : (
              <Button variant="danger" onClick={deleteSeries} style={{ border: '1px solid var(--border)' }}>
                Delete
              </Button>
            )}
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Keep
            </Button>
          </div>
        </div>
      )}

      {confirmSeries && (
        <div className="rounded-md border" style={{ borderColor: 'var(--accent)', padding: 14, marginTop: 4 }}>
          <p className="font-medium text-text" style={{ marginBottom: 12 }}>
            Apply these changes to <strong>every</strong> occurrence of this series?
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={performSave} disabled={busy}>
              Save whole series
            </Button>
            <Button variant="ghost" onClick={() => setConfirmSeries(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
