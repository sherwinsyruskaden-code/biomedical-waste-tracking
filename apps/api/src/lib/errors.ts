/** Errors that are safe to show to the client. Anything else becomes a generic 500. */
export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) => new AppError(400, "bad_request", message, details);
export const unauthorized = (message = "Please sign in to continue.") => new AppError(401, "unauthorized", message);
export const forbidden = (message = "You do not have permission to do that.") => new AppError(403, "forbidden", message);
export const notFound = (what = "Resource") => new AppError(404, "not_found", `${what} not found.`);
export const conflict = (message: string, details?: unknown) => new AppError(409, "conflict", message, details);
export const invalidTransition = (message: string, details?: unknown) =>
  new AppError(422, "invalid_transition", message, details);
