// Notes are spendable by whoever knows their secret, and whoever creates a note
// knows it: the sender of a payment, the deposit gateway, the faucet. Notes the
// user creates for themselves (change, re-shielded and upgraded notes) instead
// get a secret derived from their spending key:
//
//   secret = HMAC-SHA256(spendingKey, "starlit-note-secret-v1:" ‖ n)
//
// with a random nonce n stored inside the encrypted note. Nobody else can
// produce a matching (n, secret) pair, so "self-created" cannot be faked, and
// every other note is re-shielded (see lib/reshield).

import { bytesToHex, hexToBytes } from "@/lib/keys";

const LABEL = "starlit-note-secret-v1:";

async function hmacHex(spendingKeyHex: string, n: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    hexToBytes(spendingKeyHex) as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(LABEL + n));
  return bytesToHex(new Uint8Array(mac));
}

/** A fresh note secret only the owner of `spendingKeyHex` can reproduce. */
export async function selfNoteSecret(spendingKeyHex: string): Promise<{ secret: string; n: string }> {
  const n = bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
  return { secret: await hmacHex(spendingKeyHex, n), n };
}

/** True when the note's secret was derived from this spending key (nobody else knows it). */
export async function isSelfCreated(spendingKeyHex: string, note: { secret?: string; n?: string }): Promise<boolean> {
  if (!note.secret || !note.n || !/^[0-9a-f]{32}$/.test(note.n)) return false;
  return (await hmacHex(spendingKeyHex, note.n)) === note.secret;
}
