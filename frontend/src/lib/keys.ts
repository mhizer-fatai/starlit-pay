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

export interface DecryptedNote {
  amount: number;
  asset: string;
  sender?: string;
}

/**
 * Decrypts a `shielded_notes.encrypted_note` with the viewing secret key.
 * Handles the canonical NaCl Box format (hex ephemeral 32B + hex nonce 24B +
 * hex ciphertext, as written by the deposit gateway) plus the plain base64-JSON
 * notes written by the current prototype Send flow. Returns null when the note
 * cannot be decrypted with these keys.
 */
export function decryptShieldedNote(
  encryptedNote: string,
  viewingSecretHex: string,
): DecryptedNote | null {
  if (encryptedNote && /^[0-9a-fA-F]+$/.test(encryptedNote) && encryptedNote.length > 112) {
    try {
      const opened = nacl.box.open(
        hexToBytes(encryptedNote.substring(112)),
        hexToBytes(encryptedNote.substring(64, 112)),
        hexToBytes(encryptedNote.substring(0, 64)),
        hexToBytes(viewingSecretHex),
      );
      if (opened) {
        const obj = JSON.parse(new TextDecoder().decode(opened)) as {
          amount?: unknown;
          asset?: unknown;
          sender?: unknown;
        };
        const amount = Number(obj.amount);
        if (Number.isFinite(amount)) {
          return {
            amount,
            asset: typeof obj.asset === "string" && obj.asset ? obj.asset : "USDC",
            sender: typeof obj.sender === "string" ? obj.sender : undefined,
          };
        }
      }
    } catch {
      /* fall through to prototype format */
    }
  }
  try {
    const obj = JSON.parse(atob(encryptedNote)) as {
      amount?: unknown;
      asset?: unknown;
      sender?: unknown;
    };
    const amount = Number(obj?.amount);
    if (Number.isFinite(amount)) {
      return {
        amount,
        asset: typeof obj.asset === "string" && obj.asset ? obj.asset : "USDC",
        sender: typeof obj.sender === "string" ? obj.sender : undefined,
      };
    }
  } catch {
    /* undecryptable */
  }
  return null;
}
