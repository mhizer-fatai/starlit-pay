import { HttpError } from "../../http/errors.js";
import { inspectPoolTransaction, toStroops } from "../zk_payer/pool_tx.js";

// Completes gateway deposits into the real-ZK pools from the user's device.
//
// A payment to the gateway is recorded once and kept as the user's credit
// (gateway/service.js). The user's browser proves a deposit of that credit
// and the gateway signs it as the depositor, so on-chain the gateway is the
// one paying in and the user's own wallet never appears.
//
// The gateway signs only a deposit that pulls exactly the credited amount
// from it into the credit's pool, and one at a time: a credit is "claiming"
// until its signed deposit lands or can no longer land (it expires within
// 10 minutes), and only then can it be claimed again.

// After expiry, give RPC time to report a deposit that landed in the last ledgers.
const EXPIRY_GRACE_MS = 60_000;

export const creditId = (row) => `${row.tx_hash}:${row.op_index}`;

export function createZkGateway({ gatewayKeypair, networkPassphrase, poolsByAsset, repository, transactionStatus, logger, now = () => Date.now() }) {
  const gateway = gatewayKeypair?.publicKey() ?? null;
  const pools = Object.values(poolsByAsset);

  const refuse = (reason) => {
    throw new HttpError(403, `This deposit can't be signed: ${reason}.`, "NOT_SIGNED");
  };

  /** Moves a credit on once its claim is decided: done if the deposit landed, open again if it can't. */
  async function settle(row) {
    if (row.status !== "claiming") return row;
    const status = await transactionStatus(row.claim_tx_hash);
    if (status === "SUCCESS") {
      await repository.finishClaim(row);
      return { ...row, status: "done" };
    }
    if (status === "FAILED" || Date.parse(row.claim_expires_at) + EXPIRY_GRACE_MS < now()) {
      if (await repository.reopenClaim(row)) return { ...row, status: "credited", claim_tx_hash: null };
    }
    return row;
  }

  return {
    address: gateway,

    /** The user's credits still to deposit, after settling earlier claims. */
    async list(userId) {
      const rows = await Promise.all((await repository.openCredits(userId)).map(settle));
      return rows
        .filter((row) => row.status === "credited" || row.status === "claiming")
        .map((row) => ({ id: creditId(row), amount: row.amount, asset: row.asset, status: row.status, receivedAt: row.created_at }));
    },

    async sign(userId, id, xdr) {
      if (!gateway) throw new HttpError(503, "The deposit gateway is not configured.");
      const [txHash, opIndex] = String(id).split(":");
      const found = await repository.getCredit(txHash, Number(opIndex));
      if (!found || found.user_id !== userId) throw new HttpError(404, "Deposit not found.");
      const row = await settle(found);
      if (row.status === "claiming") throw new HttpError(409, "This deposit is already being completed. Try again in a few minutes.", "CLAIM_IN_PROGRESS");
      if (row.status !== "credited") throw new HttpError(409, "This deposit is already complete.", "CLAIM_DONE");

      const pool = poolsByAsset[row.asset];
      if (!pool) throw new HttpError(409, `No private pool for ${row.asset}.`);
      const { tx, pool: target, extAmount, expiresAt } = inspectPoolTransaction(xdr, { signer: gateway, pools, networkPassphrase, refuse, now });
      if (target !== pool) refuse(`a ${row.asset} deposit must go to the ${row.asset} pool`);
      if (extAmount !== toStroops(row.amount)) refuse(`it must deposit exactly the ${row.amount} ${row.asset} received`);

      const hash = tx.hash().toString("hex");
      if (!(await repository.startClaim(row, { claim_tx_hash: hash, claim_expires_at: new Date(expiresAt * 1000).toISOString() }))) {
        throw new HttpError(409, "This deposit is already being completed. Try again in a few minutes.", "CLAIM_IN_PROGRESS");
      }
      tx.sign(gatewayKeypair);
      logger.info("Gateway signed a private deposit", { userId, credit: id, asset: row.asset, tx: hash });
      return tx.toXDR();
    },
  };
}
