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

export interface DinnerSuggestion {
  meal: string;
  count: number;
  lastUsed: string;
}

export interface Timer {
  id: string;
  label: string | null;
  durationSec: number;
  startedAt: string;
  expiresAt: string;
  acknowledgedAt: string | null;
  updatedAt: string;
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

export type ParsedIntent =
  | { intent: 'dinner_set'; date: string; meal: string; confidence: number }
  | { intent: 'chore_complete'; person: string; chore: string; confidence: number }
  | { intent: 'query_dinner'; date: string; confidence: number }
  | { intent: 'query_agenda'; date: string; confidence: number }
  | { intent: 'timer_set'; duration_sec: number; label: string | null; confidence: number }
  | { intent: 'timer_query'; label: string | null; confidence: number }
  | { intent: 'timer_cancel'; label: string | null; confidence: number }
  | { intent: 'timer_extend'; duration_sec: number; label: string | null; confidence: number }
  | { intent: 'ask_question'; answer: string; confidence: number; concern?: boolean }
  | { intent: 'noise_play'; catalog_key?: string; play_catalog?: string; fallback_text?: string; confidence: number }
  | { intent: 'joke_tell'; joke_id?: string; setup: string; punchline: string; confidence: number }
  | { intent: 'event_add'; title: string; date: string; time?: string; duration_min?: number; category?: string; confidence: number }
  | { intent: 'unknown'; reason: string; confidence: number };

export type VoiceOverlayKind =
  | 'idle' | 'listening' | 'thinking' | 'confirming'
  | 'applied' | 'failed' | 'mic_offline' | 'voice_offline';

export type TtsProvider = 'kokoro_lan' | 'openrouter' | 'clip' | 'none';

export interface VoiceStatus {
  mic_online: boolean;
  last_heartbeat_at: string | null;
  mute_until: string | null;
  muted: boolean;
  last_tts_provider: TtsProvider | null;
  volume: number;
  audio_muted: boolean;
}

export interface VoiceConcern {
  id: string;
  createdAt: string;
  transcript: string;
  answer: string | null;
  intentName: string | null;
}
