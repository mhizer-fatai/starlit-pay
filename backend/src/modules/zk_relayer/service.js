import { ComplianceUnavailableError } from "../../compliance.js";
import { HttpError } from "../../http/errors.js";
import { inspectPoolTransaction } from "./pool_tx.js";

// Pays for users' private-pool transactions (real ZK proofs, SPP contracts).
//
// The browser SDK builds the transaction with a Starlit account as source and
// as the pool's `sender`, and asks it to sign. It signs only a single
// `transact` call to Starlit's own pools that moves no deposit (a deposit
// would pull tokens from that account) and needs no other signature.
//
// That account is a channel leased to the user for this payment (see
// channels.js), so many users can pay at once without their transactions
// competing for one account's sequence numbers. Without channels configured
// the relayer account itself signs, as before.

export function createZkRelayer({ relayerKeypair, channels = null, networkPassphrase, pools, isAddressBlocked, logger, now = () => Date.now() }) {
  const relayer = relayerKeypair?.publicKey() ?? null;
  const hasChannels = Boolean(relayer && channels?.size);
  // Checked per request: channels switch on once they exist on the network.
  const channelsReady = () => hasChannels && channels.isReady();

  const refuse = (reason) => {
    throw new HttpError(403, `This transaction can't be sponsored: ${reason}.`, "NOT_SPONSORED");
  };

  /** Throws unless the transaction is exactly what `signer` agrees to pay for. */
  async function check(xdr, signer) {
    const details = inspectPoolTransaction(xdr, { signer, pools, networkPassphrase, refuse, now });
    if (details.extAmount > 0n) refuse("deposits are not sponsored");

    if (details.extAmount < 0n) {
      // Money leaving the pool: screen the public recipient, failing closed.
      let blocked;
      try {
        blocked = await isAddressBlocked(details.recipient, { failClosed: true });
      } catch (err) {
        if (!(err instanceof ComplianceUnavailableError)) throw err;
        logger.error(err.message);
        throw new HttpError(503, "Compliance check unavailable, try again shortly.", "compliance_unavailable");
      }
      if (blocked) throw new HttpError(403, "Recipient address is restricted under compliance policy.");
    }
    return details;
  }

  return {
    address: relayer,
    get channels() {
      return channelsReady() ? channels.size : 0;
    },

    /**
     * The account that will sign this user's next payment: a channel leased to
     * them, or the relayer when channels aren't set up (leaseId null).
     */
    async lease(userId) {
      if (!relayer) throw new HttpError(503, "Private payments are not configured.");
      if (!channelsReady()) return { leaseId: null, address: relayer };
      const lease = await channels.acquire(userId);
      if (!lease) throw new HttpError(503, "Lots of payments are going through right now. Please try again in a few minutes.", "CHANNELS_BUSY");
      return lease;
    },

    async release(leaseId, userId) {
      if (hasChannels && leaseId) await channels.release(leaseId, userId);
    },

    async sign(xdr, userId, leaseId = null) {
      if (!relayer) throw new HttpError(503, "Private payments are not configured.");
      if (!leaseId) {
        const { tx, pool, extAmount } = await check(xdr, relayer);
        tx.sign(relayerKeypair);
        logger.info("relayer signed a pool transaction", { userId, pool, kind: extAmount < 0n ? "withdraw" : "transfer" });
        return tx.toXDR();
      }

      const keypair = hasChannels ? channels.keypairFor(leaseId, userId) : null;
      if (!keypair) throw new HttpError(409, "This payment took too long to prepare. Please send it again.", "CHANNEL_LEASE_EXPIRED");
      const { tx, pool, extAmount, expiresAt } = await check(xdr, keypair.publicKey());
      tx.sign(keypair);
      channels.signed(leaseId, { hash: tx.hash().toString("hex"), maxTime: expiresAt });
      logger.info("relayer signed a pool transaction on a channel", {
        userId,
        pool,
        channel: keypair.publicKey(),
        kind: extAmount < 0n ? "withdraw" : "transfer",
      });
      return tx.toXDR();
    },
  };
}
