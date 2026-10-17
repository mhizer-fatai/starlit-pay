// Price sources for /api/prices. Pure functions plus fetchers with an
// injectable fetch, so they can be tested without the network.

// Prices always come from Stellar MAINNET: testnet order books are play money.
export const STELLAR_DEX_HORIZON_URL = process.env.STELLAR_PRICE_HORIZON_URL || "https://horizon.stellar.org";

// Circle's USDC on Stellar mainnet (home domain centre.io)
export const CIRCLE_USDC_ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

const COINGECKO_URL =
  "https://api.coingecko.com/api/v3/simple/price?ids=stellar,usd-coin&vs_currencies=usd";

// Reject thin or broken books: a wide spread means the mid price is not a market price.
export const MAX_DEX_SPREAD = 0.02;

/**
 * Mid price of the XLM/USDC order book (USDC per XLM), or null when the book
 * is empty, malformed, crossed or too wide to trust.
 */
export function midPriceFromOrderBook(book) {
  const bid = Number(book?.bids?.[0]?.price);
  const ask = Number(book?.asks?.[0]?.price);
  if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= 0) return null;
  if (bid > ask) return null;
  const mid = (bid + ask) / 2;
  if ((ask - bid) / mid > MAX_DEX_SPREAD) return null;
  return mid;
}

async function getJson(fetchImpl, url, { headers = {}, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { headers: { Accept: "application/json", ...headers }, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** XLM price from the Stellar DEX (XLM/USDC mainnet order book). USDC is taken as $1. */
export async function fetchStellarDexPrices({ fetchImpl = fetch, timeoutMs = 8000, horizonUrl = STELLAR_DEX_HORIZON_URL } = {}) {
  const url =
    `${horizonUrl}/order_book?selling_asset_type=native` +
    `&buying_asset_type=credit_alphanum4&buying_asset_code=USDC&buying_asset_issuer=${CIRCLE_USDC_ISSUER}&limit=1`;
  const book = await getJson(fetchImpl, url, { timeoutMs });
  const xlm = midPriceFromOrderBook(book);
  if (xlm === null) throw new Error("Stellar DEX order book unusable (empty, crossed or spread too wide)");
  return { XLM: xlm, USDC: 1, source: "stellar-dex" };
}

export async function fetchCoinGeckoPrices({ fetchImpl = fetch, timeoutMs = 8000, apiKey = process.env.COINGECKO_API_KEY } = {}) {
  const headers = apiKey ? { "x-cg-demo-api-key": apiKey } : {};
  const data = await getJson(fetchImpl, COINGECKO_URL, { headers, timeoutMs });
  const xlm = Number(data?.stellar?.usd);
  const usdc = Number(data?.["usd-coin"]?.usd);
  if (!Number.isFinite(xlm) || xlm <= 0 || !Number.isFinite(usdc) || usdc <= 0) {
    throw new Error("CoinGecko returned invalid prices");
  }
  return { XLM: xlm, USDC: usdc, source: "coingecko" };
}

/** Tries each source in order; returns the first good result, or throws with every failure. */
export async function fetchFirstAvailable(sources) {
  const errors = [];
  for (const [name, fetcher] of sources) {
    try {
      return await fetcher();
    } catch (err) {
      errors.push(`${name}: ${err.message}`);
    }
  }
  throw new Error(errors.join("; "));
}
