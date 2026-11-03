import * as StellarSdk from "@stellar/stellar-sdk";

// Everything the gateway asks of Stellar: Horizon for incoming payments, RPC
// for the pool deposit it makes in return.

const TX_TIMEOUT_SECONDS = 180;

export function createGatewayChain({ rpc, horizon, gatewayKeypair, networkPassphrase, pollAttempts = 30, sleep }) {
  const wait = sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));

  return {
    txTimeoutSeconds: TX_TIMEOUT_SECONDS,

    fetchTransaction: (hash) => horizon.transactions().transaction(hash).call(),

    async listIncoming(cursor, limit = 20) {
      const page = await horizon.transactions().forAccount(gatewayKeypair.publicKey()).order("asc").cursor(cursor).limit(limit).call();
      return page.records;
    },

    async latestPagingToken() {
      const page = await horizon.transactions().forAccount(gatewayKeypair.publicKey()).order("desc").limit(1).call();
      return page.records[0]?.paging_token ?? "0";
    },

    /** SUCCESS, FAILED or NOT_FOUND. */
    async transactionStatus(hash) {
      return (await rpc.getTransaction(hash)).status;
    },

    /**
     * Builds and signs the deposit without sending it, so its hash can be
     * recorded first: if the process dies mid-send, the outcome can be looked up.
     */
    async prepareDeposit({ contractId, token, amount, commitmentHex, encryptedNoteHex }) {
      const contract = new StellarSdk.Contract(contractId);
      const account = await rpc.getAccount(gatewayKeypair.publicKey());
      const args = [
        StellarSdk.Address.fromString(gatewayKeypair.publicKey()).toScVal(),
        StellarSdk.Address.fromString(token).toScVal(),
        StellarSdk.nativeToScVal(BigInt(Math.round(amount * 10_000_000)), { type: "i128" }),
        StellarSdk.nativeToScVal(Buffer.from(commitmentHex, "hex"), { type: "bytes" }),
        StellarSdk.nativeToScVal(Buffer.from(encryptedNoteHex, "hex"), { type: "bytes" }),
      ];
      const built = new StellarSdk.TransactionBuilder(account, { fee: StellarSdk.BASE_FEE, networkPassphrase })
        .addOperation(contract.call("deposit", ...args))
        .setTimeout(TX_TIMEOUT_SECONDS)
        .build();

      const simulation = await rpc.simulateTransaction(built);
      if (StellarSdk.rpc.Api.isSimulationError(simulation)) throw new Error(`Simulation failed: ${simulation.error}`);
      const tx = StellarSdk.rpc.assembleTransaction(built, simulation).build();
      tx.sign(gatewayKeypair);
      const hash = tx.hash().toString("hex");

      return {
        hash,
        /** SUCCESS, FAILED (definitely not applied), or UNKNOWN (may still land). */
        async submit() {
          let sent;
          try {
            sent = await rpc.sendTransaction(tx);
          } catch {
            return "UNKNOWN"; // the request may have reached the network
          }
          if (sent.status === "ERROR" || sent.status === "TRY_AGAIN_LATER") return "FAILED";
          for (let i = 0; i < pollAttempts; i++) {
            const result = await rpc.getTransaction(hash).catch(() => null);
            if (result?.status === "SUCCESS" || result?.status === "FAILED") return result.status;
            await wait(1000);
          }
          return "UNKNOWN";
        },
      };
    },
  };
}
