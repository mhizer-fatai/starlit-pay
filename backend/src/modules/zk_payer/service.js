import { ComplianceUnavailableError } from "../../compliance.js";
import { HttpError } from "../../http/errors.js";
import { inspectPoolTransaction } from "./pool_tx.js";

// Pays for users' private-pool transactions (real ZK proofs, SPP contracts).
//
// The browser SDK builds the transaction with this account as source and as
// the pool's `sender`, and asks it to sign. It signs only a single `transact`
// call to Starlit's own pools that moves no deposit (a deposit would pull
// tokens from this account) and needs no other signature.

export function createZkPayer({ payerKeypair, networkPassphrase, pools, isAddressBlocked, logger, now = () => Date.now() }) {
  const payer = payerKeypair?.publicKey() ?? null;

  const refuse = (reason) => {
    throw new HttpError(403, `This transaction can't be sponsored: ${reason}.`, "NOT_SPONSORED");
  };

  /** Throws unless the transaction is exactly what the payer agrees to pay for. */
  async function check(xdr) {
    const details = inspectPoolTransaction(xdr, { signer: payer, pools, networkPassphrase, refuse, now });
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
    address: payer,

    async sign(xdr, userId) {
      if (!payer) throw new HttpError(503, "Private payments are not configured.");
      const { tx, pool, extAmount } = await check(xdr);
      tx.sign(payerKeypair);
      logger.info("ZK payer signed a pool transaction", { userId, pool, kind: extAmount < 0n ? "withdraw" : "transfer" });
      return tx.toXDR();
    },
  };
}
