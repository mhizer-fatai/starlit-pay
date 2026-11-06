// Credits are rows of gateway_deposits (one per incoming payment). Every
// status change is conditional on the row's current state, so two requests
// can't both claim, finish or reopen the same credit.

export function createZkGatewayRepository(supabase) {
  const deposits = () => supabase.from("gateway_deposits");
  const row = (query, r) => query.eq("tx_hash", r.tx_hash).eq("op_index", r.op_index);
  const changed = async (query) => {
    const { data, error } = await query.select("tx_hash");
    if (error) throw error;
    return data.length === 1;
  };
  const stamp = () => new Date().toISOString();

  return {
    async openCredits(userId) {
      const { data, error } = await deposits().select("*").eq("user_id", userId).in("status", ["credited", "claiming"]).order("created_at");
      if (error) throw error;
      return data;
    },

    async getCredit(txHash, opIndex) {
      const { data, error } = await deposits().select("*").eq("tx_hash", txHash).eq("op_index", opIndex).maybeSingle();
      if (error) throw error;
      return data;
    },

    /** credited → claiming. False if someone else changed it first. */
    startClaim(r, claim) {
      return changed(row(deposits().update({ status: "claiming", ...claim, updated_at: stamp() }), r).eq("status", "credited"));
    },

    finishClaim(r) {
      return changed(row(deposits().update({ status: "done", pool_tx_hash: r.claim_tx_hash, updated_at: stamp() }), r).eq("status", "claiming").eq("claim_tx_hash", r.claim_tx_hash));
    },

    reopenClaim(r) {
      return changed(
        row(deposits().update({ status: "credited", claim_tx_hash: null, claim_expires_at: null, updated_at: stamp() }), r)
          .eq("status", "claiming")
          .eq("claim_tx_hash", r.claim_tx_hash)
      );
    },
  };
}
