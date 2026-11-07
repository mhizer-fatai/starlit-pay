// Public protocol statistics for the dashboard. Cached briefly: every call
// otherwise costs two database counts and two RPC simulations. When the chain
// can't be read, the value locked is reported as unknown, never a made-up figure.

const CACHE_MS = 60_000;

export function createStatsService({ countNotes, readPoolBalances, logger, now = Date.now }) {
  let cached = null;

  async function tvl() {
    try {
      const { xlm, usdc } = await readPoolBalances();
      return `${Math.round(usdc)} USDC & ${Math.round(xlm).toLocaleString("en-US")} XLM`;
    } catch (err) {
      logger.warn("Pool balance unavailable for stats:", err);
      return null;
    }
  }

  return {
    async get() {
      if (cached && now() - cached.at < CACHE_MS) return cached.stats;
      const [{ notes, transactions }, tvlFormatted] = await Promise.all([countNotes(), tvl()]);
      const stats = {
        transactionsCount: transactions,
        notesCommitted: notes,
        tvlFormatted,
        zkProofsVerified: transactions,
        network: "Stellar Testnet",
        status: "live",
      };
      cached = { stats, at: now() };
      return stats;
    },
  };
}
