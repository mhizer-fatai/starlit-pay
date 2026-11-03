// The cooldown lives on the user row (users.faucet_claimed_at, see
// schema_faucet.sql). It used to live in a file that every deploy wiped.

export function createFaucetRepository(supabase) {
  const users = () => supabase.from("users");

  return {
    async findById(id) {
      const { data, error } = await users().select("id, deposit_memo, faucet_claimed_at").eq("id", id).maybeSingle();
      if (error) throw error;
      return data;
    },

    async findByViewingKey(viewingKey) {
      const { data, error } = await users().select("faucet_claimed_at").eq("public_encryption_key", viewingKey).maybeSingle();
      if (error) throw error;
      return data;
    },

    /** Sets the claim time only if the last claim is older than cutoff. False if it wasn't. */
    async claimCooldown(id, claimedAt, cutoff) {
      const { data, error } = await users()
        .update({ faucet_claimed_at: claimedAt })
        .eq("id", id)
        .or(`faucet_claimed_at.is.null,faucet_claimed_at.lt.${cutoff}`)
        .select("id");
      if (error) throw error;
      return data.length === 1;
    },

    async restoreCooldown(id, previous) {
      const { error } = await users().update({ faucet_claimed_at: previous }).eq("id", id);
      if (error) throw error;
    },
  };
}
