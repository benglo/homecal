import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type {
  Category,
  Chore,
  ChoreBoard,
  Dinner,
  EventMaster,
  EventOccurrence,
  FamilyMember,
  Photo,
  WeatherData,
} from '../model/types';

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

export function useWeather() {
  return useQuery<WeatherData>({
    queryKey: ['weather'],
    queryFn: api.weather,
    staleTime: 0,
    refetchInterval: 15 * 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
  });
}

/** Map categories by id for chip lookup. */
export function byId(categories: Category[] | undefined): Map<string, Category> {
  return new Map((categories ?? []).map((c) => [c.id, c]));
}

export function useFamilyMembers() {
  return useQuery<FamilyMember[]>({
    queryKey: ['family-members'],
    queryFn: api.familyMembers,
    staleTime: 5 * 60_000,
  });
}

export function useChores() {
  return useQuery<Chore[]>({
    queryKey: ['chores'],
    queryFn: api.chores,
    staleTime: 5 * 60_000,
  });
}

export function useChoreBoard(date: string) {
  return useQuery<ChoreBoard>({
    queryKey: ['chore-board', date],
    queryFn: () => api.choreBoard(date),
    placeholderData: keepPreviousData,
  });
}
