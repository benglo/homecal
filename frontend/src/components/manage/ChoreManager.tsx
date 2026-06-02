import { useState } from 'react';
import { Pencil, Trash2, Plus, ChevronUp, ChevronDown, Minus } from 'lucide-react';
import type { Chore, ChoreInput, FamilyMember } from '../../core/model/types';
import { useChores, useFamilyMembers } from '../../core/hooks/useData';
import { useChoreMutations } from '../../core/hooks/useMutations';
import { ApiError } from '../../core/api/client';
import { Button } from '../primitives/Button';
import { TextInput } from '../sheets/fields';

type EditState =
  | { mode: 'edit'; id: string }
  | { mode: 'add'; memberId: string }
  | null;

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

const DOW_SHORT: Record<number, string> = {
  0: 'Sun',
  1: 'Mon',
  2: 'Tue',
  3: 'Wed',
  4: 'Thu',
  5: 'Fri',
  6: 'Sat',
};

/** Manage-tab list of chores grouped by family member. Inline add/edit, delete with
 *  confirm, ±1 position reorder by swapping with the in-group neighbour. Day picker
 *  shows Mon-first but stores 0 = Sunday (SQLite strftime %w convention). */
export function ChoreManager() {
  const choresQ = useChores();
  const membersQ = useFamilyMembers();
  const { create, update, remove } = useChoreMutations();

  const [editing, setEditing] = useState<EditState>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string; message: string } | null>(null);

  const members = membersQ.data ?? [];
  const chores = choresQ.data ?? [];

  const cancel = () => {
    setEditing(null);
    setError(null);
  };

  const startEdit = (c: Chore) => {
    setEditing({ mode: 'edit', id: c.id });
    setConfirmDelete(null);
    setError(null);
  };

  const startAdd = (memberId: string) => {
    setEditing({ mode: 'add', memberId });
    setConfirmDelete(null);
    setError(null);
  };

  const requestDelete = (id: string) => {
    setConfirmDelete(id);
    setError(null);
  };

  const confirmDeleteFor = (c: Chore) => {
    setError(null);
    remove.mutate(c.id, {
      onSuccess: () => setConfirmDelete(null),
      onError: (err) =>
        setError({
          id: c.id,
          message: err instanceof ApiError ? err.message : 'Could not delete this chore.',
        }),
    });
  };

  /** Swap position with the neighbour above/below in the same member's list. */
  const move = (chore: Chore, group: Chore[], dir: -1 | 1) => {
    const idx = group.findIndex((c) => c.id === chore.id);
    const neighbour = group[idx + dir];
    if (!neighbour) return;
    setError(null);
    update.mutate(
      { id: chore.id, body: { position: neighbour.position } },
      {
        onError: (err) =>
          setError({
            id: chore.id,
            message: err instanceof ApiError ? err.message : 'Could not reorder — try again.',
          }),
      }
    );
    update.mutate({ id: neighbour.id, body: { position: chore.position } });
  };

  // Group by member, sorted by position.
  const grouped = members.map((m) => ({
    member: m,
    items: chores.filter((c) => c.assignedTo === m.id).sort((a, b) => a.position - b.position),
  }));

  return (
    <section style={{ marginBottom: 24 }}>
      <h2
        className="font-semibold text-text-muted"
        style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}
      >
        Chores
      </h2>

      {(choresQ.isPending || membersQ.isPending) && (
        <p className="text-text-faint" style={{ fontSize: 14, padding: '8px 0' }}>
          Loading…
        </p>
      )}

      {!membersQ.isPending && members.length === 0 && (
        <p
          className="text-text-muted rounded-md border border-border"
          style={{ fontSize: 14, padding: '12px 14px', background: 'var(--surface)' }}
        >
          Add a family member first — chores are assigned to a person.
        </p>
      )}

      {grouped.map(({ member, items }) => {
        const isAddingHere = editing?.mode === 'add' && editing.memberId === member.id;
        return (
          <div key={member.id} style={{ marginBottom: 16 }}>
            <div className="flex items-center gap-2" style={{ marginBottom: 8 }}>
              <span
                className="grid place-items-center rounded-md"
                style={{
                  width: 28,
                  height: 28,
                  fontSize: 16,
                  background: 'var(--surface-2)',
                }}
                aria-hidden
              >
                {member.icon || '👤'}
              </span>
              <h3 className="font-semibold text-text" style={{ fontSize: 15 }}>
                {member.name}
              </h3>
            </div>

            <ul className="flex flex-col gap-2">
              {items.map((c, idx) => {
                const isEditing = editing?.mode === 'edit' && editing.id === c.id;
                const isConfirming = confirmDelete === c.id;
                const rowError = error?.id === c.id ? error.message : null;
                const canUp = idx > 0;
                const canDown = idx < items.length - 1;
                return (
                  <li
                    key={c.id}
                    className="rounded-md border border-border"
                    style={{ background: 'var(--surface)' }}
                  >
                    {isEditing ? (
                      <ChoreForm
                        members={members}
                        initial={{
                          title: c.title,
                          icon: c.icon,
                          stars: c.stars,
                          frequency: c.frequency,
                          dayOfWeek: c.dayOfWeek,
                          assignedTo: c.assignedTo,
                        }}
                        submitLabel="Save"
                        isPending={update.isPending}
                        errorMessage={rowError}
                        onCancel={cancel}
                        onSubmit={(body) =>
                          update.mutate(
                            { id: c.id, body },
                            {
                              onSuccess: () => {
                                setEditing(null);
                                setError(null);
                              },
                              onError: (err) =>
                                setError({
                                  id: c.id,
                                  message:
                                    err instanceof ApiError
                                      ? err.message
                                      : 'Could not save — try again.',
                                }),
                            }
                          )
                        }
                      />
                    ) : (
                      <>
                        <div className="flex items-center gap-2" style={{ padding: '10px 12px' }}>
                          <span
                            className="grid place-items-center shrink-0 rounded-md"
                            style={{
                              width: 36,
                              height: 36,
                              fontSize: 20,
                              background: 'var(--surface-2)',
                            }}
                            aria-hidden
                          >
                            {c.icon || '✅'}
                          </span>
                          <div className="flex-1 min-w-0">
                            <div
                              className="font-semibold text-text truncate"
                              style={{ fontSize: 15 }}
                            >
                              {c.title}
                            </div>
                            <div
                              className="flex items-center gap-2 text-text-muted"
                              style={{ fontSize: 12, marginTop: 2 }}
                            >
                              <span aria-label={`${c.stars} stars`}>
                                {'⭐'.repeat(Math.max(1, Math.min(5, c.stars)))}
                              </span>
                              <span
                                className="rounded-md"
                                style={{
                                  padding: '2px 8px',
                                  background: 'var(--surface-2)',
                                  fontSize: 11,
                                  fontWeight: 600,
                                  textTransform: 'uppercase',
                                  letterSpacing: 0.4,
                                }}
                              >
                                {c.frequency === 'daily'
                                  ? 'Daily'
                                  : c.dayOfWeek != null
                                    ? DOW_SHORT[c.dayOfWeek]
                                    : 'Weekly'}
                              </span>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => move(c, items, -1)}
                            disabled={!canUp || update.isPending}
                            aria-label={`Move ${c.title} up`}
                            className="grid place-items-center rounded-md text-text-muted disabled:opacity-30"
                            style={{ width: 40, height: 40 }}
                          >
                            <ChevronUp size={18} />
                          </button>
                          <button
                            type="button"
                            onClick={() => move(c, items, 1)}
                            disabled={!canDown || update.isPending}
                            aria-label={`Move ${c.title} down`}
                            className="grid place-items-center rounded-md text-text-muted disabled:opacity-30"
                            style={{ width: 40, height: 40 }}
                          >
                            <ChevronDown size={18} />
                          </button>
                          <button
                            type="button"
                            onClick={() => startEdit(c)}
                            aria-label={`Edit ${c.title}`}
                            className="grid place-items-center rounded-md text-text-muted"
                            style={{ width: 44, height: 44 }}
                          >
                            <Pencil size={18} />
                          </button>
                          <button
                            type="button"
                            onClick={() => requestDelete(c.id)}
                            aria-label={`Delete ${c.title}`}
                            className="grid place-items-center rounded-md"
                            style={{ width: 44, height: 44, color: 'var(--stale)' }}
                          >
                            <Trash2 size={18} />
                          </button>
                        </div>
                        {isConfirming && (
                          <div style={{ padding: '0 12px 12px' }}>
                            <p
                              className="text-text-muted"
                              style={{ fontSize: 13, marginBottom: 10 }}
                              role="alert"
                            >
                              Delete <strong>{c.title}</strong>?
                            </p>
                            <div className="flex flex-wrap gap-2">
                              <Button
                                variant="danger"
                                onClick={() => confirmDeleteFor(c)}
                                disabled={remove.isPending}
                              >
                                {remove.isPending ? 'Deleting…' : 'Delete'}
                              </Button>
                              <Button variant="ghost" onClick={() => setConfirmDelete(null)}>
                                Cancel
                              </Button>
                            </div>
                          </div>
                        )}
                        {rowError && !isConfirming && (
                          <div style={{ padding: '0 12px 12px' }}>
                            <p
                              className="text-text-muted"
                              style={{ fontSize: 13, color: 'var(--stale)' }}
                              role="alert"
                            >
                              {rowError}
                            </p>
                          </div>
                        )}
                      </>
                    )}
                  </li>
                );
              })}
            </ul>

            {isAddingHere ? (
              <div
                className="rounded-md border border-border"
                style={{ background: 'var(--surface)', marginTop: 10 }}
              >
                <ChoreForm
                  members={members}
                  initial={{
                    title: '',
                    icon: '',
                    stars: 1,
                    frequency: 'daily',
                    dayOfWeek: null,
                    assignedTo: member.id,
                  }}
                  submitLabel="Add"
                  isPending={create.isPending}
                  errorMessage={error?.id === `add:${member.id}` ? error.message : null}
                  onCancel={cancel}
                  onSubmit={(body) =>
                    create.mutate(body, {
                      onSuccess: () => {
                        setEditing(null);
                        setError(null);
                      },
                      onError: (err) =>
                        setError({
                          id: `add:${member.id}`,
                          message:
                            err instanceof ApiError ? err.message : 'Could not add — try again.',
                        }),
                    })
                  }
                />
              </div>
            ) : (
              <button
                type="button"
                onClick={() => startAdd(member.id)}
                className="flex items-center gap-2 rounded-md border border-border font-semibold"
                style={{
                  marginTop: 10,
                  padding: '10px 16px',
                  fontSize: 14,
                  background: 'var(--surface)',
                  color: 'var(--accent)',
                }}
              >
                <Plus size={16} />
                Add chore for {member.name}
              </button>
            )}
          </div>
        );
      })}
    </section>
  );
}

