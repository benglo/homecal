import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Category, Dinner, EventOccurrence } from '../model/types';

export function useCategories() {
  return useQuery({
    queryKey: ['categories'],
    queryFn: api.categories,
    staleTime: 5 * 60_000,
  });
}

export function useEvents(startIso: string, endIso: string) {
  return useQuery<EventOccurrence[]>({
    queryKey: ['events', startIso, endIso],
    queryFn: () => api.events(startIso, endIso),
    placeholderData: keepPreviousData,
  });
}

export function useDinners(start: string, end: string) {
  return useQuery<Dinner[]>({
    queryKey: ['dinners', start, end],
    queryFn: () => api.dinners(start, end),
    placeholderData: keepPreviousData,
  });
}

/** Map categories by id for chip lookup. */
export function byId(categories: Category[] | undefined): Map<string, Category> {
  return new Map((categories ?? []).map((c) => [c.id, c]));
}
