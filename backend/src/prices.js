import { app } from "./config.js";
import { fetchCoinGeckoPrices, fetchFirstAvailable, fetchStellarDexPrices } from "./price_sources.js";

// Live crypto prices proxied through the backend so browsers never touch
// upstream APIs directly (avoids CORS issues and per-client rate limiting).
// Sources, in order: the Stellar DEX (mainnet XLM/USDC order book, no key
// needed), then CoinGecko. Response: { USDC, XLM, updatedAt, stale, source }

const CACHE_TTL_MS = 60 * 1000;

const FALLBACK = { USDC: 1, XLM: 0.12 };

let cache = { ...FALLBACK, updatedAt: 0, stale: true, source: "fallback" };
let refreshPromise = null;

const SOURCES = [
  ["stellar-dex", () => fetchStellarDexPrices()],
  ["coingecko", () => fetchCoinGeckoPrices()],
];

async function refreshPrices() {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    try {
      const prices = await fetchFirstAvailable(SOURCES);
      cache = { ...prices, updatedAt: Date.now(), stale: false };
    } catch (err) {
      console.warn("Price refresh failed, serving cache:", err.message);
      cache = { ...cache, stale: true };
    } finally {
      refreshPromise = null;
    }
    return cache;
  })();
  return refreshPromise;
}

app.get("/api/prices", async (_req, res) => {
  try {
    if (Date.now() - cache.updatedAt >= CACHE_TTL_MS) {
      await refreshPrices();
    }
    res.status(200).json({
      USDC: cache.USDC,
      XLM: cache.XLM,
      updatedAt: cache.updatedAt,
      stale: cache.stale,
      source: cache.source,
    });
  } catch (error) {
    console.error("Prices API error:", error.message);
    res.status(200).json({ ...FALLBACK, updatedAt: 0, stale: true, source: "fallback" });
  }
});
