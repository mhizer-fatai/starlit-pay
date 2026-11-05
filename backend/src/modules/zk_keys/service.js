import * as StellarSdk from "@stellar/stellar-sdk";
import { HttpError } from "../../http/errors.js";

// The directory of users' private-pool keys: the note key (who owns a note)
// and the encryption key (who can read it). A user publishes keys signed by
// their own Stellar key; anyone paying them gets the signature too, so the
// sender's app can check it rather than trusting this server.

/** What the owner signs (SEP-53). The app builds the same text to sign and to verify. */
export function zkKeysMessage(noteKey, encryptionKey) {
  return `Starlit Pay private keys\nnote: ${noteKey.toLowerCase()}\nencryption: ${encryptionKey.toLowerCase()}`;
}

/** The Stellar key that speaks for a user; older accounts kept it in public_encryption_key. */
const signerOf = (user) => user.stellar_address || (user.public_encryption_key?.startsWith("G") ? user.public_encryption_key : null);

export function verifyZkKeys(address, { noteKey, encryptionKey, signature }) {
  try {
    return StellarSdk.Keypair.fromPublicKey(address).verifyMessage(zkKeysMessage(noteKey, encryptionKey), Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
}

export function createZkKeysService({ repository, now = () => new Date() }) {
  return {
    async publish(userId, keys) {
      const user = await repository.findById(userId);
      if (!user) throw new HttpError(404, "User not found");
      const signer = signerOf(user);
      if (!signer || !StellarSdk.StrKey.isValidEd25519PublicKey(signer)) {
        throw new HttpError(400, "This account has no wallet key to sign its private keys.");
      }
      if (!verifyZkKeys(signer, keys)) throw new HttpError(403, "These keys aren't signed by your wallet.");

      const saved = await repository.saveKeys(userId, {
        zk_note_key: keys.noteKey.toLowerCase(),
        zk_encryption_key: keys.encryptionKey.toLowerCase(),
        zk_keys_signature: keys.signature,
        zk_keys_updated_at: now().toISOString(),
      });
      if (!saved) throw new HttpError(409, "These keys already belong to another account.");
      return { noteKey: saved.zk_note_key, encryptionKey: saved.zk_encryption_key };
    },

    async lookup(username) {
      const user = await repository.findByUsername(username);
      if (!user) throw new HttpError(404, "User not found");
      if (!user.zk_note_key) throw new HttpError(404, "This user can't receive private payments yet.", "NO_ZK_KEYS");
      return {
        username: user.username,
        stellarAddress: signerOf(user),
        noteKey: user.zk_note_key,
        encryptionKey: user.zk_encryption_key,
        signature: user.zk_keys_signature,
      };
    },
  };
}
