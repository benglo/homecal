import { z } from 'zod';
import { RRule } from 'rrule';

/** Boundary validation (spec §0). Parse failures map to 400 via the error handler. */

const HEX = /^#[0-9A-Fa-f]{6}$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const isoString = z.string().min(1).refine((s) => !Number.isNaN(Date.parse(s)), {
  message: 'must be an ISO-8601 datetime',
});

export const categoryCreate = z.object({
  name: z.string().min(1).max(64),
  color: z.string().regex(HEX, 'color must be #RRGGBB'),
  icon: z.string().max(64).optional(),
});
export const categoryUpdate = categoryCreate.partial().refine((o) => Object.keys(o).length > 0, {
  message: 'no fields to update',
});

const rruleString = z
  .string()
  .min(1)
  .refine((s) => {
    try {
      RRule.fromString(s);
      return true;
    } catch {
      return false;
    }
  }, 'invalid RRULE')
  .refine((s) => /UNTIL=|COUNT=/i.test(s), 'RRULE must be bounded (UNTIL or COUNT)');

export const eventCreate = z
  .object({
    categoryId: z.string().min(1),
    title: z.string().min(1).max(256),
    start: isoString,
    end: isoString,
    allDay: z.boolean().default(false),
    location: z.string().max(256).optional(),
    rrule: rruleString.optional(),
  })
  .refine((o) => Date.parse(o.end) >= Date.parse(o.start), {
    message: 'end must be >= start',
    path: ['end'],
  });

export const eventUpdate = z
  .object({
    categoryId: z.string().min(1).optional(),
    title: z.string().min(1).max(256).optional(),
    start: isoString.optional(),
    end: isoString.optional(),
    allDay: z.boolean().optional(),
    location: z.string().max(256).nullable().optional(),
    rrule: rruleString.nullable().optional(),
  })
  .refine((o) => Object.keys(o).length > 0, { message: 'no fields to update' });

export const windowQuery = z
  .object({ start: isoString, end: isoString })
  .refine((o) => Date.parse(o.end) > Date.parse(o.start), { message: 'end must be after start' })
  .refine((o) => Date.parse(o.end) - Date.parse(o.start) <= 366 * 86_400_000, {
    message: 'window too large (max 1 year)',
  });

export const dinnerUpsert = z.object({ meal: z.string().trim().min(1).max(256) });

export const suggestionsQuery = z.object({
  limit: z.coerce.number().int().positive().max(200).default(50),
});

export const dateParam = z.string().regex(DATE_ONLY, 'date must be YYYY-MM-DD');

export type CategoryCreate = z.infer<typeof categoryCreate>;
export type CategoryUpdate = z.infer<typeof categoryUpdate>;
// Use output type so `allDay` (which has .default) is a required boolean post-parse.
export type EventCreate = z.output<typeof eventCreate>;
export type EventUpdate = z.infer<typeof eventUpdate>;

export const familyMemberCreate = z.object({
  name: z.string().min(1).max(64),
  icon: z.string().min(1).max(16),
});
export const familyMemberUpdate = familyMemberCreate;

export const choreCreate = z
  .object({
    title: z.string().min(1).max(256),
    icon: z.string().min(1).max(16),
    stars: z.number().int().min(1).max(5).default(1),
    frequency: z.enum(['daily', 'weekly']),
    dayOfWeek: z.number().int().min(0).max(6).nullable().optional(),
    assignedTo: z.string().min(1),
    position: z.number().int().min(0).default(0),
  })
  .refine(
    (o) =>
      o.frequency === 'daily'
        ? o.dayOfWeek == null
        : o.dayOfWeek != null && o.dayOfWeek >= 0 && o.dayOfWeek <= 6,
    { message: 'weekly chores require dayOfWeek (0-6); daily chores must not have dayOfWeek', path: ['dayOfWeek'] }
  );

export const choreUpdate = z
  .object({
    title: z.string().min(1).max(256).optional(),
    icon: z.string().min(1).max(16).optional(),
    stars: z.number().int().min(1).max(5).optional(),
    frequency: z.enum(['daily', 'weekly']).optional(),
    dayOfWeek: z.number().int().min(0).max(6).nullable().optional(),
    assignedTo: z.string().min(1).optional(),
    position: z.number().int().min(0).optional(),
  })
  .refine((o) => Object.keys(o).length > 0, { message: 'no fields to update' });

export const choreCompleteBody = z.object({
  date: dateParam,
});

export type FamilyMemberCreate = z.infer<typeof familyMemberCreate>;
export type ChoreCreate = z.output<typeof choreCreate>;
export type ChoreUpdate = z.infer<typeof choreUpdate>;

const VOICE_STATE_KINDS = [
  'idle','listening','thinking','confirming','applied','failed','mic_offline','voice_offline',
] as const;

/** Every intent name `post_audit` may carry. Mirrors `VALID_INTENTS` on the Pi.
 *  Tightened from `z.string().min(1).max(64)` so a typo at the wire is caught
 *  by Zod before it hits the DB column (which intentionally has no CHECK so
 *  adding the 12th intent doesn't force a table rebuild). */
export const VOICE_INTENT_NAMES = [
  'dinner_set', 'chore_complete',
  'query_dinner', 'query_agenda',
  'timer_set', 'timer_query', 'timer_cancel', 'timer_extend',
  'ask_question', 'noise_play', 'joke_tell',
  'unknown',
] as const;
export type VoiceIntentName = (typeof VOICE_INTENT_NAMES)[number];

export const voiceStateBody = z.object({
  utterance_id: z.string().min(1),
  kind: z.enum(VOICE_STATE_KINDS),
  payload: z.unknown().optional(),
});

export const voiceAuditBody = z.object({
  id: z.string().min(1),
  transcript: z.string().min(1).max(2000),
  intent_json: z.string().max(4000).nullable().optional(),
  confidence: z.number().min(0).max(1).nullable().optional(),
  status: z.enum(['applied','confirmed','cancelled','pending','failed','silent_low_conf']),
  duration_ms: z.number().int().nonnegative().nullable().optional(),
  error: z.string().max(500).nullable().optional(),
  // "matcher" = regex path bypassed Haiku; "llm" = Haiku produced the
  // intent. Nullable for non-intent paths (blank STT, hallucination).
  source: z.enum(['matcher','llm']).nullable().optional(),
  intent_name: z.enum(VOICE_INTENT_NAMES).nullable().optional(),
  answer: z.string().max(4000).nullable().optional(),
  concern: z.boolean().nullable().optional(),
  tts_provider: z.enum(['kokoro_lan', 'openrouter', 'clip', 'none']).nullable().optional(),
  tts_latency_ms: z.number().int().min(0).nullable().optional(),
});

export const voiceHeartbeatBody = z.object({
  at: z.string().datetime(),
});

export const voiceMuteBody = z.object({
  until: z.string().datetime().nullable(),
});

// Kitchen timer caps: 8h max because a longer one is almost certainly an
// STT misparse ("eight hours" instead of "eight minutes"), and a "one second"
// timer is useless — collapses straight into the expiry chime.
const TIMER_MIN_SEC = 5;
const TIMER_MAX_SEC = 8 * 60 * 60;

export const timerCreate = z.object({
  label: z.string().trim().min(1).max(64).nullable().optional(),
  durationSec: z.number().int().min(TIMER_MIN_SEC).max(TIMER_MAX_SEC),
});

export const timerExtend = z.object({
  addSec: z.number().int().min(1).max(TIMER_MAX_SEC),
});
