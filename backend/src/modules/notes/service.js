import * as StellarSdk from "@stellar/stellar-sdk";
import { HttpError } from "../../http/errors.js";

// Encrypted notes: the private balance. A note can be read or marked spent by
// its owner only: the signed-in user, or a request signed with the owner's
// Stellar key (older clients).

const SIGNATURE_MAX_AGE_MS = 60_000;

/** A fresh timestamp signed by the account's Ed25519 key. */
export function verifyRequestSignature(timestamp, signatureHex, publicKey, now = Date.now()) {
  try {
    const age = Math.abs(now - parseInt(timestamp, 10));
    if (isNaN(age) || age > SIGNATURE_MAX_AGE_MS) return false;
    return StellarSdk.Keypair.fromPublicKey(publicKey).verify(Buffer.from(timestamp), Buffer.from(signatureHex, "hex"));
  } catch {
    return false;
  }
}

export function createNotesService({ repository, logger, now = Date.now }) {
  function assertOwner(user, sessionUserId, { timestamp, signature }) {
    if (sessionUserId && sessionUserId === user.id) return;
    if (!timestamp || !signature) {
      throw new HttpError(401, "Authentication parameters (timestamp, signature) or Bearer token are required.");
    }
    const signer = user.stellar_address || (user.public_encryption_key?.startsWith("G") ? user.public_encryption_key : null);
    if (!signer) throw new HttpError(400, "No signer address found for this user profile.");
    if (!verifyRequestSignature(timestamp, signature, signer, now())) throw new HttpError(401, "Unauthorized: Invalid request signature.");
  }

  async function orFail(message, run) {
    try {
      return await run();
    } catch (err) {
      if (err instanceof HttpError) throw err;
      logger.error(`${message}:`, err);
      throw new HttpError(500, message);
    }
  }

  return {
    async list(viewingKey, sessionUserId, { timestamp, signature, includeSpent }) {
      if (!sessionUserId && (!timestamp || !signature)) {
        throw new HttpError(401, "Authentication parameters (timestamp, signature) or Bearer token are required.");
      }
      return orFail("Failed to fetch shielded notes", async () => {
        const user = await repository.findUserByViewingKey(viewingKey);
        if (!user) throw new HttpError(404, "User profile matching this viewing key not found.");
        assertOwner(user, sessionUserId, { timestamp, signature });
        return repository.listNotes(viewingKey, { includeSpent });
      });
    },

    /** Called by a signed-in sender (payment, transfer, change). */
    add(note) {
      return orFail("Failed to save shielded note", () => repository.insertNote(note));
    },

    markSpent(commitment, sessionUserId, { timestamp, signature }) {
      return orFail("Failed to mark note as spent", async () => {
        const note = await repository.findNote(commitment);
        if (!note) throw new HttpError(404, "Shielded note not found.");
        if (note.status === "spent") return { success: true, message: "Note already marked as spent." };
        const user = await repository.findUserByViewingKey(note.recipient_viewing_key);
        if (!user) throw new HttpError(404, "User profile matching this note not found.");
        assertOwner(user, sessionUserId, { timestamp, signature });
        await repository.markSpent(commitment);
        return { success: true };
      });
    },
  };
}
