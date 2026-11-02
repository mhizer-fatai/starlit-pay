import { currentRequestId } from "./requestContext.js";

// Structured logs: one JSON object per line in production, readable text in a
// terminal. Takes the same arguments as console; a trailing plain object
// becomes searchable fields.

const pretty = process.env.LOG_FORMAT === "pretty" || (process.env.LOG_FORMAT !== "json" && process.stdout.isTTY);

const isFields = (value) => value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;

// A log line must never be the thing that breaks a payment: Stellar code hands
// around BigInts, which JSON.stringify refuses.
function safeJson(value) {
  try {
    return JSON.stringify(value, (key, v) => (typeof v === "bigint" ? v.toString() : v));
  } catch {
    return String(value);
  }
}
const text = (value) => (value instanceof Error ? value.message : typeof value === "string" ? value : safeJson(value));

export function formatLogLine(level, args, { requestId, time, asJson }) {
  const rest = [...args];
  const fields = rest.length > 1 && isFields(rest.at(-1)) ? rest.pop() : {};
  const message = rest.map(text).join(" ");
  const error = rest.find((value) => value instanceof Error);
  const details = { ...fields, ...(error?.stack ? { stack: error.stack } : {}) };
  // Our own keys go last so a caller's field can't overwrite them.
  const entry = { ...details, level, time, ...(requestId ? { requestId } : {}), message };
  if (asJson) return safeJson(entry);
  const extras = Object.keys(details).length ? ` ${safeJson(details)}` : "";
  return `${time} ${level.toUpperCase()}${requestId ? ` [${requestId.slice(0, 8)}]` : ""} ${message}${extras}`;
}

function write(level, args) {
  const line = formatLogLine(level, args, { requestId: currentRequestId(), time: new Date().toISOString(), asJson: !pretty });
  (level === "error" ? process.stderr : process.stdout).write(`${line}\n`);
}

export const logger = {
  info: (...args) => write("info", args),
  warn: (...args) => write("warn", args),
  error: (...args) => write("error", args),
};

// Paths can carry secrets (relay tokens) or identifiers (viewing keys, user
// ids), so a request is logged by its route pattern, never its real URL.
const redactPath = (path) => path.replace(/[A-Za-z0-9_-]{20,}/g, ":id");

export function accessLog(req, res, next) {
  const startedAt = performance.now();
  const requestId = req.id;
  res.on("finish", () => {
    const route = req.route?.path ?? redactPath(req.path);
    const fields = {
      requestId,
      method: req.method,
      route: Array.isArray(route) ? route.join("|") : String(route),
      status: res.statusCode,
      durationMs: Math.round(performance.now() - startedAt),
    };
    (res.statusCode >= 500 ? logger.error : logger.info)("request", fields);
  });
  next();
}
