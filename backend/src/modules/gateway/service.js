import crypto from "node:crypto";
import * as StellarSdk from "@stellar/stellar-sdk";
import { poolAssetCode, TOKEN_CONTRACTS as TOKENS } from "../../tokens.js";
import { toStroops } from "../zk_payer/pool_tx.js";

// Turns a payment to the gateway address into a private note in the pool.
//
// Each payment is recorded by its own transaction hash before anything is
// deposited, so it is credited exactly once: replaying old transactions, or a
// user changing keys, can't credit it again. A note's commitment depends on the
// recipient's current keys, so it could never serve as that record.

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
  // { minDeposit, maxDeposit } in stroops: credit payments for the real-ZK pools instead of depositing.
  zkCredits = null,
  now = Date.now,
}) {
  // An attempt is stale once its pool transaction can no longer land.
  const staleMs = (chain.txTimeoutSeconds + 120) * 1000;

  // A payment set aside needs a person: it is never retried automatically.
  // List them with: SELECT * FROM gateway_deposits WHERE status = 'needs_review';
  async function setAside(key, reason) {
    await repository.update(key, { status: "needs_review", last_error: reason });
    logger.error(`Gateway set deposit ${key.txHash}:${key.opIndex} aside for review: ${reason}`);
  }

  /** Decides whether this process may (re)try a payment someone already recorded. */
  async function mayRetry(key, row) {
    if (["done", "legacy", "credited", "claiming"].includes(row.status)) return { skip: "already_processed" };
    if (row.status === "needs_review") return { skip: "needs_review" };
    const age = now() - Date.parse(row.updated_at);
    if (row.status !== "failed" && age < staleMs) return { skip: "in_progress" };

    if (row.pool_tx_hash) {
      if (age > LOOKUP_WINDOW_MS) {
        await setAside(key, "outcome no longer visible on RPC");
        return { skip: "needs_review" };
      }
      if ((await chain.transactionStatus(row.pool_tx_hash)) === "SUCCESS") {
        await repository.update(key, { status: "done" });
        return { skip: "already_processed" };
      }
    }
    if (row.attempts >= MAX_ATTEMPTS) {
      await setAside(key, `failed ${row.attempts} times; last error: ${row.last_error ?? "unknown"}`);
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
    const asset = poolAssetCode(op.asset);
    if (zkCredits) return creditPayment({ key, op, asset, amount, user, source, memo });

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
      await setAside(key, "sender blocked by screening");
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

  /**
   * Real-ZK pools: the payment becomes the user's credit, recorded exactly
   * once; their browser proves the deposit later and the gateway signs it
   * (see zk_gateway). Nothing is deposited here.
   */
  async function creditPayment({ key, op, asset, amount, user, source, memo }) {
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
    if (stroops < zkCredits.minDeposit || stroops > zkCredits.maxDeposit) {
      await setAside(key, `amount ${op.amount} ${asset} is outside the pool's deposit limits`);
      return { processed: false, reason: "outside_deposit_limits" };
    }
    await repository.update(key, { status: "credited", user_id: user.id, last_error: null });
    logger.info(`Gateway credited ${amount} ${asset} to @${user.username} (memo ${memo}); their device completes the deposit`);
    return { processed: true, credited: true, amount, asset };
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
      // Only the pool's own assets: a look-alike "USDC" from another issuer
      // would otherwise be credited as real USDC.
      .filter(({ op }) => poolAssetCode(op.asset));
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
