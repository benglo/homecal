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

export const dinnerUpsert = z.object({ meal: z.string().min(1).max(256) });
export const dateParam = z.string().regex(DATE_ONLY, 'date must be YYYY-MM-DD');

export type CategoryCreate = z.infer<typeof categoryCreate>;
export type CategoryUpdate = z.infer<typeof categoryUpdate>;
// Use output type so `allDay` (which has .default) is a required boolean post-parse.
export type EventCreate = z.output<typeof eventCreate>;
export type EventUpdate = z.infer<typeof eventUpdate>;
