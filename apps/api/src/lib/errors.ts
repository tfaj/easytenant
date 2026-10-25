import type { ContentfulStatusCode } from "hono/utils/http-status";

export class AppError extends Error {
  constructor(
    public status: ContentfulStatusCode,
    public code: string,
    message: string,
    public details?: unknown
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new AppError(400, "bad_request", message, details);
export const unauthorized = (message = "Sign in to continue.") =>
  new AppError(401, "unauthorized", message);
export const forbidden = (message = "You don't have permission to do that.") =>
  new AppError(403, "forbidden", message);
export const notFound = (what = "Item") => new AppError(404, "not_found", `${what} not found.`);
export const conflict = (message: string) => new AppError(409, "conflict", message);
export const gone = (message: string) => new AppError(410, "gone", message);
