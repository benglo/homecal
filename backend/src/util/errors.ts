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
