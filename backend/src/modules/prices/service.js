// Live prices, proxied so browsers never call price APIs directly (CORS and
// per-client rate limits). Cached for a minute; concurrent requests share one
// refresh. When no source has ever answered, XLM is null: an invented price
// would value balances wrongly.

const CACHE_TTL_MS = 60_000;

export function createPriceService({ fetchPrices, logger, now = Date.now }) {
  let cache = { USDC: 1, XLM: null, updatedAt: 0, stale: true, source: "unavailable" };
  let refreshing = null;

  function refresh() {
    refreshing ??= (async () => {
      try {
        cache = { ...(await fetchPrices()), updatedAt: now(), stale: false };
      } catch (err) {
        logger.warn("Price refresh failed, serving cache:", err);
        cache = { ...cache, stale: true };
      } finally {
        refreshing = null;
      }
    })();
    return refreshing;
  }

  return {
    async current() {
      if (now() - cache.updatedAt >= CACHE_TTL_MS) await refresh();
      const { USDC, XLM, updatedAt, stale, source } = cache;
      return { USDC, XLM, updatedAt, stale, source };
    },
  };
}
