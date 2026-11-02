import { AsyncLocalStorage } from "node:async_hooks";
import crypto from "node:crypto";

// Per-request context, so anything logged while handling a request can be
// traced back to it, without passing an id through every function.

const storage = new AsyncLocalStorage();
const SAFE_ID = /^[\w-]{8,64}$/;

export const currentRequestId = () => storage.getStore()?.requestId;

export function requestContext(req, res, next) {
  const incoming = req.get("x-request-id");
  const requestId = incoming && SAFE_ID.test(incoming) ? incoming : crypto.randomUUID();
  req.id = requestId;
  res.setHeader("X-Request-Id", requestId);
  storage.run({ requestId }, next);
}
