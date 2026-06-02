import { useState } from 'react';
import { Plus, Minus } from 'lucide-react';
import type { ChoreInput, FamilyMember } from '../../core/model/types';
import { Button } from '../primitives/Button';
import { TextInput } from '../sheets/fields';
import { TogglePillGroup } from '../ui/TogglePill';

/** Day-of-week labels in Mon-first display order with the underlying value (0 = Sunday). */
const DOW_OPTIONS: ReadonlyArray<{ label: string; value: number }> = [
  { label: 'Mon', value: 1 },
  { label: 'Tue', value: 2 },
  { label: 'Wed', value: 3 },
  { label: 'Thu', value: 4 },
  { label: 'Fri', value: 5 },
  { label: 'Sat', value: 6 },
  { label: 'Sun', value: 0 },
];

export interface ChoreFormInitial {
  title: string;
  icon: string;
  stars: number;
  frequency: 'daily' | 'weekly';
  dayOfWeek: number | null;
  assignedTo: string;
}

interface Props {
  members: FamilyMember[];
  initial: ChoreFormInitial;
  submitLabel: string;
  isPending: boolean;
  errorMessage: string | null;
  onCancel: () => void;
  onSubmit: (body: ChoreInput) => void;
}

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  textTransform: 'uppercase',
  letterSpacing: 0.4,
};

/** Inline create/edit form for a chore. Plain controlled state, no react-hook-form.
 *  Day picker shows Mon-first but stores 0 = Sunday (SQLite strftime %w convention). */
export function ChoreForm({
  members,
  initial,
  submitLabel,
  isPending,
  errorMessage,
  onCancel,
  onSubmit,
}: Props) {
  const [title, setTitle] = useState(initial.title);
  const [icon, setIcon] = useState(initial.icon);
  const [stars, setStars] = useState(initial.stars);
  const [frequency, setFrequency] = useState<'daily' | 'weekly'>(initial.frequency);
  const [dayOfWeek, setDayOfWeek] = useState<number | null>(initial.dayOfWeek);
  const [assignedTo, setAssignedTo] = useState(initial.assignedTo);
  const [validationError, setValidationError] = useState<string | null>(null);

  const trimmedTitle = title.trim();
  const trimmedIcon = icon.trim();
  const weeklyMissingDay = frequency === 'weekly' && dayOfWeek == null;
  const canSave =
    trimmedTitle.length > 0 &&
    trimmedIcon.length > 0 &&
    assignedTo.length > 0 &&
    !weeklyMissingDay &&
    !isPending;

  const submit = () => {
    if (!trimmedTitle) {
      setValidationError('Title is required.');
      return;
    }
    if (!assignedTo) {
      setValidationError('Pick a family member.');
      return;
    }
    if (frequency === 'weekly' && dayOfWeek == null) {
      setValidationError('Pick a day for weekly chores.');
      return;
    }
    setValidationError(null);
    onSubmit({
      title: trimmedTitle,
      icon: trimmedIcon,
      stars: Math.max(1, Math.min(5, stars)),
      frequency,
      dayOfWeek: frequency === 'weekly' ? dayOfWeek : null,
      assignedTo,
    });
  };

  const message = validationError ?? errorMessage;

  return (
    <div className="flex flex-col gap-3" style={{ padding: 12 }}>
      <div className="flex flex-col gap-2">
        <label className="font-medium text-text-muted" style={labelStyle}>
          Title
          <TextInput
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Make bed"
            autoFocus
            maxLength={256}
            style={{ marginTop: 6 }}
          />
        </label>
      </div>

      <div className="flex flex-col gap-2">
        <label className="font-medium text-text-muted" style={labelStyle}>
          Icon
          <TextInput
            value={icon}
            onChange={(e) => setIcon(e.target.value)}
            placeholder="e.g. 🛏️"
            maxLength={16}
            style={{ marginTop: 6 }}
          />
        </label>
      </div>

      <div className="flex flex-col gap-2">
        <span className="font-medium text-text-muted" style={labelStyle}>
          Stars
        </span>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setStars((s) => Math.max(1, s - 1))}
            aria-label="Decrease stars"
            className="grid place-items-center rounded-md border border-border"
            style={{ width: 44, height: 44, background: 'var(--surface-2)' }}
          >
            <Minus size={18} />
          </button>
          <span className="font-semibold text-text" style={{ fontSize: 18, minWidth: 80 }}>
            {'⭐'.repeat(stars)}
          </span>
          <button
            type="button"
            onClick={() => setStars((s) => Math.min(5, s + 1))}
            aria-label="Increase stars"
            className="grid place-items-center rounded-md border border-border"
            style={{ width: 44, height: 44, background: 'var(--surface-2)' }}
          >
            <Plus size={18} />
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="font-medium text-text-muted" style={labelStyle}>
          Frequency
        </span>
        <TogglePillGroup
          options={[
            { value: 'daily', label: 'Daily' },
            { value: 'weekly', label: 'Weekly' },
          ]}
          value={frequency}
          onChange={(opt) => {
            setFrequency(opt);
            if (opt === 'daily') setDayOfWeek(null);
          }}
          ariaLabel="Frequency"
          pillStyle={{ flex: 1, fontSize: 15 }}
          className="flex gap-2"
        />
      </div>

      {frequency === 'weekly' && (
        <div className="flex flex-col gap-2">
          <span className="font-medium text-text-muted" style={labelStyle}>
            Day
          </span>
          <TogglePillGroup
            options={DOW_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            value={dayOfWeek}
            onChange={setDayOfWeek}
            ariaLabel="Day of week"
            pillStyle={{ minWidth: 56, padding: '6px 12px' }}
          />
        </div>
      )}

      <div className="flex flex-col gap-2">
        <label className="font-medium text-text-muted" style={labelStyle}>
          Assigned to
          <select
            value={assignedTo}
            onChange={(e) => setAssignedTo(e.target.value)}
            style={{
              width: '100%',
              minHeight: 46,
              padding: '12px 14px',
              fontSize: 16,
              borderRadius: 'var(--r-sm)',
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--text)',
              marginTop: 6,
            }}
          >
            {members.length === 0 && <option value="">(no members)</option>}
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.icon ? `${m.icon} ` : ''}
                {m.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {message && (
        <p
          className="text-text-muted"
          style={{ fontSize: 13, color: 'var(--stale)' }}
          role="alert"
        >
          {message}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={submit} disabled={!canSave}>
          {isPending ? 'Saving…' : submitLabel}
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={isPending}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
