// Credits for money sent to the gateway by a contract call rather than a
// payment with a memo: a user's smart wallet transferring its public funds
// into their private balance. The gateway's payment watcher never sees these
// (they aren't payment operations); the relay that submitted the transfer
// knows whose it is, so it records the credit (once: the transaction hash is
// the record's key), and the user's device deposits it like any arrival.

const toAmount = (stroops) => `${stroops / 10_000_000n}.${String(stroops % 10_000_000n).padStart(7, "0")}`;

export function createDirectCredits({ repository, gatewayAddress, tokens, logger }) {
  return async function recordTransfer({ to, token, amount, hash, userId }) {
    if (to !== gatewayAddress) return;
    const asset = Object.keys(tokens).find((code) => tokens[code] === token);
    // The money is at the gateway now: anything that stops the credit needs a person.
    if (!asset || !userId || !hash) {
      logger.error("A transfer reached the gateway but couldn't be credited; credit it by hand", { hash, userId, token, amount: String(amount) });
      return;
    }
    const created = await repository.recordCredit({ tx_hash: hash, op_index: 0, memo: "wallet", amount: toAmount(amount), asset, user_id: userId });
    logger.info(created ? "Public funds sent to the gateway, credited" : "Gateway credit already recorded", { userId, asset, amount: toAmount(amount), hash });
  };
}
