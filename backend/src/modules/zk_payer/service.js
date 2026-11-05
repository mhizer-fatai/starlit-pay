import * as StellarSdk from "@stellar/stellar-sdk";
import { ComplianceUnavailableError } from "../../compliance.js";
import { HttpError } from "../../http/errors.js";

// Pays for users' private-pool transactions (real ZK proofs, SPP contracts).
//
// The browser SDK builds the transaction with this account as source and as
// the pool's `sender`, and asks it to sign. It signs only a single `transact`
// call to Starlit's own pools that moves no deposit (a deposit would pull
// tokens from this account) and needs no other signature. The proof itself
// is checked by the pool, so the payer never needs to understand it.

const MAX_FEE_STROOPS = 50_000_000; // 5 XLM: far above a normal transact
const MAX_VALIDITY_SECONDS = 600;
// SPP builds transactions with no expiry; the payer, as the only signer,
// adds this one so a signed transaction can't linger.
const DEFAULT_VALIDITY_SECONDS = 300;

export function createZkPayer({ payerKeypair, networkPassphrase, pools, isAddressBlocked, logger, now = () => Date.now() }) {
  const payer = payerKeypair?.publicKey() ?? null;
  const poolIds = new Set(pools);

  const refuse = (reason) => {
    throw new HttpError(403, `This transaction can't be sponsored: ${reason}.`, "NOT_SPONSORED");
  };

  function parse(xdr) {
    let tx;
    try {
      tx = StellarSdk.TransactionBuilder.fromXDR(xdr, networkPassphrase);
    } catch {
      throw new HttpError(400, "Invalid transaction.", "validation_error");
    }
    const neverExpires = !tx.timeBounds || Number(tx.timeBounds.maxTime) === 0;
    return tx instanceof StellarSdk.FeeBumpTransaction || !neverExpires ? tx : withExpiry(tx);
  }

  function withExpiry(tx) {
    const envelope = tx.toEnvelope();
    const maxTime = Math.floor(now() / 1000) + DEFAULT_VALIDITY_SECONDS;
    envelope.v1().tx().cond(
      StellarSdk.xdr.Preconditions.precondTime(
        new StellarSdk.xdr.TimeBounds({ minTime: StellarSdk.xdr.Uint64.fromString("0"), maxTime: StellarSdk.xdr.Uint64.fromString(String(maxTime)) })
      )
    );
    return new StellarSdk.Transaction(envelope, networkPassphrase);
  }

  /** Throws unless `tx` is exactly what the payer agrees to pay for. Returns the transfer details. */
  async function check(tx) {
    if (tx instanceof StellarSdk.FeeBumpTransaction) refuse("fee bumps are not accepted");
    if (tx.source !== payer) refuse("the payer must be the transaction source");
    if (Number(tx.fee) > MAX_FEE_STROOPS) refuse("the fee is too high");
    const maxTime = Number(tx.timeBounds?.maxTime ?? 0);
    if (!maxTime || maxTime * 1000 > now() + MAX_VALIDITY_SECONDS * 1000) refuse("the transaction must expire within 10 minutes");
    if (tx.operations.length !== 1) refuse("exactly one operation is allowed");

    const [op] = tx.operations;
    if (op.type !== "invokeHostFunction" || op.func.switch().name !== "hostFunctionTypeInvokeContract") refuse("only a contract call is allowed");
    const call = op.func.invokeContract();
    const contract = StellarSdk.Address.fromScAddress(call.contractAddress()).toString();
    if (!poolIds.has(contract)) refuse("only Starlit's private pools are allowed");
    if (call.functionName().toString() !== "transact") refuse("only the pool's transact call is allowed");

    const args = call.args();
    if (args.length !== 3) refuse("unexpected transact arguments");
    if (StellarSdk.Address.fromScVal(args[2]).toString() !== payer) refuse("the payer must be the pool sender");

    // Only the source account (the payer) may authorize: no one else's signature is involved.
    for (const entry of op.auth ?? []) {
      if (entry.credentials().switch().name !== "sorobanCredentialsSourceAccount") refuse("other accounts' authorizations are not accepted");
    }

    const ext = StellarSdk.scValToNative(args[1]);
    const extAmount = BigInt(ext.ext_amount);
    if (extAmount > 0n) refuse("deposits are not sponsored");
    const recipient = typeof ext.recipient === "string" ? ext.recipient : String(ext.recipient);

    if (extAmount < 0n) {
      // Money leaving the pool: screen the public recipient, failing closed.
      let blocked;
      try {
        blocked = await isAddressBlocked(recipient, { failClosed: true });
      } catch (err) {
        if (!(err instanceof ComplianceUnavailableError)) throw err;
        logger.error(err.message);
        throw new HttpError(503, "Compliance check unavailable, try again shortly.", "compliance_unavailable");
      }
      if (blocked) throw new HttpError(403, "Recipient address is restricted under compliance policy.");
    }
    return { pool: contract, withdrawal: extAmount < 0n ? { recipient, amount: -extAmount } : null };
  }

  return {
    address: payer,

    async sign(xdr, userId) {
      if (!payer) throw new HttpError(503, "Private payments are not configured.");
      const tx = parse(xdr);
      const details = await check(tx);
      tx.sign(payerKeypair);
      logger.info("ZK payer signed a pool transaction", {
        userId,
        pool: details.pool,
        kind: details.withdrawal ? "withdraw" : "transfer",
      });
      return tx.toXDR();
    },
  };
}
