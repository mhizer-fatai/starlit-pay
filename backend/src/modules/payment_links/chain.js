import * as StellarSdk from "@stellar/stellar-sdk";
import { poolAssetCode } from "../../tokens.js";

// "XLM" or "USDC" only for the pool's real assets: a look-alike USDC from
// another issuer must not pay a USDC link.
const describeAsset = (asset) => poolAssetCode(asset) ?? (asset.isNative() ? "XLM" : `${asset.getCode()}:${asset.getIssuer()}`);

/** Reads a transaction from the network into the facts a payment link claim needs. Null if unknown. */
export function createTransactionReader({ rpc, networkPassphrase }) {
  return async function readTransaction(hash) {
    const tx = await rpc.getTransaction(hash);
    if (tx.status === "NOT_FOUND") return null;

    const parsed = StellarSdk.TransactionBuilder.fromXDR(tx.envelopeXdr, networkPassphrase);
    const inner = parsed instanceof StellarSdk.FeeBumpTransaction ? parsed.innerTransaction : parsed;

    const payments = [];
    const contractCalls = [];
    for (const op of inner.operations) {
      if (op.type === "payment") {
        payments.push({ destination: op.destination, asset: describeAsset(op.asset), amount: Number(op.amount) });
      } else if (op.type === "invokeHostFunction" && op.func.switch().name === "hostFunctionTypeInvokeContract") {
        const call = op.func.invokeContract();
        contractCalls.push({
          contract: StellarSdk.Address.fromScAddress(call.contractAddress()).toString(),
          fn: call.functionName().toString(),
        });
      }
    }

    return {
      successful: tx.status === "SUCCESS",
      source: inner.source,
      memo: inner.memo.type === "id" ? String(inner.memo.value) : null,
      createdAt: tx.createdAt * 1000,
      payments,
      contractCalls,
    };
  };
}
