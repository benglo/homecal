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

/** GET /api/events/:id — the underlying master, for editing a series. */
export interface EventMaster {
  id: string;
  categoryId: string;
  title: string;
  start: string; // ISO-8601 UTC
  end: string;
  allDay: boolean;
  location: string | null;
  rrule: string | null;
  updatedAt: string;
}

/** Body for POST /api/events. `undefined` fields are omitted by the client. */
export interface EventCreateInput {
  categoryId: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location?: string;
  rrule?: string;
}

/** Body for PUT /api/events/:id. `location`/`rrule` accept null to clear. */
export type EventUpdateInput = Partial<{
  categoryId: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location: string | null;
  rrule: string | null;
}>;

export interface CategoryInput {
  name: string;
  color: string;
  icon?: string;
}

export interface Dinner {
  date: string; // YYYY-MM-DD
  meal: string;
  updatedAt: string;
}

export type WallView = 'agenda' | 'week' | 'month';

export interface Photo {
  id: string;
  filename: string;
  url: string;
  createdAt: string;
}

export interface WeatherData {
  temperature: number | null;
  feelsLike: number | null;
  condition: string;
  description: string;
  humidity: number | null;
  windSpeed: number | null;
  windDirection: string;
  pressure: number | null;
  stationName: string;
  observationTime: string | null;
  fetchedAt: string;
  stale?: boolean;
}
