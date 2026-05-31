/** API types (mirror backend src/model/types.ts). */
export interface Category {
  id: string;
  name: string;
  color: string;
  icon: string | null;
  updatedAt: string;
}

export interface EventOccurrence {
  id: string;
  masterId: string;
  categoryId: string;
  title: string;
  start: string; // ISO-8601 UTC
  end: string;
  allDay: boolean;
  location?: string;
  isRecurring: boolean;
  occurrenceDate?: string;
}

export interface Dinner {
  date: string; // YYYY-MM-DD
  meal: string;
  updatedAt: string;
}

export type WallView = 'agenda' | 'week' | 'month';
