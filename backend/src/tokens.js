// The two assets the shielded pool holds, as classic assets and as their
// Stellar Asset Contracts (testnet).

export const USDC_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

export const TOKEN_CONTRACTS = {
  XLM: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
  USDC: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
};

/** "XLM" or "USDC" for the pool's assets; null for anything else, including look-alike USDC. */
export function poolAssetCode(asset) {
  if (asset.isNative()) return "XLM";
  if (asset.getCode() === "USDC" && asset.getIssuer() === USDC_ISSUER) return "USDC";
  return null;
}
