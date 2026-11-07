// Client-side key derivation (ported from the previous frontend's utils/crypto.js).
// Keys are deterministically derived from `email + 6-digit PIN` so no recovery
// phrase is needed: the same email + PIN always reproduces the same wallet.
//
//   masterSeed   = sha256(email:pin)
//   stellar      = Keypair.fromRawEd25519Seed(sha256(masterSeed:stellar))
//   spendingKey  = hex(sha256(masterSeed:spending))
//   viewing      = NaCl Box keypair from sha256(masterSeed:viewing)
//
// Only `identity_commitment = sha256(spendingKey)` is stored in the `users`
// table — the DB/backend can verify a PIN without ever seeing the keys.

import * as StellarSdk from "@stellar/stellar-sdk";
import nacl from "tweetnacl";

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

export async function deriveKeysFromEmailAndPin(email: string, pin: string): Promise<DerivedKeys> {
  const cleanEmail = email.toLowerCase().trim();
  const cleanPin = pin.trim();

  const masterSeed = await sha256(`${cleanEmail}:${cleanPin}`);

  const stellarSeed = await sha256(`${bytesToHex(masterSeed)}:stellar`);
  const stellarKeypair = StellarSdk.Keypair.fromRawEd25519Seed(Buffer.from(stellarSeed));

  const zkSpendingSeed = await sha256(`${bytesToHex(masterSeed)}:spending`);
  const zkSpendingKey = bytesToHex(zkSpendingSeed);

  const viewingSeed = await sha256(`${bytesToHex(masterSeed)}:viewing`);
  const viewingKeyPair = nacl.box.keyPair.fromSecretKey(viewingSeed);

  return {
    masterSeed: bytesToHex(masterSeed),
    stellar: {
      publicKey: stellarKeypair.publicKey(),
      secretKey: stellarKeypair.secret(),
    },
    spendingKey: zkSpendingKey,
    viewing: {
      publicKey: bytesToHex(viewingKeyPair.publicKey),
      secretKey: bytesToHex(viewingKeyPair.secretKey),
    },
  };
}

/** One-way commitment stored in `users.identity_commitment` for PIN verification. */
export async function identityCommitment(spendingKey: string): Promise<string> {
  return bytesToHex(await sha256(spendingKey));
}

export function isValidPin(pin: string): boolean {
  return /^\d{6}$/.test(pin);
}
