import type {
  Category,
  CategoryInput,
  Chore,
  ChoreBoard,
  ChoreCompletion,
  ChoreInput,
  ChoreUpdateInput,
  Dinner,
  DinnerSuggestion,
  EventCreateInput,
  EventMaster,
  EventOccurrence,
  EventUpdateInput,
  FamilyMember,
  FamilyMemberInput,
  Photo,
  Timer,
  VoiceConcern,
  VoiceStatus,
  WeatherData,
} from '../model/types';

/** Carries the server's error envelope so the UI can branch on `code`
 *  (e.g. CATEGORY_IN_USE → 409) and show `message` in an editor. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface Envelope {
  error: { code: string; message: string };
}

async function parseError(res: Response): Promise<ApiError> {
  let code = res.status >= 500 ? 'INTERNAL' : 'BAD_REQUEST';
  let message = `HTTP ${res.status}`;
  try {
    const body = (await res.json()) as Envelope;
    if (body?.error) {
      code = body.error.code;
      message = body.error.message;
    }
  } catch {
    /* keep the status-derived defaults */
  }
  return new ApiError(res.status, code, message);
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { accept: 'application/json' } });
  if (!res.ok) throw await parseError(res);
  return res.json() as Promise<T>;
}

/** POST/PUT/DELETE with a JSON body. Returns parsed JSON, or undefined on 204. */
async function send<T>(method: 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? { accept: 'application/json' } : { accept: 'application/json', 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  // reads
  categories: () => get<Category[]>('/api/categories'),
  events: (startIso: string, endIso: string) =>
    get<EventOccurrence[]>(
      `/api/events?start=${encodeURIComponent(startIso)}&end=${encodeURIComponent(endIso)}`
    ),
  eventMaster: (id: string) => get<EventMaster>(`/api/events/${id}`),
  dinners: (start: string, end: string) =>
    get<Dinner[]>(`/api/dinners?start=${start}&end=${end}`),

  // event writes
  createEvent: (body: EventCreateInput) => send<EventMaster>('POST', '/api/events', body),
  updateEvent: (id: string, body: EventUpdateInput) => send<EventMaster>('PUT', `/api/events/${id}`, body),
  deleteEvent: (id: string) => send<void>('DELETE', `/api/events/${id}`),
  cancelOccurrence: (id: string, occurrenceDate: string) =>
    send<void>('DELETE', `/api/events/${id}/occurrences/${encodeURIComponent(occurrenceDate)}`),

  // dinner writes
  setDinner: (date: string, meal: string) => send<Dinner>('PUT', `/api/dinners/${date}`, { meal }),
  deleteDinner: (date: string) => send<void>('DELETE', `/api/dinners/${date}`),
  dinnerSuggestions: (limit = 50) =>
    get<DinnerSuggestion[]>(`/api/dinners/suggestions?limit=${limit}`),

  // category writes
  createCategory: (body: CategoryInput) => send<Category>('POST', '/api/categories', body),
  updateCategory: (id: string, body: Partial<CategoryInput>) => send<Category>('PUT', `/api/categories/${id}`, body),
  deleteCategory: (id: string) => send<void>('DELETE', `/api/categories/${id}`),
  reassignCategory: (id: string, toId: string) =>
    send<{ moved: number }>('POST', `/api/categories/${id}/reassign`, { toId }),

  // photo reads
  photos: () => get<{ data: Photo[] }>('/api/photos').then((r) => r.data),

  // photo writes
  deletePhoto: (id: string) => send<void>('DELETE', `/api/photos/${id}`),

  // kiosk
  shutdownKiosk: () => send<{ ok: boolean; message: string }>('POST', '/api/kiosk/shutdown'),

  // weather
  weather: () => get<WeatherData>('/api/weather'),

  // family members
  familyMembers: () => get<FamilyMember[]>('/api/family-members'),
  createFamilyMember: (body: FamilyMemberInput) => send<FamilyMember>('POST', '/api/family-members', body),
  updateFamilyMember: (id: string, body: FamilyMemberInput) => send<FamilyMember>('PUT', `/api/family-members/${id}`, body),
  deleteFamilyMember: (id: string) => send<void>('DELETE', `/api/family-members/${id}`),

  // chores
  chores: () => get<Chore[]>('/api/chores'),
  createChore: (body: ChoreInput) => send<Chore>('POST', '/api/chores', body),
  updateChore: (id: string, body: ChoreUpdateInput) => send<Chore>('PUT', `/api/chores/${id}`, body),
  deleteChore: (id: string) => send<void>('DELETE', `/api/chores/${id}`),

  // chore board + completion
  choreBoard: (date: string) => get<ChoreBoard>(`/api/chore-board?date=${date}`),
  completeChore: (id: string, date: string) =>
    send<ChoreCompletion>('POST', `/api/chores/${id}/complete`, { date }),
  uncompleteChore: (id: string, date: string) =>
    send<void>('DELETE', `/api/chores/${id}/complete/${date}`),

  // voice
  voiceStatus: () => get<VoiceStatus>('/api/voice/status'),
  voiceConcerns: (since?: string) =>
    get<VoiceConcern[]>(`/api/voice/concerns${since ? '?since=' + encodeURIComponent(since) : ''}`),
  setVoiceMute: (until: string | null) =>
    send<{ ok: true; mute_until: string | null }>('PUT', '/api/voice/mute', { until }),

  // timers
  timers: () => get<Timer[]>('/api/timers'),
  cancelTimer: (id: string) => send<void>('DELETE', `/api/timers/${id}`),
  acknowledgeTimer: (id: string) => send<Timer>('POST', `/api/timers/${id}/acknowledge`),
};
