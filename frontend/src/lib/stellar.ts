import * as StellarSdk from "@stellar/stellar-sdk";

export const HORIZON_URL = "https://horizon-testnet.stellar.org";
export const RPC_URL = "https://soroban-testnet.stellar.org";
export const NETWORK_PASSPHRASE = StellarSdk.Networks.TESTNET;

export const horizon = new StellarSdk.Horizon.Server(HORIZON_URL);
export const rpc = new StellarSdk.rpc.Server(RPC_URL);

export const SHIELDED_POOL_CONTRACT_ID = "CAHSOWD7JVCRO4U73MGXRET7DRJDM3K2CFS5EGYARWDEGACHWSR6ZEZM";
export const DEPOSIT_GATEWAY_ADDRESS = "GCDQQE7CPLIGMAH4QEB2SSIEAS5MZMFSQAYSEJYSF7P5ZLA6HOU4BWWY";

export const TOKENS: Record<string, string> = {
  XLM: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
  USDC: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
};

export const CLASSIC_TOKENS: Record<string, string> = {
  USDC: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
};

export async function getPublicBalances(
  publicKey: string,
  tokensMap: Record<string, string> = {}
): Promise<Record<string, string>> {
  try {
    const account = await horizon.loadAccount(publicKey);
    const balances: Record<string, string> = { XLM: "0" };

    for (const key of Object.keys(tokensMap)) {
      balances[key] = "0";
    }

    for (const b of account.balances) {
      if (b.asset_type === "native") {
        balances.XLM = b.balance;
      } else if ("asset_code" in b && "asset_issuer" in b) {
        for (const [code, issuer] of Object.entries(tokensMap)) {
          if (b.asset_code === code && b.asset_issuer === issuer) {
            balances[code] = b.balance;
          }
        }
      }

    }
    return balances;
  } catch (error: unknown) {
    const defaultBals: Record<string, string> = { XLM: "0", unactivated: "true" };
    for (const key of Object.keys(tokensMap)) {
      defaultBals[key] = "0";
    }
    return defaultBals;
  }
}

export async function buildPublicPaymentTxXdr(
  senderPublicKey: string,
  recipientAddress: string,
  amount: number,
  assetCode: string,
  assetIssuer?: string,
  memoId?: string | number
): Promise<string> {
  const account = await horizon.loadAccount(senderPublicKey);

  let asset: StellarSdk.Asset;
  if (assetCode === "XLM") {
    asset = StellarSdk.Asset.native();
  } else {
    const matchedBalance = account.balances.find(
      (b: any) => b.asset_code === assetCode && parseFloat(b.balance) > 0
    ) || account.balances.find((b: any) => b.asset_code === assetCode);
    const effectiveIssuer =
      (matchedBalance as any)?.asset_issuer ||
      assetIssuer ||
      CLASSIC_TOKENS[assetCode] ||
      "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
    asset = new StellarSdk.Asset(assetCode, effectiveIssuer);
  }

  const txBuilder = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      StellarSdk.Operation.payment({
        destination: recipientAddress,
        asset: asset,
        amount: amount.toFixed(7),
      })
    )
    .setTimeout(180);

  if (memoId) {
    txBuilder.addMemo(StellarSdk.Memo.id(memoId.toString()));
  }

  const tx = txBuilder.build();
  return tx.toXDR();
}

export async function submitSignedXdr(signedXdr: string): Promise<string> {
  try {
    const tx = StellarSdk.TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE);
    const response = await horizon.submitTransaction(tx as any);
    return (response as any).hash;
  } catch (err: any) {
    if (err.response?.data?.extras?.result_codes) {
      const resultCodes = err.response.data.extras.result_codes;
      const opCodes = resultCodes.operations ? `, Operations: ${resultCodes.operations.join(", ")}` : "";
      throw new Error(`Transaction failed. Transaction code: ${resultCodes.transaction}${opCodes}`);
    }
    throw err;
  }
}

export function generateSep0007Uri(params: {
  destination: string;
  amount?: number | string;
  asset?: "USDC" | "XLM" | string;
  memo?: string | number;
}): string {
  const url = new URL("web+stellar:pay");
  url.searchParams.set("destination", params.destination);
  if (params.amount && Number(params.amount) > 0) {
    url.searchParams.set("amount", Number(params.amount).toFixed(7));
  }
  if (params.asset && params.asset !== "XLM") {
    url.searchParams.set("asset_code", params.asset);
    if (CLASSIC_TOKENS[params.asset]) {
      url.searchParams.set("asset_issuer", CLASSIC_TOKENS[params.asset]);
    }
  }
  if (params.memo) {
    url.searchParams.set("memo", params.memo.toString());
    url.searchParams.set("memo_type", "id");
  }
  return url.toString();
}

const txHashCache = new Map<string, string>();

/** Resolves the on-chain Soroban transaction hash for a shielded note commitment. */
export async function findTxHashForCommitment(
  commitment: string,
  ledger?: number
): Promise<string | null> {
  if (!commitment) return null;
  const cleanCommitment = commitment.toLowerCase().trim();
  if (txHashCache.has(cleanCommitment)) {
    return txHashCache.get(cleanCommitment)!;
  }

  try {
    let startLedger: number;
    let endLedger: number | undefined;

    if (ledger && Number.isFinite(ledger) && ledger > 0) {
      startLedger = ledger;
      endLedger = ledger + 1;
    } else {
      const latest = await rpc.getLatestLedger();
      startLedger = Math.max(1, latest.sequence - 300);
    }

    const filter: StellarSdk.rpc.Server.GetEventsRequest = {
      startLedger,
      filters: [
        {
          type: "contract",
          contractIds: [SHIELDED_POOL_CONTRACT_ID],
        },
      ],
      limit: 100,
    };
    if (endLedger) {
      filter.endLedger = endLedger;
    }

    const res = await rpc.getEvents(filter);
    if (!res.events || res.events.length === 0) return null;

    for (const e of res.events) {
      try {
        const valArray = StellarSdk.scValToNative(e.value);
        if (Array.isArray(valArray)) {
          for (const item of valArray) {
            let hex = "";
            if (Buffer.isBuffer(item) || item instanceof Uint8Array) {
              hex = Buffer.from(item).toString("hex").toLowerCase();
            } else if (typeof item === "string") {
              hex = item.toLowerCase();
            }
            if (hex === cleanCommitment && e.txHash) {
              txHashCache.set(cleanCommitment, e.txHash);
              return e.txHash;
            }
          }
        }
      } catch {
        // continue
      }
    }

    if (endLedger && res.events.length === 1 && res.events[0].txHash) {
      txHashCache.set(cleanCommitment, res.events[0].txHash);
      return res.events[0].txHash;
    }
  } catch (err) {
    console.warn("findTxHashForCommitment query error:", err);
  }
  return null;
}

