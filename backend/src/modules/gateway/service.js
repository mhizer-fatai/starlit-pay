import * as StellarSdk from "@stellar/stellar-sdk";
import { poolAssetCode } from "../../tokens.js";
import { toStroops } from "../zk_payer/pool_tx.js";

// Turns a payment to the gateway address (the faucet, or any wallet paying a
// user's deposit memo) into that user's credit for the private pools. Their
// device later proves the deposit and the gateway signs it (zk_gateway).
//
// Each payment is recorded by its own transaction hash and operation before
// anything else, so it is credited exactly once, however often it is seen.

const DUST = 0.0001;
export const MAX_ATTEMPTS = 5;
// A payment left "processing" this long was interrupted (a restart): retry it.
const STALE_MS = 2 * 60 * 1000;

export function createDepositProcessor({ repository, chain, isAddressBlocked, gatewayAddress, networkPassphrase, limits, logger, now = Date.now }) {
  // A payment set aside needs a person: it is never retried automatically.
  // List them with: SELECT * FROM gateway_deposits WHERE status = 'needs_review';
  async function setAside(key, reason) {
    await repository.update(key, { status: "needs_review", last_error: reason });
    logger.error(`Gateway set deposit ${key.txHash}:${key.opIndex} aside for review: ${reason}`);
  }

  /** Decides whether this process may (re)try a payment someone already recorded. */
  async function mayRetry(key, row) {
    if (row.status !== "processing") return { skip: row.status === "needs_review" ? "needs_review" : "already_processed" };
    if (now() - Date.parse(row.updated_at) < STALE_MS) return { skip: "in_progress" };
    if (row.attempts >= MAX_ATTEMPTS) {
      await setAside(key, `interrupted ${row.attempts} times`);
      return { skip: "needs_review" };
    }
    return (await repository.takeOver(key, row)) ? {} : { skip: "in_progress" };
  }

  async function creditPayment({ key, op, asset, user, source, memo }) {
    if (!(await repository.claim(key, { memo: String(memo), amount: op.amount, asset, user_id: user.id }))) {
      const decision = await mayRetry(key, await repository.get(key));
      if (decision.skip) return { processed: false, reason: decision.skip };
    }
    if (await isAddressBlocked(source)) {
      logger.warn(`[ASP COMPLIANCE BLOCK] Deposit from ${source} rejected for @${user.username}.`);
      await setAside(key, "sender blocked by screening");
      return { processed: false, reason: "sanctioned_address" };
    }
    const stroops = toStroops(op.amount);
    if (stroops < limits.minDeposit || stroops > limits.maxDeposit) {
      await setAside(key, `amount ${op.amount} ${asset} is outside the pool's deposit limits`);
      return { processed: false, reason: "outside_deposit_limits" };
    }
    await repository.update(key, { status: "credited", user_id: user.id, last_error: null });
    logger.info(`Gateway credited ${op.amount} ${asset} to @${user.username} (memo ${memo}); their device completes the deposit`);
    return { processed: true, credited: true, amount: parseFloat(op.amount), asset };
  }

  /** Processes every payment to the gateway in one Horizon transaction record. */
  async function processTransaction(txRecord) {
    if (txRecord.memo_type !== "id" && txRecord.memo_type !== "text") return { processed: false, reason: "invalid_memo_type" };
    const memo = parseInt(txRecord.memo, 10);
    if (isNaN(memo)) return { processed: false, reason: "invalid_memo_id" };

    // A fee-bump wraps the sender's transaction: the payment is inside.
    const envelope = StellarSdk.TransactionBuilder.fromXDR(txRecord.envelope_xdr, networkPassphrase);
    const tx = envelope instanceof StellarSdk.FeeBumpTransaction ? envelope.innerTransaction : envelope;
    const payments = tx.operations
      .map((op, opIndex) => ({ op, opIndex }))
      .filter(({ op }) => op.type === "payment" && op.destination === gatewayAddress && parseFloat(op.amount) > DUST)
      // Only the pools' own assets: a look-alike "USDC" from another issuer
      // would otherwise be credited as real USDC.
      .filter(({ op }) => poolAssetCode(op.asset));
    if (!payments.length) return { processed: false, reason: "no_payment" };

    const user = await repository.findUserByMemo(memo);
    if (!user) return { processed: false, reason: "user_not_found", memoId: memo };

    const operations = [];
    for (const { op, opIndex } of payments) {
      const key = { txHash: txRecord.hash, opIndex };
      operations.push(await creditPayment({ key, op, asset: poolAssetCode(op.asset), user, source: tx.source, memo }));
    }
    return { processed: operations.some((r) => r.processed), operations };
  }

  /** Retries payments whose processing was interrupted (a restart mid-way). */
  async function retryStalled() {
    const staleBefore = new Date(now() - STALE_MS).toISOString();
    for (const hash of await repository.listRetryable(staleBefore, MAX_ATTEMPTS)) {
      try {
        await processTransaction(await chain.fetchTransaction(hash));
      } catch (err) {
        logger.error(`Gateway retry of ${hash} failed:`, err);
      }
    }
  }

  return { processTransaction, retryStalled };
}
