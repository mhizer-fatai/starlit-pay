// Small key helpers. The wallet's keys themselves are random and live in the
// encrypted vault (lib/vault); `identity_commitment = sha256(spendingKey)` is
// the only key-derived value the users table holds.

export function stringToBytes(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

export async function sha256(message: string): Promise<Uint8Array> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", stringToBytes(message) as BufferSource);
  return new Uint8Array(hashBuffer);
}

export interface DerivedKeys {
  masterSeed: string;
  stellar: { publicKey: string; secretKey: string };
  spendingKey: string;
  viewing: { publicKey: string; secretKey: string };
}

/** One-way commitment stored in `users.identity_commitment` for PIN verification. */
export async function identityCommitment(spendingKey: string): Promise<string> {
  return bytesToHex(await sha256(spendingKey));
}

export function isValidPin(pin: string): boolean {
  return /^\d{6}$/.test(pin);
}
