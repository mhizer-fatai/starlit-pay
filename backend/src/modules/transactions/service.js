import { HttpError } from "../../http/errors.js";

const MAX_PAYLOAD_LENGTH = 16 * 1024;

// A user's records describe their payments, so only that user may touch them.
function assertOwner(actor, userId) {
  if (actor.id !== userId) throw new HttpError(403, "You can only access your own transactions.");
}

export function createTransactionsService({ repository }) {
  return {
    async list(actor, userId) {
      assertOwner(actor, userId);
      return repository.listByUser(userId);
    },

    async record(actor, { user_id: userId, encrypted_payload: encryptedPayload } = {}) {
      if (typeof userId !== "string" || typeof encryptedPayload !== "string" || !userId || !encryptedPayload) {
        throw new HttpError(400, "Missing required parameters to log transaction.");
      }
      if (encryptedPayload.length > MAX_PAYLOAD_LENGTH) throw new HttpError(413, "Transaction record is too large.");
      assertOwner(actor, userId);
      return repository.create({ userId, encryptedPayload });
    },
  };
}
