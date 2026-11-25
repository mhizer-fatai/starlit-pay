import * as StellarSdk from "@stellar/stellar-sdk";
import { HttpError } from "../../http/errors.js";

// What Starlit's accounts check before signing a private-pool transaction
// (real ZK proofs, SPP contracts) that a user's browser built: the relayer for
// transfers and withdrawals, the gateway for deposits. The proof itself is
// checked by the pool, so the signer never needs to understand it.

const MAX_FEE_STROOPS = 50_000_000; // 5 XLM: far above a normal transact
const MAX_VALIDITY_SECONDS = 600;
// SPP builds transactions with no expiry; the signer, as the only one, adds
// this so a signed transaction can't linger.
const DEFAULT_VALIDITY_SECONDS = 300;

/**
 * Parses a browser-built transaction and checks it is exactly one `transact`
 * call to one of `pools`, with `signer` as source and pool sender and no one
 * else's authorization. Returns the transaction (given a 5-minute expiry if it
 * had none) and what it moves. `refuse(reason)` must throw.
 */
export function inspectPoolTransaction(xdr, { signer, pools, networkPassphrase, refuse, now = () => Date.now() }) {
  let tx;
  try {
    tx = StellarSdk.TransactionBuilder.fromXDR(xdr, networkPassphrase);
  } catch {
    throw new HttpError(400, "Invalid transaction.", "validation_error");
  }
  if (tx instanceof StellarSdk.FeeBumpTransaction) refuse("fee bumps are not accepted");
  if (!tx.timeBounds || Number(tx.timeBounds.maxTime) === 0) tx = withExpiry(tx, networkPassphrase, now);

  if (tx.source !== signer) refuse("the signer must be the transaction source");
  if (Number(tx.fee) > MAX_FEE_STROOPS) refuse("the fee is too high");
  const maxTime = Number(tx.timeBounds.maxTime);
  if (maxTime * 1000 > now() + MAX_VALIDITY_SECONDS * 1000) refuse("the transaction must expire within 10 minutes");
  if (tx.operations.length !== 1) refuse("exactly one operation is allowed");

  const [op] = tx.operations;
  if (op.type !== "invokeHostFunction" || op.func.switch().name !== "hostFunctionTypeInvokeContract") refuse("only a contract call is allowed");
  const call = op.func.invokeContract();
  const pool = StellarSdk.Address.fromScAddress(call.contractAddress()).toString();
  if (!pools.includes(pool)) refuse("only Starlit's private pools are allowed");
  if (call.functionName().toString() !== "transact") refuse("only the pool's transact call is allowed");

  const args = call.args();
  if (args.length !== 3) refuse("unexpected transact arguments");
  if (StellarSdk.Address.fromScVal(args[2]).toString() !== signer) refuse("the signer must be the pool sender");

  // Only the source account (the signer) may authorize: no one else's signature is involved.
  for (const entry of op.auth ?? []) {
    if (entry.credentials().switch().name !== "sorobanCredentialsSourceAccount") refuse("other accounts' authorizations are not accepted");
  }

  const ext = StellarSdk.scValToNative(args[1]);
  const recipient = typeof ext.recipient === "string" ? ext.recipient : String(ext.recipient);
  return { tx, pool, extAmount: BigInt(ext.ext_amount), recipient, expiresAt: maxTime };
}

function withExpiry(tx, networkPassphrase, now) {
  const envelope = tx.toEnvelope();
  const maxTime = Math.floor(now() / 1000) + DEFAULT_VALIDITY_SECONDS;
  envelope.v1().tx().cond(
    StellarSdk.xdr.Preconditions.precondTime(
      new StellarSdk.xdr.TimeBounds({ minTime: StellarSdk.xdr.Uint64.fromString("0"), maxTime: StellarSdk.xdr.Uint64.fromString(String(maxTime)) })
    )
  );
  return new StellarSdk.Transaction(envelope, networkPassphrase);
}

/** "12.5" (Horizon's 7-decimal amounts) → 125000000n. */
export function toStroops(amount) {
  const match = /^(\d+)(?:\.(\d{1,7}))?$/.exec(String(amount).trim());
  if (!match) throw new Error(`Not a token amount: ${amount}`);
  return BigInt(match[1]) * 10_000_000n + BigInt((match[2] ?? "").padEnd(7, "0"));
}
