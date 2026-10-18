// Recovery code: 128 random bits shown to the user once, written as 28
// Crockford base32 characters (26 data + 2 checksum) in groups of four:
//   7Q2M-8XKD-PA4T-V0RN-3HJC-W9ZB-E6QF
// Crockford's alphabet has no I, L, O or U, and the parser accepts the usual
// misreadings (O→0, I/L→1). The checksum catches typos before any network call.
// 128 bits is far beyond brute force, so no Argon2 stretching is needed.

import { deriveKek, hkdf, toB64u, wipe } from "./crypto";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE_BYTES = 16;
const DATA_CHARS = 26; // 130 bits: 128 data bits + 2 zero bits
const CHECK_CHARS = 2; // 10 bits of SHA-256

export interface RecoveryCode {
  /** Formatted for display, e.g. "7Q2M-8XKD-…". */
  display: string;
  bytes: Uint8Array;
}

function encodeBase32(bytes: Uint8Array, chars: number): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out.slice(0, chars);
}

async function checksum(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
  return encodeBase32(digest.subarray(0, 2), CHECK_CHARS);
}

const group = (code: string) => code.match(/.{1,4}/g)!.join("-");

export async function generateRecoveryCode(): Promise<RecoveryCode> {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_BYTES));
  const display = group(encodeBase32(bytes, DATA_CHARS) + (await checksum(bytes)));
  return { display, bytes };
}

/** Parses what the user typed. Returns the 16 code bytes, or null if invalid. */
export async function parseRecoveryCode(input: string): Promise<Uint8Array | null> {
  const normalized = input
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
  if (normalized.length !== DATA_CHARS + CHECK_CHARS) return null;

  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of normalized.slice(0, DATA_CHARS)) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) return null;
    value = ((value << 5) | v) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  if (out.length !== CODE_BYTES || (value & ((1 << bits) - 1)) !== 0) return null;

  const bytes = Uint8Array.from(out);
  if ((await checksum(bytes)) !== normalized.slice(DATA_CHARS)) {
    wipe(bytes);
    return null;
  }
  return bytes;
}

export interface RecoveryMaterial {
  /** Sent to the server, which stores only an HMAC of it. */
  verifier: string;
  /** Key-encryption key for the recovery wrap of the data key. */
  kek: CryptoKey;
}

export async function recoveryMaterial(codeBytes: Uint8Array): Promise<RecoveryMaterial> {
  const verifierBytes = await hkdf(codeBytes, "recovery:verifier");
  const verifier = toB64u(verifierBytes);
  wipe(verifierBytes);
  return { verifier, kek: await deriveKek(codeBytes, "kek:recovery") };
}
