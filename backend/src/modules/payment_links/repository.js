const NOT_FOUND = "PGRST116";
const UNIQUE_VIOLATION = "23505";

export function createPaymentLinksRepository(supabase) {
  return {
    async create(link) {
      const { data, error } = await supabase.from("payment_links").insert([link]).select().single();
      if (error) throw error;
      return data;
    },

    async findByCommitment(commitment) {
      const { data, error } = await supabase
        .from("payment_links")
        .select("*, creator:creator_id(username, display_name, avatar_url, deposit_memo, public_encryption_key)")
        .eq("commitment", commitment)
        .single();
      if (error?.code === NOT_FOUND) return null;
      if (error) throw error;
      return data;
    },

    /**
     * Claims only a pending link, so two simultaneous claims can't both win.
     * Null if it wasn't pending; "hash_used" if that payment already claimed
     * another link (claim_tx_hash is unique, see schema_phase3.sql).
     */
    async markClaimed(commitment, txHash) {
      const { data, error } = await supabase
        .from("payment_links")
        .update({ status: "claimed", claim_tx_hash: txHash })
        .eq("commitment", commitment)
        .eq("status", "pending")
        .select()
        .maybeSingle();
      if (error?.code === UNIQUE_VIOLATION) return "hash_used";
      if (error) throw error;
      return data;
    },
  };
}
