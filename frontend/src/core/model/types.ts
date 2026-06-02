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

export type WallView = 'agenda' | 'week' | 'month' | 'chores';

export interface Photo {
  id: string;
  filename: string;
  url: string;
  createdAt: string;
}

export interface FamilyMember {
  id: string;
  name: string;
  icon: string;
  updatedAt: string;
}

export interface Chore {
  id: string;
  title: string;
  icon: string;
  stars: number;
  frequency: 'daily' | 'weekly';
  dayOfWeek: number | null;
  assignedTo: string;
  position: number;
  updatedAt: string;
}

export interface BoardChore {
  id: string;
  title: string;
  icon: string;
  stars: number;
  completed: boolean;
  completedAt: string | null;
}

export interface BoardMember {
  id: string;
  name: string;
  icon: string;
  totalStars: number;
  chores: BoardChore[];
}

export interface ChoreBoard {
  date: string;
  members: BoardMember[];
}

export interface ChoreCompletion {
  choreId: string;
  completedDate: string;
  completedAt: string;
}

export interface FamilyMemberInput {
  name: string;
  icon: string;
}

export interface ChoreInput {
  title: string;
  icon: string;
  stars?: number;
  frequency: 'daily' | 'weekly';
  dayOfWeek?: number | null;
  assignedTo: string;
  position?: number;
}

export type ChoreUpdateInput = Partial<ChoreInput>;

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
