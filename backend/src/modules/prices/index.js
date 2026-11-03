import { Router } from "express";
import { asyncHandler } from "../../http/errors.js";
import { logger } from "../../http/logger.js";
import { fetchCoinGeckoPrices, fetchFirstAvailable, fetchStellarDexPrices } from "../../price_sources.js";
import { createPriceService } from "./service.js";

// Sources in order: the Stellar DEX (mainnet XLM/USDC order book, no key
// needed), then CoinGecko.
const service = createPriceService({
  fetchPrices: () =>
    fetchFirstAvailable([
      ["stellar-dex", () => fetchStellarDexPrices()],
      ["coingecko", () => fetchCoinGeckoPrices()],
    ]),
  logger,
});

export const pricesRouter = Router();
pricesRouter.get(
  "/api/prices",
  asyncHandler(async (req, res) => {
    res.status(200).json(await service.current());
  })
);
