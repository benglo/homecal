import { useState } from 'react';
import { Pencil, Trash2, Plus } from 'lucide-react';
import type { FamilyMember } from '../../core/model/types';
import { useFamilyMembers } from '../../core/hooks/useData';
import { useFamilyMemberMutations } from '../../core/hooks/useMutations';
import { ApiError } from '../../core/api/client';
import { Button } from '../primitives/Button';
import { TextInput } from '../sheets/fields';

type EditState = { mode: 'edit'; id: string } | { mode: 'add' } | null;

/** Manage-tab list of family members: inline edit + delete (with cascade warning) + inline add.
 *  Style mirrors CategoryManager — sectioned list with rounded rows, 48×48 icon-only Edit/Delete
 *  buttons, and inline error messaging beneath the offending row. Forms are plain controlled
 *  state (no react-hook-form, per repo convention) and reuse the shared TextInput field. */
export function FamilyMemberManager() {
  const familyMembersQ = useFamilyMembers();
  const { create, update, remove } = useFamilyMemberMutations();
  const [editing, setEditing] = useState<EditState>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string | 'add'; message: string } | null>(null);

  const members = familyMembersQ.data ?? [];

  const startEdit = (m: FamilyMember) => {
    setEditing({ mode: 'edit', id: m.id });
    setConfirmDelete(null);
    setError(null);
  };

  const startAdd = () => {
    setEditing({ mode: 'add' });
    setConfirmDelete(null);
    setError(null);
  };

  const cancel = () => {
    setEditing(null);
    setError(null);
  };

  const requestDelete = (id: string) => {
    setConfirmDelete(id);
    setError(null);
  };

  const confirmDeleteFor = (m: FamilyMember) => {
    setError(null);
    remove.mutate(m.id, {
      onSuccess: () => setConfirmDelete(null),
      onError: (err) =>
        setError({
          id: m.id,
          message: err instanceof ApiError ? err.message : 'Could not delete this family member.',
        }),
    });
  };

  return (
    <section style={{ marginBottom: 24 }}>
      <h2
        className="font-semibold text-text-muted"
        style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}
      >
        Family members
      </h2>

      {familyMembersQ.isPending && (
        <p className="text-text-faint" style={{ fontSize: 14, padding: '8px 0' }}>
          Loading…
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {members.map((m) => {
          const isEditing = editing?.mode === 'edit' && editing.id === m.id;
          const isConfirming = confirmDelete === m.id;
          const rowError = error?.id === m.id ? error.message : null;
          return (
            <li
              key={m.id}
              className="rounded-md border border-border"
              style={{ background: 'var(--surface)' }}
            >
              {isEditing ? (
                <MemberForm
                  initialName={m.name}
                  initialIcon={m.icon}
                  submitLabel="Save"
                  isPending={update.isPending}
                  errorMessage={rowError}
                  onCancel={cancel}
                  onSubmit={(body) =>
                    update.mutate(
                      { id: m.id, body },
                      {
                        onSuccess: () => {
                          setEditing(null);
                          setError(null);
                        },
                        onError: (err) =>
                          setError({
                            id: m.id,
                            message:
                              err instanceof ApiError ? err.message : 'Could not save — try again.',
                          }),
                      },
                    )
                  }
                />
              ) : (
                <>
                  <div className="flex items-center gap-3" style={{ padding: '10px 12px' }}>
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
                      {m.icon || '👤'}
                    </span>
                    <span
                      className="flex-1 min-w-0 font-semibold text-text truncate"
                      style={{ fontSize: 16 }}
                    >
                      {m.name}
                    </span>
                    <button
                      type="button"
                      onClick={() => startEdit(m)}
                      aria-label={`Edit ${m.name}`}
                      className="grid place-items-center rounded-md text-text-muted"
                      style={{ width: 48, height: 48 }}
                    >
                      <Pencil size={18} />
                    </button>
                    <button
                      type="button"
                      onClick={() => requestDelete(m.id)}
                      aria-label={`Delete ${m.name}`}
                      className="grid place-items-center rounded-md"
                      style={{ width: 48, height: 48, color: 'var(--stale)' }}
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
                        Delete <strong>{m.name}</strong>? All of their chores will be removed too.
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="danger"
                          onClick={() => confirmDeleteFor(m)}
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

      {editing?.mode === 'add' ? (
        <div
          className="rounded-md border border-border"
          style={{ background: 'var(--surface)', marginTop: 10 }}
        >
          <MemberForm
            initialName=""
            initialIcon=""
            submitLabel="Add"
            isPending={create.isPending}
            errorMessage={error?.id === 'add' ? error.message : null}
            onCancel={cancel}
            onSubmit={(body) =>
              create.mutate(body, {
                onSuccess: () => {
                  setEditing(null);
                  setError(null);
                },
                onError: (err) =>
                  setError({
                    id: 'add',
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
          onClick={startAdd}
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
          Add family member
        </button>
      )}
    </section>
  );
}

interface FormProps {
  initialName: string;
  initialIcon: string;
  submitLabel: string;
  isPending: boolean;
  errorMessage: string | null;
  onCancel: () => void;
  onSubmit: (body: { name: string; icon: string }) => void;
}

/** Inline create/edit form for a family member. Plain controlled state. */
function MemberForm({
  initialName,
  initialIcon,
  submitLabel,
  isPending,
  errorMessage,
  onCancel,
  onSubmit,
}: FormProps) {
  const [name, setName] = useState(initialName);
  const [icon, setIcon] = useState(initialIcon);

  const trimmedName = name.trim();
  const canSave = trimmedName.length > 0 && !isPending;

  const submit = () => {
    if (!canSave) return;
    onSubmit({ name: trimmedName, icon: icon.trim() });
  };

  return (
    <div className="flex flex-col gap-3" style={{ padding: 12 }}>
      <div className="flex flex-col gap-2">
        <label
          className="font-medium text-text-muted"
          style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4 }}
        >
          Name
          <TextInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Mia"
            autoFocus
            style={{ marginTop: 6 }}
          />
        </label>
      </div>
      <div className="flex flex-col gap-2">
        <label
          className="font-medium text-text-muted"
          style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4 }}
        >
          Icon
          <TextInput
            value={icon}
            onChange={(e) => setIcon(e.target.value)}
            placeholder="e.g. 🦊 or initials"
            style={{ marginTop: 6 }}
          />
        </label>
      </div>
      {errorMessage && (
        <p
          className="text-text-muted"
          style={{ fontSize: 13, color: 'var(--stale)' }}
          role="alert"
        >
          {errorMessage}
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
