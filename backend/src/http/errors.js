import { logger } from "./logger.js";

// Shared HTTP error handling. Services throw HttpError for anything the caller
// should see; everything else is logged and answered with a generic message,
// so internal details never reach a client.

export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}

/** Express 4 doesn't catch rejected promises from async handlers. */
export const asyncHandler = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

export function notFound(req, res) {
  res.status(404).json({ error: "Not found.", code: "not_found" });
}

export function errorMiddleware(err, req, res, next) {
  if (res.headersSent) return next(err);
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, ...(err.code ? { code: err.code } : {}) });
  }
  // body-parser
  if (err?.type === "entity.parse.failed") return res.status(400).json({ error: "Invalid JSON.", code: "invalid_json" });
  if (err?.type === "entity.too.large") return res.status(413).json({ error: "Request is too large.", code: "too_large" });

  logger.error("Unhandled request error", err, { method: req.method, route: req.route?.path });
  res.status(500).json({ error: "Something went wrong. Please try again.", requestId: req.id });
}
