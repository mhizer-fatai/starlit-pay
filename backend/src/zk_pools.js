// The real-ZK private pools (SPP contracts) on testnet, one per asset.
// ZK_POOL_XLM / ZK_POOL_USDC override them.
export const ZK_POOLS = {
  XLM: process.env.ZK_POOL_XLM || "CBPXO3XY6DVA4K6MU3K2JFYUOLUBFOMP2ACFFNVUP5LQZUZXFSTABPUX",
  USDC: process.env.ZK_POOL_USDC || "CBRXBWOEVQRNP7ZLGUTKG5UQBEFSOLLVHV4UEEVBKRPECB763YGHANLY",
};

// The pools' deposit limits (set at deployment), in stroops.
export const ZK_DEPOSIT_LIMITS = { minDeposit: 1_000_000n, maxDeposit: 500_000_000_000n };
