// The signer the private-pool SDK (SPP) uses for a Starlit user.
//
// Two accounts are involved. The user's own Stellar key (from their vault)
// owns the notes: it signs the one message the SDK turns into the user's
// privacy keys, and nothing else. Starlit's payer account pays: it is the
// transaction source and the pool's sender, so the user never needs XLM for
// fees, and it signs on the backend, which checks the transaction first.

import * as StellarSdk from "@stellar/stellar-sdk";

import { hkdf } from "@/lib/vault/crypto";

export interface ZkSignerDeps {
  /** The user's Stellar key: owner of the notes. */
  owner: StellarSdk.Keypair;
  /** Starlit's payer address (GET /api/zk/payer). */
  payerAddress: string;
  /** Asks the backend payer to sign (POST /api/zk/payer/sign). */
  signWithPayer: (xdr: string) => Promise<{ signedTxXdr: string }>;
}

interface SignOptions {
  address?: string;
}

/**
 * The owner alone, for the one step the SDK insists the owner signs itself:
 * deriving the privacy keys (kept afterwards in the encrypted local database).
 */
export function createOwnerSigner(owner: StellarSdk.Keypair) {
  const ownerAddress = owner.publicKey();
  return {
    async getPublicKey() {
      return ownerAddress;
    },

    // SEP-53, base64: the same format Freighter returns.
    async signMessage(message: string, opts?: SignOptions) {
      if (opts?.address && opts.address !== ownerAddress) throw new Error("Only the note owner signs messages.");
      return { signedMessage: owner.signMessage(message).toString("base64"), signerAddress: ownerAddress };
    },

    // The owner never pays for or authorizes pool transactions.
    async signTransaction(): Promise<never> {
      throw new Error("Pool transactions are paid by Starlit's payer.");
    },

    async signAuthEntry(): Promise<never> {
      throw new Error("Separate authorizations are not used for private payments.");
    },
  };
}

export function createZkSigner({ owner, payerAddress, signWithPayer }: ZkSignerDeps) {
  return {
    ...createOwnerSigner(owner),

    async signTransaction(xdr: string, opts?: SignOptions) {
      if (opts?.address && opts.address !== payerAddress) throw new Error("Pool transactions are paid by Starlit's payer.");
      const { signedTxXdr } = await signWithPayer(xdr);
      return { signedTxXdr, signerAddress: payerAddress };
    },
  };
}

/**
 * The key that encrypts the SDK's local database (notes, synced pool events).
 * Derived from the user's Stellar key, so it comes back with the wallet on any
 * device and is never stored.
 */
export async function deriveZkStorageKey(owner: StellarSdk.Keypair): Promise<Uint8Array> {
  return hkdf(new Uint8Array(owner.rawSecretKey()), "zk:storage");
}
