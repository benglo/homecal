import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type {
  Category,
  Chore,
  ChoreBoard,
  Dinner,
  DinnerSuggestion,
  EventMaster,
  EventOccurrence,
  FamilyMember,
  Photo,
  Timer,
  VoiceStatus,
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

/** Distinct meal history for the editor's typeahead. Invalidated locally on
 *  every dinner mutation (useDinnerMutations.settle) AND fanned out by the
 *  SSE 'dinners' poke (useRealtime.KIND_TO_KEYS) — the local invalidation
 *  is the fast path; SSE is the backstop for cross-device edits. */
export function useDinnerSuggestions() {
  return useQuery<DinnerSuggestion[]>({
    queryKey: ['dinner-suggestions'],
    queryFn: () => api.dinnerSuggestions(),
    staleTime: 60_000,
  });
}

export function useVoiceStatus() {
  return useQuery<VoiceStatus>({
    queryKey: ['voice-status'],
    queryFn: () => api.voiceStatus(),
    staleTime: 5 * 60_000,
  });
}

/** Active (un-acknowledged) timers. SSE 'timers' poke invalidates on every
 *  mutation; the local clock ticks the countdown so no per-second polling
 *  is needed. staleTime:0 because a countdown is inherently time-sensitive
 *  — any remount should re-fetch rather than serve a cached list. */
export function useTimers() {
  return useQuery<Timer[]>({
    queryKey: ['timers'],
    queryFn: api.timers,
    staleTime: 0,
  });
}
