export function createSmartWalletRepository(supabase, logger) {
  const users = () => supabase.from("users");

  return {
    /** select("*"): the birth columns may not exist until schema_smart_wallet.sql is re-run. */
    async findUser(id) {
      const { data, error } = await users().select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      return data;
    },

    async activePasskeys(userId) {
      const { data, error } = await supabase
        .from("passkeys")
        .select("id, credential_id, public_key, device_name, pending_until")
        .eq("user_id", userId)
        .is("revoked_at", null);
      if (error) throw error;
      return data ?? [];
    },

    /**
     * First wallet only: an address already set is never replaced. Called after
     * the wallet exists on chain, so a failure is logged, not thrown: the
     * creation succeeded either way.
     */
    async setWalletAddress(userId, address, createdAt) {
      const { error } = await users().update({ smart_wallet_address: address, smart_wallet_created_at: createdAt }).eq("id", userId).is("smart_wallet_address", null);
      if (error) logger.error("Could not store the new smart wallet address:", error.message);
    },

    /** The creation transaction; kept separate so it works even before the birth columns exist. */
    async setBirth(userId, birth, walletAddress) {
      let query = users().update({ smart_wallet_tx_hash: birth.txHash, smart_wallet_ledger: birth.ledger }).eq("id", userId);
      if (walletAddress) query = query.eq("smart_wallet_address", walletAddress);
      const { error } = await query;
      if (error) logger.warn("Could not store wallet birth (run schema_smart_wallet.sql):", error.message);
    },
  };
}
