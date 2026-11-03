import * as StellarSdk from "@stellar/stellar-sdk";

/** Calls a pool contract method from the relayer account, which pays the fee. */
export function createPoolInvoker({ rpc, relayerKeypair, networkPassphrase, contractId, queue, waitFor }) {
  return function invoke(method, args) {
    return queue(async () => {
      const account = await rpc.getAccount(relayerKeypair.publicKey());
      const built = new StellarSdk.TransactionBuilder(account, { fee: StellarSdk.BASE_FEE, networkPassphrase })
        .addOperation(new StellarSdk.Contract(contractId).call(method, ...args))
        .setTimeout(180)
        .build();

      const simulation = await rpc.simulateTransaction(built);
      if (StellarSdk.rpc.Api.isSimulationError(simulation)) throw new Error(`Simulation failed: ${simulation.error}`);
      const tx = StellarSdk.rpc.assembleTransaction(built, simulation).build();
      tx.sign(relayerKeypair);

      const sent = await rpc.sendTransaction(tx);
      if (sent.status === "ERROR" || sent.status === "TRY_AGAIN_LATER") throw new Error(`Tx submission failed: ${sent.status}`);
      const result = await waitFor(sent.hash);
      if (result.status !== "SUCCESS") throw new Error(`Transaction finished with status: ${result.status}`);
      return { hash: sent.hash, ledger: result.ledger };
    });
  };
}
