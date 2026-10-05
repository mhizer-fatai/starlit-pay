import { app } from "./config.js";

// Live crypto prices proxied through the backend so browsers never touch
// CoinGecko directly (avoids CORS issues and per-client rate limiting).
// Response: { USDC, XLM, updatedAt, stale }

const COINGECKO_URL =
  "https://api.coingecko.com/api/v3/simple/price?ids=stellar,usd-coin&vs_currencies=usd";

const CACHE_TTL_MS = 60 * 1000;
const UPSTREAM_TIMEOUT_MS = 8000;

const FALLBACK = { USDC: 1, XLM: 0.12 };

let cache = { ...FALLBACK, updatedAt: 0, stale: true };
let refreshPromise = null;

async function refreshFromCoinGecko() {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
    try {
      const headers = { Accept: "application/json" };
      if (process.env.COINGECKO_API_KEY) {
        headers["x-cg-demo-api-key"] = process.env.COINGECKO_API_KEY;
      }
      const res = await fetch(COINGECKO_URL, { headers, signal: controller.signal });
      if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
      const data = await res.json();
      const xlm = Number(data?.stellar?.usd);
      const usdc = Number(data?.["usd-coin"]?.usd);
      if (!Number.isFinite(xlm) || xlm <= 0 || !Number.isFinite(usdc) || usdc <= 0) {
        throw new Error("CoinGecko returned invalid prices");
      }
      cache = { USDC: usdc, XLM: xlm, updatedAt: Date.now(), stale: false };
    } catch (err) {
      console.warn("Price refresh failed, serving cache:", err.message);
      cache = { ...cache, stale: true };
    } finally {
      clearTimeout(timer);
      refreshPromise = null;
    }
    return cache;
  })();
  return refreshPromise;
}

app.get("/api/prices", async (_req, res) => {
  try {
    if (Date.now() - cache.updatedAt >= CACHE_TTL_MS) {
      await refreshFromCoinGecko();
    }
    res.status(200).json({ USDC: cache.USDC, XLM: cache.XLM, updatedAt: cache.updatedAt, stale: cache.stale });
  } catch (error) {
    console.error("Prices API error:", error.message);
    res.status(200).json({ ...FALLBACK, updatedAt: 0, stale: true });
  }
});