interface FormInitial {
  title: string;
  icon: string;
  stars: number;
  frequency: 'daily' | 'weekly';
  dayOfWeek: number | null;
  assignedTo: string;
}

interface FormProps {
  members: FamilyMember[];
  initial: FormInitial;
  submitLabel: string;
  isPending: boolean;
  errorMessage: string | null;
  onCancel: () => void;
  onSubmit: (body: ChoreInput) => void;
}

/** Inline create/edit form for a chore. Plain controlled state, no react-hook-form. */
function ChoreForm({
  members,
  initial,
  submitLabel,
  isPending,
  errorMessage,
  onCancel,
  onSubmit,
}: FormProps) {
  const [title, setTitle] = useState(initial.title);
  const [icon, setIcon] = useState(initial.icon);
  const [stars, setStars] = useState(initial.stars);
  const [frequency, setFrequency] = useState<'daily' | 'weekly'>(initial.frequency);
  const [dayOfWeek, setDayOfWeek] = useState<number | null>(initial.dayOfWeek);
  const [assignedTo, setAssignedTo] = useState(initial.assignedTo);
  const [validationError, setValidationError] = useState<string | null>(null);

  const trimmedTitle = title.trim();
  const weeklyMissingDay = frequency === 'weekly' && dayOfWeek == null;
  const canSave =
    trimmedTitle.length > 0 &&
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
      icon: icon.trim(),
      stars: Math.max(1, Math.min(5, stars)),
      frequency,
      dayOfWeek: frequency === 'weekly' ? dayOfWeek : null,
      assignedTo,
    });
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
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
        <div className="flex gap-2">
          {(['daily', 'weekly'] as const).map((opt) => {
            const active = frequency === opt;
            return (
              <button
                key={opt}
                type="button"
                onClick={() => {
                  setFrequency(opt);
                  if (opt === 'daily') setDayOfWeek(null);
                }}
                aria-pressed={active}
                className="rounded-md border font-semibold"
                style={{
                  flex: 1,
                  minHeight: 44,
                  fontSize: 15,
                  background: active ? 'var(--accent-weak)' : 'var(--surface)',
                  color: active ? 'var(--accent-ink)' : 'var(--text)',
                  borderColor: active ? 'var(--accent)' : 'var(--border)',
                  borderWidth: active ? 2 : 1,
                  textTransform: 'capitalize',
                }}
              >
                {opt}
              </button>
            );
          })}
        </div>
      </div>

      {frequency === 'weekly' && (
        <div className="flex flex-col gap-2">
          <span className="font-medium text-text-muted" style={labelStyle}>
            Day
          </span>
          <div className="flex flex-wrap gap-2">
            {DOW_OPTIONS.map((opt) => {
              const active = dayOfWeek === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setDayOfWeek(opt.value)}
                  aria-pressed={active}
                  className="rounded-md border font-semibold"
                  style={{
                    minHeight: 44,
                    minWidth: 56,
                    padding: '6px 12px',
                    fontSize: 14,
                    background: active ? 'var(--accent-weak)' : 'var(--surface)',
                    color: active ? 'var(--accent-ink)' : 'var(--text)',
                    borderColor: active ? 'var(--accent)' : 'var(--border)',
                    borderWidth: active ? 2 : 1,
                  }}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
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
