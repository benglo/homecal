import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Category, Dinner, EventMaster, EventOccurrence, Photo } from '../model/types';

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

/** The underlying master for a series — fetched only while a series editor is open. */
export function useEventMaster(id: string | null) {
  return useQuery<EventMaster>({
    queryKey: ['eventMaster', id],
    queryFn: () => api.eventMaster(id!),
    enabled: !!id,
    staleTime: 0,
  });
}

export function useDinners(start: string, end: string) {
  return useQuery<Dinner[]>({
    queryKey: ['dinners', start, end],
    queryFn: () => api.dinners(start, end),
    placeholderData: keepPreviousData,
  });
}

export function usePhotos() {
  return useQuery<Photo[]>({
    queryKey: ['photos'],
    queryFn: api.photos,
    staleTime: 5 * 60_000,
  });
}

/** Map categories by id for chip lookup. */
export function byId(categories: Category[] | undefined): Map<string, Category> {
  return new Map((categories ?? []).map((c) => [c.id, c]));
}
