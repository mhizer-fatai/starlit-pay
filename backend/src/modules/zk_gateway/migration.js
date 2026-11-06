// Moving a user's balance from the older pool to the real-ZK pools.
//
// The user's app withdraws their old notes to the gateway through the relayer.
// The relayer knows which signed-in user asked, so when such a withdrawal
// lands, it becomes that user's gateway credit (once: the withdrawal's
// transaction hash is the record's key), and their device deposits it into
// the new pool like any other arrival.

const toAmount = (stroops) => `${stroops / 10_000_000n}.${String(stroops % 10_000_000n).padStart(7, "0")}`;

export function createMigrationCredits({ repository, gatewayAddress, tokens, enabled, logger }) {
  return async function recordWithdrawal({ recipient, token, amount, hash, userId }) {
    if (!enabled() || recipient !== gatewayAddress) return;
    const asset = Object.keys(tokens).find((code) => tokens[code] === token);
    // The money is at the gateway now: anything that stops the credit needs a person.
    if (!asset || !userId || !hash) {
      logger.error("Migration withdrawal reached the gateway but couldn't be credited; credit it by hand", { hash, userId, token, amount });
      return;
    }
    // The same conversion the relayer used for the on-chain amount.
    const stroops = BigInt(Math.round(amount * 10_000_000));
    const created = await repository.recordCredit({ tx_hash: hash, op_index: 0, memo: "migration", amount: toAmount(stroops), asset, user_id: userId });
    logger.info(created ? "Old-pool balance moved to the gateway as a credit" : "Migration credit already recorded", { userId, asset, amount: toAmount(stroops), hash });
  };
}
