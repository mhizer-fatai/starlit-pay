import nacl from "tweetnacl";
import * as StellarSdk from "@stellar/stellar-sdk";

export function stringToBytes(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

export async function sha256(message: string | Uint8Array): Promise<Uint8Array> {
  const bytes = typeof message === "string" ? stringToBytes(message) : message;
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const hashBuffer = await crypto.subtle.digest("SHA-256", copy);
  return new Uint8Array(hashBuffer);
}

export interface EncryptedNotePayload {
  ephemeralPublicKey: string;
  nonce: string;
  ciphertext: string;
}

export function encryptNote(
  amount: number | string,
  asset: string,
  secret: string,
  senderUsername: string,
  recipientPublicEncryptionKeyHex: string
): EncryptedNotePayload {
  const payload = JSON.stringify({
    amount: amount.toString(),
    asset,
    secret,
    sender: senderUsername,
    timestamp: Date.now(),
  });

  const payloadBytes = stringToBytes(payload);
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const recipientPublicKey = hexToBytes(recipientPublicEncryptionKeyHex);

  const ephemeralKeyPair = nacl.box.keyPair();

  const encrypted = nacl.box(
    payloadBytes,
    nonce,
    recipientPublicKey,
    ephemeralKeyPair.secretKey
  );

  return {
    ephemeralPublicKey: bytesToHex(ephemeralKeyPair.publicKey),
    nonce: bytesToHex(nonce),
    ciphertext: bytesToHex(encrypted),
  };
}

export interface DecryptedNote {
  amount: string;
  asset: string;
  secret: string;
  sender?: string;
  timestamp?: number;
}

export function decryptNote(
  encryptedPayload: EncryptedNotePayload,
  myViewingSecretKeyHex: string
): DecryptedNote | null {
  const { ephemeralPublicKey, nonce, ciphertext } = encryptedPayload;

  try {
    const decrypted = nacl.box.open(
      hexToBytes(ciphertext),
      hexToBytes(nonce),
      hexToBytes(ephemeralPublicKey),
      hexToBytes(myViewingSecretKeyHex)
    );

    if (!decrypted) {
      return null;
    }

    return JSON.parse(new TextDecoder().decode(decrypted)) as DecryptedNote;
  } catch {
    return null;
  }
}

export function encryptSymmetrically(text: string, secretKeyHex: string): string {
  const bytes = stringToBytes(text);
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const key = hexToBytes(secretKeyHex);
  const encrypted = nacl.secretbox(bytes, nonce, key);
  return bytesToHex(nonce) + bytesToHex(encrypted);
}

export function decryptSymmetrically(encryptedHex: string, secretKeyHex: string): string | null {
  try {
    const nonceLength = nacl.secretbox.nonceLength * 2;
    const nonce = hexToBytes(encryptedHex.substring(0, nonceLength));
    const ciphertext = hexToBytes(encryptedHex.substring(nonceLength));
    const key = hexToBytes(secretKeyHex);
    const decrypted = nacl.secretbox.open(ciphertext, nonce, key);
    if (!decrypted) return null;
    return new TextDecoder().decode(decrypted);
  } catch {
    return null;
  }
}
