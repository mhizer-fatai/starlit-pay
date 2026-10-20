import { createAuthKeys } from "./crypto.js";

const SAME_SITE_VALUES = new Set(["lax", "strict", "none"]);

/**
 * Reads auth-layer configuration from the environment. The layer fails closed:
 * when secrets are missing or weak, `configured` is false and its routes answer 503.
 */
export function readAuthSettings(env = process.env) {
  const errors = [];

  const sessionSecret = env.AUTH_SESSION_SECRET?.trim();
  if (!sessionSecret || sessionSecret.length < 32) {
    errors.push("AUTH_SESSION_SECRET must be set to at least 32 characters.");
  }

  const pinPepperHex = env.PIN_PEPPER_KEY?.trim();
  if (!pinPepperHex || !/^[0-9a-fA-F]{64}$/.test(pinPepperHex)) {
    errors.push("PIN_PEPPER_KEY must be 64 hex characters (32 random bytes).");
  }

  const sameSite = (env.COOKIE_SAMESITE || "lax").toLowerCase();
  if (!SAME_SITE_VALUES.has(sameSite)) {
    errors.push("COOKIE_SAMESITE must be lax, strict or none.");
  }
  const secure = env.COOKIE_SECURE !== "false";
  if (sameSite === "none" && !secure) {
    errors.push("COOKIE_SAMESITE=none requires secure cookies.");
  }

  const origins = (env.WEBAUTHN_ORIGINS || "http://localhost:5173")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

  const configured = errors.length === 0;

  return {
    configured,
    errors,
    keys: configured
      ? createAuthKeys({ sessionSecret, pinPepperKey: Buffer.from(pinPepperHex, "hex") })
      : null,
    rpID: env.WEBAUTHN_RP_ID || "localhost",
    rpName: env.WEBAUTHN_RP_NAME || "Starlit Pay",
    origins,
    cookie: {
      secure,
      sameSite,
      domain: env.COOKIE_DOMAIN || undefined,
    },
    accessTtlSec: 15 * 60,
    refreshTtlSec: 30 * 24 * 60 * 60,
    freshAuthSec: 5 * 60,
    challengeTtlMs: 5 * 60 * 1000,
    pin: {
      maxAttempts: 5,
      baseLockSec: 15 * 60,
      maxLockSec: 24 * 60 * 60,
      setupTicketTtlMs: 10 * 60 * 1000,
      // Argon2id parameters the browser must use to stretch the PIN (about 1s on a phone).
      argon2: { algorithm: "argon2id", memoryKiB: 64 * 1024, iterations: 3, parallelism: 1, hashLength: 32 },
    },
    now: () => Date.now(),
  };
}
