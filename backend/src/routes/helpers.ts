import type { z } from 'zod';
import { httpError } from '../util/errors';

/** Validate a request body/query with zod; throw a 400 with a useful message on failure. */
export function parseBody<S extends z.ZodTypeAny>(schema: S, data: unknown): z.output<S> {
  const res = schema.safeParse(data);
  if (!res.success) {
    const msg = res.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw httpError(400, 'VALIDATION', msg);
  }
  return res.data;
}
