import * as StellarSdk from "@stellar/stellar-sdk";
import { HttpError } from "../../http/errors.js";

const MAX_FEE_STROOPS = 50_000_000; // 5 XLM: refuse anything unusually expensive

/** Submits checked smart-wallet invocations with the relayer paying the fee. */
export function createSponsorChain({ rpc, relayerKeypair, networkPassphrase, queue, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  async function waitForTx(hash) {
    for (let i = 0; i < 40; i++) {
      const res = await rpc.getTransaction(hash);
      if (res.status === "SUCCESS" || res.status === "FAILED") return res;
      await sleep(1500);
    }
    return { status: "TIMEOUT" };
  }

  return {
    sponsoring: Boolean(relayerKeypair),
    getTransaction: (hash) => rpc.getTransaction(hash),

    // The relayer account is shared: wait our turn (see relayer_account.js).
    sponsor: (checked) =>
      queue(async () => {
        const account = await rpc.getAccount(relayerKeypair.publicKey());
        let tx = new StellarSdk.TransactionBuilder(account, { fee: StellarSdk.BASE_FEE, networkPassphrase })
          .addOperation(StellarSdk.Operation.invokeHostFunction({ func: checked.func, auth: checked.auth }))
          .setTimeout(60)
          .build();
        tx = await rpc.prepareTransaction(tx);

        // The submitted authorization must be exactly what was checked.
        const preparedAuth = tx.operations[0].auth.map((a) => a.toXDR("base64")).sort().join();
        const checkedAuth = checked.auth.map((a) => a.toXDR("base64")).sort().join();
        if (preparedAuth !== checkedAuth) throw new HttpError(403, "Authorization changed during preparation.", "NOT_SPONSORED");
        if (Number(tx.fee) > MAX_FEE_STROOPS) throw new HttpError(403, "This transaction is too expensive to sponsor.", "FEE_TOO_HIGH");

        tx.sign(relayerKeypair);
        const sent = await rpc.sendTransaction(tx);
        if (sent.status === "ERROR") throw new HttpError(502, "The network rejected the transaction.", "SUBMIT_FAILED");
        const done = await waitForTx(sent.hash);
        if (done.status !== "SUCCESS") throw new HttpError(502, `Transaction ${done.status.toLowerCase()}.`, "TX_FAILED");
        return { hash: sent.hash, ledger: done.ledger };
      }),
  };
}
