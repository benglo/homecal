import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type {
  CategoryInput,
  EventCreateInput,
  EventOccurrence,
  EventUpdateInput,
} from '../model/types';

/** Patch every cached ['events', …] window in place. Returns a rollback thunk
 *  capturing the prior snapshots so onError can restore them. */
function patchEventQueries(
  qc: QueryClient,
  fn: (occs: EventOccurrence[]) => EventOccurrence[]
): () => void {
  const queries = qc.getQueriesData<EventOccurrence[]>({ queryKey: ['events'] });
  for (const [key, data] of queries) {
    if (data) qc.setQueryData(key, fn(data));
  }
  return () => {
    for (const [key, data] of queries) qc.setQueryData(key, data);
  };
}

// For timed events startIso is a full UTC ISO; for all-day it's a bare 'YYYY-MM-DD'.
// The lexicographic compare is correct for Brisbane (fixed UTC+10): every event window
// starts at 14:00 UTC of the prior calendar day, so a bare date always sorts after the
// window-start key for the same Brisbane day. Boundary slips self-correct on the settle.
export const inWindow = (key: unknown[], startIso: string): boolean => {
  const [, ws, we] = key as [string, string, string];
  return typeof ws === 'string' && typeof we === 'string' && startIso >= ws && startIso < we;
};

/** Event create/update/delete + single-occurrence cancel.
 *  Create is optimistic (the row appears immediately on the wall quick-add);
 *  the SSE poke + invalidate reconcile the authoritative expansion. */
export function useEventMutations() {
  const qc = useQueryClient();
  const settle = () => void qc.invalidateQueries({ queryKey: ['events'] });

  const create = useMutation({
    mutationFn: (body: EventCreateInput) => api.createEvent(body),
    onMutate: async (body) => {
      await qc.cancelQueries({ queryKey: ['events'] });
      const tempId = `temp-${body.start}-${body.title}`;
      const optimistic: EventOccurrence = {
        id: tempId,
        masterId: tempId,
        categoryId: body.categoryId,
        title: body.title,
        start: body.start,
        end: body.end,
        allDay: body.allDay,
        location: body.location,
        isRecurring: !!body.rrule,
        occurrenceDate: body.start,
      };
      const queries = qc.getQueriesData<EventOccurrence[]>({ queryKey: ['events'] });
      const rollback = () => queries.forEach(([k, d]) => qc.setQueryData(k, d));
      for (const [key, data] of queries) {
        if (data && inWindow(key as unknown[], body.start)) {
          qc.setQueryData(key, [...data, optimistic].sort((a, b) => (a.start < b.start ? -1 : 1)));
        }
      }
      return { rollback };
    },
    onError: (_e, _v, ctx) => ctx?.rollback(),
    onSettled: settle,
  });

  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: EventUpdateInput }) => api.updateEvent(id, body),
    onSettled: settle,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteEvent(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ['events'] });
      const rollback = patchEventQueries(qc, (occs) => occs.filter((o) => o.masterId !== id));
      return { rollback };
    },
    onError: (_e, _v, ctx) => ctx?.rollback(),
    onSettled: settle,
  });

  const cancelOccurrence = useMutation({
    mutationFn: ({ id, occurrenceDate }: { id: string; occurrenceDate: string }) =>
      api.cancelOccurrence(id, occurrenceDate),
    onMutate: async ({ id, occurrenceDate }) => {
      await qc.cancelQueries({ queryKey: ['events'] });
      const rollback = patchEventQueries(qc, (occs) =>
        occs.filter((o) => !(o.masterId === id && o.occurrenceDate === occurrenceDate))
      );
      return { rollback };
    },
    onError: (_e, _v, ctx) => ctx?.rollback(),
    onSettled: settle,
  });

  return { create, update, remove, cancelOccurrence };
}

/** Per-day meal set/clear; optimistic against the date-keyed dinner windows. */
export function useDinnerMutations() {
  const qc = useQueryClient();
  const settle = () => void qc.invalidateQueries({ queryKey: ['dinners'] });

  const set = useMutation({
    mutationFn: ({ date, meal }: { date: string; meal: string }) => api.setDinner(date, meal),
    onSettled: settle,
  });

  const clear = useMutation({
    mutationFn: (date: string) => api.deleteDinner(date),
    onSettled: settle,
  });

  return { set, clear };
}

/** Category create/update/delete. Delete surfaces the 409 (CATEGORY_IN_USE) to the caller. */
export function useCategoryMutations() {
  const qc = useQueryClient();
  const settle = () => void qc.invalidateQueries({ queryKey: ['categories'] });

  const create = useMutation({
    mutationFn: (body: CategoryInput) => api.createCategory(body),
    onSettled: settle,
  });

  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<CategoryInput> }) =>
      api.updateCategory(id, body),
    onSettled: settle,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteCategory(id),
    onSettled: () => {
      settle();
      void qc.invalidateQueries({ queryKey: ['events'] });
    },
  });

  // Move all events off `id` onto `toId` (e.g. Uncategorized) so the category can be deleted.
  const reassign = useMutation({
    mutationFn: ({ id, toId }: { id: string; toId: string }) => api.reassignCategory(id, toId),
    onSettled: () => void qc.invalidateQueries({ queryKey: ['events'] }),
  });

  return { create, update, remove, reassign };
}

export function usePhotoMutations() {
  const qc = useQueryClient();
  const settle = () => void qc.invalidateQueries({ queryKey: ['photos'] });

  const remove = useMutation({
    mutationFn: (id: string) => api.deletePhoto(id),
    onSettled: settle,
  });

  return { remove };
}
