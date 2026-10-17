import crypto from "node:crypto";

// Server-side primitives for the passkey auth layer. Nothing here can decrypt a
// user's vault: the server only stores and compares opaque values.

export const toB64u = (buf) => Buffer.from(buf).toString("base64url");
export const fromB64u = (str) => Buffer.from(str, "base64url");

/** Derives an independent 32-byte subkey for one purpose from a root secret. */
export function deriveKey(rootSecret, label) {
  return Buffer.from(crypto.hkdfSync("sha256", rootSecret, Buffer.alloc(0), `starlit-auth:${label}`, 32));
}

export function createAuthKeys({ sessionSecret, pinPepperKey }) {
  return {
    accessJwt: deriveKey(sessionSecret, "access-jwt"),
    refreshToken: deriveKey(sessionSecret, "refresh-token"),
    setupTicket: deriveKey(sessionSecret, "pin-setup-ticket"),
    pinVerifier: deriveKey(pinPepperKey, "pin-verifier"),
    serverShare: deriveKey(pinPepperKey, "pin-server-share"),
    recoveryCode: deriveKey(pinPepperKey, "recovery-code"),
  };
}

/** HMAC-SHA256 over length-prefixed parts, returned as base64url. */
export function mac(key, ...parts) {
  const h = crypto.createHmac("sha256", key);
  for (const part of parts) {
    const bytes = Buffer.isBuffer(part) ? part : Buffer.from(String(part), "utf8");
    const len = Buffer.alloc(4);
    len.writeUInt32BE(bytes.length);
    h.update(len);
    h.update(bytes);
  }
  return h.digest("base64url");
}

/** Constant-time comparison of two strings. */
export function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/** AES-256-GCM seal: base64url(iv | tag | ciphertext). `aad` binds the value to its context. */
export function seal(key, plaintext, aad) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return toB64u(Buffer.concat([iv, cipher.getAuthTag(), ct]));
}

/** Opens a value produced by seal(); returns null if it was tampered with or the context differs. */
export function open(key, sealed, aad) {
  try {
    const raw = fromB64u(sealed);
    if (raw.length < 28) return null;
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]);
  } catch {
    return null;
  }
}

export function randomToken(bytes = 32) {
  return toB64u(crypto.randomBytes(bytes));
}

/** Validates a base64url string that must decode to exactly `bytes` bytes. */
export function isB64uOfLength(value, bytes) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) return false;
  return fromB64u(value).length === bytes;
}

/** Validates a base64url string whose encoded length is within bounds. */
export function isB64uWithin(value, minChars, maxChars) {
  return (
    typeof value === "string" &&
    value.length >= minChars &&
    value.length <= maxChars &&
    /^[A-Za-z0-9_-]+$/.test(value)
  );
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isUuid = (value) => typeof value === "string" && UUID_RE.test(value);

export function uuidToBytes(uuid) {
  return Buffer.from(uuid.replace(/-/g, ""), "hex");
}
