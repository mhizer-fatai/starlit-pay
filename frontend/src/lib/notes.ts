import nacl from "tweetnacl";
import type { BackendTransaction, ShieldedNote } from "./backend";
import { getPoolRoot } from "./backend";

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

export interface DecryptedNoteData {
  amount: number;
  asset: "USDC" | "XLM" | string;
  sender?: string;
  secret?: string;
  timestamp?: number;
}

export function decryptNotePayload(
  encryptedNote: string | undefined,
  viewingSecretHex: string | null,
): DecryptedNoteData | null {
  if (!encryptedNote) return null;

  // 1. Try decoding Base64 JSON payload
  try {
    const raw = atob(encryptedNote);
    const parsed = JSON.parse(raw);
    if (parsed && (parsed.amount !== undefined || parsed.asset)) {
      return {
        amount: Number(parsed.amount) || 0,
        asset: parsed.asset?.toUpperCase() || "USDC",
        sender: parsed.sender || parsed.to,
        timestamp: parsed.at ? new Date(parsed.at).getTime() : undefined,
      };
    }
  } catch {
    /* not base64 json */
  }

  // 2. Try direct JSON parsing
  try {
    const parsed = JSON.parse(encryptedNote);
    if (parsed && (parsed.amount !== undefined || parsed.asset)) {
      return {
        amount: Number(parsed.amount) || 0,
        asset: parsed.asset?.toUpperCase() || "USDC",
        sender: parsed.sender,
      };
    }
  } catch {
    /* not direct json */
  }

  // 3. Try tweetnacl box decryption from hex payload
  if (viewingSecretHex && /^[0-9a-fA-F]+$/.test(encryptedNote) && encryptedNote.length > 112) {
    try {
      const ephemeralPublicKey = hexToBytes(encryptedNote.substring(0, 64));
      const nonce = hexToBytes(encryptedNote.substring(64, 112));
      const ciphertext = hexToBytes(encryptedNote.substring(112));
      const secretKey = hexToBytes(viewingSecretHex);

      const decrypted = nacl.box.open(ciphertext, nonce, ephemeralPublicKey, secretKey);
      if (decrypted) {
        const str = new TextDecoder().decode(decrypted);
        const parsed = JSON.parse(str);
        return {
          amount: Number(parsed.amount) || 0,
          asset: parsed.asset?.toUpperCase() || "USDC",
          sender: parsed.sender,
          secret: parsed.secret,
          timestamp: parsed.timestamp,
        };
      }
    } catch {
      /* decryption failed */
    }
  }

  return null;
}

export interface DecodedTransaction {
  id?: string;
  type: "send" | "receive" | "withdraw" | "faucet" | "other";
  amount: number;
  asset: string;
  party: string;
  createdAt?: string;
}

export function decodeTransaction(tx: BackendTransaction): DecodedTransaction {
  if (!tx.encrypted_payload) {
    return {
      id: tx.id,
      type: "other",
      amount: 0,
      asset: "USDC",
      party: "Shielded",
      createdAt: tx.created_at,
    };
  }

  try {
    const raw = atob(tx.encrypted_payload);
    const parsed = JSON.parse(raw);
    const amt = Number(parsed.amount) || 0;
    const asset = (parsed.asset || "USDC").toUpperCase();
    const to = parsed.to || "";
    const type = parsed.type || (to.startsWith("G") ? "withdraw" : "send");

    return {
      id: tx.id,
      type,
      amount: amt,
      asset,
      party: to ? (to.startsWith("G") ? `${to.slice(0, 4)}...${to.slice(-4)}` : `@${to.replace(/^@/, "")}`) : "Unknown",
      createdAt: parsed.at || tx.created_at,
    };
  } catch {
    return {
      id: tx.id,
      type: "other",
      amount: 0,
      asset: "USDC",
      party: "Shielded transaction",
      createdAt: tx.created_at,
    };
  }
}

export interface SpendableNote {
  commitment: string;
  amount: number;
  asset: string;
  secret: string;
  root?: string;
  tokenAddress?: string;
}

export function getSpendableNotes(
  notes: ShieldedNote[],
  viewingSecretHex: string | null,
  assetCode: string
): SpendableNote[] {
  const result: SpendableNote[] = [];
  const targetAsset = assetCode.toUpperCase();

  for (const note of notes) {
    if (note.status && note.status !== "unspent") continue;
    const decrypted = decryptNotePayload(note.encrypted_note, viewingSecretHex);
    if (decrypted && decrypted.asset.toUpperCase() === targetAsset && decrypted.amount > 0) {
      result.push({
        commitment: note.commitment,
        amount: decrypted.amount,
        asset: decrypted.asset.toUpperCase(),
        secret: decrypted.secret || note.commitment,
        // Notes posted by clients (received payments, change) have no recorded
        // root; spenders fetch a currently valid one with spendRootFor().
        root: note.root || undefined,
      });
    }
  }

  return result.sort((a, b) => b.amount - a.amount);
}


/**
 * Merkle root to spend a note against: the note's own root when the indexer
 * recorded one, otherwise any root the pool currently accepts.
 */
export async function spendRootFor(note: { root?: string }): Promise<string> {
  if (note.root) return note.root;
  const { root } = await getPoolRoot();
  return root;
}
