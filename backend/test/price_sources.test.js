import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  CIRCLE_USDC_ISSUER,
  fetchCoinGeckoPrices,
  fetchFirstAvailable,
  fetchStellarDexPrices,
  midPriceFromOrderBook,
} from "../src/price_sources.js";

const book = (bid, ask) => ({ bids: bid ? [{ price: String(bid) }] : [], asks: ask ? [{ price: String(ask) }] : [] });
const okFetch = (body, onUrl) => async (url) => {
  onUrl?.(url);
  return { ok: true, status: 200, json: async () => body };
};

describe("midPriceFromOrderBook", () => {
  test("returns the mid of best bid and ask", () => {
    assert.equal(midPriceFromOrderBook(book(0.17637, 0.17657)), (0.17637 + 0.17657) / 2);
  });

  test("rejects empty, crossed or malformed books", () => {
    assert.equal(midPriceFromOrderBook(book(null, 0.17)), null);
    assert.equal(midPriceFromOrderBook(book(0.17, null)), null);
    assert.equal(midPriceFromOrderBook(book(0.18, 0.17)), null, "crossed book");
    assert.equal(midPriceFromOrderBook({ bids: [{ price: "abc" }], asks: [{ price: "0.17" }] }), null);
    assert.equal(midPriceFromOrderBook(null), null);
  });

  test("rejects a spread wider than 2%", () => {
    assert.equal(midPriceFromOrderBook(book(0.17, 0.18)), null);
    assert.notEqual(midPriceFromOrderBook(book(0.17, 0.1733)), null);
  });
});

describe("fetchers", () => {
  test("Stellar DEX queries the mainnet XLM/Circle-USDC book", async () => {
    let requested = "";
    const prices = await fetchStellarDexPrices({ fetchImpl: okFetch(book(0.2, 0.2002), (u) => (requested = u)) });
    assert.equal(prices.source, "stellar-dex");
    assert.equal(prices.USDC, 1);
    assert.ok(Math.abs(prices.XLM - 0.2001) < 1e-9);
    assert.match(requested, /^https:\/\/horizon\.stellar\.org\/order_book\?selling_asset_type=native/);
    assert.ok(requested.includes(`buying_asset_issuer=${CIRCLE_USDC_ISSUER}`));
  });

  test("Stellar DEX throws on an unusable book", async () => {
    await assert.rejects(fetchStellarDexPrices({ fetchImpl: okFetch(book(null, null)) }), /unusable/);
  });

  test("CoinGecko parses prices and sends the demo key when set", async () => {
    let headers;
    const fetchImpl = async (_url, init) => {
      headers = init.headers;
      return { ok: true, status: 200, json: async () => ({ stellar: { usd: 0.18 }, "usd-coin": { usd: 0.9998 } }) };
    };
    const prices = await fetchCoinGeckoPrices({ fetchImpl, apiKey: "demo-key" });
    assert.deepEqual(prices, { XLM: 0.18, USDC: 0.9998, source: "coingecko" });
    assert.equal(headers["x-cg-demo-api-key"], "demo-key");
  });

  test("HTTP errors are reported", async () => {
    const fetchImpl = async () => ({ ok: false, status: 429, json: async () => ({}) });
    await assert.rejects(fetchCoinGeckoPrices({ fetchImpl, apiKey: undefined }), /HTTP 429/);
  });
});

describe("fetchFirstAvailable", () => {
  test("falls back to the next source when the first fails", async () => {
    const result = await fetchFirstAvailable([
      ["stellar-dex", async () => { throw new Error("down"); }],
      ["coingecko", async () => ({ XLM: 0.18, USDC: 1, source: "coingecko" })],
    ]);
    assert.equal(result.source, "coingecko");
  });

  test("reports every failure when all sources fail", async () => {
    await assert.rejects(
      fetchFirstAvailable([
        ["stellar-dex", async () => { throw new Error("down"); }],
        ["coingecko", async () => { throw new Error("HTTP 429"); }],
      ]),
      /stellar-dex: down; coingecko: HTTP 429/
    );
  });
});
