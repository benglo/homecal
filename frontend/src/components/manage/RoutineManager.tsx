import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { FamilyMember, Routine, RoutineInput, RoutineKind } from '../../core/model/types';
import { useFamilyMembers, useRoutines } from '../../core/hooks/useData';
import { useRoutineMutations } from '../../core/hooks/useMutations';
import { ApiError } from '../../core/api/client';
import { Button } from '../primitives/Button';
import { SectionHeading } from './primitives/SectionHeading';
import { InlineAddButton } from './primitives/InlineAddButton';
import { TogglePillGroup } from '../ui/TogglePill';
import { RoutineSettingsPanel } from './RoutineSettingsPanel';

const KIND_LABEL: Record<RoutineKind, string> = {
  morning: '☀️ Ready for school by',
  dinner: '🍽️ Dinner',
  bath: '🛁 Bath',
  bed: '🌙 Bed',
};

/** Weekday bitmasks (bit 0 = Sunday). Anything else set via the API shows no pill selected. */
const DAY_PRESETS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 127, label: 'Every day' },
  { value: 62, label: 'Mon–Fri' },
  { value: 65, label: 'Weekends' },
];

const fieldStyle: React.CSSProperties = {
  minHeight: 44,
  padding: '8px 10px',
  fontSize: 16,
  borderRadius: 'var(--r-sm)',
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  color: 'var(--text)',
};

const rowStyle: React.CSSProperties = { padding: 12, background: 'var(--surface)' };

type Draft = Required<RoutineInput>;

interface FieldsProps {
  value: Draft;
  members: FamilyMember[];
  onChange: (patch: Partial<Draft>) => void;
  /** Saved rows commit the time on blur (a native time picker fires change per digit). */
  commitTimeOnBlur: boolean;
}

function RoutineFields({ value, members, onChange, commitTimeOnBlur }: FieldsProps) {
  return (
    <>
      <div className="flex items-center gap-2">
        <select
          aria-label="Routine"
          value={value.kind}
          onChange={(e) => onChange({ kind: e.target.value as RoutineKind })}
          style={{ ...fieldStyle, flex: 1 }}
        >
          {(Object.keys(KIND_LABEL) as RoutineKind[]).map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </select>
        {commitTimeOnBlur ? (
          <input
            type="time"
            aria-label="Time"
            defaultValue={value.time}
            onBlur={(e) => e.target.value && e.target.value !== value.time && onChange({ time: e.target.value })}
            style={{ ...fieldStyle, width: 120 }}
          />
        ) : (
          <input
            type="time"
            aria-label="Time"
            value={value.time}
            onChange={(e) => onChange({ time: e.target.value })}
            style={{ ...fieldStyle, width: 120 }}
          />
        )}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <TogglePillGroup<number>
          options={DAY_PRESETS}
          value={DAY_PRESETS.some((p) => p.value === value.days) ? value.days : null}
          onChange={(days) => onChange({ days })}
          ariaLabel="Days"
          pillStyle={{ padding: '6px 12px', fontSize: 14 }}
        />
        <select
          aria-label="Who"
          value={value.memberId ?? ''}
          onChange={(e) => onChange({ memberId: e.target.value || null })}
          style={{ ...fieldStyle, minHeight: 36 }}
        >
          <option value="">Everyone</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.icon} {m.name}
            </option>
          ))}
        </select>
      </div>
    </>
  );
}

/** Manage-tab list of household routine times. Saved rows save on change — these are
 *  a handful of settings, not documents. Adding goes through an explicit Save, because a
 *  half-made bath/bed time in the past would lock the TV straight away. The TV launcher
 *  reads these (via /api/day-plan) to drive reminders and lock times. */
export function RoutineManager() {
  const routinesQ = useRoutines();
  const membersQ = useFamilyMembers();
  const { create, update, remove } = useRoutineMutations();
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const members = membersQ.data ?? [];
  const routines = routinesQ.data ?? [];

  const onError = (err: unknown) =>
    setError(err instanceof ApiError ? err.message : 'Could not save that routine.');
  const save = (r: Routine, body: Partial<Draft>) => {
    setError(null);
    update.mutate({ id: r.id, body }, { onError });
  };

  return (
    <section style={{ marginBottom: 24 }}>
      <SectionHeading>Routines (TV reminders)</SectionHeading>

      <ul className="flex flex-col gap-2">
        {routines.map((r) => (
          <li key={r.id} className="rounded-md border border-border flex flex-col gap-2" style={rowStyle}>
            <RoutineFields
              value={{ kind: r.kind, time: r.time, days: r.days, memberId: r.memberId }}
              members={members}
              onChange={(patch) => save(r, patch)}
              commitTimeOnBlur
            />
            <div className="flex justify-end">
              <button
                type="button"
                aria-label="Delete routine"
                onClick={() => remove.mutate(r.id, { onError })}
                className="flex items-center gap-1 text-text-muted"
                style={{ minHeight: 36, fontSize: 13 }}
              >
                <Trash2 size={16} /> Remove
              </button>
            </div>
          </li>
        ))}
      </ul>

      {draft && (
        <div className="rounded-md border border-border flex flex-col gap-2" style={{ ...rowStyle, marginTop: 10 }}>
          <RoutineFields
            value={draft}
            members={members}
            onChange={(patch) => setDraft({ ...draft, ...patch })}
            commitTimeOnBlur={false}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              disabled={create.isPending || !draft.time}
              onClick={() => {
                setError(null);
                create.mutate(draft, { onSuccess: () => setDraft(null), onError });
              }}
            >
              {create.isPending ? 'Saving…' : 'Add'}
            </Button>
            <Button variant="ghost" onClick={() => setDraft(null)} disabled={create.isPending}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" style={{ fontSize: 13, color: 'var(--stale)', marginTop: 6 }}>
          {error}
        </p>
      )}

      {!draft && (
        <InlineAddButton
          onClick={() => {
            setError(null);
            setDraft({ kind: 'bed', time: '19:30', days: 127, memberId: null });
          }}
        >
          Add routine
        </InlineAddButton>
      )}

      <RoutineSettingsPanel />
    </section>
  );
}
