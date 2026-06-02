import { useState } from 'react';
import type { Chore } from '../../core/model/types';
import { useChores, useFamilyMembers } from '../../core/hooks/useData';
import { useChoreMutations } from '../../core/hooks/useMutations';
import { ApiError } from '../../core/api/client';
import { SectionHeading } from './primitives/SectionHeading';
import { InlineAddButton } from './primitives/InlineAddButton';
import { ChoreForm } from './ChoreForm';
import { ChoreRow } from './ChoreRow';

type EditState =
  | { mode: 'edit'; id: string }
  | { mode: 'add'; memberId: string }
  | null;

const formShellStyle = { background: 'var(--surface)' } as const;

/** Manage-tab list of chores grouped by family member. Inline add/edit, delete with
 *  confirm, ±1 position reorder by swapping with the in-group neighbour.
 *
 *  Form lives in `ChoreForm`, row chrome in `ChoreRow` — this file owns the per-member
 *  grouping, edit/add/confirm state, and the mutation wiring. */
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

  /** Swap position with the neighbour above/below in the same member's list.
   *  Chained so a partial failure (first PUT succeeds, second fails) can't leave
   *  two chores sharing the same position silently — the second only fires once
   *  the first has been accepted. */
  const move = (chore: Chore, group: Chore[], dir: -1 | 1) => {
    const idx = group.findIndex((c) => c.id === chore.id);
    const neighbour = group[idx + dir];
    if (!neighbour) return;
    setError(null);
    const onReorderError = (err: unknown) =>
      setError({
        id: chore.id,
        message: err instanceof ApiError ? err.message : 'Could not reorder — try again.',
      });
    update.mutate(
      { id: chore.id, body: { position: neighbour.position } },
      {
        onSuccess: () => {
          update.mutate(
            { id: neighbour.id, body: { position: chore.position } },
            { onError: onReorderError }
          );
        },
        onError: onReorderError,
      }
    );
  };

  // Group by member, sorted by position.
  const grouped = members.map((m) => ({
    member: m,
    items: chores.filter((c) => c.assignedTo === m.id).sort((a, b) => a.position - b.position),
  }));

  return (
    <section style={{ marginBottom: 24 }}>
      <SectionHeading>Chores</SectionHeading>

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
                style={{ width: 28, height: 28, fontSize: 16, background: 'var(--surface-2)' }}
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
                const rowError = error?.id === c.id ? error.message : null;
                return (
                  <li key={c.id}>
                    {isEditing ? (
                      <div className="rounded-md border border-border" style={formShellStyle}>
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
                      </div>
                    ) : (
                      <ChoreRow
                        chore={c}
                        canUp={idx > 0}
                        canDown={idx < items.length - 1}
                        reorderPending={update.isPending}
                        removePending={remove.isPending}
                        isConfirming={confirmDelete === c.id}
                        errorMessage={rowError}
                        onMoveUp={() => move(c, items, -1)}
                        onMoveDown={() => move(c, items, 1)}
                        onEdit={() => startEdit(c)}
                        onRequestDelete={() => {
                          setConfirmDelete(c.id);
                          setError(null);
                        }}
                        onConfirmDelete={() => confirmDeleteFor(c)}
                        onCancelDelete={() => setConfirmDelete(null)}
                      />
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
              <InlineAddButton onClick={() => startAdd(member.id)}>
                Add chore for {member.name}
              </InlineAddButton>
            )}
          </div>
        );
      })}
    </section>
  );
}
