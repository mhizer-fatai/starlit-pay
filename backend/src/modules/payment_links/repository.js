const NOT_FOUND = "PGRST116";

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

    /** Claims only a pending link, so two simultaneous claims can't both win. Null if it wasn't pending. */
    async markClaimed(commitment) {
      const { data, error } = await supabase
        .from("payment_links")
        .update({ status: "claimed" })
        .eq("commitment", commitment)
        .eq("status", "pending")
        .select()
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  };
}
