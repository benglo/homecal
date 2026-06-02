/** Error carrying an HTTP status + stable code for the response envelope (spec §0). */
export interface AppError extends Error {
  statusCode: number;
  code: string;
}

export function httpError(statusCode: number, code: string, message: string): AppError {
  const err = new Error(message) as AppError;
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

/**
 * Translate a SQLite UNIQUE constraint violation into a 409 DUPLICATE_NAME error.
 * Returns the unmodified error otherwise. Callers re-throw the result, matching
 * the existing `throw uniqueOr(e, msg)` shape used in repos.
 */
export function uniqueOr(e: unknown, msg: string): Error {
  if (e instanceof Error && /UNIQUE constraint failed/.test(e.message)) {
    return httpError(409, 'DUPLICATE_NAME', msg);
  }
  return e as Error;
}
