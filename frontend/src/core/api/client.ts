import type { Category, Dinner, EventOccurrence } from '../model/types';

interface ApiError {
  error: { code: string; message: string };
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { accept: 'application/json' } });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      msg = (await res.json() as ApiError).error.message;
    } catch {
      /* keep status */
    }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export const api = {
  categories: () => get<Category[]>('/api/categories'),
  events: (startIso: string, endIso: string) =>
    get<EventOccurrence[]>(
      `/api/events?start=${encodeURIComponent(startIso)}&end=${encodeURIComponent(endIso)}`
    ),
  dinners: (start: string, end: string) =>
    get<Dinner[]>(`/api/dinners?start=${start}&end=${end}`),
};
