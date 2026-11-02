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

export function errorMiddleware(err, req, res, next) {
  if (res.headersSent) return next(err);
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, ...(err.code ? { code: err.code } : {}) });
  }
  console.error(`${req.method} ${req.path} failed:`, err?.message ?? err);
  res.status(500).json({ error: "Something went wrong. Please try again." });
}
