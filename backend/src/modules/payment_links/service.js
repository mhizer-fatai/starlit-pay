import { HttpError } from "../../http/errors.js";

const LINK_LIFETIME_MS = 30 * 60 * 1000;
const CLOCK_SKEW_MS = 60 * 1000;
const POOL_SPEND_FUNCTIONS = new Set(["transfer", "withdraw"]);
const TX_HASH = /^[0-9a-f]{64}$/i;

export function createPaymentLinksService({ repository, readTransaction, gatewayAddress, relayerAddress, poolContract, now = Date.now }) {
  const isExpired = (link) => now() - new Date(link.created_at).getTime() > LINK_LIFETIME_MS;

  /** A wallet payment to the gateway, carrying the link owner's memo, for the right asset and amount. */
  const paysLinkFromWallet = (tx, link) =>
    link.creator?.deposit_memo != null &&
    tx.memo === String(link.creator.deposit_memo) &&
    tx.payments.some(
      (p) => p.destination === gatewayAddress && p.asset === link.asset && p.amount + 1e-7 >= Number(link.amount)
    );

  /** A private payment by a signed-in user. Its amount and recipient are private, so only its origin can be checked. */
  const paysLinkPrivately = (tx, actor) =>
    Boolean(actor) &&
    tx.source === relayerAddress &&
    tx.contractCalls.some((c) => c.contract === poolContract && POOL_SPEND_FUNCTIONS.has(c.fn));

  return {
    async create(actor, { creator_id: creatorId, amount, asset, commitment, description } = {}) {
      if (!creatorId || !amount || !commitment) throw new HttpError(400, "Missing required fields");
      if (actor.id !== creatorId) throw new HttpError(403, "Forbidden: Cannot create payment link for another user.");
      return repository.create({
        creator_id: creatorId,
        amount,
        asset: asset || "USDC",
        commitment,
        description,
        status: "pending",
      });
    },

    async get(commitment) {
      const link = await repository.findByCommitment(commitment);
      if (!link) throw new HttpError(404, "Payment link not found");
      return { ...link, status: link.status !== "claimed" && isExpired(link) ? "expired" : link.status };
    },

    async claim(commitment, txHash, actor) {
      if (typeof txHash !== "string" || !TX_HASH.test(txHash)) {
        throw new HttpError(400, "A valid transaction hash is required.");
      }

      const link = await repository.findByCommitment(commitment);
      if (!link) throw new HttpError(404, "Payment link not found");
      if (link.status === "claimed") throw new HttpError(400, "This payment link has already been claimed.");
      if (isExpired(link)) throw new HttpError(400, "This payment link has expired.");

      const tx = await readTransaction(txHash.toLowerCase());
      const paidAfterLinkCreated = tx && tx.createdAt + CLOCK_SKEW_MS >= new Date(link.created_at).getTime();
      if (!tx?.successful || !paidAfterLinkCreated || !(paysLinkFromWallet(tx, link) || paysLinkPrivately(tx, actor))) {
        throw new HttpError(400, "That transaction does not pay this link.");
      }

      const claimed = await repository.markClaimed(commitment);
      if (!claimed) throw new HttpError(400, "This payment link has already been claimed.");
      return claimed;
    },
  };
}
