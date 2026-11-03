import crypto from "node:crypto";
import * as StellarSdk from "@stellar/stellar-sdk";

// Turns a payment to the gateway address into a private note in the pool.
//
// Each payment is recorded by its own transaction hash before anything is
// deposited, so it is credited exactly once: replaying old transactions, or a
// user changing keys, can't credit it again. A note's commitment depends on the
// recipient's current keys, so it could never serve as that record.

const TOKENS = {
  XLM: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
  USDC: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
};
const DUST = 0.0001;
export const MAX_ATTEMPTS = 5;
// RPC keeps about 7 days of transactions: older outcomes can't be looked up.
const LOOKUP_WINDOW_MS = 6 * 24 * 60 * 60 * 1000;

export function createDepositProcessor({
  repository,
  chain,
  isAddressBlocked,
  calculateCommitment,
  encryptNoteForUser,
  gatewayAddress,
  gatewaySecret,
  poolContract,
  networkPassphrase,
  logger,
  now = Date.now,
}) {
  // An attempt is stale once its pool transaction can no longer land.
  const staleMs = (chain.txTimeoutSeconds + 120) * 1000;

  /** Decides whether this process may (re)try a payment someone already recorded. */
  async function mayRetry(key, row) {
    if (row.status === "done" || row.status === "legacy") return { skip: "already_processed" };
    if (row.status === "needs_review") return { skip: "needs_review" };
    const age = now() - Date.parse(row.updated_at);
    if (row.status !== "failed" && age < staleMs) return { skip: "in_progress" };

    if (row.pool_tx_hash) {
      if (age > LOOKUP_WINDOW_MS) {
        await repository.update(key, { status: "needs_review", last_error: "outcome no longer visible on RPC" });
        return { skip: "needs_review" };
      }
      if ((await chain.transactionStatus(row.pool_tx_hash)) === "SUCCESS") {
        await repository.update(key, { status: "done" });
        return { skip: "already_processed" };
      }
    }
    if (row.attempts >= MAX_ATTEMPTS) {
      await repository.update(key, { status: "needs_review" });
      return { skip: "needs_review" };
    }
    if (!(await repository.takeOver(key, row))) return { skip: "in_progress" };
    // The earlier attempt's pool deposit never landed: remove its note.
    if (row.commitment) await repository.deleteNote(row.commitment);
    return {};
  }

  async function processPayment({ txRecord, opIndex, op, user, source, memo }) {
    const key = { txHash: txRecord.hash, opIndex };
    const amount = parseFloat(op.amount);
    const asset = op.asset.isNative() ? "XLM" : "USDC";

    const noteSecret = crypto.createHmac("sha256", gatewaySecret).update(txRecord.hash).digest("hex");
    const commitment = await calculateCommitment(amount, user.public_encryption_key, TOKENS[asset], noteSecret);

    if (await repository.claim(key, { memo: String(memo), amount: op.amount, asset, commitment })) {
      // Credited before payments were recorded: the note is the only trace.
      if (await repository.noteExists(commitment)) {
        await repository.update(key, { status: "done" });
        return { processed: false, reason: "already_processed", commitment };
      }
    } else {
      const decision = await mayRetry(key, await repository.get(key));
      if (decision.skip) return { processed: false, reason: decision.skip, commitment };
      await repository.update(key, { commitment });
    }

    logger.info(`Gateway processing deposit of ${amount} ${asset} for @${user.username} (memo ${memo})`);
    if (await isAddressBlocked(source)) {
      logger.warn(`[ASP COMPLIANCE BLOCK] Deposit from ${source} rejected for @${user.username}.`);
      await repository.update(key, { status: "needs_review", last_error: "sender blocked by screening" });
      return { processed: false, reason: "sanctioned_address" };
    }

    const encrypted = encryptNoteForUser(amount, asset, noteSecret, source, user.public_encryption_key);
    const encryptedHex = encrypted.ephemeralPublicKey + encrypted.nonce + encrypted.ciphertext;

    let outcome;
    try {
      await repository.insertNote({ commitment, encrypted_note: encryptedHex, recipient_viewing_key: user.public_encryption_key });
      const prepared = await chain.prepareDeposit({ contractId: poolContract, token: TOKENS[asset], amount, commitmentHex: commitment, encryptedNoteHex: encryptedHex });
      await repository.update(key, { status: "submitted", pool_tx_hash: prepared.hash });
      outcome = { hash: prepared.hash, status: await prepared.submit() };
    } catch (err) {
      outcome = { status: "FAILED", error: err };
    }

    if (outcome.status === "SUCCESS") {
      await repository.update(key, { status: "done", last_error: null });
      logger.info(`Gateway shielded deposit, pool tx ${outcome.hash}`);
      return { processed: true, amount, asset, commitment, contractTxHash: outcome.hash };
    }
    if (outcome.status === "UNKNOWN") {
      // Left as submitted: the retry pass looks the outcome up once it can't change.
      logger.warn(`Gateway deposit ${outcome.hash} outcome unknown; will check again`);
      return { processed: false, reason: "pending", commitment };
    }
    const message = outcome.error?.message ?? "pool transaction failed";
    await repository.deleteNote(commitment).catch(() => undefined);
    await repository.update(key, { status: "failed", last_error: message.slice(0, 500) });
    throw new Error(`Gateway deposit failed: ${message}`);
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
      .filter(({ op }) => op.type === "payment" && op.destination === gatewayAddress && parseFloat(op.amount) > DUST);
    if (!payments.length) return { processed: false, reason: "no_payment" };

    const user = await repository.findUserByMemo(memo);
    if (!user) return { processed: false, reason: "user_not_found", memoId: memo };

    const operations = [];
    for (const { op, opIndex } of payments) {
      operations.push(await processPayment({ txRecord, opIndex, op, user, source: tx.source, memo }));
    }
    return { processed: operations.some((r) => r.processed), operations };
  }

  /** Retries attempts that failed or stalled (process restarted, outcome unknown). */
  async function retryStalled() {
    const staleBefore = new Date(now() - staleMs).toISOString();
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
