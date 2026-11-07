// What the gateway asks of Stellar: Horizon for the payments it receives.
// (Depositing into the private pools happens from the user's device; see zk_gateway.)

export function createGatewayChain({ horizon, gatewayAddress }) {
  return {
    fetchTransaction: (hash) => horizon.transactions().transaction(hash).call(),

    async listIncoming(cursor, limit = 20) {
      const page = await horizon.transactions().forAccount(gatewayAddress).order("asc").cursor(cursor).limit(limit).call();
      return page.records;
    },

    async latestPagingToken() {
      const page = await horizon.transactions().forAccount(gatewayAddress).order("desc").limit(1).call();
      return page.records[0]?.paging_token ?? "0";
    },
  };
}
